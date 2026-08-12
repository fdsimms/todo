import type { Task } from '../types';
import { ordinal } from './ordinal';

/**
 * "Extra task" — every Nth completion of a task adds a separate one-off task.
 *
 * See the field notes on `Task.extraTaskEveryN`. This module owns the rule
 * (when does it fire, what does the added task get called) and its wording, so
 * the editor's caption, the row's value and the store all say the same thing
 * about the same numbers.
 *
 * Pure and parameterised like the other utils here — the store passes the task
 * in rather than this reaching for it.
 */

/**
 * Floor of 2. "Every 1st completion" is every completion, which is a chain
 * with one step, not this — and offering it invites the reading that 1 means
 * "off" when null already does.
 */
export const MIN_EXTRA_TASK_EVERY_N = 2;
/** Same ceiling `CountStepper` gets everywhere else a small integer is picked. */
export const MAX_EXTRA_TASK_EVERY_N = 99;

export interface ExtraTaskRule {
  everyN: number;
  title: string;
}

/**
 * The rule this task actually has, or null.
 *
 * Both halves are required: a count with no title would add a task with no
 * name, which is a row nobody can act on. Asking here rather than testing the
 * two fields at each call site is what keeps the editor, the store and the
 * caption agreeing on when the rule is live.
 */
export function extraTaskRule(task: Pick<Task, 'extraTaskEveryN' | 'extraTaskTitle'>): ExtraTaskRule | null {
  const everyN = task.extraTaskEveryN;
  const title = task.extraTaskTitle?.trim();
  if (everyN === null || everyN < MIN_EXTRA_TASK_EVERY_N) return null;
  if (!title) return null;
  return { everyN, title };
}

/**
 * The tally after this completion, and whether it fires.
 *
 * Resets to 0 on the completion that fires rather than counting up forever and
 * testing a modulo: the stored number then reads as "completions since the
 * last extra task", which is what the caption promises and what survives the
 * user changing N. A modulo against a lifetime count would silently move the
 * next one when N changed.
 *
 * A tally already at or past N fires too (`>=`, not `===`) — lowering N on a
 * task that has been running should take effect on the next completion rather
 * than waiting for the count to wrap all the way round again.
 */
export function advanceExtraTaskTally(tally: number, everyN: number): { tally: number; spawns: boolean } {
  const next = Math.max(0, tally) + 1;
  return next >= everyN ? { tally: 0, spawns: true } : { tally: next, spawns: false };
}

/**
 * How many completions are left before the next one, for the editor's caption.
 * Clamped at 1 — a tally that has somehow outrun N still means "the next one".
 */
export function completionsUntilExtraTask(tally: number, everyN: number): number {
  return Math.max(1, everyN - Math.max(0, tally));
}

/** The editor row's value, and the only place the count is shown on its own. */
export function extraTaskSummary(everyN: number | null): string | undefined {
  if (everyN === null || everyN < MIN_EXTRA_TASK_EVERY_N) return undefined;
  return `Every ${ordinal(everyN)}`;
}

/**
 * The caption under the stepper — what the rule will do, in one sentence.
 *
 * Says where the added task lands as well as how often, because that's the
 * half nobody can infer: it's due with the *next* occurrence, not stacked onto
 * the completion that triggered it. A task that doesn't repeat has no next
 * occurrence, so it lands on the day it's added.
 */
export function describeExtraTaskRule(
  everyN: number | null,
  title: string | null,
  repeats: boolean
): string {
  if (everyN === null || everyN < MIN_EXTRA_TASK_EVERY_N) return 'No extra task';
  const trimmed = title?.trim();
  if (!trimmed) return `Name the task to add every ${ordinal(everyN)} completion`;
  return repeats
    ? `Adds “${trimmed}” every ${ordinal(everyN)} completion, due with the next one`
    : `Adds “${trimmed}” every ${ordinal(everyN)} completion, due that day`;
}
