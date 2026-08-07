import type { Task } from '../types';

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
