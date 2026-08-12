/**
 * What the device calendar says about a day — how much of it is already spoken
 * for, and what's left.
 *
 * Pure on purpose, exactly like `dailyAgenda.ts`: everything here takes events
 * and a range and returns numbers or intervals, so the rules about what counts
 * as busy can be tested without a device. The EventKit half — permission, which
 * calendars, fetching — is `utils/calendarSync.ts`, and it does no filtering of
 * its own beyond marshalling: **the rules live here so they're the tested
 * half**, and so every reader asks the same question rather than re-deciding.
 *
 * A "Google Calendar integration" is this. A Google account added under iOS
 * Settings › Calendar › Accounts surfaces its calendars to EventKit as ordinary
 * CalDAV-backed calendars, so nothing in the app needs to know Google exists —
 * see #1495 for why that's the whole design and not a shortcut.
 */

/**
 * An event, flattened to the fields any read here needs.
 *
 * Deliberately not `expo-calendar`'s `Event`: that type carries thirty-odd
 * fields, half of them platform-conditional, and importing it would drag a
 * native module's types into a module the test suite loads. `status` and
 * `availability` stay plain strings for the same reason — the enums are
 * expo-calendar's, the values are stable strings, and the rules below are what
 * matter.
 */
export interface BusyEvent {
  id: string;
  title: string;
  /** ISO. */
  start: string;
  /** ISO. */
  end: string;
  allDay: boolean;
  calendarId: string;
  /** EventKit's `EventStatus` — 'confirmed' | 'tentative' | 'canceled' | 'none'. */
  status: string;
  /** EventKit's `Availability` — 'busy' | 'free' | 'tentative' | 'unavailable' | 'notSupported'. */
  availability: string;
}

/** Half-open [start, end) in epoch milliseconds. */
export interface BusyInterval {
  start: number;
  end: number;
}

/**
 * An event that still exists as far as the calendar is concerned.
 *
 * A cancelled event is history the account hasn't finished tidying up, and it
 * shows in no calendar UI — counting one would mean the app says the day has
 * three things on it while every other app on the phone says two.
 */
export function isLiveEvent(event: BusyEvent): boolean {
  return event.status !== 'canceled';
}

/**
 * An event that takes time out of the day.
 *
 * Two exclusions, and both are the difference between a number worth showing
 * and one that's noise:
 *
 * - **All-day events are not time.** A birthday, a public holiday, a
 *   "Sarah out of office" marker — every one of those would otherwise book the
 *   entire day solid, and a calendar with any of them in it would report every
 *   day as full. They're still real events (`eventsIn` returns them, and a
 *   caption can say so); they just aren't minutes.
 * - **An event marked Free is the user saying it isn't busy.** Google Calendar
 *   and iOS both expose that switch, people use it for exactly this, and
 *   overriding it means the app is arguing with an answer it was given.
 *
 * Tentative counts as busy: a meeting you haven't declined is one you may have
 * to attend, and a schedule suggestion that assumes otherwise is optimistic in
 * the direction that hurts.
 */
export function occupiesTime(event: BusyEvent): boolean {
  return isLiveEvent(event) && !event.allDay && event.availability !== 'free';
}

/** Epoch ms, or null for anything unparseable — a bad date is not a busy day. */
function ms(iso: string): number | null {
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

/**
 * The intervals of [rangeStart, rangeEnd) that are already spoken for, clipped
 * to the range and **merged**.
 *
 * Merging rather than summing is the whole reason this returns intervals
 * instead of a number. Two overlapping hour-long meetings are one hour of busy,
 * not two — and double-booking is normal enough that summing durations
 * overstates a working week badly, in a way that only ever shows up as the app
 * refusing to suggest a day that's actually fine.
 *
 * Clipping matters for the same reason in the other direction: an event running
 * from 22:00 to 01:00 gives two hours to one day and one to the next, never
 * three to both.
 */
export function busyIntervalsIn(
  events: readonly BusyEvent[],
  rangeStart: Date,
  rangeEnd: Date
): BusyInterval[] {
  const from = rangeStart.getTime();
  const to = rangeEnd.getTime();
  if (!(to > from)) return [];

  const clipped: BusyInterval[] = [];
  for (const event of events) {
    if (!occupiesTime(event)) continue;
    const start = ms(event.start);
    const end = ms(event.end);
    if (start === null || end === null) continue;
    const lo = Math.max(start, from);
    const hi = Math.min(end, to);
    // Covers three cases at once: an event outside the range, one that ends
    // before it starts, and a zero-length one. None of them is time.
    if (hi <= lo) continue;
    clipped.push({ start: lo, end: hi });
  }

  clipped.sort((a, b) => a.start - b.start);

  const merged: BusyInterval[] = [];
  for (const interval of clipped) {
    const last = merged[merged.length - 1];
    // `<=` so two meetings that abut become one block rather than two with a
    // zero-length gap between them — `freeGapsIn` would otherwise offer that
    // gap as somewhere to put a task.
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** How many minutes of [rangeStart, rangeEnd) are already spoken for. */
export function busyMinutesIn(
  events: readonly BusyEvent[],
  rangeStart: Date,
  rangeEnd: Date
): number {
  const total = busyIntervalsIn(events, rangeStart, rangeEnd)
    .reduce((sum, i) => sum + (i.end - i.start), 0);
  return Math.round(total / 60000);
}

/**
 * What's left of [rangeStart, rangeEnd) once the busy intervals are taken out.
 *
 * `minMinutes` drops the slivers: a four-minute gap between two meetings is
 * arithmetically free and is not somewhere anything goes, so a caller asking
 * "where could this 30-minute task go" passes 30 and gets answers it can use.
 */
export function freeGapsIn(
  events: readonly BusyEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  minMinutes = 0
): BusyInterval[] {
  const from = rangeStart.getTime();
  const to = rangeEnd.getTime();
  if (!(to > from)) return [];

  const gaps: BusyInterval[] = [];
  let cursor = from;
  for (const busy of busyIntervalsIn(events, rangeStart, rangeEnd)) {
    if (busy.start > cursor) gaps.push({ start: cursor, end: busy.start });
    cursor = Math.max(cursor, busy.end);
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });

  const floor = minMinutes * 60000;
  return gaps.filter(gap => gap.end - gap.start >= floor);
}

/** How many minutes of [rangeStart, rangeEnd) nothing has claimed. */
export function freeMinutesIn(
  events: readonly BusyEvent[],
  rangeStart: Date,
  rangeEnd: Date
): number {
  const span = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 60000);
  if (span <= 0) return 0;
  return Math.max(0, span - busyMinutesIn(events, rangeStart, rangeEnd));
}

/**
 * Every live event overlapping the range, in start order — all-day ones
 * included, since "what's on today" is a different question from "how much of
 * today is gone".
 */
export function eventsIn(
  events: readonly BusyEvent[],
  rangeStart: Date,
  rangeEnd: Date
): BusyEvent[] {
  const from = rangeStart.getTime();
  const to = rangeEnd.getTime();
  return events
    .filter(event => {
      if (!isLiveEvent(event)) return false;
      const start = ms(event.start);
      const end = ms(event.end);
      if (start === null || end === null) return false;
      // An all-day event's range is the day itself, so the same overlap test
      // covers both kinds. `end > from` keeps a meeting that finished at the
      // range's own start out of it.
      return start < to && end > from;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/**
 * The next thing with a time on it at or after `from`, within the range.
 *
 * All-day events are skipped: this answers "what's next", and something with
 * no time can't be next. Anything already under way is skipped too — an event
 * you're sitting in is not the one you're being told about.
 */
export function nextEventAfter(
  events: readonly BusyEvent[],
  from: Date,
  rangeEnd: Date
): BusyEvent | null {
  const at = from.getTime();
  const to = rangeEnd.getTime();
  let best: BusyEvent | null = null;
  let bestStart = Infinity;
  for (const event of events) {
    if (!isLiveEvent(event) || event.allDay) continue;
    const start = ms(event.start);
    if (start === null || start < at || start >= to) continue;
    if (start < bestStart) {
      best = event;
      bestStart = start;
    }
  }
  return best;
}
