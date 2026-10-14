import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { generateId } from '../utils/id';
import {
  APP_GROUPS_SETTING, GROUP_ASSIGNMENTS_SETTING, assignmentsAfterRemoval, cleanGroupName,
  parseAppGroups, parseGroupAssignments, resolveAssignments, resolveGroupId, withGroupAdded,
  withGroupRemoved, withGroupRenamed, type AddGroupResult, type AppGroup, type GroupAssignments,
  type GroupedReason,
} from '../utils/appGroups';
import {
  BLOCK_SCHEDULES_SETTING, MAX_BLOCK_SCHEDULES, cleanScheduleName, parseBlockSchedules,
  pauseActiveSchedules, scheduleProblem, type BlockSchedule,
} from '../utils/blockSchedule';

/**
 * The named groups of apps, which group each reason blocks, and the schedules.
 *
 * All three live in the settings table and stay on this device (the sync
 * allowlist names settings that travel, and these are not on it), for the same
 * reason the key tags do: the apps in a group are opaque tokens only this
 * phone's Screen Time can read, so a group synced to another phone would name
 * apps it cannot resolve, and a schedule that blocked there with nothing in
 * its group would read as working.
 *
 * The shield itself is not written here. `useAppShieldSync` watches this store
 * and `appShield.ts` decides, because a schedule is one reason among five for
 * the one system shield.
 *
 * Held in memory and written through, so demo mode has to `reload()` it when
 * the database swaps (see `useDemoStore`).
 */

export type NewSchedule = Omit<BlockSchedule, 'id' | 'pausedUntil'>;

export type ScheduleResult =
  | { ok: true; schedule: BlockSchedule }
  | { ok: false; reason: 'full' | 'invalid'; message?: string };

interface AppGroupStore {
  /** Custom groups only; Default is implied (`allGroups`). */
  groups: AppGroup[];
  assignments: GroupAssignments;
  schedules: BlockSchedule[];
  initialize: () => void;
  /** Re-read from the current database, after a demo-mode swap. */
  reload: () => void;
  addGroup: (name: string) => AddGroupResult & { group?: AppGroup };
  renameGroup: (id: string, name: string) => AddGroupResult;
  removeGroup: (id: string) => void;
  /** Point a reason at a group. */
  assignGroup: (reason: GroupedReason, groupId: string) => void;
  addSchedule: (draft: NewSchedule) => ScheduleResult;
  updateSchedule: (id: string, draft: NewSchedule) => ScheduleResult;
  removeSchedule: (id: string) => void;
  setScheduleEnabled: (id: string, enabled: boolean) => void;
  /** Lift every open schedule until its window ends. Returns how many. */
  pauseOpenSchedules: (now: Date) => number;
}

function readState(): { groups: AppGroup[]; assignments: GroupAssignments; schedules: BlockSchedule[] } {
  return {
    groups: parseAppGroups(dbGetSetting(APP_GROUPS_SETTING)),
    assignments: parseGroupAssignments(dbGetSetting(GROUP_ASSIGNMENTS_SETTING)),
    schedules: parseBlockSchedules(dbGetSetting(BLOCK_SCHEDULES_SETTING)),
  };
}

const persistGroups = (groups: AppGroup[]) => dbSetSetting(APP_GROUPS_SETTING, JSON.stringify(groups));
const persistAssignments = (a: GroupAssignments) => dbSetSetting(GROUP_ASSIGNMENTS_SETTING, JSON.stringify(a));
const persistSchedules = (s: BlockSchedule[]) => dbSetSetting(BLOCK_SCHEDULES_SETTING, JSON.stringify(s));

export const useAppGroupStore = create<AppGroupStore>((set, get) => ({
  groups: [],
  assignments: parseGroupAssignments(null),
  schedules: [],

  initialize() {
    set(readState());
  },

  reload() {
    set(readState());
  },

  addGroup(name) {
    const group: AppGroup = { id: generateId(), name: cleanGroupName(name) };
    const added = withGroupAdded(get().groups, group);
    if (!added.ok) return added;
    persistGroups(added.groups);
    set({ groups: added.groups });
    return { ...added, group };
  },

  renameGroup(id, name) {
    const renamed = withGroupRenamed(get().groups, id, cleanGroupName(name));
    if (!renamed.ok) return renamed;
    persistGroups(renamed.groups);
    set({ groups: renamed.groups });
    return renamed;
  },

  removeGroup(id) {
    const groups = withGroupRemoved(get().groups, id);
    const assignments = assignmentsAfterRemoval(get().assignments, id);
    persistGroups(groups);
    persistAssignments(assignments);
    // Schedules keep the dangling id: resolving it to Default at use time is
    // the single rule (`resolveGroupId`), and rewriting them here would be a
    // second copy of it.
    set({ groups, assignments });
  },

  assignGroup(reason, groupId) {
    const assignments = { ...get().assignments, [reason]: resolveGroupId(get().groups, groupId) };
    persistAssignments(assignments);
    set({ assignments });
  },

  addSchedule(draft) {
    if (get().schedules.length >= MAX_BLOCK_SCHEDULES) return { ok: false, reason: 'full' };
    const problem = scheduleProblem(draft);
    if (problem) return { ok: false, reason: 'invalid', message: problem };
    const schedule: BlockSchedule = {
      ...draft,
      id: generateId(),
      name: cleanScheduleName(draft.name),
      days: [...new Set(draft.days)].sort(),
      pausedUntil: null,
    };
    const schedules = [...get().schedules, schedule];
    persistSchedules(schedules);
    set({ schedules });
    return { ok: true, schedule };
  },

  updateSchedule(id, draft) {
    const problem = scheduleProblem(draft);
    if (problem) return { ok: false, reason: 'invalid', message: problem };
    const existing = get().schedules.find(s => s.id === id);
    if (!existing) return { ok: false, reason: 'invalid' };
    // Editing a window ends a pause: the instance a tag lifted may no longer
    // exist in the shape it was lifted in.
    const schedule: BlockSchedule = {
      ...draft,
      id,
      name: cleanScheduleName(draft.name),
      days: [...new Set(draft.days)].sort(),
      pausedUntil: null,
    };
    const schedules = get().schedules.map(s => (s.id === id ? schedule : s));
    persistSchedules(schedules);
    set({ schedules });
    return { ok: true, schedule };
  },

  removeSchedule(id) {
    const schedules = get().schedules.filter(s => s.id !== id);
    persistSchedules(schedules);
    set({ schedules });
  },

  setScheduleEnabled(id, enabled) {
    const schedules = get().schedules.map(s => (s.id === id ? { ...s, enabled, pausedUntil: null } : s));
    persistSchedules(schedules);
    set({ schedules });
  },

  pauseOpenSchedules(now) {
    const { schedules, paused } = pauseActiveSchedules(get().schedules, now);
    if (paused === 0) return 0;
    persistSchedules(schedules);
    set({ schedules });
    return paused;
  },
}));

/** The groups each reason resolves to right now, with a removed group read as Default. */
export function resolvedAssignments(): GroupAssignments {
  const { groups, assignments } = useAppGroupStore.getState();
  return resolveAssignments(groups, assignments);
}

/** A stored group id as the shield will use it. */
export function resolveGroupNow(groupId: string): string {
  return resolveGroupId(useAppGroupStore.getState().groups, groupId);
}
