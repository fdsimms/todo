import type { WorkoutRoutine } from '../types';
import { cleanWorkoutName } from './workoutData';

/**
 * The Routines tab's headings. A group is just the name a routine carries
 * (`WorkoutRoutine.groupName`): there is no group row, so an empty group can't
 * exist, can't go stale, and two devices that both typed "Gym" agree without a
 * natural key to fold.
 */

type Grouped = Pick<WorkoutRoutine, 'groupName' | 'archived' | 'sortOrder'>;

export interface RoutineGroup<T> {
  name: string;
  routines: T[];
}

export interface RoutineSections<T> {
  /** Routines in no group, listed first with no heading. */
  ungrouped: T[];
  groups: RoutineGroup<T>[];
  archived: T[];
}

/** Every group name in use, in the order the tab lists them, archived routines included. */
export function groupNames(routines: readonly Grouped[]): string[] {
  const seen = new Map<string, string>();
  for (const r of [...routines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = r.groupName?.trim().toLowerCase();
    if (r.groupName && key && !seen.has(key)) seen.set(key, r.groupName);
  }
  return [...seen.values()];
}

/**
 * The name to store for a typed one: blank is no group, and a name that matches
 * a group already in use ignoring case takes that group's spelling, so
 * "gym" files under "Gym" instead of starting a second heading.
 */
export function resolveGroupName(typed: string | null, routines: readonly Grouped[]): string | null {
  if (typed === null) return null;
  const clean = cleanWorkoutName(typed);
  if (!clean) return null;
  const key = clean.toLowerCase();
  return groupNames(routines).find(n => n.toLowerCase() === key) ?? clean;
}

/**
 * Splits the list into what the tab draws. Groups follow the order of their
 * first routine, and routines keep `sortOrder` inside each. An archived routine
 * leaves its group's heading and count and is listed under Archived only.
 */
export function routineSections<T extends Grouped>(routines: readonly T[]): RoutineSections<T> {
  const ordered = [...routines].sort((a, b) => a.sortOrder - b.sortOrder);
  const live = ordered.filter(r => !r.archived);
  const names = groupNames(live);
  const keyOf = (r: Grouped) => r.groupName?.trim().toLowerCase() ?? '';
  return {
    ungrouped: live.filter(r => !keyOf(r)),
    groups: names.map(name => ({
      name,
      routines: live.filter(r => keyOf(r) === name.toLowerCase()),
    })),
    archived: ordered.filter(r => r.archived),
  };
}
