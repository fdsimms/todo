import type { WorkoutRoutine } from '../types';
import { cleanWorkoutName } from './workoutData';

/**
 * The Routines tab's headings. A group is a name: the routines filed under it
 * carry it (`WorkoutRoutine.groupName`), and the list of names the person made
 * (`routineGroups` in `useWorkoutStore`, a synced setting) is what lets a group
 * exist with nothing in it yet. The two are unioned, so a routine that syncs in
 * under a name the list hasn't heard of yet still gets its heading.
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

const keyOf = (name: string | null | undefined) => (name ?? '').trim().toLowerCase();

/** The names in `registry` order, each once, then any a routine holds that the registry doesn't. */
function mergedNames(routines: readonly Grouped[], registry: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of registry) {
    const key = keyOf(name);
    if (key && !seen.has(key)) seen.set(key, name);
  }
  for (const r of [...routines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = keyOf(r.groupName);
    if (r.groupName && key && !seen.has(key)) seen.set(key, r.groupName);
  }
  return [...seen.values()];
}

/**
 * Every group name in use, archived routines' included, so a name typed to
 * match one is spelled the way it already is.
 */
export function groupNames(routines: readonly Grouped[], registry: readonly string[] = []): string[] {
  return mergedNames(routines, registry);
}

/**
 * The name to store for a typed one: blank is no group, and a name that matches
 * a group already in use ignoring case takes that group's spelling, so
 * "gym" files under "Gym" instead of starting a second heading.
 */
export function resolveGroupName(
  typed: string | null,
  routines: readonly Grouped[],
  registry: readonly string[] = [],
): string | null {
  if (typed === null) return null;
  const clean = cleanWorkoutName(typed);
  if (!clean) return null;
  const key = clean.toLowerCase();
  return mergedNames(routines, registry).find(n => n.toLowerCase() === key) ?? clean;
}

/**
 * Splits the list into what the tab draws. Groups follow the registry's order,
 * with any a routine alone names after it, and routines keep `sortOrder` inside
 * each. A group is drawn while it is in the registry or a live routine is in
 * it: an archived routine leaves its group's heading and count and is listed
 * under Archived only, and does not keep a heading of its own alive.
 */
export function routineSections<T extends Grouped>(
  routines: readonly T[],
  registry: readonly string[] = [],
): RoutineSections<T> {
  const ordered = [...routines].sort((a, b) => a.sortOrder - b.sortOrder);
  const live = ordered.filter(r => !r.archived);
  const names = mergedNames(live, registry);
  return {
    ungrouped: live.filter(r => !keyOf(r.groupName)),
    groups: names.map(name => ({
      name,
      routines: live.filter(r => keyOf(r.groupName) === name.toLowerCase()),
    })),
    archived: ordered.filter(r => r.archived),
  };
}

/** The list of group names after `from` is renamed to `to`: kept in place, and joined with `to` if that group already exists. */
export function renamedRegistry(registry: readonly string[], from: string, to: string): string[] {
  const fromKey = keyOf(from);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of registry) {
    const next = keyOf(name) === fromKey ? to : name;
    const key = keyOf(next);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  if (!seen.has(keyOf(to))) out.push(to);
  return out;
}

/**
 * What a drop on the Routines tab means. `flat` is the list as it stands after
 * the drag: headings (a name), routines (an id) and rows that are neither. A
 * routine belongs to the nearest heading above it, or to no group above the
 * first one. Returns the live routines in their new order with the group each
 * now sits in.
 */
export type FlatRoutineRow =
  | { kind: 'header'; name: string }
  | { kind: 'routine'; id: string }
  | { kind: 'other' };

export function placementsFromList(flat: readonly FlatRoutineRow[]): Array<{ id: string; groupName: string | null }> {
  const out: Array<{ id: string; groupName: string | null }> = [];
  let current: string | null = null;
  for (const row of flat) {
    if (row.kind === 'header') current = row.name;
    else if (row.kind === 'routine') out.push({ id: row.id, groupName: current });
  }
  return out;
}
