/**
 * Named groups of apps the shield can block, and which group each reason for
 * blocking uses: the rules, with no store, clock or native call in them.
 *
 * The apps in a group are opaque tokens only iOS can read, so they live in the
 * native side's App Group container, one file per group. All this module holds
 * is the part React can know: a group's id and name, and which group a focus
 * session, a task gate, a failed-task penalty, a key tag and each schedule
 * point at.
 *
 * **A group that cannot be found resolves to the fallback group (Default unless
 * the person made another group the default), never to nothing.** A
 * reason pointing at a removed group would otherwise block no apps at all while
 * every switch still read as on. Default is also the group that held the one
 * app selection before groups existed, so an install that upgrades blocks
 * exactly what it did.
 *
 * **A supergroup is a group that names other groups instead of holding apps.**
 * It has no selection file: the apps are opaque tokens only iOS can read, so
 * two selections can't be merged here, and two groups can hold the same app, so
 * their counts can't be summed either. It is a list of plain group ids that
 * `expandGroupId` turns into those groups wherever a reason is resolved, which
 * is also why the native side never hears about one: everything written to it
 * has been expanded first. A supergroup holds plain groups only, never another
 * supergroup.
 */

/** The settings row holding the custom groups, as JSON. Device-local, like the tokens. */
export const APP_GROUPS_SETTING = 'appGroups';
/** The settings row holding which group each reason uses, as JSON. Device-local. */
export const GROUP_ASSIGNMENTS_SETTING = 'appGroupAssignments';

/** The settings row holding the original group's display name, plain text. Device-local. */
export const BASE_GROUP_NAME_SETTING = 'appGroupBaseName';
/** The settings row holding the id of the group a missing group resolves to, plain text. Device-local. */
export const FALLBACK_GROUP_SETTING = 'appGroupFallback';

/**
 * The group that holds the original app selection. Always present and never
 * removed; its name can be changed (`GroupsMeta.baseName`) but its id is the
 * native selection file's name, so that never changes.
 */
export const DEFAULT_GROUP_ID = 'default';
export const DEFAULT_GROUP_NAME = 'Default';

/** Custom groups, not counting Default. */
export const MAX_APP_GROUPS = 7;
/** Supergroups, counted apart from the plain groups since they hold no selection file. */
export const MAX_SUPERGROUPS = 7;
export const MAX_GROUP_NAME_LENGTH = 24;

export interface AppGroup {
  id: string;
  name: string;
  /**
   * The plain groups a supergroup combines (Default's id counts). Present, even
   * when empty, exactly when this is a supergroup. Never an allowlist.
   */
  members?: string[];
  /**
   * An allowlist: while a reason holds this group, every app is blocked
   * *except* the ones picked. Absent is the original mode, where the picked apps
   * are the ones blocked. See `allowGroupIds` for what keeps this from going
   * wrong.
   */
  allowOnly?: boolean;
}

export function isSupergroup(group: AppGroup | undefined): boolean {
  return group !== undefined && Array.isArray(group.members);
}

/** The groups that hold apps: Default and every custom group that isn't a supergroup. */
export function plainGroups(custom: readonly AppGroup[], meta: GroupsMeta = DEFAULT_GROUPS_META): AppGroup[] {
  return allGroups(custom, meta).filter(g => !isSupergroup(g));
}

/**
 * The groups a supergroup can combine: plain groups that block their own apps.
 * **Never an allowlist.** An allowlist blocks everything *except* its apps, so
 * "Social or Games" over one would read as the opposite of what either group
 * says. A group made an allowlist leaves every supergroup (`withGroupMode`).
 */
export function memberGroups(custom: readonly AppGroup[], meta: GroupsMeta = DEFAULT_GROUPS_META): AppGroup[] {
  return plainGroups(custom, meta).filter(g => g.allowOnly !== true);
}

/** The reasons that take a group directly. A schedule carries its own `groupId`. */
export type GroupedReason = 'focus' | 'gate' | 'penalty' | 'key';

export const GROUPED_REASONS: readonly GroupedReason[] = ['focus', 'gate', 'penalty', 'key'];

export type GroupAssignments = Record<GroupedReason, string>;

export const DEFAULT_ASSIGNMENTS: GroupAssignments = {
  focus: DEFAULT_GROUP_ID,
  gate: DEFAULT_GROUP_ID,
  penalty: DEFAULT_GROUP_ID,
  key: DEFAULT_GROUP_ID,
};

/** Ids become file names in the App Group container, so nothing else is accepted. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export const DEFAULT_GROUP: AppGroup = { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME };

/**
 * The two things about the original group that a person can change: what it is
 * called, and whether it is still the group a missing group falls back to. The
 * id of the fallback may be any group, so "Default" is a role as well as a name.
 */
export interface GroupsMeta {
  baseName: string;
  fallbackId: string;
}

export const DEFAULT_GROUPS_META: GroupsMeta = { baseName: DEFAULT_GROUP_NAME, fallbackId: DEFAULT_GROUP_ID };

export function parseGroupsMeta(
  baseName: string | null | undefined,
  fallbackId: string | null | undefined,
  custom: readonly AppGroup[],
): GroupsMeta {
  return {
    baseName: baseName ? cleanGroupName(baseName, DEFAULT_GROUP_NAME) : DEFAULT_GROUP_NAME,
    // A fallback that no longer exists, or is a supergroup, is the original group, never nothing.
    fallbackId: fallbackId && custom.some(g => g.id === fallbackId && !isSupergroup(g)) ? fallbackId : DEFAULT_GROUP_ID,
  };
}

/** The name as stored: trimmed, capped, and never empty. */
export function cleanGroupName(raw: string, fallback = 'New group'): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_GROUP_NAME_LENGTH);
  return name || fallback;
}

/**
 * The custom groups out of the settings row. Malformed entries are dropped
 * rather than thrown on, since this runs at launch; a lost group falls back to
 * Default for whatever pointed at it.
 */
export function parseAppGroups(raw: string | null | undefined): AppGroup[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>([DEFAULT_GROUP_ID]);
  const groups: AppGroup[] = [];
  let plain = 0;
  let supers = 0;
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name, members, allowOnly } = item as Partial<AppGroup>;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    if (!ID_PATTERN.test(id) || seen.has(id)) continue;
    if (Array.isArray(members)) {
      if (supers >= MAX_SUPERGROUPS) continue;
      supers += 1;
      seen.add(id);
      // Members are checked against the plain groups once every row is read, below.
      groups.push({ id, name: cleanGroupName(name), members: members.filter((m): m is string => typeof m === 'string') });
    } else {
      if (plain >= MAX_APP_GROUPS) continue;
      plain += 1;
      seen.add(id);
      groups.push(allowOnly === true ? { id, name: cleanGroupName(name), allowOnly: true } : { id, name: cleanGroupName(name) });
    }
  }
  // A member that isn't a block-list group (removed, a supergroup, an allowlist, a repeat) is dropped, never kept as a dangling id.
  const plainIds = new Set([DEFAULT_GROUP_ID, ...groups.filter(g => !isSupergroup(g) && g.allowOnly !== true).map(g => g.id)]);
  return groups.map(g => (isSupergroup(g) ? { ...g, members: cleanMembers(g.members!, plainIds) } : g));
}

/** Member ids that name a plain group, once each, in the order given. */
function cleanMembers(members: readonly string[], plainIds: ReadonlySet<string>): string[] {
  return [...new Set(members)].filter(m => plainIds.has(m));
}

/** Default first, then the custom groups in the order the person made them. */
export function allGroups(custom: readonly AppGroup[], meta: GroupsMeta = DEFAULT_GROUPS_META): AppGroup[] {
  return [{ id: DEFAULT_GROUP_ID, name: meta.baseName }, ...custom];
}

export type AddGroupResult =
  | { ok: true; groups: AppGroup[] }
  | { ok: false; reason: 'full' | 'duplicate' | 'invalid' };

/** Add a group, refusing a repeated name (case aside) since two would be indistinguishable in a picker. */
export function withGroupAdded(
  custom: readonly AppGroup[],
  group: AppGroup,
  meta: GroupsMeta = DEFAULT_GROUPS_META,
): AddGroupResult {
  if (!ID_PATTERN.test(group.id) || group.id === DEFAULT_GROUP_ID) return { ok: false, reason: 'invalid' };
  const capped = isSupergroup(group)
    ? custom.filter(isSupergroup).length >= MAX_SUPERGROUPS
    : custom.filter(g => !isSupergroup(g)).length >= MAX_APP_GROUPS;
  if (capped) return { ok: false, reason: 'full' };
  const key = group.name.toLowerCase();
  if (key === meta.baseName.toLowerCase() || custom.some(g => g.name.toLowerCase() === key)) {
    return { ok: false, reason: 'duplicate' };
  }
  // In the order the groups are listed, not the order they were picked.
  const members = isSupergroup(group)
    ? memberGroups(custom, meta).map(g => g.id).filter(id => group.members!.includes(id))
    : undefined;
  return { ok: true, groups: [...custom, members ? { ...group, members } : group] };
}

export function withGroupRenamed(
  custom: readonly AppGroup[],
  id: string,
  name: string,
  meta: GroupsMeta = DEFAULT_GROUPS_META,
): AddGroupResult {
  const key = name.toLowerCase();
  if (key === meta.baseName.toLowerCase() || custom.some(g => g.id !== id && g.name.toLowerCase() === key)) {
    return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, groups: custom.map(g => (g.id === id ? { ...g, name } : g)) };
}

/**
 * The ids of the groups that block everything except their own apps.
 *
 * **Never the original group, and never the one a missing group falls back to.**
 * A reason pointing at a deleted group resolves to the fallback (see the header),
 * and that must mean "block some apps", not "block everything else": a deleted
 * group flipping a schedule into a lock on the whole phone is the failure this
 * rule exists to prevent. `withGroupMode` refuses to make the fallback an
 * allowlist and `useAppGroupStore.setDefaultGroup` refuses to make an allowlist
 * the fallback; this is the backstop for a stored state that says otherwise.
 */
export function allowGroupIds(custom: readonly AppGroup[], meta: GroupsMeta = DEFAULT_GROUPS_META): string[] {
  return custom.filter(g => g.allowOnly === true && g.id !== meta.fallbackId).map(g => g.id);
}

/** Whether a stored group id resolves to an allowlist. */
export function isAllowGroup(
  custom: readonly AppGroup[],
  id: string | null | undefined,
  meta: GroupsMeta = DEFAULT_GROUPS_META,
): boolean {
  return allowGroupIds(custom, meta).includes(resolveGroupId(custom, id, meta));
}

export type GroupModeResult =
  | { ok: true; groups: AppGroup[] }
  | { ok: false; reason: 'missing' | 'fallback' };

/** Set a custom group to block its apps or to allow only them. The fallback group can't be an allowlist. */
export function withGroupMode(
  custom: readonly AppGroup[],
  id: string,
  allowOnly: boolean,
  meta: GroupsMeta = DEFAULT_GROUPS_META,
): GroupModeResult {
  // A supergroup holds no apps of its own, so it has no mode to set.
  if (!custom.some(g => g.id === id && !isSupergroup(g))) return { ok: false, reason: 'missing' };
  if (allowOnly && id === meta.fallbackId) return { ok: false, reason: 'fallback' };
  return {
    ok: true,
    groups: custom.map(g => {
      if (isSupergroup(g)) return allowOnly && g.members!.includes(id) ? { ...g, members: g.members!.filter(m => m !== id) } : g;
      if (g.id !== id) return g;
      const { allowOnly: _old, ...rest } = g;
      return allowOnly ? { ...rest, allowOnly: true } : rest;
    }),
  };
}

/** The group gone, and gone from every supergroup that held it. */
export function withGroupRemoved(custom: readonly AppGroup[], id: string): AppGroup[] {
  return custom
    .filter(g => g.id !== id)
    .map(g => (isSupergroup(g) && g.members!.includes(id) ? { ...g, members: g.members!.filter(m => m !== id) } : g));
}

/** A supergroup's members set to the plain groups named, in the order the groups are listed. */
export function withMembersSet(
  custom: readonly AppGroup[],
  id: string,
  memberIds: readonly string[],
  meta: GroupsMeta = DEFAULT_GROUPS_META,
): AppGroup[] {
  const wanted = new Set(memberIds);
  const members = memberGroups(custom, meta).map(g => g.id).filter(m => wanted.has(m));
  return custom.map(g => (g.id === id && isSupergroup(g) ? { ...g, members } : g));
}

/** The plain groups a supergroup combines that still exist, in listed order. Empty for a plain group. */
export function supergroupMembers(custom: readonly AppGroup[], id: string, meta: GroupsMeta = DEFAULT_GROUPS_META): AppGroup[] {
  const group = custom.find(g => g.id === id);
  if (!isSupergroup(group)) return [];
  const members = new Set(group!.members);
  return memberGroups(custom, meta).filter(g => members.has(g.id));
}

/** The group a stored id means: itself when it exists, otherwise the fallback group. */
export function resolveGroupId(
  custom: readonly AppGroup[],
  id: string | null | undefined,
  meta: GroupsMeta = DEFAULT_GROUPS_META,
): string {
  if (id === DEFAULT_GROUP_ID) return DEFAULT_GROUP_ID;
  if (id && custom.some(g => g.id === id)) return id;
  return custom.some(g => g.id === meta.fallbackId) ? meta.fallbackId : DEFAULT_GROUP_ID;
}

/**
 * The plain groups an id blocks: itself for a plain group, its members for a
 * supergroup, and the fallback group for an id that no longer exists or a
 * supergroup with no members left. Never empty, for the reason the file header
 * gives. This is the one place a supergroup becomes apps, so everything handed
 * to the shield or to native code goes through it.
 */
export function expandGroupId(
  custom: readonly AppGroup[],
  id: string | null | undefined,
  meta: GroupsMeta = DEFAULT_GROUPS_META,
): string[] {
  const resolved = resolveGroupId(custom, id, meta);
  const group = custom.find(g => g.id === resolved);
  if (!isSupergroup(group)) return [resolved];
  const members = supergroupMembers(custom, resolved, meta).map(g => g.id);
  return members.length > 0 ? members : [resolveGroupId(custom, meta.fallbackId, meta)];
}

/** The name to show for an id, resolving a missing group to the fallback's. */
export function groupName(
  custom: readonly AppGroup[],
  id: string | null | undefined,
  meta: GroupsMeta = DEFAULT_GROUPS_META,
): string {
  const resolved = resolveGroupId(custom, id, meta);
  return resolved === DEFAULT_GROUP_ID ? meta.baseName : custom.find(g => g.id === resolved)?.name ?? meta.baseName;
}

export function parseGroupAssignments(raw: string | null | undefined): GroupAssignments {
  if (!raw) return { ...DEFAULT_ASSIGNMENTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_ASSIGNMENTS };
  }
  const out: GroupAssignments = { ...DEFAULT_ASSIGNMENTS };
  if (typeof parsed !== 'object' || parsed === null) return out;
  for (const reason of GROUPED_REASONS) {
    const value = (parsed as Record<string, unknown>)[reason];
    if (typeof value === 'string' && ID_PATTERN.test(value)) out[reason] = value;
  }
  return out;
}

/** Every reason's group with missing groups resolved to Default. */
export function resolveAssignments(
  custom: readonly AppGroup[],
  assignments: GroupAssignments,
  meta: GroupsMeta = DEFAULT_GROUPS_META,
): GroupAssignments {
  return {
    focus: resolveGroupId(custom, assignments.focus, meta),
    gate: resolveGroupId(custom, assignments.gate, meta),
    penalty: resolveGroupId(custom, assignments.penalty, meta),
    key: resolveGroupId(custom, assignments.key, meta),
  };
}

/** Assignments after a group is removed: whatever pointed at it goes back to Default. */
export function assignmentsAfterRemoval(assignments: GroupAssignments, id: string): GroupAssignments {
  const next = { ...assignments };
  for (const reason of GROUPED_REASONS) if (next[reason] === id) next[reason] = DEFAULT_GROUP_ID;
  return next;
}

/** Distinct ids in first-seen order. */
export function uniqueGroupIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
