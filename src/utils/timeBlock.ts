import { addMinutes } from 'date-fns/addMinutes';
import type { Task } from '../types';
import type { BusyEvent } from './calendarBusy';
import { freeGapsIn } from './calendarBusy';
import { activeChainStep } from './chain';
import { estimatedMinutesFor } from './effort';

/**
 * Where a task's time block should go, and whether it can have one at all —
 * the decision half of #1492. Pure and store-free, so it runs in Jest's `node`
 * environment with no native modules; the EventKit calls it feeds live in
 * `calendarSync.ts` and the wiring in `useTaskStore.ts`.
 *
 * A time block is a *proposal*, not a schedule. Everything here computes a
 * start the system event sheet is prefilled with, which the user then confirms
 * or drags somewhere better before anything is written — so being wrong is
 * cheap, and that's what licenses the guessing below. Nothing in this file
 * ever writes an event, and nothing recomputes a block's time after the fact:
 * once an event exists, its start belongs to the event (see
 * `Task.timeBlockEventId`).
 */

/**
 * What to call the block — `displayTitleFor`'s rule, resolved through the same
 * `activeChainStep` it uses rather than by importing it.
 *
 * That import is deliberately avoided: `visibilityUtils` reaches the settings
 * store and so `expo-sqlite`, which would drag this module (and its tests) out
 * of the `node` environment the whole file exists to stay inside. `chain.ts` is
 * where the "which step is live" rule actually lives, so both readers still
 * answer from one place — see its own doc comment.
 */
function blockTitleFor(task: Task): string {
  return activeChainStep(task)?.title ?? task.title;
}

/** How long a block runs, and what it's called. */
export interface TimeBlockFields {
  title: string;
  start: Date;
  end: Date;
}

/** Everything `proposeTimeBlockStart` needs that isn't on the task. */
export interface TimeBlockContext {
  now: Date;
  /** "HH:MM" — the earliest hour the app is willing to put work at. */
  activeHoursStart: string;
  /** "HH:MM" — and the latest. */
  activeHoursEnd: string;
  /**
   * The device calendar's events, or **null when the calendar couldn't be
   * read** — the feature is off, permission was refused, or the read failed.
   * The distinction is the same one `useCalendarStore.loaded` exists for and
   * it matters here for one reason: `[]` means the day is genuinely clear and
   * any hour will do, while null means we know nothing, and a "first free
   * slot" derived from nothing is a confident lie about an empty day.
   */
  events: readonly BusyEvent[] | null;
}

/** Round up to the next `step`-minute boundary, leaving exact boundaries alone. */
function ceilToMinutes(date: Date, step: number): Date {
  const ms = step * 60000;
  const rounded = Math.ceil(date.getTime() / ms) * ms;
  return new Date(rounded);
}

/** `hhmm` applied to `day`'s own calendar date. */
function timeOnDay(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const out = new Date(day);
  out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return out;
}

/**
 * Whether this task can be blocked out at all.
 *
 * The gate is an estimate, because a block's whole content is a length — an
 * event with no duration to give it is just a reminder, which this app already
 * has two of. It reads through `estimatedMinutesFor` rather than
 * `task.estimatedMinutes` for the reason every workload read does: mid-chain
 * it's the *step* that's on the day, so a five-step routine blocks out the
 * step you're on and not the whole routine.
 *
 * Subtasks are excluded on the same rule `TaskItem` gates its timer with — a
 * subtask is a stretch of its parent's session, and a second event for one is
 * two calendar entries for one piece of work. Completed and archived tasks
 * have nothing left to find time for.
 */
export function canTimeBlock(task: Task): boolean {
  if (task.parentId !== null) return false;
  if (task.completed || task.archived) return false;
  return estimatedMinutesFor(task) !== null;
}

/**
 * The moment to prefill the event sheet with.
 *
 * Three rules, in order of how much the user has actually told us:
 *
 * 1. **The task's own `windowStart`**, if it has one and it hasn't already
 *    passed. "Not before 9am" is the user having answered this exact question
 *    already, and no gap search should second-guess it.
 * 2. **The first free gap long enough to hold it**, when the calendar is
 *    readable. This is what #1488's read was built for, and the reason
 *    `minMinutes` exists on `freeGapsIn`: a 20-minute crack between two
 *    meetings is not where an hour of work goes.
 * 3. **The start of the search span**, otherwise — which is where rules 1 and 2
 *    both land when the day is empty anyway.
 *
 * The span is the day's active hours, clamped forward to now (rounded up to a
 * quarter hour, so a proposal never reads `2:07`) when the day in question is
 * today. Nothing is ever proposed in the past. A day with no room left at all
 * still gets rule 3 rather than nothing: the sheet is a chance to look at the
 * day and pick, and refusing to open it is a worse answer than opening it on a
 * busy hour the user can drag out of.
 */
export function proposeTimeBlockStart(
  task: Task,
  minutes: number,
  ctx: TimeBlockContext
): Date {
  // A task with no date is work for today — there is no other day to mean.
  const day = task.dueDate ? new Date(task.dueDate) : ctx.now;

  const dayOpen = timeOnDay(day, ctx.activeHoursStart);
  const dayClose = timeOnDay(day, ctx.activeHoursEnd);
  // Active hours that don't resolve within one day ("22:00–02:00") leave no
  // span to search; fall back to the whole rest of the day rather than
  // inverting the range and returning nonsense.
  const close = dayClose > dayOpen ? dayClose : timeOnDay(day, '23:59');

  const earliest = ceilToMinutes(ctx.now, 15);
  const spanStart = dayOpen > earliest ? dayOpen : earliest;

  // Rule 1 — an explicit start time the user set on the task itself.
  if (task.windowStart) {
    const wanted = timeOnDay(day, task.windowStart);
    if (wanted >= earliest) return wanted;
  }

  // The day is already over, or its active hours are. Rounded-up now is the
  // only honest answer left; the sheet takes it from there.
  if (spanStart >= close) return earliest;

  // Rule 2 — the first slot the day actually has room for.
  if (ctx.events !== null) {
    const gaps = freeGapsIn(ctx.events, spanStart, close, minutes);
    if (gaps.length > 0) return new Date(gaps[0].start);
  }

  // Rule 3.
  return spanStart;
}

/** Title, start and end for a task's block, or null if it can't have one. */
export function timeBlockFieldsFor(task: Task, ctx: TimeBlockContext): TimeBlockFields | null {
  if (!canTimeBlock(task)) return null;
  const minutes = estimatedMinutesFor(task);
  if (minutes === null) return null;
  const start = proposeTimeBlockStart(task, minutes, ctx);
  return {
    // The chain-aware title, matching the chain-aware duration above — a block
    // for step 2 of a routine should say what step 2 is.
    title: blockTitleFor(task) || 'Task',
    start,
    end: addMinutes(start, minutes),
  };
}

/**
 * What a reconcile should push onto an existing block, or null when there is
 * nothing to say.
 *
 * **Only the two fields the task owns**, and `start` is emphatically not one
 * of them — the user moved that block to Thursday afternoon on purpose. The
 * new end is measured from whatever start the event has now, so a block
 * dragged to a new hour keeps its length and a task whose estimate grew gets
 * a longer block in the same place.
 *
 * Returns null when the event already says this, so the common case (a save
 * that didn't touch the title or the estimate) costs no device write at all.
 */
export function timeBlockUpdateFor(
  task: Task,
  event: { title: string; start: Date; end: Date; allDay: boolean }
): { title: string; endDate: Date } | null {
  // Turned into an all-day event by hand — the user has said this isn't a
  // slot any more, and imposing a duration back onto it would undo that.
  if (event.allDay) return null;

  const minutes = estimatedMinutesFor(task);
  if (minutes === null) return null;

  const title = blockTitleFor(task) || 'Task';
  const endDate = addMinutes(event.start, minutes);

  // Compared to the minute rather than the millisecond: EventKit rounds, and a
  // sub-minute difference is not a change anyone made.
  const sameLength = Math.abs(endDate.getTime() - event.end.getTime()) < 60000;
  if (sameLength && title === event.title) return null;
  return { title, endDate };
}
