/**
 * One day of the calendar read as an agenda: the day's events and the tasks
 * that have a clock time, in one list by start, with everything else counted
 * rather than listed.
 *
 * The calendar is a view of the person's calendar first. A task earns a line
 * on it only when something says *when* in the day it happens (a time window,
 * a reminder, or a time block on the calendar), which is the same rule the Day
 * view's clock places by, so this is `buildDayTimeline` laid out as a list
 * rather than a second reading of the day. The rest of the day's tasks are a
 * count and a way into the list that owns them (Today, or Later for a day
 * still to come), never rows here: the task lists already show them, and
 * repeating them under the events is what made the calendar read as one more
 * task list.
 *
 * Pure: the day's start, its rows and its events arrive as parameters.
 */
import type { Task } from '../types';
import type { BusyEvent } from './calendarBusy';
import { buildDayTimeline, type DayTimelineInput } from './dayTimeline';

/** Free time shorter than this between two lines isn't worth a line of its own. */
export const AGENDA_GAP_MINUTES = 60;

export interface AgendaItem {
  key: string;
  kind: 'event' | 'task';
  title: string;
  /** Minutes from the logical day's start, as the timeline places them. */
  startMinutes: number;
  endMinutes: number;
  /** Nothing says how long it runs: show the start alone. */
  instant: boolean;
  /** Set for an event line, and for a task blocked out on the calendar. */
  event: BusyEvent | null;
  task: Task | null;
  /**
   * Free minutes between everything before this line and its start, when
   * there are at least `AGENDA_GAP_MINUTES` of them. Never set on the first
   * line: the stretch before the day's first thing is the day, not a gap.
   */
  gapBefore: number | null;
}

export interface DayAgenda {
  /** Events on the date rather than at a time (birthdays, a trip, a holiday). */
  allDay: BusyEvent[];
  items: AgendaItem[];
  /** The day's open tasks with nothing saying when. Counted, not listed. */
  untimed: Task[];
  /**
   * Where the "now" line goes: before `items[nowIndex]`, or after the last
   * line when it equals `items.length`. Null when now isn't in this day.
   */
  nowIndex: number | null;
}

export interface DayAgendaInput extends DayTimelineInput {
  /** The real instant, for the now line. Omit for a day that isn't today. */
  now?: Date | null;
}

export function buildDayAgenda({ now = null, ...input }: DayAgendaInput): DayAgenda {
  const timeline = buildDayTimeline(input);
  const taskById = new Map(input.tasks.map(t => [t.id, t]));
  const eventById = new Map(input.events.map(e => [e.id, e]));

  // The timeline sorts by start, then end; an agenda reads the same way.
  let busyUntil: number | null = null;
  const items: AgendaItem[] = timeline.entries.map(entry => {
    const gap = busyUntil === null ? null : entry.startMinutes - busyUntil;
    const end = entry.instant ? entry.startMinutes : entry.endMinutes;
    busyUntil = busyUntil === null ? end : Math.max(busyUntil, end);
    return {
      key: entry.key,
      kind: entry.kind,
      title: entry.title,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
      instant: entry.instant,
      event: entry.eventId ? eventById.get(entry.eventId) ?? null : null,
      task: entry.taskId ? taskById.get(entry.taskId) ?? null : null,
      gapBefore: gap !== null && gap >= AGENDA_GAP_MINUTES ? gap : null,
    };
  });

  let nowIndex: number | null = null;
  if (now) {
    const minutes = Math.floor((now.getTime() - input.dayStart.getTime()) / 60000);
    if (minutes >= 0 && minutes < 24 * 60) {
      // After everything that has started, so a meeting under way sits above
      // the line rather than below it.
      const next = items.findIndex(item => item.startMinutes > minutes);
      nowIndex = next === -1 ? items.length : next;
    }
  }

  return {
    allDay: timeline.allDay,
    items,
    untimed: timeline.unplaced.filter(t => !t.completed),
    nowIndex,
  };
}

/** Whether a line has finished, for dimming what's behind you today. */
export function isAgendaItemPast(item: AgendaItem, nowMinutes: number): boolean {
  const end = item.instant ? item.startMinutes : item.endMinutes;
  return end <= nowMinutes;
}

export type UntimedTarget = 'today' | 'later';

/**
 * Where a day's untimed tasks live. A day still to come is in Later; today's,
 * and an earlier day's still open, are on Today, since an overdue task stays
 * there until it's done.
 */
export function untimedTargetFor(dayKey: string, todayKey: string): UntimedTarget {
  return dayKey > todayKey ? 'later' : 'today';
}

/** "3 tasks without a time". Empty when there are none. */
export function describeUntimed(count: number): string {
  if (count <= 0) return '';
  return `${count} ${count === 1 ? 'task' : 'tasks'} without a time`;
}

/**
 * The colors a month cell marks a day with: one per event, in start order,
 * at most `max`. A calendar with no known color is skipped rather than drawn
 * in a stand-in color, which would read as a calendar that doesn't exist.
 */
export function dayEventColors(
  events: readonly BusyEvent[],
  colorFor: (calendarId: string) => string | undefined,
  max = 3,
): string[] {
  const out: string[] = [];
  for (const event of events) {
    if (out.length >= max) break;
    const color = colorFor(event.calendarId);
    if (color) out.push(color);
  }
  return out;
}

/** "1h free", "1h 30m free", "45m free". */
export function describeGap(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m free`;
  return m === 0 ? `${h}h free` : `${h}h ${m}m free`;
}

/**
 * "3 events · 1 task": the line beside a day's date. All-day events count as
 * events; the untimed tasks are left to their own link below the agenda.
 */
export function summarizeAgenda(agenda: DayAgenda): string {
  const events = agenda.allDay.length + agenda.items.filter(i => i.kind === 'event').length;
  const tasks = agenda.items.filter(i => i.kind === 'task').length;
  const parts: string[] = [];
  if (events > 0) parts.push(`${events} ${events === 1 ? 'event' : 'events'}`);
  if (tasks > 0) parts.push(`${tasks} ${tasks === 1 ? 'task' : 'tasks'}`);
  return parts.join(' · ');
}

/** "45 min", "1 hr", "2 hr 5 min". */
function describeSpan(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * Where an event stands against now, for the line under its title when it is
 * opened on its own: "Starts in 46 min", "Now, ends in 20 min". Null for one
 * that is over, or more than half a day off, where the date and time beside
 * it already say all there is.
 */
export function describeEventTiming(start: Date, end: Date, now: Date): string | null {
  const untilStart = Math.ceil((start.getTime() - now.getTime()) / 60000);
  if (untilStart > 0) return untilStart > 12 * 60 ? null : `Starts in ${describeSpan(untilStart)}`;
  const untilEnd = Math.ceil((end.getTime() - now.getTime()) / 60000);
  if (untilEnd > 0) return `Now, ends in ${describeSpan(untilEnd)}`;
  return null;
}

/** How many days the Schedule view lists, from today: the store's own read of the calendar. */
export const SCHEDULE_DAYS = 14;

export type ScheduleBlock =
  | { kind: 'day'; key: string }
  | { kind: 'quiet'; from: string; to: string; count: number };

/**
 * The Schedule view's list: each day with something on it as its own
 * section, and every run of days with nothing folded into one line, so two
 * weeks read as what's in them rather than as fourteen headings. Today is
 * always its own section, empty or not, since it is where the list starts.
 */
export function scheduleBlocks(
  days: readonly { key: string; isEmpty: boolean }[],
  todayKey: string,
): ScheduleBlock[] {
  const out: ScheduleBlock[] = [];
  for (const day of days) {
    if (!day.isEmpty || day.key === todayKey) {
      out.push({ kind: 'day', key: day.key });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.kind === 'quiet') {
      out[out.length - 1] = { ...last, to: day.key, count: last.count + 1 };
    } else {
      out.push({ kind: 'quiet', from: day.key, to: day.key, count: 1 });
    }
  }
  return out;
}
