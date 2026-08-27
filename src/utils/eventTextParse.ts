import { TITLE_MAX_LENGTH } from '../types';
import type { ExtractedCalendarEvent } from '../services/aiSuggestions';

/**
 * Reading an event out of pasted confirmation text with regexes alone — no
 * key, no network call, no model.
 *
 * **This exists because the AI path can be switched off, and a paste is the
 * one source that doesn't strictly need it.** A photo has to be read by
 * something; text is already text, and the fields worth having out of an
 * appointment confirmation are mostly shaped rather than meant: a date looks
 * like a date, an address looks like an address. So `calendarImport` being
 * off (or having no API key behind it) costs you the photo half and the
 * accuracy, not the feature.
 *
 * **What it is honestly worse at, and why the AI path still exists:**
 *
 * - **It reads one event, never several.** A travel itinerary confirming a
 *   flight and the hotel booked alongside it is one blob of text with no
 *   marker saying where the first event stops — segmenting it is a judgement
 *   about meaning, not about shape, which is the exact thing regexes can't
 *   do. So this takes the first date and the first time it finds and reports
 *   `moreDatesFound` when the text named others, rather than quietly
 *   dropping half an itinerary. The sheet is what shows that.
 * - **The title is a guess.** There is no structural signal in plain text
 *   saying which line is the name of the thing, so this takes the first line
 *   that isn't boilerplate, a date, an address, or a phone number. That is
 *   right surprisingly often on a templated confirmation page and wrong on
 *   anything free-form. An empty title is a fine outcome — the editor opens
 *   with the date and address already filled in and a cursor in the title.
 * - **The location is scored, not understood.** See `scoreAddressLine`.
 *
 * Deliberately pure and `now`-injected: resolving "October 2" with no year
 * needs to know what today is, and reading that off a bare `new Date()` is
 * the grace-window bug in CLAUDE.md. The caller passes
 * `getLogicalToday(dayResetTime)`.
 */

/** Same ceiling `extractCalendarEvents` puts on a paste, for the same reason. */
export const MAX_EVENT_TEXT_CHARS = 6_000;

/** A candidate title longer than this is prose, not a name. */
const MAX_TITLE_LINE = 80;

export interface ParsedEventText {
  /** The single event read, or null when nothing dated turned up. */
  event: ExtractedCalendarEvent | null;
  /**
   * The text named more than one distinct date, so it probably describes more
   * than one event — of which this read the first. Surfaced rather than
   * swallowed: silently keeping the flight and dropping the hotel is the
   * failure this whole flag exists to prevent.
   */
  moreDatesFound: boolean;
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Month name or abbreviation to 1-12. "sept" is the one abbreviation that isn't three letters. */
const MONTH_INDEX: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  MONTH_NAMES.forEach((name, i) => {
    map[name] = i + 1;
    map[name.slice(0, 3)] = i + 1;
  });
  map.sept = 9;
  return map;
})();

// Longest first, so the alternation matches "september" rather than stopping
// at "sep" and leaving "tember" behind to break the rest of the pattern.
const MONTH_PATTERN = Object.keys(MONTH_INDEX)
  .sort((a, b) => b.length - a.length)
  .join('|');

interface DateParts {
  year: number | null;
  month: number;
  day: number;
}

/** Is this a real calendar date? Rejects Feb 30 and friends, which the shape checks let through. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(year, month - 1, day, 12, 0, 0, 0);
  return probe.getMonth() === month - 1 && probe.getDate() === day;
}

/** Two-digit years are this century — a confirmation is not about 1926. */
function fullYear(raw: string): number {
  const n = Number(raw);
  return n < 100 ? 2000 + n : n;
}

/**
 * Every date-shaped run in the text, in the order they appear.
 *
 * Four shapes, and the numeric one carries the only genuine ambiguity here:
 * `9/12/2026` is September 12th to an American reader and 9 December to most
 * of the rest of the world. The app's copy is American English throughout
 * (see CLAUDE.md), so month-first is the assumption — but a first number
 * above 12 can only be a day, so `13/05/2026` is read day-first rather than
 * thrown away.
 */
function findDates(text: string): DateParts[] {
  const found: { at: number; parts: DateParts }[] = [];

  // "Monday September 28, 2026", "Sep 28", "September 28th 2026"
  const monthFirst = new RegExp(
    String.raw`\b(?:${MONTH_PATTERN})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b`,
    'gi',
  );
  // "28 September 2026"
  const dayFirst = new RegExp(
    String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:${MONTH_PATTERN})(?:,?\s*(\d{4}))?\b`,
    'gi',
  );
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  const numeric = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;

  let m: RegExpExecArray | null;

  while ((m = monthFirst.exec(text)) !== null) {
    const name = m[0].match(new RegExp(MONTH_PATTERN, 'i'))?.[0].toLowerCase();
    const month = name ? MONTH_INDEX[name] : undefined;
    if (!month) continue;
    found.push({ at: m.index, parts: { year: m[2] ? fullYear(m[2]) : null, month, day: Number(m[1]) } });
  }

  while ((m = dayFirst.exec(text)) !== null) {
    const name = m[0].match(new RegExp(MONTH_PATTERN, 'i'))?.[0].toLowerCase();
    const month = name ? MONTH_INDEX[name] : undefined;
    if (!month) continue;
    found.push({ at: m.index, parts: { year: m[2] ? fullYear(m[2]) : null, month, day: Number(m[1]) } });
  }

  while ((m = iso.exec(text)) !== null) {
    found.push({ at: m.index, parts: { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } });
  }

  while ((m = numeric.exec(text)) !== null) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    // A first number past 12 can only be a day; anything else is read
    // month-first — see this function's own note.
    const dayFirstNumeric = first > 12;
    found.push({
      at: m.index,
      parts: {
        year: fullYear(m[3]),
        month: dayFirstNumeric ? second : first,
        day: dayFirstNumeric ? first : second,
      },
    });
  }

  return found
    .sort((a, b) => a.at - b.at)
    .map(f => f.parts)
    // A year of `null` can't be validated yet, so only the shape is checked
    // here and the calendar check happens once a year has been resolved.
    .filter(p => p.month >= 1 && p.month <= 12 && p.day >= 1 && p.day <= 31);
}

/**
 * `YYYY-MM-DD` for a date that may not have stated its year.
 *
 * A yearless date resolves to its next occurrence on or after the current
 * logical day, which is what "October 2" on a confirmation means in every
 * case anyone pastes one.
 */
function resolveDate(parts: DateParts, now: Date): string | null {
  let year = parts.year;
  if (year === null) {
    year = now.getFullYear();
    const thisYear = new Date(year, parts.month - 1, parts.day, 12, 0, 0, 0);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    if (thisYear < today) year += 1;
  }
  if (!isRealDate(year, parts.month, parts.day)) return null;
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * The first time-shaped run in the text, as 24-hour `HH:MM`.
 *
 * Two passes rather than one regex: a meridiem time ("8:15 AM", "7 PM") and a
 * bare 24-hour one ("19:30") need different validation, and running them
 * separately keeps each readable. Bare matches overlapping a meridiem match
 * are dropped, since "8:15" inside "8:15 AM" is the same time read worse.
 *
 * The colon-or-meridiem requirement is what keeps this off the numbers that
 * surround a real time on a confirmation page: a phone number, a ZIP+4, an
 * "Estimated Visit Duration: 15 minutes" all fail both patterns.
 */
function findFirstTime(text: string): string | null {
  const meridiem = /\b(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?\b/gi;
  const twentyFour = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;

  const hits: { at: number; end: number; hh: number; mm: number }[] = [];
  let m: RegExpExecArray | null;

  while ((m = meridiem.exec(text)) !== null) {
    const raw = Number(m[1]);
    if (raw < 1 || raw > 12) continue;
    const pm = m[3].toLowerCase() === 'p';
    const hh = raw === 12 ? (pm ? 12 : 0) : raw + (pm ? 12 : 0);
    hits.push({ at: m.index, end: m.index + m[0].length, hh, mm: m[2] ? Number(m[2]) : 0 });
  }

  const meridiemRanges = hits.map(h => [h.at, h.end] as const);
  while ((m = twentyFour.exec(text)) !== null) {
    const at = m.index;
    const end = at + m[0].length;
    if (meridiemRanges.some(([s, e]) => at < e && end > s)) continue;
    hits.push({ at, end, hh: Number(m[1]), mm: Number(m[2]) });
  }

  if (hits.length === 0) return null;
  const first = hits.sort((a, b) => a.at - b.at)[0];
  return `${String(first.hh).padStart(2, '0')}:${String(first.mm).padStart(2, '0')}`;
}

const PHONE = /\b\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/i;
const CONFIRMATION_WORD = /\b(confirmation|reservation\s*(?:#|no\.?|number)|record\s+locator|booking\s*(?:#|ref|reference))\b/i;
const STREET_SUFFIX = /\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|parkway|pkwy|highway|hwy|square|sq|terrace|ter|circle|cir|north|south|east|west)\b\.?/i;
/** "NY 10038", "IL 60611" — a state code next to a ZIP, which a confirmation number never is. */
const CITY_STATE_ZIP = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;

/** Page furniture: true of a line that says what the page is rather than what the event is. */
const BOILERPLATE = new RegExp(
  '^(?:'
  + [
    'appointment (?:details|scheduled|confirmed|information)',
    "you'?re all set",
    '(?:booking|reservation|order|your booking|your reservation) confirmed',
    'your trip is booked',
    'confirmed', 'confirmation', 'details',
    'add to calendar', 'get directions', 'view (?:details|map)',
    'prepare for your visit', 'manage (?:booking|reservation)',
    'print', 'thank you', 'thanks for booking',
    'itinerary', 'e-?ticket', 'receipt',
  ].join('|')
  + ')\\b',
  'i',
);

/**
 * How much a line looks like part of a postal address.
 *
 * Scored rather than matched because a real address line has no single
 * reliable shape: "240 Central Park South" carries no street-type word at
 * all, and "New York NY 10038-2609" carries no street number. What the
 * negatives are for is the mistake this replaced — a bare five-digit test
 * called `Confirmation #M-88213` an address, because a confirmation number
 * is also a run of digits.
 */
function scoreAddressLine(line: string): number {
  let score = 0;
  if (/^\d+\s+[A-Za-z]/.test(line)) score += 2;
  if (STREET_SUFFIX.test(line)) score += 2;
  if (CITY_STATE_ZIP.test(line)) score += 3;
  if (CONFIRMATION_WORD.test(line) || line.includes('#')) score -= 5;
  if (PHONE.test(line)) score -= 5;
  if (URL_LIKE.test(line)) score -= 3;
  return score;
}

const ADDRESS_SCORE = 2;

/**
 * The address, assembled from the run of consecutive lines that scores as
 * one, plus the line above it when that reads as the name of the place.
 *
 * The venue line is worth reaching for because it's the half a person
 * actually recognises — "Weill Cornell Otolaryngology" tells you where you're
 * going in a way that "156 William Street" doesn't. It's only taken when it's
 * short, carries no digits, isn't page furniture, and isn't already being
 * used as the title, so a heading or a date sitting above an address can't be
 * mistaken for the name of a building.
 */
function findLocation(lines: string[], titleLine: string | null): string {
  const start = lines.findIndex(line => scoreAddressLine(line) >= ADDRESS_SCORE);
  if (start === -1) return '';

  const parts: string[] = [];
  const above = start > 0 ? lines[start - 1] : null;
  if (
    above
    && above !== titleLine
    && above.length <= 60
    && !/\d/.test(above)
    && !BOILERPLATE.test(above)
    && !URL_LIKE.test(above)
  ) {
    parts.push(above);
  }

  for (let i = start; i < lines.length; i += 1) {
    if (scoreAddressLine(lines[i]) < ADDRESS_SCORE) break;
    parts.push(lines[i]);
  }

  return parts.join(', ');
}

/** A phone number and a confirmation number, when the text prints them — what's worth keeping that has no field of its own. */
function findNotes(lines: string[]): string {
  const notes: string[] = [];

  const phoneLine = lines.find(line => PHONE.test(line));
  const phone = phoneLine?.match(PHONE)?.[0];
  if (phone) notes.push(phone);

  // The code has to carry a digit. Without that the word after the label is
  // taken as the code, so a page headed "Reservation Confirmed" reports a
  // confirmation number of "Confirmed".
  const confirmation = lines
    .map(line => line.match(
      /(?:confirmation|reservation|record\s+locator|booking\s*ref(?:erence)?)[^A-Za-z0-9]*(?:#|no\.?|number)?[^A-Za-z0-9]*((?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{3,})/i,
    ))
    .find(Boolean);
  if (confirmation?.[1]) notes.push(`Confirmation ${confirmation[1]}`);

  return notes.join(' · ');
}

/**
 * The first line that reads as the name of the event.
 *
 * Everything this skips is something a confirmation page reliably puts above
 * the answer: the page's own heading, the date, the address, the phone
 * number. What's left over is usually the line a person would have typed
 * themselves, and when it isn't, an empty title costs one field of typing
 * rather than a wrong one to notice and correct.
 */
function findTitle(lines: string[], dateLines: Set<string>): string {
  for (const line of lines) {
    if (BOILERPLATE.test(line)) continue;
    if (dateLines.has(line)) continue;
    if (scoreAddressLine(line) >= ADDRESS_SCORE) continue;
    if (PHONE.test(line) || URL_LIKE.test(line) || line.includes('@')) continue;
    if (CONFIRMATION_WORD.test(line)) continue;
    if (line.length < 3 || line.length > MAX_TITLE_LINE) continue;
    return line.slice(0, TITLE_MAX_LENGTH);
  }
  return '';
}

/**
 * Reads one event out of pasted text. `now` decides the year for a date that
 * didn't state one — pass `getLogicalToday(dayResetTime)`, never a bare
 * `new Date()`.
 */
export function parseEventText(text: string, now: Date): ParsedEventText {
  const trimmed = text.trim().slice(0, MAX_EVENT_TEXT_CHARS);
  if (!trimmed) return { event: null, moreDatesFound: false };

  const lines = trimmed
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const dates = findDates(trimmed)
    .map(parts => resolveDate(parts, now))
    .filter((d): d is string => d !== null);
  // Nothing to put on a day is nothing worth calling an event — the whole
  // point of this is landing something on a date.
  if (dates.length === 0) return { event: null, moreDatesFound: false };

  const date = dates[0];
  const moreDatesFound = new Set(dates).size > 1;

  // Lines carrying a date are never the title — they're when it is, not what
  // it is. Matched by line rather than by offset because a date can sit
  // mid-sentence ("Departs 6:05 AM on 9/12/2026").
  const dateLines = new Set(lines.filter(line => findDates(line).length > 0));
  const title = findTitle(lines, dateLines);

  return {
    event: {
      title,
      date,
      time: findFirstTime(trimmed),
      location: findLocation(lines, title || null),
      notes: findNotes(lines),
    },
    moreDatesFound,
  };
}
