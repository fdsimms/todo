import type { Task } from '../types';
import { normalizeTitle } from './taskInstances';

/**
 * Whether a row is a *miss* rather than a completion, and its positive twin.
 *
 * A missed occurrence is stored as a completed one — `completed: true`, a
 * `completedAt` stamp, plus `missedAt` (see Task.missedAt for why). So
 * `completed` alone can no longer answer "did the user actually do this", and
 * these two are how that question gets asked.
 *
 * Which one a call site wants follows a simple rule:
 *
 * - "Is this row history / off the board?" → plain `task.completed`, unchanged.
 *   Visibility, the roster collapse, retention, the Logbook's membership all
 *   want a miss included, and already treat it correctly.
 * - "Did the user do this?" → `isRealCompletion`. Every counted achievement,
 *   every rhythm sample, anything trained on past behaviour.
 *
 * Deliberately its own leaf module rather than living in visibilityUtils
 * beside isQuotaPartial, which is where it otherwise belongs: visibilityUtils
 * reaches useSettingsStore for dayResetTime, which reaches the db, which
 * imports expo-sqlite — and that throws on sight in Jest's `node` environment.
 * stats.ts and rhythms.ts are pure modules tested there, so importing the
 * predicate from visibilityUtils took both suites out at load time. This file
 * imports nothing but the type, so anything can reach it. visibilityUtils
 * re-exports both names, so the store's existing import site still resolves.
 */
// Both test truthiness rather than `!== null`, so a Task assembled without the
// field (an old serialized row, a partial fixture) reads as "not missed"
// rather than silently as missed — the safe direction, since the alternative
// is every completion in the app's history dropping out of every statistic.
export function isMissed(task: Task): boolean {
  return !!task.missedAt;
}

export function isRealCompletion(task: Task): boolean {
  return task.completed && !task.missedAt;
}

export interface MostMissedGroup {
  /** Display title (casing taken from the most recent miss). */
  title: string;
  /** Normalized key the group was formed on — see normalizeTitle. */
  key: string;
  /** Number of occurrences explicitly marked missed. */
  count: number;
  /** ISO timestamp of the most recent miss. */
  lastMissedAt: string;
}

/**
 * Recurring tasks ranked by how often an occurrence was explicitly marked
 * missed (`markMissed` → `Task.missedAt`), grouped by title the same way
 * `getRepeatedInstances` groups ad-hoc repeats — a missed occurrence spawns
 * the next one exactly like a real completion (`completeTask`), so the chain
 * has no stable id to key on across the whole run; the title is what a user
 * would recognise "I keep missing X" by, and it's already the convention
 * this screen uses for grouping a recurring task's history. Only groups with
 * at least one miss are returned, sorted by count desc then most-recent miss.
 */
export function mostMissed(tasks: readonly Task[]): MostMissedGroup[] {
  const groups = new Map<string, { title: string; titleAt: string; count: number; lastMissedAt: string }>();

  for (const task of tasks) {
    if (task.parentId) continue;
    if (!isMissed(task) || !task.missedAt) continue;

    const key = normalizeTitle(task.title);
    if (!key) continue;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { title: task.title.trim(), titleAt: task.missedAt, count: 1, lastMissedAt: task.missedAt });
    } else {
      existing.count++;
      if (task.missedAt > existing.lastMissedAt) existing.lastMissedAt = task.missedAt;
      // Most recent miss wins the display casing, same rule as getRepeatedInstances.
      if (task.missedAt > existing.titleAt) {
        existing.title = task.title.trim();
        existing.titleAt = task.missedAt;
      }
    }
  }

  return Array.from(groups.entries())
    .map(([key, { title, count, lastMissedAt }]) => ({ key, title, count, lastMissedAt }))
    .sort((a, b) => (b.count - a.count) || (a.lastMissedAt < b.lastMissedAt ? 1 : -1));
}
