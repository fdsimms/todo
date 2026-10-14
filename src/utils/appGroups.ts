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
 * **A group that cannot be found resolves to Default, never to nothing.** A
 * reason pointing at a removed group would otherwise block no apps at all while
 * every switch still read as on. Default is also the group that held the one
 * app selection before groups existed, so an install that upgrades blocks
 * exactly what it did.
 */

/** The settings row holding the custom groups, as JSON. Device-local, like the tokens. */
export const APP_GROUPS_SETTING = 'appGroups';
/** The settings row holding which group each reason uses, as JSON. Device-local. */
export const GROUP_ASSIGNMENTS_SETTING = 'appGroupAssignments';

/** The group that holds the original app selection. Always present, never renamed or removed. */
export const DEFAULT_GROUP_ID = 'default';
export const DEFAULT_GROUP_NAME = 'Default';

/** Custom groups, not counting Default. */
export const MAX_APP_GROUPS = 7;
export const MAX_GROUP_NAME_LENGTH = 24;

export interface AppGroup {
  id: string;
  name: string;
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
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name } = item as Partial<AppGroup>;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    if (!ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    groups.push({ id, name: cleanGroupName(name) });
  }
  return groups.slice(0, MAX_APP_GROUPS);
}

/** Default first, then the custom groups in the order the person made them. */
export function allGroups(custom: readonly AppGroup[]): AppGroup[] {
  return [DEFAULT_GROUP, ...custom];
}

export type AddGroupResult =
  | { ok: true; groups: AppGroup[] }
  | { ok: false; reason: 'full' | 'duplicate' | 'invalid' };

/** Add a group, refusing a repeated name (case aside) since two would be indistinguishable in a picker. */
export function withGroupAdded(custom: readonly AppGroup[], group: AppGroup): AddGroupResult {
  if (!ID_PATTERN.test(group.id) || group.id === DEFAULT_GROUP_ID) return { ok: false, reason: 'invalid' };
  if (custom.length >= MAX_APP_GROUPS) return { ok: false, reason: 'full' };
  const key = group.name.toLowerCase();
  if (key === DEFAULT_GROUP_NAME.toLowerCase() || custom.some(g => g.name.toLowerCase() === key)) {
    return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, groups: [...custom, group] };
}

export function withGroupRenamed(custom: readonly AppGroup[], id: string, name: string): AddGroupResult {
  const key = name.toLowerCase();
  if (key === DEFAULT_GROUP_NAME.toLowerCase() || custom.some(g => g.id !== id && g.name.toLowerCase() === key)) {
    return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, groups: custom.map(g => (g.id === id ? { ...g, name } : g)) };
}

export function withGroupRemoved(custom: readonly AppGroup[], id: string): AppGroup[] {
  return custom.filter(g => g.id !== id);
}

/** The group a stored id means: itself when it exists, otherwise Default. */
export function resolveGroupId(custom: readonly AppGroup[], id: string | null | undefined): string {
  if (!id || id === DEFAULT_GROUP_ID) return DEFAULT_GROUP_ID;
  return custom.some(g => g.id === id) ? id : DEFAULT_GROUP_ID;
}

/** The name to show for an id, resolving a missing group to Default's. */
export function groupName(custom: readonly AppGroup[], id: string | null | undefined): string {
  const resolved = resolveGroupId(custom, id);
  return resolved === DEFAULT_GROUP_ID ? DEFAULT_GROUP_NAME : custom.find(g => g.id === resolved)?.name ?? DEFAULT_GROUP_NAME;
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
export function resolveAssignments(custom: readonly AppGroup[], assignments: GroupAssignments): GroupAssignments {
  return {
    focus: resolveGroupId(custom, assignments.focus),
    gate: resolveGroupId(custom, assignments.gate),
    penalty: resolveGroupId(custom, assignments.penalty),
    key: resolveGroupId(custom, assignments.key),
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
