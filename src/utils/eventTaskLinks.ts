import { addDays } from 'date-fns/addDays';
import type { BusyEvent } from './calendarBusy';
import { isLiveEvent } from './calendarBusy';
import { eventPeopleKey } from './eventPeople';
import type { TemplateAnchors } from './templateUtils';

/**
 * Which tasks were planned around a calendar event: the ones added from its
 * row, and the ones a template run anchored to its date. The sibling of
 * `eventPeople.ts`, and like it this is the app's own metadata about an event
 * it does not own, kept on the device and keyed by occurrence.
 *
 * **It is a record here rather than a field on `Task`.** `awayShift.ts` and
 * `docs/arch/away-dates.md` refuse per-task provenance (a new column plus the
 * four-site `TemplateItem` parity obligation), and nothing about an event
 * changes that argument. The event already has a record in this app; hanging
 * the task ids off it costs no schema.
 *
 * **It exists for one question: did the event move?** The answer is always an
 * offer (`AwayShiftSheet`, the same "these move with it?" the trip move asks),
 * never a shift, for `awayShift.ts`'s reason: only the person who planned the
 * tasks knows which were tied to the date.
 */
export interface EventTaskLink {
  key: string;
  eventId: string;
  /** ISO, the occurrence's start when the tasks were planned. */
  eventStart: string;
  /** ISO. */
  eventEnd: string;
  title: string;
  taskIds: string[];
}

export type EventTaskLinks = Record<string, EventTaskLink>;

/** Same occurrence key as the people link, so the two records agree. */
export const eventTaskKey = eventPeopleKey;

export function tasksForEvent(
  links: Readonly<EventTaskLinks>,
  event: Pick<BusyEvent, 'id' | 'start'>
): string[] {
  return links[eventTaskKey(event)]?.taskIds ?? [];
}

/** Adds tasks to an occurrence's link, creating it when there is none. */
export function withEventTasks(
  links: Readonly<EventTaskLinks>,
  event: Pick<BusyEvent, 'id' | 'start' | 'end' | 'title'>,
  taskIds: readonly string[]
): EventTaskLinks {
  if (taskIds.length === 0) return { ...links };
  const key = eventTaskKey(event);
  const held = links[key]?.taskIds ?? [];
  return {
    ...links,
    [key]: {
      key,
      eventId: event.id,
      eventStart: event.start,
      eventEnd: event.end,
      title: event.title,
      taskIds: [...new Set([...held, ...taskIds])],
    },
  };
}

/**
 * Moves a link onto the occurrence where the event now sits, once the user has
 * answered the move offer (either way). Afterwards the link describes the event
 * as it is, so the offer is not made again.
 */
export function rekeyEventTasks(
  links: Readonly<EventTaskLinks>,
  oldKey: string,
  event: Pick<BusyEvent, 'id' | 'start' | 'end' | 'title'>
): EventTaskLinks {
  const link = links[oldKey];
  if (!link) return { ...links };
  const next = { ...links };
  delete next[oldKey];
  return withEventTasks(next, event, link.taskIds);
}

/** How long past its end a link is kept. A week covers a follow-up task. */
export const EVENT_TASK_LINK_GRACE_DAYS = 7;

export function pruneStaleEventTaskLinks(
  links: Readonly<EventTaskLinks>,
  now: Date
): EventTaskLinks {
  const floor = addDays(now, -EVENT_TASK_LINK_GRACE_DAYS).getTime();
  const kept: EventTaskLinks = {};
  for (const [key, link] of Object.entries(links)) {
    const end = Date.parse(link.eventEnd);
    if (Number.isFinite(end) && end > floor) kept[key] = link;
  }
  return kept;
}

/** Reads a stored record, tolerating anything malformed. */
export function parseEventTaskLinks(raw: string | null | undefined): EventTaskLinks {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: EventTaskLinks = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const link = value as Partial<EventTaskLink> | null;
      if (
        !link
        || typeof link.eventId !== 'string'
        || typeof link.eventStart !== 'string'
        || typeof link.eventEnd !== 'string'
        || !Array.isArray(link.taskIds)
      ) continue;
      const taskIds = link.taskIds.filter((id): id is string => typeof id === 'string');
      if (taskIds.length === 0) continue;
      out[key] = {
        key,
        eventId: link.eventId,
        eventStart: link.eventStart,
        eventEnd: link.eventEnd,
        title: typeof link.title === 'string' ? link.title : '',
        taskIds,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export interface MovedEvent {
  link: EventTaskLink;
  /** Where the event sits now. */
  event: BusyEvent;
}

/**
 * Linked events that have moved, as far as the calendar window can tell.
 *
 * An event id names the whole event, and a recurring series shares one id
 * across every occurrence, so "moved" is read conservatively:
 *
 * - **The old occurrence is gone.** Nothing in the window carries the old key.
 * - **The old start is inside the window**, so its absence means something. An
 *   occurrence that was already in the past, or past the window's end, would be
 *   missing either way.
 * - **Exactly one live occurrence of that id is in the window.** Two or more is
 *   a series, and which of them the old one became is a guess. Refused.
 *
 * Wrong in the rare case (one occurrence of a series deleted with another
 * still in range), and harmless when it is: the answer is an offer the user
 * can decline.
 */
export function movedLinkedEvents(
  links: Readonly<EventTaskLinks>,
  events: readonly BusyEvent[],
  windowStart: Date,
  windowEnd: Date
): MovedEvent[] {
  const from = windowStart.getTime();
  const to = windowEnd.getTime();
  const liveKeys = new Set<string>();
  const byId = new Map<string, BusyEvent[]>();
  for (const event of events) {
    if (!isLiveEvent(event)) continue;
    liveKeys.add(eventTaskKey(event));
    const list = byId.get(event.id);
    if (list) list.push(event);
    else byId.set(event.id, [event]);
  }

  const out: MovedEvent[] = [];
  for (const link of Object.values(links)) {
    if (liveKeys.has(link.key)) continue;
    const oldStart = Date.parse(link.eventStart);
    if (!Number.isFinite(oldStart) || oldStart < from || oldStart >= to) continue;
    const now = byId.get(link.eventId);
    if (!now || now.length !== 1) continue;
    out.push({ link, event: now[0] });
  }
  return out;
}

/**
 * A template run's two anchors for an event: its first day and its last. An
 * all-day event's end is the midnight after it, so the last day is read a
 * moment before the end rather than at it.
 */
export function anchorsForEvent(event: Pick<BusyEvent, 'start' | 'end'>): TemplateAnchors {
  const start = new Date(event.start);
  const endMs = Date.parse(event.end);
  const last = Number.isFinite(endMs) ? new Date(Math.max(endMs - 1, start.getTime())) : start;
  return { start, end: last };
}
