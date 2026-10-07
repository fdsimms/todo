import type { CalendarRequest } from '../../src/types';
import type { CalendarRequestInput, Replica } from './replica';

/**
 * Asking the phone to put an event on the calendar. This server cannot reach a
 * calendar, so `request_calendar_event` writes a synced request and the one
 * device chosen in Settings writes the event when the request arrives
 * (`src/utils/calendarRequestDrain.ts`), then stamps the outcome back onto the
 * row. `list_calendar_requests` is how the outcome is read here. See
 * docs/arch/mcp-server.md.
 *
 * Times are read in the person's own zone: the process adopts the phone's zone
 * after every sync (timeZone.ts), so a bare `2026-10-06T14:00` is 2 PM where
 * they are, and a value with an offset is taken as given.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TITLE = 200;
/** Longer than any appointment, short enough to catch an end typed in the wrong month. */
const MAX_TIMED_SPAN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ALL_DAY_DAYS = 31;

export interface CalendarRequestToolInput {
  title: string;
  start: string;
  end?: string;
  location?: string | null;
  notes?: string | null;
}

/** Local midnight of a `YYYY-MM-DD`, or null if it isn't a real day. */
function localDay(value: string): Date | null {
  const m = DAY.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

function addLocalDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The tool's input as the row it becomes. A bare date makes an all-day event
 * (with `end` as the last day, inclusive); a date and time makes a timed one
 * (with `end` defaulting to an hour later). Refuses anything already over,
 * since the phone would only refuse it later with less to say.
 */
export function parseCalendarRequest(input: CalendarRequestToolInput, now = new Date()): CalendarRequestInput {
  const title = input.title.trim();
  if (!title) throw new Error('An event needs a title.');
  if (title.length > MAX_TITLE) throw new Error(`Keep the title under ${MAX_TITLE} characters.`);

  const firstDay = localDay(input.start);
  if (!firstDay && DAY.test(input.start)) throw new Error(`"${input.start}" is not a date.`);
  let start: Date;
  let end: Date;
  if (firstDay) {
    const lastDay = input.end === undefined ? firstDay : localDay(input.end);
    if (!lastDay) throw new Error('For an all-day event, give end as the last day, YYYY-MM-DD.');
    if (lastDay < firstDay) throw new Error('The last day is before the first.');
    start = firstDay;
    end = addLocalDays(lastDay, 1);
    if ((end.getTime() - start.getTime()) / 86400000 > MAX_ALL_DAY_DAYS + 1) {
      throw new Error(`An all-day event can run at most ${MAX_ALL_DAY_DAYS} days.`);
    }
  } else {
    start = new Date(input.start);
    if (Number.isNaN(start.getTime())) {
      throw new Error(`"${input.start}" is not a date or time. Use YYYY-MM-DD for an all-day event, or YYYY-MM-DDTHH:MM.`);
    }
    if (input.end !== undefined && DAY.test(input.end)) {
      throw new Error('A timed event ends at a time: give end as YYYY-MM-DDTHH:MM.');
    }
    end = input.end === undefined ? new Date(start.getTime() + 60 * 60 * 1000) : new Date(input.end);
    if (Number.isNaN(end.getTime())) throw new Error(`"${input.end}" is not a time. Use YYYY-MM-DDTHH:MM.`);
    if (end <= start) throw new Error('The event has to end after it starts.');
    if (end.getTime() - start.getTime() > MAX_TIMED_SPAN_MS) {
      throw new Error('That event runs over a week. Check the end, or make it an all-day event.');
    }
  }
  if (end <= now) throw new Error('That event is already over.');

  return {
    title,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: !!firstDay,
    location: blankToNull(input.location),
    notes: blankToNull(input.notes),
  };
}

export interface SerializedCalendarRequest {
  id: string;
  title: string;
  /** YYYY-MM-DD for an all-day event, else an ISO instant. */
  start: string;
  /** For an all-day event, the last day (inclusive). */
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  status: CalendarRequest['status'];
  failureReason?: string;
  requestedAt: string;
  resolvedAt?: string;
  /** Present on a change: what it does to the event the request named in `changes` wrote. */
  change?: 'update' | 'delete';
  /** The request whose event this changes. */
  changes?: string;
}

export function serializeCalendarRequest(r: CalendarRequest): SerializedCalendarRequest {
  if (r.action === 'update' || r.action === 'delete') {
    const c = r.changes ?? {};
    return {
      id: r.id,
      title: r.title,
      start: c.startAt ?? '',
      end: c.endAt ?? '',
      allDay: c.allDay ?? r.allDay,
      ...(c.location ? { location: c.location } : {}),
      ...(c.notes ? { notes: c.notes } : {}),
      status: r.status,
      ...(r.failureReason ? { failureReason: r.failureReason } : {}),
      requestedAt: r.createdAt,
      ...(r.resolvedAt ? { resolvedAt: r.resolvedAt } : {}),
      change: r.action,
      ...(r.targetRequestId ? { changes: r.targetRequestId } : {}),
    };
  }
  const start = new Date(r.startAt);
  const end = new Date(r.endAt);
  return {
    id: r.id,
    title: r.title,
    start: r.allDay ? dayKey(start) : r.startAt,
    end: r.allDay ? dayKey(addLocalDays(end, -1)) : r.endAt,
    allDay: r.allDay,
    ...(r.location ? { location: r.location } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
    status: r.status,
    ...(r.failureReason ? { failureReason: r.failureReason } : {}),
    requestedAt: r.createdAt,
    ...(r.resolvedAt ? { resolvedAt: r.resolvedAt } : {}),
  };
}

const PENDING_NOTE =
  'Queued, not on the calendar yet. The phone set to add these writes it the next time it syncs (when the app is opened, or in the background). Check list_calendar_requests for the outcome rather than saying it was added.';

export function requestCalendarEvent(replica: Replica, input: CalendarRequestToolInput) {
  const request = replica.requestCalendarEvent(parseCalendarRequest(input));
  return { request: serializeCalendarRequest(request), note: PENDING_NOTE };
}

export function listCalendarRequests(replica: Replica, input: { status?: CalendarRequest['status'] }) {
  const requests = replica.calendarRequests()
    .filter(r => !input.status || r.status === input.status)
    .reverse()
    .map(serializeCalendarRequest);
  return {
    deviceSetToAddThem: replica.settings().calendarRequestsOn,
    requests,
    ...(requests.length === 0 ? { note: 'Answered requests are kept for 30 days.' } : {}),
  };
}

export function cancelCalendarRequest(replica: Replica, input: { id: string }) {
  return { cancelled: serializeCalendarRequest(replica.cancelCalendarRequest(input.id)) };
}

export interface CalendarChangeInput {
  /** The request that added the event (list_calendar_requests). */
  requestId: string;
  delete?: boolean;
  title?: string;
  start?: string;
  end?: string;
  location?: string | null;
  notes?: string | null;
}

/**
 * Ask the phone to change or remove an event an earlier request added. New
 * times are checked the way a new request's are, against the event as it was
 * asked for, so a moved start keeps the length the event had.
 */
export function changeCalendarEvent(replica: Replica, input: CalendarChangeInput) {
  const target = replica.calendarRequests().find(r => r.id === input.requestId);
  if (!target) throw new Error(`No calendar request with id ${input.requestId}. list_calendar_requests lists them.`);
  const { requestId, delete: del, ...fields } = input;
  if (del) {
    if (Object.keys(fields).length > 0) throw new Error('A delete takes nothing else.');
    return { request: serializeCalendarRequest(replica.requestCalendarChange(requestId, { delete: true })), note: PENDING_NOTE };
  }
  if (Object.keys(fields).length === 0) throw new Error('Nothing to change: give title, start, end, location or notes, or delete: true.');
  const was = serializeCalendarRequest(target);
  let startAt: string | undefined;
  let endAt: string | undefined;
  let allDay: boolean | undefined;
  if (fields.start !== undefined || fields.end !== undefined) {
    // A new start with no end keeps the event's length.
    const length = new Date(target.endAt).getTime() - new Date(target.startAt).getTime();
    const start = fields.start ?? was.start;
    const end = fields.end ?? (fields.start !== undefined && !DAY.test(start) ? new Date(new Date(start).getTime() + length).toISOString() : fields.start !== undefined ? undefined : was.end);
    const parsed = parseCalendarRequest({ title: fields.title ?? target.title, start, ...(end !== undefined ? { end } : {}) });
    startAt = parsed.startAt;
    endAt = parsed.endAt;
    allDay = parsed.allDay;
  }
  const title = fields.title?.trim();
  if (fields.title !== undefined && !title) throw new Error('An event needs a title.');
  const changes = {
    ...(title ? { title } : {}),
    ...(startAt !== undefined ? { startAt, endAt, allDay } : {}),
    ...(fields.location !== undefined ? { location: blankToNull(fields.location) } : {}),
    ...(fields.notes !== undefined ? { notes: blankToNull(fields.notes) } : {}),
  };
  return { request: serializeCalendarRequest(replica.requestCalendarChange(requestId, { changes })), note: PENDING_NOTE };
}
