/**
 * The calendar widget's section of the widget snapshot: what the extension
 * needs to draw today and tomorrow as an agenda, the way the Calendar screen
 * does (`calendarAgenda.ts`).
 *
 * **The extension reads the events itself when it can.** A calendar widget
 * that only knew what the app last wrote would show a meeting booked on a
 * laptop an hour ago only once the app was opened, which is the one thing a
 * calendar widget can't be. So this carries what the extension can't work
 * out from EventKit (which calendars the person reads, their colors as the
 * app shows them, the occurrences they hid, the logical days' bounds and the
 * tasks with a time), and the app's own read of each day as the fallback for an extension that
 * EventKit refuses. Which one it drew from is the extension's business; both
 * answer the same question.
 *
 * Pure: the caller hands in each day's rows and the calendar read.
 */
import type { Task } from '../types';
import { eventsIn, type BusyEvent } from './calendarBusy';
import { buildDayAgenda } from './calendarAgenda';
import type { SunLocation } from './sunTimes';

/** An event as the widget draws it. Times are ISO; the widget formats them. */
export interface WidgetCalendarEvent {
  /** EventKit's `calendarItemIdentifier`, which is what expo-calendar calls an event's id. */
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId: string;
  location: string | null;
  videoCall: boolean;
}

/** A task that has a time on one of the two days. */
export interface WidgetCalendarTask {
  id: string;
  title: string;
  /** The instant it starts, from its window, reminder or time block. */
  start: string;
  /** Null when nothing says how long it runs. */
  end: string | null;
  completed: boolean;
  category: string | null;
  /**
   * The calendar event this task is blocked out as (`Task.timeBlockEventId`,
   * an event id), which the widget leaves out so the block is one line, the
   * task, as on the Calendar screen.
   */
  blockEventId: string | null;
}

export interface WidgetCalendarDay {
  /** `YYYY-MM-DD`, the logical day. */
  key: string;
  /** The logical day's bounds, which the extension can't work out (it can't read the reset time). */
  start: string;
  end: string;
  /**
   * The app's own read of the day, or null when there isn't a trustworthy
   * one (the read is off, failed, or this is a background run). Bucketed
   * here, where `eventsIn` already knows which day an all-day event is on.
   */
  events: WidgetCalendarEvent[] | null;
  tasks: WidgetCalendarTask[];
  /** The day's open tasks with no time, which the widget only counts. */
  untimed: number;
}

/** A hidden occurrence: the event's id and its start, the two parts of `hiddenEventKey`. */
export interface WidgetHiddenEvent {
  id: string;
  start: string;
}

export interface WidgetCalendar {
  /** The calendars the app reads (vacation filter applied), so the widget reads the same ones. */
  calendarIds: string[];
  /** Each calendar's color as the app shows it, by id. */
  colors: Record<string, string>;
  hidden: WidgetHiddenEvent[];
  /** Today, then tomorrow. */
  days: WidgetCalendarDay[];
}

/** Enough lines for a large widget's day, with room for what's already over. */
export const MAX_WIDGET_CALENDAR_EVENTS = 16;
export const MAX_WIDGET_CALENDAR_TASKS = 12;

export interface WidgetCalendarDayInput {
  key: string;
  start: Date;
  end: Date;
  /** The day's task rows (`dayRows`), timed or not. */
  tasks: readonly Task[];
  sunLocation?: SunLocation | null;
}

export interface WidgetCalendarInput {
  days: readonly WidgetCalendarDayInput[];
  /** The calendar read, hidden events already left out, or null when there isn't one. */
  events: readonly BusyEvent[] | null;
  calendarIds: readonly string[];
  calendarsById: Readonly<Record<string, { color: string }>>;
  hidden: readonly WidgetHiddenEvent[];
}

const toWidgetEvent = (e: BusyEvent): WidgetCalendarEvent => ({
  id: e.id,
  title: e.title.trim(),
  start: e.start,
  end: e.end,
  allDay: e.allDay,
  calendarId: e.calendarId,
  location: e.location?.trim() || null,
  videoCall: e.videoCall === true,
});

export function buildWidgetCalendar(input: WidgetCalendarInput): WidgetCalendar {
  const colors: Record<string, string> = {};
  for (const id of input.calendarIds) {
    const color = input.calendarsById[id]?.color;
    if (color) colors[id] = color;
  }

  const days = input.days.map(day => {
    const dayEvents = input.events ? eventsIn(input.events, day.start, day.end) : [];
    // The same placement the Calendar screen's agenda makes, with the day's
    // events passed so a task blocked out on the calendar sits at its block.
    const agenda = buildDayAgenda({ dayStart: day.start, tasks: day.tasks, events: dayEvents, sunLocation: day.sunLocation ?? null });
    const at = (minutes: number) => new Date(day.start.getTime() + minutes * 60000).toISOString();
    const tasks = agenda.items
      .filter(item => item.kind === 'task' && item.task !== null)
      .slice(0, MAX_WIDGET_CALENDAR_TASKS)
      .map(item => ({
        id: item.task!.id,
        title: item.title.trim(),
        start: at(item.startMinutes),
        end: item.instant ? null : at(item.endMinutes),
        completed: item.task!.completed,
        category: item.task!.category ?? null,
        blockEventId: item.task!.timeBlockEventId ?? null,
      }));
    return {
      key: day.key,
      start: day.start.toISOString(),
      end: day.end.toISOString(),
      events: input.events ? dayEvents.slice(0, MAX_WIDGET_CALENDAR_EVENTS).map(toWidgetEvent) : null,
      tasks,
      untimed: agenda.untimed.length,
    };
  });

  return {
    calendarIds: [...input.calendarIds],
    colors,
    hidden: [...input.hidden],
    days,
  };
}
