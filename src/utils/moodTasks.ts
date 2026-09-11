import type { Task, TimeOfDay } from '../types';
import { generatedSourceOf } from './generatedTasks';
import { lowMoodRun, type MoodDay } from './moodInsights';

/**
 * The two generators the mood log fires — see `docs/arch/generated-tasks.md`
 * for the mechanism they share with the other fifteen.
 *
 * They sit together here the way `birthday` and `birthdayGift` share
 * `birthdayTasks.ts`: one subject, two lead-ins, and the second reuses
 * everything but its trigger.
 *
 * `moodLog` is the ordinary one — a task to write down how you are doing,
 * day-keyed like `calendarReview` with a settings-level mark in place of a
 * per-source stamp. `moodLogTimeSegments` lets it fire more than once a day,
 * one held-back task per configured segment (morning, evening, and so on)
 * instead of the single any-time task an empty list still means; at most one
 * is ever live at once, and `checkMoodTasks` clears an earlier segment's
 * unanswered task the moment the next one's threshold arrives — an unanswered
 * morning check-in is a question about a part of the day that's passed, not a
 * task still owed, the same reasoning the day-to-day clear already applies.
 *
 * **`moodNudge` is the one worth reading before changing.** It is the only
 * generator in the app whose trigger is a *trend in the user's own answers*
 * rather than a date, a row, or a threshold crossed once, and that makes it the
 * only one that can be wrong about a person rather than about their data. Three
 * rules keep it from being that, and none of them is decoration:
 *
 * 1. **It never names a feeling back at you, and never diagnoses.** The task is
 *    "Plan something you enjoy this week". It is not "You've been down for 4
 *    days", it is not a suggestion to see anybody, and it does not carry the
 *    word depressed, anxious, or unwell. The app knows you tapped a 2 four
 *    times; that is all it knows.
 * 2. **It ships off, and it is one task, once a week at the very most.** A
 *    generator that fires on a low patch is the last thing in the app that
 *    should be able to pile up, because the person it lands on is by
 *    construction having a bad week.
 * 3. **The run is counted over logged days only** (see `lowMoodRun`), so
 *    closing the app for a fortnight neither builds a run nor breaks one. Not
 *    logging is not evidence of anything, and treating a gap either way would
 *    let the nudge fire off days nobody reported.
 */

/** The daily task's title. Never varies. */
export const MOOD_LOG_TITLE = 'Log how you\'re feeling';

/**
 * The nudge's title.
 *
 * Literal about what to do, silent about why — rule 1 above, and the copy rule
 * in CLAUDE.md besides. The reason lives in the task's notes, where it is read
 * by somebody who chose to open the row.
 */
export const MOOD_NUDGE_TITLE = 'Plan something you enjoy this week';

/**
 * The default run of low days before the nudge is offered.
 *
 * Three, not two: everybody has two bad days in a row, and a generator that
 * fires on them is one that fires constantly and gets switched off in a week.
 * The user can raise or lower it (`moodNudgeAfterDays`).
 */
export const DEFAULT_MOOD_NUDGE_AFTER_DAYS = 3;

/**
 * The fewest days between two nudges.
 *
 * Without it a low patch that runs a fortnight would fire one every day it
 * continued, which is rule 2's failure mode exactly: the app noticing you feel
 * bad and responding by adding a chore to your list, daily. A week means a long
 * low run produces one task, then one more if it is still going.
 */
export const MOOD_NUDGE_COOLDOWN_DAYS = 7;

/**
 * The day key a daily log task is asking about, or null for any other task.
 *
 * A check-in's `sourceId` is the day key alone when `moodLogTimeSegments` is
 * empty (one any-time task a day, the original shape), or `${dayKey}:${segment}`
 * when several are configured — this strips the segment back off, so every
 * caller that only cares about the day (completing today's check-in,
 * deciding whether a task belongs to today at all) doesn't have to know the
 * two-part form exists. `moodLogSegmentOf` below reads the other half.
 */
export function moodLogDayKey(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  const source = generatedSourceOf(task, 'moodLog');
  if (source === null) return null;
  const sep = source.indexOf(':');
  return sep === -1 ? source : source.slice(0, sep);
}

/**
 * The time-of-day segment a check-in was raised for, or null for a task with
 * no segment — either `moodLogTimeSegments` was empty when it was created, or
 * this isn't a mood-log task at all. See `moodLogDayKey` above for the
 * sourceId shape this splits.
 */
export function moodLogSegmentOf(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): TimeOfDay | null {
  const source = generatedSourceOf(task, 'moodLog');
  if (source === null) return null;
  const sep = source.indexOf(':');
  return sep === -1 ? null : (source.slice(sep + 1) as TimeOfDay);
}

/** The sourceId for a check-in, given the day and — if configured — its segment. */
export function moodLogSourceId(dayKey: string, segment: TimeOfDay | null): string {
  return segment === null ? dayKey : `${dayKey}:${segment}`;
}

/** The day key a nudge was raised on, or null for any other task. */
export function moodNudgeDayKey(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'moodNudge');
}

/**
 * Whether a low run is long enough, and far enough from the last nudge, to
 * offer one.
 *
 * Takes the last nudge's day key rather than reading it, so the whole rule is
 * decidable without a store and the cooldown is testable at a date boundary.
 * A null last key means one has never fired.
 */
export function wantsMoodNudge(
  days: readonly MoodDay[],
  todayKey: string,
  afterDays: number,
  lastNudgeDayKey: string | null,
): boolean {
  const run = lowMoodRun(days, todayKey);
  if (run < Math.max(1, afterDays)) return false;
  if (lastNudgeDayKey === null) return true;
  return daysBetweenKeys(lastNudgeDayKey, todayKey) >= MOOD_NUDGE_COOLDOWN_DAYS;
}

/**
 * Whole days from one day key to another.
 *
 * Built off local midnight on both sides rather than by subtracting
 * timestamps, so a DST boundary between the two doesn't come out as 6.958
 * days and round the cooldown a day short.
 */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00`);
  const to = new Date(`${toKey}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/**
 * The line "Lighten today" carries while a low run is going, or null.
 *
 * **The only place the mood log reaches back into Today**, and the shape of it
 * is the whole argument. Three things it deliberately is not:
 *
 * - **Not a banner.** `ProjectNudgeBanner` was removed for good reasons (see
 *   `docs/arch/generated-tasks.md`): a strip above the list can't be deferred
 *   or dismissed per-thing, and holds the header slot whether or not now is
 *   the moment. This is one line inside a menu the user opened, next to an
 *   action they were already considering, so it cannot nag by construction.
 * - **Not a second nudge task.** `moodNudge` is the generator, and its rule is
 *   one task a week at the very most. A low week must not produce a second row.
 * - **Not a change to what the plan pre-checks.** The tempting version of this
 *   was having a low run auto-check the soft-blocked rows too. Those blockers
 *   are `streak`, `started`, `high-priority` and `people` — so that version
 *   breaks a twelve-day streak, or moves something somebody else is waiting on,
 *   on the strength of the user having tapped a 2 three times. Offering the
 *   sheet is help; deciding what comes off the day is not the app's call.
 *
 * Same restraint as the nudge's copy: it says what was recorded and what the
 * screen can do about it, and nothing about what it might mean.
 */
export function lowMoodDeloadNote(run: number, afterDays: number): string | null {
  if (run < Math.max(1, afterDays)) return null;
  return `You've logged a low mood ${run} days running.`;
}

/**
 * The nudge's notes — why this task is on the list.
 *
 * States what was recorded and nothing more: a count of days you yourself
 * marked low. No interpretation, no advice beyond the title's, and no
 * suggestion about what it might mean.
 */
export function moodNudgeNotes(run: number): string {
  return `You've logged a low mood ${run} days running.`;
}
