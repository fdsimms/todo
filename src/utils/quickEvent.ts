import { addHours } from 'date-fns/addHours';
import {
  applyMentionOverrides,
  matchPersonMentions,
  parseTaskInput,
  type GroupMentionToken,
  type PersonToken,
} from './parseTaskInput';
import { defaultNewEventSpan } from './eventPeople';
import type { TimeOfDay } from '../types';

/**
 * One typed line ("lunch w/ @dustin fri 12p") turned into a new calendar
 * event, the event counterpart of quick add. Nothing here writes anything: it
 * fills Apple's new-event sheet, which is where the user checks and saves it
 * (`presentEventCreate`), and names who to link it to afterward.
 *
 * **It reuses quick add's two readers rather than growing its own**:
 * `parseTaskInput` for the day and time, `matchPersonMentions` for "@name".
 * Both already carry the refusals that matter (a schedule phrase must be a
 * suffix, an ambiguous "@sam" names nobody), so an event line reads exactly
 * the way a task line does.
 *
 * **A repeat phrase is read for its first day only.** "Every monday" becomes
 * next Monday; a repeating event is set up in the sheet, which has the real
 * repeat control, rather than translated from task recurrence into EventKit's.
 */
export interface QuickEventDraft {
  /** The line minus the schedule phrase, with each "@name" as the name. */
  title: string;
  start: Date;
  end: Date;
  personIds: string[];
  /** Whether a day or time was read from the line, for the preview. */
  scheduled: boolean;
  /**
   * The schedule phrase that was read, for the sheet to highlight and offer
   * to set: where it starts, the text itself, and the line with it taken out
   * (mentions left as typed). Null when nothing was read or it was ignored.
   */
  phrase: { start: number; text: string; lineWithout: string } | null;
  /** Each resolved "@name" span in the line, for highlighting. */
  mentionSpans: [number, number][];
  /** The place read from a trailing "at Joe's", or null when the line names none. */
  location: string | null;
  /**
   * The alert read from a trailing "alert 30m", as minutes before the start
   * (0 is at the start). Null is "alert none"; undefined is "no alert clause
   * typed", which leaves the remembered default alone.
   */
  alertMinutes: number | null | undefined;
  /** The location and alert clauses in the line, for highlighting. */
  clauseSpans: [number, number][];
}

// "alert 30m", "alert 1 hour", "alert 2d", "alert none". A suffix, like the
// schedule phrase, so a word "alert" inside a title is left alone.
const ALERT_CLAUSE = /\s+alert\s+(?:(\d{1,4})\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)?|none|off)\s*$/i;

/** Minutes a unit word stands for. A bare number is minutes. */
function unitMinutes(unit: string | undefined): number {
  const u = (unit ?? 'm').toLowerCase();
  if (u.startsWith('h')) return 60;
  if (u.startsWith('d')) return 1440;
  return 1;
}

/**
 * Reads a trailing alert clause. `start` is where its leading space begins, so
 * `input.slice(0, start)` is the line without it.
 */
export function parseAlertClause(
  input: string
): { start: number; minutes: number | null } | null {
  const m = ALERT_CLAUSE.exec(input);
  if (!m) return null;
  if (m[1] === undefined) return { start: m.index, minutes: null };
  return { start: m.index, minutes: Number(m[1]) * unitMinutes(m[2]) };
}

const ALL_DAY_ALERT_HOUR = 9;

/**
 * EventKit's `relativeOffset` for "N minutes before". A timed event counts
 * back from its start. An all-day event starts at midnight, where an alert is
 * useless, so it counts back from 9:00 that morning, the time Calendar's own
 * "On day of event" uses.
 */
export function alertRelativeOffset(minutes: number, allDay: boolean): number {
  return (allDay ? ALL_DAY_ALERT_HOUR * 60 : 0) - minutes;
}

// " at Joe's", where the clause runs to the end of what is left.
const LOCATION_CLAUSE = /\s+at\s+(\S.*)$/i;

/** A representative hour for a day-part word with no clock time. */
const DAY_PART_HOUR: Record<TimeOfDay, number> = {
  morning: 9,
  afternoon: 14,
  evening: 19,
  night: 21,
};

export function parseQuickEvent(
  input: string,
  opts: {
    people: readonly PersonToken[];
    groups?: readonly GroupMentionToken[];
    /** The name to write in place of a resolved "@token". */
    nameOf: (personId: string) => string | null;
    /** `getLogicalNow(dayResetTime)`, the "now" quick add parses against. */
    now: Date;
    /** `getCurrentDayStart()`. */
    today: Date;
    /**
     * The real current time, for "the next whole hour". Not `now`, which is
     * pulled back a day in the grace window so a parsed "tomorrow" lands right.
     */
    wallClock: Date;
    /**
     * Read no schedule phrase at all: the user said "not that" to it, so it
     * stays part of the title and the day falls back to the default.
     */
    ignoreSchedule?: boolean;
    /** Picks made for an "@name" more than one person answers to, by token. */
    mentionOverrides?: Record<string, string>;
  }
): QuickEventDraft {
  // Peel the trailing clauses right to left (alert, then place) so what is
  // left ends in the schedule phrase `parseTaskInput` needs. Every index below
  // is into `body`, a prefix of `input`, so it is also an index into `input`.
  const alertClause = parseAlertClause(input);
  const afterAlert = alertClause ? input.slice(0, alertClause.start) : input;
  let body = afterAlert;
  let location: string | null = null;
  let locationStart: number | null = null;
  const locationMatch = LOCATION_CLAUSE.exec(afterAlert);
  if (locationMatch) {
    const place = locationMatch[1].trim().replace(/[\s,;.]+$/, '');
    // "at 3pm" and "at the park tomorrow" end in a schedule phrase, so they
    // are the time, not the place. Put the place last: "lunch fri 12p at Joe's".
    const endsInTime =
      !opts.ignoreSchedule && parseTaskInput(`x ${place}`, opts.now, opts.wallClock) !== null;
    if (place && !endsInTime) {
      location = place;
      locationStart = locationMatch.index;
      body = afterAlert.slice(0, locationMatch.index);
    }
  }

  const parsed = opts.ignoreSchedule ? null : parseTaskInput(body, opts.now, opts.wallClock);
  const mentions = applyMentionOverrides(
    body,
    matchPersonMentions(body, [...opts.people], [...(opts.groups ?? [])]),
    opts.mentionOverrides ?? {}
  );
  const personIds = [...new Set(mentions.map(m => m.personId))];

  // Rebuild the title from the original input so both kinds of span can be
  // edited by index: the schedule phrase dropped, each mention named.
  const spans: { start: number; end: number; text: string }[] = [];
  if (parsed) {
    spans.push({ start: parsed.matchStart, end: parsed.matchStart + parsed.matchedText.length, text: '' });
  }
  const bySpan = new Map<string, string[]>();
  for (const m of mentions) {
    const k = `${m.start}:${m.end}`;
    const held = bySpan.get(k);
    if (held) held.push(m.personId);
    else bySpan.set(k, [m.personId]);
  }
  for (const [k, ids] of bySpan) {
    const [start, end] = k.split(':').map(Number);
    const token = body.slice(start + 1, end);
    // One person: their name. A group: the word typed, since it names several.
    const name = ids.length === 1 ? opts.nameOf(ids[0]) ?? token : token;
    spans.push({ start, end, text: name });
  }
  spans.sort((a, b) => b.start - a.start);
  let title = body;
  for (const span of spans) {
    title = title.slice(0, span.start) + span.text + title.slice(span.end);
  }
  title = title.replace(/\s+/g, ' ').trim().replace(/[\s,;:.-]+$/, '');

  const schedule = parsed?.schedule;
  let start: Date;
  if (schedule?.explicitClockTime) {
    const d = schedule.dueDate;
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), schedule.explicitClockTime.h, schedule.explicitClockTime.m);
  } else if (schedule && schedule.timeSegments.length > 0) {
    const d = schedule.dueDate;
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_PART_HOUR[schedule.timeSegments[0]], 0);
  } else {
    // No time: the same default the other "New event" buttons use, on the
    // day read (or today).
    start = defaultNewEventSpan(schedule?.dueDate ?? opts.today, opts.today, opts.wallClock).start;
  }

  // Taking the schedule phrase out of the line must leave the clauses that
  // followed it, or accepting the date would silently drop the place and alert.
  const clausesFrom = locationStart ?? alertClause?.start ?? null;
  const clauses = clausesFrom === null ? '' : input.slice(clausesFrom);
  const phrase = parsed
    ? { start: parsed.matchStart, text: parsed.matchedText, lineWithout: parsed.cleanTitle + clauses }
    : null;
  const mentionSpans = [...bySpan.keys()].map(k => k.split(':').map(Number) as [number, number]);
  const clauseSpans: [number, number][] = [];
  if (locationStart !== null) {
    clauseSpans.push([locationStart + (/^\s*/.exec(afterAlert.slice(locationStart))?.[0].length ?? 0), afterAlert.length]);
  }
  if (alertClause) {
    clauseSpans.push([alertClause.start + (/^\s*/.exec(input.slice(alertClause.start))?.[0].length ?? 0), input.length]);
  }

  return {
    title,
    start,
    end: addHours(start, 1),
    personIds,
    scheduled: !!schedule,
    phrase,
    mentionSpans,
    location,
    alertMinutes: alertClause ? alertClause.minutes : undefined,
    clauseSpans,
  };
}

/**
 * The marker that turns a regular quick add line into an event: a leading
 * "event:" ("event: lunch w/ @dustin sat 12pm"). Returns the rest of the line
 * when it is there, or null. A leading word and a colon, so it can't be hit by
 * accident mid-title, and "event" alone without the colon stays a task title.
 */
export function eventMarkerText(input: string): string | null {
  const match = /^\s*event:\s*/i.exec(input);
  return match ? input.slice(match[0].length) : null;
}
