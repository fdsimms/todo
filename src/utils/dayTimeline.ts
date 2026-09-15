import type { Task } from '../types';
import type { BusyEvent } from './calendarBusy';
import { effectiveWindowEndTime, hhmmMinutes } from './clockTime';
import { estimatedMinutesFor } from './effort';

/**
 * Laying one day out on a time axis (#2680) — the first clock-time-to-offset
 * rule in the app, and deliberately the only one.
 *
 * Everything here is in **minutes from the logical day's start**, not from
 * midnight. `dayResetTime` can put that start at 04:00, in which case "02:00"
 * is near the *end* of the day rather than the beginning, and any arithmetic
 * anchored to midnight wraps the wrong way. One origin, measured once, is what
 * keeps the whole layout honest about that.
 *
 * **Nothing here reads a store**, same discipline as `timeBlock.ts`: the day's
 * start, its tasks and its events all arrive as parameters. That is also why
 * the window rule comes from `clockTime` rather than `visibilityUtils`.
 *
 * Three refusals decide what this draws, and they are the feature:
 *
 * - **No time means no position.** A task with nothing saying *when* goes to
 *   `unplaced`, a list under the axis. Inventing a slot for it is the step
 *   that turns a view of the day into a scheduler for it.
 * - **No length means no height.** A task placed at a reminder with no
 *   estimate is an `instant`: a mark on the axis, not a block covering minutes
 *   nobody agreed to. `estimatedMinutesFor` answers the length, so a chain
 *   contributes its live step rather than the whole chain.
 * - **All-day events are not minutes** (see `occupiesTime`), so they never
 *   reach the axis at all. They ride in `allDay`, above it.
 *
 * Planned meals are deliberately absent. A `MealPlanEntry` is a day and a slot
 * by construction with no clock time anywhere in it, and the app has twice
 * declined to invent one (`mealCalendarSync` writes them as all-day events for
 * exactly this reason, and `MEAL_SLOT_SEGMENTS` was emptied after the same
 * argument). The day view lists them beside the all-day events instead.
 */

export const MINUTES_IN_DAY = 24 * 60;

/** How much of the day to draw when there is nothing on it at all. */
export const DEFAULT_FIRST_HOUR = 8;
export const DEFAULT_LAST_HOUR = 22;

export interface TimelineEntry {
  key: string;
  kind: 'event' | 'task';
  title: string;
  /** Minutes from the logical day's start. */
  startMinutes: number;
  /** Equal to `startMinutes` when the entry has no known length. */
  endMinutes: number;
  /** Drawn as a mark rather than a block: nothing here says how long it runs. */
  instant: boolean;
  taskId: string | null;
  eventId: string | null;
  /** Which column it sits in, and how many the overlapping run needs. */
  lane: number;
  laneCount: number;
}

export interface DayTimeline {
  entries: TimelineEntry[];
  /** Events with no minutes of their own; drawn above the axis. */
  allDay: BusyEvent[];
  /** The day's tasks with nothing saying when. */
  unplaced: Task[];
  /** The span worth drawing, in minutes from the day's start. */
  firstMinute: number;
  lastMinute: number;
}

export interface DayTimelineInput {
  /** Start of the logical day, from `getDayStart` on that day's noon. */
  dayStart: Date;
  /** The day's real task rows. Projections are captions and never reach here. */
  tasks: readonly Task[];
  /** The day's events, already sliced by `eventsIn`. */
  events: readonly BusyEvent[];
}

/**
 * An "HH:MM" clock time as minutes from the day's start, wrapping forward.
 *
 * A time earlier in the clock than the day's own start belongs to the far end
 * of that logical day, not to the start of it: with a 04:00 reset, "02:00" is
 * 22 hours in. Same wrap `onLogicalDay` applies for the visibility gates.
 */
export function clockToDayMinutes(hhmm: string, dayStart: Date): number {
  const startOfDay = dayStart.getHours() * 60 + dayStart.getMinutes();
  const minutes = hhmmMinutes(hhmm);
  return minutes >= startOfDay
    ? minutes - startOfDay
    : minutes + MINUTES_IN_DAY - startOfDay;
}

/**
 * Minutes from the day's start, signed and unclamped — negative before the
 * day, past `MINUTES_IN_DAY` after it. `instantToDayMinutes` is this with the
 * out-of-range answers thrown away, which is right for a task's own reminder
 * (it is on one day or it isn't) and wrong for an event, which can straddle
 * the boundary. See `placeEvent`.
 */
function dayOffsetMinutes(iso: string, dayStart: Date): number | null {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.round((at - dayStart.getTime()) / 60000);
}

/**
 * Where an event sits on this day's axis, clipped to it at *both* ends.
 *
 * `eventsIn` selects by overlap rather than containment, so an event can begin
 * before this day as easily as it can run past the end of it — a shift from
 * 22:00 to 06:00 is on both days. Only the trailing overrun used to be
 * clamped; a leading one made `instantToDayMinutes` answer null and the event
 * was skipped outright, so the hours it covers drew as free and the Day view
 * disagreed with the day-load figure beside it, which clips overlaps properly.
 *
 * A zero-length event is an `instant`, the same answer the time-block branch
 * above already gives it. Without that it fails the `end > start` test and
 * draws as a block running to midnight.
 *
 * Null means the event doesn't touch this day at all, which `eventsIn` should
 * already have excluded — this is the guard for a caller that hasn't.
 */
function placeEvent(
  event: BusyEvent,
  dayStart: Date,
): { start: number; end: number; instant: boolean } | null {
  const rawStart = dayOffsetMinutes(event.start, dayStart);
  const rawEnd = dayOffsetMinutes(event.end, dayStart);
  if (rawStart === null || rawEnd === null) return null;
  if (rawStart >= MINUTES_IN_DAY || rawEnd <= 0) return null;
  const start = Math.max(0, rawStart);
  const end = Math.min(MINUTES_IN_DAY, rawEnd);
  return { start, end, instant: end <= start };
}

/** An instant as minutes from the day's start, or null when it isn't in it. */
export function instantToDayMinutes(iso: string, dayStart: Date): number | null {
  const at = new Date(iso).getTime();
  const from = dayStart.getTime();
  const minutes = Math.round((at - from) / 60000);
  if (minutes < 0 || minutes >= MINUTES_IN_DAY) return null;
  return minutes;
}

/** Where a task sits on the axis, or null when nothing says when. */
function placeTask(task: Task, dayStart: Date): { start: number; end: number; instant: boolean } | null {
  const length = estimatedMinutesFor(task);

  if (task.windowStart) {
    const start = clockToDayMinutes(task.windowStart, dayStart);
    const close = effectiveWindowEndTime(task.windowStart, task.windowEnd);
    if (close) {
      // A window that closes is the one case with a length nobody guessed:
      // the user typed both ends of it.
      return { start, end: clockToDayMinutes(close, dayStart), instant: false };
    }
    return length === null
      ? { start, end: start, instant: true }
      : { start, end: Math.min(start + length, MINUTES_IN_DAY), instant: false };
  }

  if (task.reminderTime) {
    const start = instantToDayMinutes(task.reminderTime, dayStart);
    if (start === null) return null;
    return length === null
      ? { start, end: start, instant: true }
      : { start, end: Math.min(start + length, MINUTES_IN_DAY), instant: false };
  }

  // A dueDate is deliberately not consulted: it is stored at local noon and
  // means a day, not a time. Reading its clock would place every undated-hour
  // task at midday and call that a plan.
  return null;
}

/**
 * Greedy column packing over a sorted run.
 *
 * An instant is given a minute of width for overlap purposes only, so a
 * reminder landing inside a meeting sits beside it rather than on top of it,
 * while still reporting `startMinutes === endMinutes` to the caller.
 */
function assignLanes(entries: TimelineEntry[]): void {
  let run: TimelineEntry[] = [];
  let runEnd = -1;

  const closeRun = () => {
    const laneCount = run.reduce((max, e) => Math.max(max, e.lane + 1), 0);
    for (const entry of run) entry.laneCount = laneCount;
    run = [];
    runEnd = -1;
  };

  for (const entry of entries) {
    const width = Math.max(entry.endMinutes, entry.startMinutes + 1);
    if (run.length > 0 && entry.startMinutes >= runEnd) closeRun();
    const taken = new Set(
      run.filter(e => Math.max(e.endMinutes, e.startMinutes + 1) > entry.startMinutes).map(e => e.lane),
    );
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    entry.lane = lane;
    run.push(entry);
    runEnd = Math.max(runEnd, width);
  }
  if (run.length > 0) closeRun();
}

export function buildDayTimeline({ dayStart, tasks, events }: DayTimelineInput): DayTimeline {
  const allDay = events.filter(e => e.allDay);
  const timed = events.filter(e => !e.allDay);

  // A task blocked out on the calendar is one thing, not two: the event owns
  // the time (see Task.timeBlockEventId) and the task is the actionable half,
  // so the task is placed at the event's hours and the event itself is not
  // emitted again beside it.
  const blockedEventIds = new Set(
    tasks.map(t => t.timeBlockEventId).filter((id): id is string => id !== null),
  );
  const eventById = new Map(timed.map(e => [e.id, e]));

  const entries: TimelineEntry[] = [];
  const unplaced: Task[] = [];

  for (const task of tasks) {
    const blockEvent = task.timeBlockEventId ? eventById.get(task.timeBlockEventId) : undefined;
    if (blockEvent) {
      const start = instantToDayMinutes(blockEvent.start, dayStart);
      const end = instantToDayMinutes(blockEvent.end, dayStart);
      if (start !== null) {
        entries.push({
          key: `task:${task.id}`,
          kind: 'task',
          title: task.title,
          startMinutes: start,
          endMinutes: end !== null && end > start ? end : start,
          instant: end === null || end <= start,
          taskId: task.id,
          eventId: blockEvent.id,
          lane: 0,
          laneCount: 1,
        });
        continue;
      }
    }
    const placed = placeTask(task, dayStart);
    if (!placed) {
      unplaced.push(task);
      continue;
    }
    entries.push({
      key: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      startMinutes: placed.start,
      endMinutes: placed.end,
      instant: placed.instant,
      taskId: task.id,
      eventId: null,
      lane: 0,
      laneCount: 1,
    });
  }

  for (const event of timed) {
    if (blockedEventIds.has(event.id)) continue;
    // Clipped to the day at both ends rather than dropped when it overruns
    // either of them: it really is on this day, it just doesn't begin or
    // finish on it. See placeEvent.
    const placed = placeEvent(event, dayStart);
    if (!placed) continue;
    entries.push({
      key: `event:${event.id}`,
      kind: 'event',
      title: event.title,
      startMinutes: placed.start,
      endMinutes: placed.end,
      instant: placed.instant,
      taskId: null,
      eventId: event.id,
      lane: 0,
      laneCount: 1,
    });
  }

  entries.sort((a, b) =>
    a.startMinutes - b.startMinutes
    || a.endMinutes - b.endMinutes
    || a.key.localeCompare(b.key));
  assignLanes(entries);

  const defaultFirst = clockToDayMinutes(`${String(DEFAULT_FIRST_HOUR).padStart(2, '0')}:00`, dayStart);
  const defaultLast = clockToDayMinutes(`${String(DEFAULT_LAST_HOUR).padStart(2, '0')}:00`, dayStart);

  let firstMinute = defaultFirst;
  let lastMinute = defaultLast;
  if (entries.length > 0) {
    const earliest = Math.min(...entries.map(e => e.startMinutes));
    const latest = Math.max(...entries.map(e => Math.max(e.endMinutes, e.startMinutes + 30)));
    firstMinute = Math.min(defaultFirst, Math.floor(earliest / 60) * 60);
    lastMinute = Math.max(defaultLast, Math.min(MINUTES_IN_DAY, Math.ceil(latest / 60) * 60));
  }

  return { entries, allDay, unplaced, firstMinute, lastMinute };
}
