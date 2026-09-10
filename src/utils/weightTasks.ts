import type { Task } from '../types';
import { generatedSourceOf } from './generatedTasks';
import { weightReadings, type WeightPoint } from './weightLog';

/**
 * `weighIn` — the twentieth generator, and the second that exists to ask for a
 * number rather than to react to one.
 *
 * See `docs/arch/generated-tasks.md` for the mechanism it shares with the other
 * nineteen. What is worth reading here is why it is its own generator rather
 * than part of `health`, and why its trigger is not a calendar.
 *
 * **It is deliberately not folded into `health`.** That generator watches a
 * reading the user's own rule names a threshold for, and fires when the
 * reading crosses it: the data already exists and the task is a response to
 * it. This is the mirror image. It fires precisely *because* there is no
 * reading, and the task it writes is a request for one. Sharing a firing pass
 * would mean one switch governing "tell me when my sodium is high" and "remind
 * me to weigh myself", which are two different permissions the way
 * `healthReadEnabled` and `healthTasks` already are.
 *
 * `moodLog` is the generator this actually resembles, and the shape is copied
 * from it on purpose: day-keyed with no source row, a settings-level mark
 * instead of a per-source stamp, and a `linkUrl` so the row asking for
 * something opens the thing that records it. Ticking a request off without
 * answering it is the failure `moodLog`'s link comment describes, and it is
 * worse here, because the answer is a number that cannot be reconstructed
 * later.
 *
 * **Its trigger is a gap in the data, not a cadence, and that is the one real
 * improvement on `moodLog`.** A daily check-in that fires whether or not you
 * already logged has to be suppressed by a separate "did you log today" check.
 * Here the absence *is* the trigger: the pass reads the last few days out of
 * Health and asks only when none of them has a weigh-in on it. So somebody who
 * weighs themselves every morning without being asked never sees this task at
 * all, and somebody who has drifted for a fortnight sees exactly one.
 *
 * **Nothing here reads a weight's value, only whether one exists.** That is the
 * same fence `weightLog.ts` and `docs/arch/health-data.md` describe: the app
 * may notice you have not recorded a number, which is a fact about your
 * logging. It may not notice what the number was, which would be a fact about
 * your body and is what would turn this into the app having an opinion.
 */

/**
 * The task's title. Never varies, so the reconcile has nothing to chase.
 *
 * Literal about the action, per the copy rule: it does not say "time to weigh
 * in", does not congratulate, and carries no target.
 */
export const WEIGH_IN_TITLE = 'Record your weight';

/** How often to ask, when the user hasn't said. */
export const DEFAULT_WEIGH_IN_EVERY_DAYS = 7;

/**
 * One day is the floor because daily weighing is a real practice and this
 * generator's gap trigger makes it safe: asked daily, it still stays silent on
 * every day somebody already stepped on the scale, so the worst case is one
 * task on a day they genuinely have not.
 */
export const WEIGH_IN_EVERY_DAYS_MIN = 1;

/**
 * A month is the ceiling. Past that the task stops being a reminder and
 * becomes an annual event, and there is no version of this worth firing where
 * the window is longer than the memory of having set it up.
 */
export const WEIGH_IN_EVERY_DAYS_MAX = 30;

export function clampWeighInEveryDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_WEIGH_IN_EVERY_DAYS;
  return Math.min(WEIGH_IN_EVERY_DAYS_MAX, Math.max(WEIGH_IN_EVERY_DAYS_MIN, Math.round(days)));
}

/** What the row's link button opens: the Weight screen, with the sheet up. */
export const WEIGH_IN_LINK_URL = 'dundundun://weight?log=1';

/**
 * The day key a weigh-in request is asking about, or null for any other task.
 *
 * Thin, like `moodLogDayKey` and `calendarReviewDayKey` — a named wrapper over
 * `generatedSourceOf` for the one meaning this column has here.
 */
export function weighInDayKey(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'weighIn');
}

/**
 * Whether to ask, given the window of days the request would cover.
 *
 * Takes the readings rather than fetching them, the way `wantsMoodNudge` takes
 * the last nudge's day key: the whole rule is then decidable without a store
 * and testable at its boundaries.
 *
 * `points` is expected to be the last `everyDays` logical days, oldest first.
 * A window with any reading in it means the question has already been answered
 * recently enough, and no task is written.
 *
 * **An empty array means "asked Health and got nothing", which is a real
 * answer.** It is the caller's job not to pass one when the read failed or was
 * never made — a refused Health read and a fortnight of not weighing in are
 * indistinguishable from here (the rule this whole area is built on), and the
 * difference matters, because one of them should write a task and the other
 * should not write anything at all. See `checkWeighInTasks`, which refuses on a
 * null reading rather than calling it an empty window.
 */
export function wantsWeighIn(points: readonly WeightPoint[]): boolean {
  return weightReadings([...points]).length === 0;
}

/**
 * The row's notes: why it is on the list.
 *
 * States the gap and nothing else. No target, no encouragement, and nothing
 * about what any previous reading was — see the fence in the module note.
 */
export function weighInNotes(everyDays: number): string {
  const days = clampWeighInEveryDays(everyDays);
  return days === 1
    ? 'Nothing recorded in Apple Health today.'
    : `Nothing recorded in Apple Health in the last ${days} days.`;
}
