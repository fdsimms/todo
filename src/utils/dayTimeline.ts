import type { Task } from '../types';
import type { BusyEvent } from './calendarBusy';
import { effectiveWindowEndTime, hhmmMinutes } from './clockTime';
import { estimatedMinutesFor } from './effort';
import { windowBounds, type SunLocation } from './sunTimes';

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
  /** Where a window that follows the sun is worked out for (sunTimes.ts). */
  sunLocation?: SunLocation | null;
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
function placeTask(
  task: Task,
  dayStart: Date,
  sunLocation: SunLocation | null,
): { start: number; end: number; instant: boolean } | null {
  const length = estimatedMinutesFor(task);

  if (task.windowStart) {
    const window = windowBounds(task, dayStart, sunLocation);
    const windowStart = window.start ?? task.windowStart;
    const start = clockToDayMinutes(windowStart, dayStart);
    // The day's start instant carries the reset time, which is the timeline
    // "after the start" is measured on (see effectiveWindowEndTime).
    const pad = (n: number) => String(n).padStart(2, '0');
    const dayResetTime = `${pad(dayStart.getHours())}:${pad(dayStart.getMinutes())}`;
    const close = effectiveWindowEndTime(windowStart, window.end, dayResetTime);
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
 * How many minutes an instant holds in the lane packing: about the two lines
 * its title can wrap to at the axis scale. One minute let a block starting ten
 * minutes later share the lane and sit on the second line of the title.
 */
const INSTANT_SLOT_MINUTES = 30;

/**
 * The least a block holds in the lane packing: the minutes its minimum drawn
 * height covers (22pt at 56pt an hour is about 24; the multi-day view's 18pt at
 * 48 is 22.5). A five-minute task is drawn that tall, so packing it by its real
 * length let a mark ten minutes later share its lane and paint over its text.
 */
const MIN_BLOCK_MINUTES = 24;

const laneEnd = (e: TimelineEntry) =>
  e.instant
    ? e.startMinutes + INSTANT_SLOT_MINUTES
    : Math.max(e.endMinutes, e.startMinutes + MIN_BLOCK_MINUTES);

/**
 * Greedy column packing over a sorted run.
 *
 * An instant holds a slot for overlap purposes only, so a reminder landing
 * inside a meeting sits beside it rather than on top of it, while still
 * reporting `startMinutes === endMinutes` to the caller.
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
    const width = laneEnd(entry);
    if (run.length > 0 && entry.startMinutes >= runEnd) closeRun();
    const taken = new Set(
      run.filter(e => laneEnd(e) > entry.startMinutes).map(e => e.lane),
    );
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    entry.lane = lane;
    run.push(entry);
    runEnd = Math.max(runEnd, width);
  }
  if (run.length > 0) closeRun();
}

/** How many offsets deep a cascade goes before it gives up and splits the column. */
export const MAX_CASCADE_DEPTH = 3;

/**
 * The least time a later start must leave an earlier entry for its first title
 * line to stay uncovered: about one line at the three-day view's scale.
 */
export const MIN_CASCADE_VISIBLE_MINUTES = 20;

export interface CascadePlacement {
  /** 0 is flush left; each step in is one cascade offset. */
  depth: number;
  /** Paint order: a later-starting entry sits on top of an earlier one. */
  order: number;
  /** True when it starts while another entry is still running under it. */
  overlays: boolean;
  /** Minutes of this entry nothing later starts on top of, or null when none does. */
  visibleMinutes: number | null;
  /**
   * True when stacking this entry's overlap would hide a title, so it takes the
   * entry's `lane` and `laneCount` column like the Day view does. Every entry of
   * an overlapping run answers the same.
   */
  split: boolean;
}

/**
 * Where each entry sits when overlaps are stacked rather than split into
 * columns, for a column too narrow to halve (the three-day view).
 *
 * An entry takes the smallest offset not held by something still running when
 * it starts, so a short entry after a long one reuses the left edge once the
 * earlier one finishes and sits on top of it at full width. The one that starts
 * last paints last. The first line of an earlier entry's title is never
 * covered because whatever overlaps it starts after it, and `visibleMinutes`
 * says how much of it a later start leaves, so the caller can cut a title to
 * the lines that fit. Results are in the input's order.
 *
 * A stack only works while each covered entry keeps a readable first line, so a
 * run of overlapping entries falls back to the lane layout (`split`) when a later
 * one starts within `MIN_CASCADE_VISIBLE_MINUTES` of an earlier one, or when it
 * would sit deeper than `MAX_CASCADE_DEPTH`, where entries would cover each
 * other completely. Narrow columns that stay readable beat a stack that doesn't.
 */
export function cascadeEntries(entries: readonly TimelineEntry[]): CascadePlacement[] {
  const sorted = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      a.entry.startMinutes - b.entry.startMinutes
      || laneEnd(b.entry) - laneEnd(a.entry)
      || a.index - b.index);
  const placements: CascadePlacement[] = new Array(entries.length);
  const depths: number[] = [];
  sorted.forEach(({ entry, index }, rank) => {
    const running: number[] = [];
    for (let i = 0; i < rank; i += 1) {
      if (laneEnd(sorted[i].entry) > entry.startMinutes) running.push(depths[i]);
    }
    let depth = 0;
    while (running.includes(depth)) depth += 1;
    depths[rank] = depth;

    const next = sorted[rank + 1]?.entry.startMinutes;
    const nextStart = next !== undefined && next < laneEnd(entry) ? next : null;
    placements[index] = {
      depth,
      order: rank + 1,
      overlays: running.length > 0,
      visibleMinutes: nextStart === null ? null : nextStart - entry.startMinutes,
      split: false,
    };
  });

  // The runs are the ones `assignLanes` packs: a run ends where nothing in it is still going.
  let run: number[] = [];
  let runEnd = -1;
  const closeRun = () => {
    const cramped = run.some(index => {
      const { depth, visibleMinutes } = placements[index];
      return depth > MAX_CASCADE_DEPTH
        || (visibleMinutes !== null && visibleMinutes < MIN_CASCADE_VISIBLE_MINUTES);
    });
    for (const index of run) placements[index].split = cramped;
    run = [];
    runEnd = -1;
  };
  sorted.forEach(({ entry, index }) => {
    if (run.length > 0 && entry.startMinutes >= runEnd) closeRun();
    run.push(index);
    runEnd = Math.max(runEnd, laneEnd(entry));
  });
  if (run.length > 0) closeRun();
  return placements;
}

export function buildDayTimeline({ dayStart, tasks, events, sunLocation = null }: DayTimelineInput): DayTimeline {
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
    const placed = placeTask(task, dayStart, sunLocation);
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

/** What a tap on an empty stretch of the axis snaps to. */
export const SLOT_STEP_MINUTES = 15;

/**
 * The minute of the day a tap at `y` (points down the axis) lands on, snapped
 * down to `SLOT_STEP_MINUTES` and kept inside the drawn span. Down rather than
 * to the nearest, so a tap anywhere in the 2:30 to 2:45 band means 2:30, the
 * label the eye just read above the finger.
 */
export function slotMinutesAt(
  y: number,
  firstMinute: number,
  lastMinute: number,
  hourHeight: number,
  step: number = SLOT_STEP_MINUTES,
): number {
  const raw = firstMinute + (Math.max(0, y) / hourHeight) * 60;
  const snapped = Math.floor(raw / step) * step;
  const latest = Math.floor((lastMinute - 1) / step) * step;
  return Math.max(firstMinute, Math.min(snapped, latest));
}

/**
 * What a drag on the Day view is doing: making an event (the finger sets its
 * end, from a long-press on an empty stretch), moving one (both ends travel
 * together), or resizing one (its end travels, from the grip at its foot).
 * Making one is resizing a block that doesn't exist yet, so the two share
 * their arithmetic.
 */
export type TimelineDragKind = 'create' | 'move' | 'resize';

/**
 * How many minutes a day lasts from `dayStart` to the same wall-clock time the
 * next day: 1380 on the day the clocks go forward and 1500 on the day they go
 * back, `MINUTES_IN_DAY` on every other. The timeline counts elapsed minutes
 * from the day's start, so this is where its last minute is.
 */
export function dayLengthMinutes(dayStart: Date): number {
  const next = new Date(dayStart);
  next.setDate(next.getDate() + 1);
  return Math.round((next.getTime() - dayStart.getTime()) / 60000);
}

/**
 * Where a dragged block sits, in minutes from the day's start, given where it
 * started and how far the finger has gone. The distance is snapped to
 * `SLOT_STEP_MINUTES` the way a tap is, so a block that isn't on the grid
 * stays where it is until the finger has really moved it, and a stretched one
 * is never shorter than one step. Kept inside the day (`dayMinutes` long): a
 * moved block stops at either edge with its own length intact, however short,
 * and a stretched one stops at the day's end.
 */
export function draggedRange(
  kind: TimelineDragKind,
  origin: { start: number; end: number },
  deltaMinutes: number,
  step: number = SLOT_STEP_MINUTES,
  dayMinutes: number = MINUTES_IN_DAY,
): { start: number; end: number } {
  const moved = Math.round(deltaMinutes / step) * step;
  if (kind === 'move') {
    const length = Math.max(0, origin.end - origin.start);
    const start = Math.max(0, Math.min(origin.start + moved, dayMinutes - length));
    return { start, end: start + length };
  }
  const end = Math.min(dayMinutes, Math.max(origin.start + step, origin.end + moved));
  return { start: origin.start, end };
}

/**
 * Which of several side-by-side day columns a dragged event is over: the one
 * it was lifted from, plus however many whole columns the finger has crossed
 * (rounded, so it changes day once past halfway), kept inside the columns
 * drawn. A column with no width yet (not laid out) keeps the event where it was.
 */
export function draggedColumn(
  originIndex: number,
  deltaX: number,
  columnWidth: number,
  columnCount: number,
): number {
  if (columnWidth <= 0 || columnCount <= 0) return originIndex;
  const moved = originIndex + Math.round(deltaX / columnWidth);
  return Math.max(0, Math.min(columnCount - 1, moved));
}
