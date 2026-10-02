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
}

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
  const parsed = opts.ignoreSchedule ? null : parseTaskInput(input, opts.now, opts.wallClock);
  const mentions = applyMentionOverrides(
    input,
    matchPersonMentions(input, [...opts.people], [...(opts.groups ?? [])]),
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
    const token = input.slice(start + 1, end);
    // One person: their name. A group: the word typed, since it names several.
    const name = ids.length === 1 ? opts.nameOf(ids[0]) ?? token : token;
    spans.push({ start, end, text: name });
  }
  spans.sort((a, b) => b.start - a.start);
  let title = input;
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

  const phrase = parsed
    ? { start: parsed.matchStart, text: parsed.matchedText, lineWithout: parsed.cleanTitle }
    : null;
  const mentionSpans = [...bySpan.keys()].map(k => k.split(':').map(Number) as [number, number]);

  return { title, start, end: addHours(start, 1), personIds, scheduled: !!schedule, phrase, mentionSpans };
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
