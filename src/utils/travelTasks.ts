import type { BusyEvent } from './calendarBusy';
import type { Task } from '../types';
import { eventIsRuleEligible, eventOccurrenceKey, type HandledEventTasks } from './eventTasks';
import { generatedSourceOf } from './generatedTasks';
import type { SavedPlace } from './savedPlaces';

/**
 * Travel tasks — "Leave for Dentist", for a calendar event somewhere else.
 *
 * The rules module for the `travel` generator (see `generatedTasks.ts` and
 * `docs/arch/generated-tasks.md`), store-free like `eventTasks.ts`, whose
 * occurrence key, eligibility gate and handled record it reuses rather than
 * copies: orchestration lives in `useTaskStore.ts`'s `checkTravelTasks`.
 *
 * **An event with a location is the whole trigger.** The app has no home
 * address and asks for none. An event somebody bothered to put an address on
 * is one they travel to, and an event with no location is treated as one they
 * don't, which is the same "noticed, never inferred" line `eventTasks.ts`
 * holds about titles. Nothing here reads, geocodes or sends the location; it
 * only checks that one is there.
 *
 * **The travel time is the user's number unless they ask for an estimate.**
 * `travelLeadMinutes` is typed in Settings and subtracted from the event's
 * start to give the reminder. With `travelEstimates` on (off by default),
 * Apple Maps' estimate from where the phone is to the event's place replaces
 * it for any event that has one (`estimatedLeadMinutes`), and the typed number
 * stays the fallback for every event that doesn't. It is opt-in because it
 * sends the addresses of the user's appointments, and their position, to
 * Apple, and an estimate can be wrong in a way the user's own guess isn't, so
 * the title says the estimate out loud ("25 min by transit") rather than
 * moving the reminder silently.
 *
 * **The reminder is what makes it useful, and it is deterministic.** "Leave at
 * 8:10" is known the moment the event is, so it can be queued the evening
 * before and be correct whenever it fires. The MTA note
 * (`transitAlerts.ts`) is a footnote on top: it rewrites the title when the
 * app has a fresh read, and costs nothing when it doesn't.
 */

export const TRAVEL_LEAD_MINUTES_DEFAULT = 30;
export const TRAVEL_LEAD_MINUTES_MIN = 5;
export const TRAVEL_LEAD_MINUTES_MAX = 180;
export const TRAVEL_LEAD_MINUTES_STEP = 5;

/** How a trip is estimated; the `travelMode` setting. */
export type TravelMode = 'driving' | 'transit' | 'walking';
export const TRAVEL_MODES: readonly TravelMode[] = ['driving', 'transit', 'walking'];

/**
 * What one event overrides about its own trip: how it is travelled (null keeps
 * the Settings mode), how early to arrive (negative is late) and where the
 * trip starts (null keeps the Settings starting point). App-only metadata like
 * `eventPeople.ts`: EventKit has no public field for any of them, so nothing is
 * written to the calendar event.
 */
export interface TravelEventPref {
  mode: TravelMode | null;
  /** Minutes to arrive before the start; negative arrives after it. 0 is on time. */
  arriveEarlyMinutes: number;
  /**
   * A saved place id, `TRAVEL_ORIGIN_PHONE` for "where I am", or null to follow
   * the Settings starting point. Its own value for the phone, since null is
   * "no override" and a Settings default of a saved place has to be overridable.
   */
  originPlaceId: string | null;
}

/** `TravelEventPref.originPlaceId` for an event whose trip starts from the phone's position. */
export const TRAVEL_ORIGIN_PHONE = 'phone';

/** Overrides by calendar event id, so a repeating event keeps its choice every week. */
export type TravelEventPrefs = Readonly<Record<string, TravelEventPref>>;

/** The arrival choices the event sheet offers: early (positive), on time, late (negative). */
export const TRAVEL_ARRIVE_CHOICES: readonly number[] = [30, 15, 10, 5, 0, -5, -10, -15];

export function clampArriveEarlyMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const stepped = Math.round(value / 5) * 5;
  return Math.min(60, Math.max(-30, stepped));
}

/** `travelEventPrefs` off settings, defensively; an entry that overrides nothing is dropped. */
export function parseTravelEventPrefs(raw: unknown): TravelEventPrefs {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, TravelEventPref> = {};
  for (const [eventId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!eventId || !entry || typeof entry !== 'object') continue;
    const { mode, arriveEarlyMinutes, originPlaceId } = entry as Record<string, unknown>;
    const pref: TravelEventPref = {
      mode: TRAVEL_MODES.find(m => m === mode) ?? null,
      arriveEarlyMinutes: clampArriveEarlyMinutes(arriveEarlyMinutes),
      originPlaceId: typeof originPlaceId === 'string' && originPlaceId ? originPlaceId : null,
    };
    if (pref.mode !== null || pref.arriveEarlyMinutes !== 0 || pref.originPlaceId !== null) out[eventId] = pref;
  }
  return out;
}

/** The mode this event is travelled by: its own pick, else the Settings mode. */
export function travelModeFor(eventId: string, prefs: TravelEventPrefs, defaultMode: TravelMode): TravelMode {
  return prefs[eventId]?.mode ?? defaultMode;
}

/** Minutes to arrive before the start, for this event (0 when it has no override). */
export function arriveEarlyFor(eventId: string, prefs: TravelEventPrefs): number {
  return prefs[eventId]?.arriveEarlyMinutes ?? 0;
}

/** "10 min early", "On time", "5 min late". */
export function describeArrival(arriveEarlyMinutes: number): string {
  if (arriveEarlyMinutes === 0) return 'On time';
  return `${Math.abs(arriveEarlyMinutes)} min ${arriveEarlyMinutes > 0 ? 'early' : 'late'}`;
}

/**
 * The reminder lead for an event: the trip (typed or estimated) plus how early
 * it should arrive, never below zero, so arriving late can't put the reminder
 * after the start.
 */
export function leadWithArrival(leadMinutes: number, arriveEarlyMinutes: number): number {
  return Math.max(0, leadMinutes + arriveEarlyMinutes);
}

/**
 * Added to an estimate before it becomes a reminder: a few minutes to get out
 * the door, which no routing estimate counts.
 */
export const TRAVEL_ESTIMATE_MARGIN_MINUTES = 5;

/** How old an estimate may be before the next trigger asks again; traffic and transit move. */
export const TRAVEL_ESTIMATE_STALE_MS = 20 * 60 * 1000;

/** At most this many estimates per refresh, so a day of back-to-back meetings isn't a burst of requests. */
export const TRAVEL_ESTIMATES_PER_REFRESH = 6;

/**
 * One estimate, for one occurrence, kept with what it was asked about: the
 * location text, the mode and where the trip started. An event whose location
 * was edited, or a mode or starting point changed since, doesn't match and is
 * asked again rather than reusing a trip to the wrong place.
 */
export interface TravelEstimate {
  minutes: number;
  location: string;
  mode: TravelMode;
  /** `travelOriginKey` of where the trip started from. */
  origin: string;
  /** Epoch ms when it was read. */
  at: number;
}

/** `travelOriginKey` for a trip that starts from wherever the phone is. */
export const TRAVEL_ORIGIN_CURRENT = 'current';

/** A saved place a trip starts from instead of the phone's position. */
export interface TravelOrigin {
  name: string;
  latitude: number;
  longitude: number;
}

/** The saved places a trip can start from: only those with a map pin, since an address alone has no coordinate to send. */
export function originCandidates(places: readonly SavedPlace[]): SavedPlace[] {
  return places.filter(p => p.latitude !== null && p.longitude !== null);
}

/**
 * The starting place the setting names, or null for "where I am now". A place
 * that was removed, or has no pin, reads as null too, and the settings row
 * shows its value through this same function, so what it says is what the
 * estimate uses.
 */
export function travelOriginFor(placeId: string | null, places: readonly SavedPlace[]): TravelOrigin | null {
  if (!placeId) return null;
  const place = originCandidates(places).find(p => p.id === placeId);
  if (!place || place.latitude === null || place.longitude === null) return null;
  return { name: place.name, latitude: place.latitude, longitude: place.longitude };
}

/**
 * Where this event's trip starts: its own pick, else the Settings starting
 * point. A pick of a place that was removed, or has no pin, follows Settings
 * rather than silently becoming the phone's position, the same fallback the
 * Settings row has. Null is where the phone is.
 */
export function travelOriginForEvent(
  eventId: string,
  prefs: TravelEventPrefs,
  defaultPlaceId: string | null,
  places: readonly SavedPlace[],
): TravelOrigin | null {
  const pick = prefs[eventId]?.originPlaceId ?? null;
  if (pick === TRAVEL_ORIGIN_PHONE) return null;
  return travelOriginFor(pick, places) ?? travelOriginFor(defaultPlaceId, places);
}

/** What an estimate is filed under: moving the starting point (or the pin) changes it, a rename doesn't. */
export function travelOriginKey(origin: TravelOrigin | null): string {
  return origin ? `at:${origin.latitude.toFixed(5)},${origin.longitude.toFixed(5)}` : TRAVEL_ORIGIN_CURRENT;
}

/** Estimates by occurrence key (`travelSourceId`). */
export type TravelEstimates = Readonly<Record<string, TravelEstimate>>;

/** The estimate held for this event, or null when there is none or it was for a different place or mode. */
export function estimateFor(
  event: Pick<BusyEvent, 'id' | 'start' | 'location'>,
  estimates: TravelEstimates,
  mode: TravelMode,
  origin: string,
): TravelEstimate | null {
  const held = estimates[travelSourceId(event)];
  if (!held) return null;
  if (held.mode !== mode || held.origin !== origin || held.location !== (event.location ?? '').trim()) return null;
  return held;
}

/**
 * The reminder lead an estimate gives: the trip plus the margin, rounded up to
 * the stepper's 5 minutes and clamped to its range, so an estimated lead is a
 * number the user could have typed.
 */
export function estimatedLeadMinutes(minutes: number): number {
  const padded = Math.max(0, minutes) + TRAVEL_ESTIMATE_MARGIN_MINUTES;
  const stepped = Math.ceil(padded / TRAVEL_LEAD_MINUTES_STEP) * TRAVEL_LEAD_MINUTES_STEP;
  return Math.min(TRAVEL_LEAD_MINUTES_MAX, Math.max(TRAVEL_LEAD_MINUTES_MIN, stepped));
}

const MODE_WORDS: Record<TravelMode, string> = { driving: 'by car', transit: 'by transit', walking: 'on foot' };

/** "25 min by transit", "1 hr 10 min by car": the estimate as the title says it. */
export function describeTravelEstimate(minutes: number, mode: TravelMode): string {
  const rounded = Math.max(1, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  const span = hours === 0 ? `${rest} min` : rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
  return `${span} ${MODE_WORDS[mode]}`;
}

/**
 * Whether an event wants a fresh estimate: none held for its place and mode,
 * or the one held is older than `TRAVEL_ESTIMATE_STALE_MS`.
 */
export function needsTravelEstimate(
  event: Pick<BusyEvent, 'id' | 'start' | 'location'>,
  estimates: TravelEstimates,
  mode: TravelMode,
  origin: string,
  now: Date,
): boolean {
  const held = estimateFor(event, estimates, mode, origin);
  return !held || now.getTime() - held.at >= TRAVEL_ESTIMATE_STALE_MS;
}

/** An event title is someone else's text and can be long; the row has one line for it. */
export const TRAVEL_EVENT_TITLE_MAX_LENGTH = 60;

/** `travelLeadMinutes` clamped to what the stepper offers, defaulting anything unusable. */
export function clampTravelLeadMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TRAVEL_LEAD_MINUTES_DEFAULT;
  const stepped = Math.round(value / TRAVEL_LEAD_MINUTES_STEP) * TRAVEL_LEAD_MINUTES_STEP;
  return Math.min(TRAVEL_LEAD_MINUTES_MAX, Math.max(TRAVEL_LEAD_MINUTES_MIN, stepped));
}

/**
 * A lead per calendar, by EventKit calendar id: "events on Work get 45
 * minutes". Holds overrides only; a calendar with no entry uses the default.
 *
 * The calendar is the one way to vary the lead that needs no guessing. The
 * alternative, reading a neighborhood or a distance out of the location, is
 * the inference this module refuses (see the header): a calendar is a choice
 * the user already made about where an event belongs.
 */
export type TravelLeadByCalendar = Record<string, number>;

/**
 * `travelLeadByCalendar` off settings, defensively: anything that isn't a
 * calendar id mapped to a usable number is dropped, and every value is clamped
 * to the stepper's range so a value from a peer on another build still reads.
 */
export function parseTravelLeadByCalendar(raw: unknown): TravelLeadByCalendar {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: TravelLeadByCalendar = {};
  for (const [calendarId, minutes] of Object.entries(value as Record<string, unknown>)) {
    if (!calendarId || typeof minutes !== 'number' || !Number.isFinite(minutes)) continue;
    out[calendarId] = clampTravelLeadMinutes(minutes);
  }
  return out;
}

/** The leads a sweep reads: the default, and the per-calendar overrides on top. */
export interface TravelLeads {
  defaultMinutes: number;
  byCalendar: Readonly<TravelLeadByCalendar>;
}

/** An event's lead: its calendar's override if it has one, else the default. */
export function travelLeadFor(event: Pick<BusyEvent, 'calendarId'>, leads: TravelLeads): number {
  return leads.byCalendar[event.calendarId] ?? leads.defaultMinutes;
}

/**
 * The words a calendar puts in the location field for a video call, compared
 * whole and case-insensitively. A closed list rather than a pattern: these are
 * the exact strings Outlook, Zoom and Google write there, and anything looser
 * would start deciding which real places are "really" places.
 */
const VIRTUAL_LOCATION_NAMES = new Set([
  'microsoft teams meeting',
  'microsoft teams',
  'teams meeting',
  'zoom',
  'zoom meeting',
  'google meet',
  'facetime',
  'webex',
  'online',
  'virtual',
]);

/**
 * Whether a location is somewhere you could travel to.
 *
 * EventKit hands back an empty string as well as null for "no location". And
 * a lot of events have a location that isn't a place: calendar apps put the
 * video-call link there, or the name of the service. A link (anything with a
 * scheme, or starting `www.`) and the names above are refused, since a "Leave
 * for…" row in front of a Zoom call is the one mistake this feature would make
 * every day. This is noticing what the field holds, not inferring anything
 * about the event: a typed address next to a link still counts, because the
 * check is on the whole field.
 */
export function eventHasLocation(event: Pick<BusyEvent, 'location'>): boolean {
  const location = (event.location ?? '').trim();
  if (!location) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\/\S*$/i.test(location) || /^www\.\S*$/i.test(location)) return false;
  return !VIRTUAL_LOCATION_NAMES.has(location.toLowerCase());
}

/**
 * The events a travel task may be written for at all: `eventTasks.ts`'s gate
 * (not cancelled, not already started), plus a location, plus a time.
 *
 * **All-day events are refused**, which is the one place this departs from
 * `eventIsRuleEligible`. That gate keeps them because "Pack a bag" two days
 * before a conference is a good rule; "leave 30 minutes before" an event with
 * no start time has nothing to subtract from.
 */
export function eventIsTravelEligible(event: BusyEvent, now: Date): boolean {
  return !event.allDay && eventHasLocation(event) && eventIsRuleEligible(event, now);
}

/** The moment to leave: the event's start, less the lead. Null for a start that doesn't parse. */
export function travelLeaveAt(event: Pick<BusyEvent, 'start'>, leadMinutes: number): Date | null {
  const start = Date.parse(event.start);
  if (!Number.isFinite(start)) return null;
  return new Date(start - leadMinutes * 60 * 1000);
}

/**
 * The source id is the occurrence key alone, with no rule id after it,
 * because there is one rule. A recurring event's every instance shares an
 * EventKit id, so the start is what tells Tuesday's standup from Wednesday's.
 */
export function travelSourceId(event: Pick<BusyEvent, 'id' | 'start'>): string {
  return eventOccurrenceKey(event);
}

/** The occurrence key a travel task was written for, or null for any other task. */
export function travelSourceOf(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  return generatedSourceOf(task, 'travel');
}

/** One event within the horizon that a travel task is, or could be, written for. */
export interface TravelMatch {
  sourceId: string;
  event: BusyEvent;
  /** ISO. Becomes the task's `reminderTime`. */
  leaveAt: string;
  /** The estimate the lead came from, or null when it is the typed lead. */
  estimate: TravelEstimate | null;
  /** ISO, the occurrence's end, which is when its handled entry expires. */
  endsAt: string;
  /**
   * Whether a task was already written for this occurrence. A handled match
   * may update a task that is still live (its title note, its reminder) and
   * must never create one: the task being gone means the user deleted it or
   * finished it, and the handled entry is what keeps that answer.
   */
  handled: boolean;
}

/**
 * Every occurrence within the horizon a travel task belongs to.
 *
 * Pure and `now`-injected, like `matchedEventTasks`, and it departs from that
 * function in one way: handled occurrences are returned (flagged) rather than
 * skipped. An event task's title never changes after it is written, so its
 * sweep has nothing to say about a row that already exists; a travel task's
 * note follows the MTA feed and its reminder follows the lead, so the sweep
 * has to reach the rows it already wrote.
 *
 * `horizonEnd` bounds how far ahead a task is written: the caller passes the
 * end of the logical tomorrow, so a 9am meeting's reminder can be queued from
 * the evening before (the row itself is dated to the event's day, and stays
 * out of Today until then). Ordered by start so a sweep is deterministic.
 */
export function matchedTravelTasks(
  leads: TravelLeads,
  events: readonly BusyEvent[],
  now: Date,
  horizonEnd: Date,
  handled: Readonly<HandledEventTasks>,
  /** Apple Maps estimates, passed only while `travelEstimates` is on. */
  estimated?: { estimates: TravelEstimates; mode: TravelMode; originKeyFor: (eventId: string) => string },
  /** Per-event mode and arrival overrides. */
  prefs: TravelEventPrefs = {},
): TravelMatch[] {
  const out: TravelMatch[] = [];
  const eligible = events
    .filter(event => eventIsTravelEligible(event, now) && Date.parse(event.start) < horizonEnd.getTime())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const event of eligible) {
    const sourceId = travelSourceId(event);
    const estimate = estimated
      ? estimateFor(event, estimated.estimates, travelModeFor(event.id, prefs, estimated.mode), estimated.originKeyFor(event.id))
      : null;
    const lead = estimate ? estimatedLeadMinutes(estimate.minutes) : travelLeadFor(event, leads);
    const leaveAt = travelLeaveAt(event, leadWithArrival(lead, arriveEarlyFor(event.id, prefs)));
    if (!leaveAt) continue;
    out.push({
      sourceId,
      event,
      leaveAt: leaveAt.toISOString(),
      estimate,
      endsAt: event.end,
      handled: sourceId in handled,
    });
  }
  return out;
}

/**
 * The event start a travel source id was written for, in epoch ms, or null
 * for one that doesn't parse. The occurrence key ends in the start, so this
 * needs no calendar read: split on the last `|`, since the EventKit id before
 * it is a shape this app doesn't choose.
 */
export function travelSourceStart(sourceId: string): number | null {
  const i = sourceId.lastIndexOf('|');
  if (i < 0) return null;
  const start = Date.parse(sourceId.slice(i + 1));
  return Number.isFinite(start) ? start : null;
}

/** The EventKit event id a travel source id was written for: everything before the last `|`. */
export function travelSourceEventId(sourceId: string): string | null {
  const i = sourceId.lastIndexOf('|');
  return i > 0 ? sourceId.slice(0, i) : null;
}

/**
 * Whether a live travel task should be cleared, given the calendar window.
 *
 * **Only while its event is still ahead.** Before the start, an occurrence
 * missing from the eligible set means the event was cancelled, deleted, moved
 * (a new start is a new key) or lost its location, and each of those is the
 * creation predicate turning false, which is how `staleMealShortfallTasks`
 * judges its own rows. After the start the occurrence leaves the set because
 * it is happening, which is no reason to delete anything: `checkEventTasks`
 * refuses the same reading for the same reason. A row whose moment has passed
 * is left to expiry instead, through the `windowEnd` the task carries, which
 * the user's own "remove expired tasks" setting governs.
 *
 * The horizon is deliberately not part of this: a task already written stays
 * put even if a change to the day reset moves which day "tomorrow" is.
 */
export function isTravelTaskStale(
  sourceId: string,
  events: readonly BusyEvent[],
  now: Date,
): boolean {
  const start = travelSourceStart(sourceId);
  if (start === null) return true;
  if (start <= now.getTime()) return false;
  return !events.some(event => eventIsTravelEligible(event, now) && travelSourceId(event) === sourceId);
}

/**
 * The task's title: "Leave for <event>", with the notes in brackets when there
 * are any: the travel estimate first, then the MTA note. The event's own words follow the verb unaltered apart from
 * length, and the note is the app's footnote to them, the order
 * `weatherTaskTitle` puts the user's words and the forecast in.
 */
export function travelTaskTitle(eventTitle: string, note: string | null, estimateNote: string | null = null): string {
  const trimmed = eventTitle.trim().replace(/\s+/g, ' ');
  const name = trimmed.length > TRAVEL_EVENT_TITLE_MAX_LENGTH
    ? `${trimmed.slice(0, TRAVEL_EVENT_TITLE_MAX_LENGTH - 1).trimEnd()}…`
    : trimmed;
  const base = name ? `Leave for ${name}` : 'Leave for your next event';
  const notes = [estimateNote, note].filter((n): n is string => !!n);
  return notes.length > 0 ? `${base} (${notes.join(', ')})` : base;
}

/**
 * The line a "Leave for X" row shows under its title: the held Apple Maps
 * estimate ("25 min by transit"), or null when there is none, or the one held
 * was for another place or mode. The row has no calendar event, so the match
 * is on what the task kept: its source id and its copied location.
 */
export function travelRowNote(
  sourceId: string,
  location: string,
  estimates: TravelEstimates,
  mode: TravelMode,
): string | null {
  const held = estimates[sourceId];
  if (!held || held.mode !== mode || held.location !== location.trim()) return null;
  return describeTravelEstimate(held.minutes, held.mode);
}
