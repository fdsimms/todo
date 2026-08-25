import type { Task } from '../types';
import type { BusyEvent } from './calendarBusy';
import { generatedSourceOf } from './generatedTasks';

/**
 * The "look at tomorrow's calendar" offer, as a task.
 *
 * Files under `calendarEventCategory`, the same setting the day's own events
 * already render under on Today (see `eventContextRows` in
 * `dayContextRows.ts`) — the task and the events it's asking about are one
 * subject to the person reading the list, so a second, independent "File this
 * under" setting would only ever be able to agree with the first or confuse
 * the two. That's also why the kind is `categorized: false` in the registry:
 * there's no category of its own to pick.
 *
 * There is exactly one task at a time, unlike the meal-plan nudge's stack of
 * seven — "review tomorrow" is one day's question, not a week's — so unlike
 * `projectReview`/`pantryCheck` there's no capped set to choose from and no
 * per-source qualifying predicate: the only question is whether tomorrow has
 * anything on it at all.
 */

/** The row's title. Never varies — there's exactly one question this asks. */
export const CALENDAR_REVIEW_TITLE = 'Review tomorrow\'s calendar';

/**
 * The day key a review task is asking about, or null for any other task.
 *
 * Thin, like `projectReviewProjectId`/`pantryCheckItemId` — a named wrapper
 * over `generatedSourceOf` for the one meaning this column has here.
 */
export function calendarReviewDayKey(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'calendarReview');
}

/**
 * Whether tomorrow is worth a review task.
 *
 * A day with nothing on it has nothing to review — writing a task for an
 * empty tomorrow would be the app asking a question it already knows the
 * answer to.
 */
export function wantsCalendarReview(tomorrowEvents: readonly BusyEvent[]): boolean {
  return tomorrowEvents.length > 0;
}
