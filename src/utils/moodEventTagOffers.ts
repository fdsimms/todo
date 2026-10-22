import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import type { BusyEvent } from './calendarBusy';
import { isLiveEvent } from './calendarBusy';
import { getDayStart } from './dateUtils';
import { EVENT_MATCH_MAX_LENGTH, EVENT_MATCH_MIN_LENGTH, ruleMatchesTitle } from './eventTasks';
import { MOOD_EVENT_TAG_MAX_LENGTH, type MoodEventTag } from './moodContextSources';

/**
 * Event names offered as calendar keyword rules in the Calendar keywords sheet:
 * "Therapy w/ Dr Kaplan, 2 in the last two weeks". The person decides whether
 * an event says anything about their mood; this only lists what is there, the
 * same offer-don't-decide line `calendarHistory.ts` keeps. Pure, and takes
 * `now` rather than reading the clock.
 */

/** How far either side of today the sheet looks for event names. */
export const MOOD_TAG_OFFER_DAYS = 14;

export interface MoodEventTagOffer {
  /** The name as the calendar has it, from the most recent event carrying it. */
  title: string;
  /** Events with this name before today, inside the window. */
  pastCount: number;
  /** The next one from today on, or null when none is coming up. */
  next: Date | null;
}

/** Lowercase with runs of whitespace flattened, so "Team  Standup" and "team standup" are one name. */
function nameKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Cuts text to `max` characters at a word boundary, so a rule made from a long
 * name still matches it: a keyword that ends mid-word is not a whole word.
 */
export function clipAtWord(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1).lastIndexOf(' ');
  return (cut > 0 ? clean.slice(0, cut) : clean.slice(0, max)).trim();
}

/**
 * One offer per event name, leaving out cancelled events, names too short to
 * be a keyword, and any name a rule already matches (on or off: either way the
 * person has answered it). Names that repeat come first, since a regular event
 * is the one worth a rule, then the soonest upcoming, then the most recent.
 */
export function moodEventTagOffers(
  events: readonly BusyEvent[],
  rules: readonly MoodEventTag[],
  now: Date,
  dayResetTime: string,
): MoodEventTagOffer[] {
  const todayStart = getDayStart(now, dayResetTime).getTime();
  const groups = new Map<string, { title: string; latest: number; pastCount: number; next: number | null; total: number }>();
  for (const event of events) {
    if (!isLiveEvent(event)) continue;
    const key = nameKey(event.title);
    if (key.length < EVENT_MATCH_MIN_LENGTH) continue;
    if (rules.some(rule => ruleMatchesTitle(rule, event.title))) continue;
    const start = Date.parse(event.start);
    if (Number.isNaN(start)) continue;
    let group = groups.get(key);
    if (!group) {
      group = { title: event.title.trim(), latest: start, pastCount: 0, next: null, total: 0 };
      groups.set(key, group);
    }
    group.total += 1;
    if (start < todayStart) group.pastCount += 1;
    else if (group.next === null || start < group.next) group.next = start;
    if (start >= group.latest) {
      group.latest = start;
      group.title = event.title.trim();
    }
  }
  return [...groups.values()]
    .sort((a, b) =>
      b.total - a.total
      || (a.next ?? Infinity) - (b.next ?? Infinity)
      || b.latest - a.latest)
    .map(g => ({ title: g.title, pastCount: g.pastCount, next: g.next === null ? null : new Date(g.next) }));
}

/** Keeps offers whose name holds every word typed, in any order. */
export function filterMoodEventTagOffers(
  offers: readonly MoodEventTagOffer[],
  query: string,
): MoodEventTagOffer[] {
  const words = nameKey(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...offers];
  return offers.filter(o => {
    const name = nameKey(o.title);
    return words.every(w => name.includes(w));
  });
}

/** "8 in the last two weeks", "Once in the last two weeks, next on Thursday", "2 in the last two weeks, one today", "Tomorrow". */
export function describeMoodEventTagOffer(offer: MoodEventTagOffer, now: Date, dayResetTime: string): string {
  const parts: string[] = [];
  if (offer.pastCount > 1) parts.push(`${offer.pastCount} in the last two weeks`);
  else if (offer.pastCount === 1) parts.push('Once in the last two weeks');
  if (offer.next) {
    const today = getDayStart(now, dayResetTime);
    const days = differenceInCalendarDays(getDayStart(offer.next, dayResetTime), today);
    const day = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : null;
    const date = days < 7 ? format(offer.next, 'EEEE') : format(offer.next, 'MMMM d');
    if (day) parts.push(parts.length > 0 ? `one ${day}` : day);
    else parts.push(`next on ${date}`);
  }
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The rule an offer becomes: the name as its keyword and, until changed, as its tag. */
export function ruleFromOffer(offer: MoodEventTagOffer, id: string): MoodEventTag {
  return {
    id,
    title: clipAtWord(offer.title, MOOD_EVENT_TAG_MAX_LENGTH),
    enabled: true,
    matches: [clipAtWord(offer.title, EVENT_MATCH_MAX_LENGTH)],
  };
}

/** The window `useCalendarStore.refreshRecent` reads, exported for its bounds. */
export function moodTagOfferWindow(now: Date, dayResetTime: string): { start: Date; end: Date } {
  const today = getDayStart(now, dayResetTime);
  return { start: addDays(today, -MOOD_TAG_OFFER_DAYS), end: addDays(today, MOOD_TAG_OFFER_DAYS + 1) };
}
