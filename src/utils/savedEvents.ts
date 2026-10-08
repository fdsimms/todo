import { dbGetSetting, dbSetSetting } from '../db/database';
import { eventMemoryKey, type RememberedEvent } from './eventMemory';
import type { EventAvailability } from './quickEventDefaults';

/**
 * Events the person keeps for re-adding ("Optometrist", "Haircut"): listed
 * when the quick event card opens empty, so a regular is a tap and then a day.
 * Tapping one fills in what it holds the way a remembered title does
 * (`eventMemory.ts`), and a saved event outranks that memory, since it is the
 * one the person chose and can edit.
 *
 * **One JSON setting, and it syncs** (`SYNCED_SETTING_KEYS`), unlike the
 * device-local memory beside it. So it holds no calendar id: the calendar is
 * kept by name and matched against this device's calendars when used, and
 * one that doesn't match falls back to the usual choice.
 *
 * Using a saved event refreshes it with what that event was saved with, the
 * same as the memory, and records its start (`lastStart`), which is what the
 * booking reminder (`bookEveryMonths`, `savedEventTasks.ts`) counts from.
 */
export const SAVED_EVENTS_KEY = 'savedEvents';
/** The ceiling on the booking reminder's interval, for the stepper. */
export const BOOK_EVERY_MONTHS_MAX = 36;

export interface SavedEvent {
  /** As typed; matched loosely (`eventMemoryKey`). */
  title: string;
  location: string | null;
  place: { latitude: number; longitude: number } | null;
  /** Null for an all-day event. */
  durationMinutes: number | null;
  alertMinutes: number | null;
  availability: EventAvailability;
  /** The calendar's name, since ids differ between devices. */
  calendarTitle: string | null;
  /** ISO start of the last event added from it, or null if never recorded. */
  lastStart: string | null;
  /** "Book <title>" once this many months have passed since `lastStart`; null is off. */
  bookEveryMonths: number | null;
  /**
   * The `lastStart` whose booking task the person deleted: that cycle asks no
   * more, and the next event added from it starts a new one. See
   * `savedEventTasks.ts`.
   */
  bookDeclinedFor: string | null;
  /** Epoch ms of the last save or use, for ordering. */
  at: number;
}

export type SavedEventFields = Omit<SavedEvent, 'title' | 'lastStart' | 'bookEveryMonths' | 'bookDeclinedFor' | 'at'>;

function readEntry(raw: unknown): SavedEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  const title = str(v.title);
  const at = num(v.at);
  if (!title || at === null) return null;
  const place = v.place && typeof v.place === 'object' ? v.place as Record<string, unknown> : null;
  const lat = place ? num(place.latitude) : null;
  const lon = place ? num(place.longitude) : null;
  const duration = num(v.durationMinutes);
  const alert = num(v.alertMinutes);
  const every = num(v.bookEveryMonths);
  const lastStart = str(v.lastStart);
  return {
    title,
    location: str(v.location),
    place: lat !== null && lon !== null ? { latitude: lat, longitude: lon } : null,
    durationMinutes: duration !== null && duration >= 1 && duration <= 24 * 60 ? Math.round(duration) : null,
    alertMinutes: alert !== null && alert >= 0 ? alert : null,
    availability: v.availability === 'free' ? 'free' : 'busy',
    calendarTitle: str(v.calendarTitle),
    lastStart: lastStart && !Number.isNaN(new Date(lastStart).getTime()) ? lastStart : null,
    bookEveryMonths: every !== null && every >= 1 && every <= BOOK_EVERY_MONTHS_MAX ? Math.round(every) : null,
    bookDeclinedFor: str(v.bookDeclinedFor),
    at,
  };
}

/** Tolerant of a missing or malformed stored value: entries that don't read are dropped, and so are repeats of a title. */
export function parseSavedEvents(raw: string | null | undefined): SavedEvent[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: SavedEvent[] = [];
    for (const item of value) {
      const read = readEntry(item);
      const key = read ? eventMemoryKey(read.title) : '';
      if (!read || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(read);
    }
    return out;
  } catch {
    return [];
  }
}

export function readSavedEvents(): SavedEvent[] {
  return parseSavedEvents(dbGetSetting(SAVED_EVENTS_KEY));
}

export function writeSavedEvents(list: readonly SavedEvent[]): void {
  dbSetSetting(SAVED_EVENTS_KEY, JSON.stringify(list));
}

/** The saved event with this title, or null. */
export function findSavedEvent(list: readonly SavedEvent[], title: string): SavedEvent | null {
  const key = eventMemoryKey(title);
  return key ? list.find(e => eventMemoryKey(e.title) === key) ?? null : null;
}

/** Most recently used first. */
export function sortedSavedEvents(list: readonly SavedEvent[]): SavedEvent[] {
  return [...list].sort((a, b) => b.at - a.at);
}

/**
 * The list with this event saved, as a new entry or over the one already
 * saved under its title (keeping that one's booking interval).
 */
export function saveEventAs(
  list: readonly SavedEvent[],
  title: string,
  fields: SavedEventFields,
  start: Date | null,
  now: number,
): SavedEvent[] {
  const key = eventMemoryKey(title);
  if (!key) return [...list];
  const existing = findSavedEvent(list, title);
  const entry: SavedEvent = {
    ...fields,
    title: title.trim(),
    lastStart: start ? start.toISOString() : existing?.lastStart ?? null,
    bookEveryMonths: existing?.bookEveryMonths ?? null,
    bookDeclinedFor: existing?.bookDeclinedFor ?? null,
    at: now,
  };
  return [...list.filter(e => eventMemoryKey(e.title) !== key), entry];
}

/**
 * After an event is added: refreshes the saved one with its title, if there
 * is one, and leaves the list untouched otherwise. Returns the same array when
 * nothing changed, so a caller can skip the write.
 */
export function recordSavedEventUse(
  list: readonly SavedEvent[],
  title: string,
  fields: SavedEventFields,
  start: Date,
  now: number,
): readonly SavedEvent[] {
  return findSavedEvent(list, title) ? saveEventAs(list, title, fields, start, now) : list;
}

export function removeSavedEvent(list: readonly SavedEvent[], title: string): SavedEvent[] {
  const key = eventMemoryKey(title);
  return list.filter(e => eventMemoryKey(e.title) !== key);
}

export function updateSavedEvent(
  list: readonly SavedEvent[],
  title: string,
  patch: Partial<Pick<SavedEvent, 'bookEveryMonths' | 'bookDeclinedFor'>>,
): SavedEvent[] {
  const key = eventMemoryKey(title);
  return list.map(e => (eventMemoryKey(e.title) === key ? { ...e, ...patch } : e));
}

/**
 * The saved event as what the card fills in from, the shape the memory
 * already uses. The calendar is matched by name on this device; with no match
 * the memory's calendar for the title (`fallbackCalendarId`) is used, and
 * then nothing, which leaves the card's usual calendar.
 */
export function savedEventRecall(
  event: SavedEvent,
  calendars: readonly { id: string; title: string }[],
  fallbackCalendarId: string | null,
): RememberedEvent {
  const byName = event.calendarTitle ? calendars.find(c => c.title === event.calendarTitle) : undefined;
  return {
    location: event.location,
    place: event.place,
    durationMinutes: event.durationMinutes,
    calendarId: byName?.id ?? fallbackCalendarId,
    alertMinutes: event.alertMinutes,
    availability: event.availability,
    at: event.at,
  };
}

export type SavedEventInput = Pick<SavedEvent, 'title' | 'location' | 'place' | 'durationMinutes' | 'alertMinutes'>;

/**
 * Creates a saved event, or rewrites the one saved under `originalTitle`, from
 * Settings. Returns null for an empty title, or a title another saved event
 * already has (a loose match, `eventMemoryKey`), so the caller can say why.
 *
 * An edit keeps what the form doesn't show: the booking interval, the cycle
 * the person declined, the last start, the calendar and availability. A new
 * one starts with none of them. Its `at` is refreshed, which is what orders the
 * list.
 */
export function editSavedEvent(
  list: readonly SavedEvent[],
  originalTitle: string | null,
  input: SavedEventInput,
  now: number,
): SavedEvent[] | null {
  const title = input.title.trim();
  const key = eventMemoryKey(title);
  if (!key) return null;
  const originalKey = originalTitle === null ? null : eventMemoryKey(originalTitle);
  if (list.some(e => eventMemoryKey(e.title) === key && key !== originalKey)) return null;
  const existing = originalKey === null ? undefined : list.find(e => eventMemoryKey(e.title) === originalKey);
  const entry: SavedEvent = {
    title,
    location: input.location?.trim() || null,
    place: input.place,
    durationMinutes: input.durationMinutes,
    alertMinutes: input.alertMinutes,
    availability: existing?.availability ?? 'busy',
    calendarTitle: existing?.calendarTitle ?? null,
    lastStart: existing?.lastStart ?? null,
    bookEveryMonths: existing?.bookEveryMonths ?? null,
    bookDeclinedFor: existing?.bookDeclinedFor ?? null,
    at: now,
  };
  return [...list.filter(e => eventMemoryKey(e.title) !== originalKey), entry];
}

/** "1 hr · Eastside Eye Care", or "All day" for an all-day one. */
export function describeSavedEvent(event: Pick<SavedEvent, 'durationMinutes' | 'location'>): string {
  const m = event.durationMinutes;
  const length = m === null ? 'All day'
    : m < 60 ? `${m} min`
    : m % 60 === 0 ? `${m / 60} hr`
    : `${Math.floor(m / 60)} hr ${m % 60} min`;
  return event.location ? `${length} · ${event.location}` : length;
}

/** Fewer typed characters than this suggest nothing: "o" matches half the list. */
export const SAVED_EVENT_SUGGEST_MIN_LENGTH = 2;
export const SAVED_EVENT_SUGGEST_LIMIT = 3;

/**
 * Saved events whose title starts with what has been typed, or has a word
 * that does ("eye" finds "Annual eye exam"). An exact match is left out:
 * it is already what the line says.
 */
export function suggestSavedEvents(list: readonly SavedEvent[], typed: string): SavedEvent[] {
  const q = eventMemoryKey(typed);
  if (q.length < SAVED_EVENT_SUGGEST_MIN_LENGTH) return [];
  const starts: SavedEvent[] = [];
  const words: SavedEvent[] = [];
  for (const e of sortedSavedEvents(list)) {
    const key = eventMemoryKey(e.title);
    if (key === q) continue;
    if (key.startsWith(q)) starts.push(e);
    else if (key.split(' ').some(w => w.startsWith(q))) words.push(e);
  }
  return [...starts, ...words].slice(0, SAVED_EVENT_SUGGEST_LIMIT);
}
