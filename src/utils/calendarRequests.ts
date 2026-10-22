import type { CalendarRequest, CalendarRequestChanges } from '../types';
import type { EventSaveFields } from './calendarSync';

/**
 * The rules for an agent's calendar requests (`CalendarRequest`), kept apart
 * from the EventKit calls in `calendarRequestDrain.ts` so they can be tested.
 *
 * The MCP server cannot reach a calendar, so a request is a synced row that
 * waits for the one device chosen to write them. "One device" is the rule that
 * matters: an iCloud calendar shows the same event on every device signed in to
 * it, so two devices each writing the same request would put it there twice.
 * `calendarRequestDeviceId` is a synced setting naming that device, which makes
 * choosing a new one switch the old one off rather than relying on someone to.
 */

/** How long a request that has been answered stays readable to the requester. */
export const CALENDAR_REQUEST_RETENTION_DAYS = 30;

/** What a request that was already over by the time it arrived says. */
export const CALENDAR_REQUEST_PAST_REASON = 'It was already over when it reached the phone.';

/** What a suggestion nobody answered in time says. */
export const CALENDAR_SUGGESTION_STALE_REASON = 'It was not answered in time.';

/** What a request the calendar refused says. */
export const CALENDAR_REQUEST_REFUSED_REASON = 'The calendar did not accept it.';

/** Whether this device is the one that writes requests. Nobody set means nobody does. */
export function isCalendarRequestWriter(writerId: string | null | undefined, selfId: string): boolean {
  return !!writerId && writerId === selfId;
}

export interface CalendarRequestDrainPlan {
  /** Pending and still ahead: write these. */
  write: CalendarRequest[];
  /** Pending changes to, or deletes of, an event an earlier request wrote. */
  change: CalendarRequest[];
  /** Pending but already over: fail these rather than writing an event into the past. */
  expire: CalendarRequest[];
  /** Answered long enough ago that nobody is waiting on the outcome. */
  purge: string[];
}

/**
 * What one pass over the table does. A request is written only while its end
 * is still ahead: a phone that didn't sync for a week shouldn't fill last
 * week with events nobody can attend, and saying so on the row is what lets
 * the requester tell that apart from a request still waiting.
 */
export function planCalendarRequestDrain(requests: readonly CalendarRequest[], now: Date): CalendarRequestDrainPlan {
  const plan: CalendarRequestDrainPlan = { write: [], change: [], expire: [], purge: [] };
  const purgeBefore = now.getTime() - CALENDAR_REQUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pushIfOld = (r: CalendarRequest) => {
    const resolved = new Date(r.resolvedAt ?? r.createdAt).getTime();
    if (!Number.isNaN(resolved) && resolved < purgeBefore) plan.purge.push(r.id);
  };
  for (const r of requests) {
    // A task kind is applied by the device the person taps on (see
    // `agentSuggestions.ts`), never by this pass, so it is neither written nor
    // changed here even if one were pending.
    if ((r.kind ?? 'event') !== 'event') {
      if (r.status === 'proposed' && suggestionIsStale(r, now)) plan.expire.push(r);
      else if (r.status !== 'pending' && r.status !== 'proposed') pushIfOld(r);
      continue;
    }
    // Before the expiry check: an update or delete carries an epoch start and
    // end on purpose (see CalendarRequest.action), so an older build expires it
    // rather than creating an event from it.
    if (r.status === 'pending' && (r.action === 'update' || r.action === 'delete')) {
      plan.change.push(r);
      continue;
    }
    // Waiting for a tap: left alone, unless the moment it was for has gone.
    if (r.status === 'proposed') {
      if (suggestionIsStale(r, now)) plan.expire.push(r);
      continue;
    }
    if (r.status === 'pending') {
      const end = new Date(r.endAt).getTime();
      if (Number.isNaN(end) || end <= now.getTime()) plan.expire.push(r);
      else plan.write.push(r);
      continue;
    }
    pushIfOld(r);
  }
  return plan;
}

/**
 * Whether a proposal waiting for a tap is for a moment that has gone: an event
 * that is already over, an alarm time in the past, or one left unanswered for
 * a month. A change to an event
 * carries epoch times on purpose and is never stale by them.
 */
export function suggestionIsStale(r: CalendarRequest, now: Date): boolean {
  // Nobody answered it for as long as an answered request is kept.
  const created = new Date(r.createdAt).getTime();
  if (!Number.isNaN(created) && created < now.getTime() - CALENDAR_REQUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000) return true;
  if (r.kind === 'task_alarm') {
    const at = r.payload?.alarmAt ? new Date(r.payload.alarmAt).getTime() : NaN;
    return Number.isNaN(at) || at <= now.getTime();
  }
  if (r.kind === 'task_deadline') return false;
  if (r.action === 'update' || r.action === 'delete') return false;
  const end = new Date(r.endAt).getTime();
  return Number.isNaN(end) || end <= now.getTime();
}

/** The fields `saveEventDirect` writes for a request. Busy, with no alert: only what was asked for. */
export function eventFieldsForRequest(r: CalendarRequest, calendarId: string | null): EventSaveFields {
  return {
    title: r.title,
    start: new Date(r.startAt),
    end: new Date(r.endAt),
    allDay: r.allDay,
    ...(r.location ? { location: r.location } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
    calendarId,
  };
}

/** What a change request says when the event it is about can't be acted on. */
export const CALENDAR_CHANGE_NO_EVENT_REASON = 'The event it changes was never written, or can no longer be found.';

/**
 * Why a change request can't run, or null when it can: the request it targets
 * has to have written its event and still know the event's server id. The
 * event itself is looked up separately, on the device.
 */
export function changeRequestProblem(change: CalendarRequest, target: CalendarRequest | null): string | null {
  if (!target || (target.action ?? 'create') !== 'create') return CALENDAR_CHANGE_NO_EVENT_REASON;
  if (target.status !== 'written' || !target.eventExternalId) return CALENDAR_CHANGE_NO_EVENT_REASON;
  return change.action === 'update' && !change.changes ? 'It named nothing to change.' : null;
}

/** The fields an update writes: the target request's own, with the change laid over them. */
export function eventFieldsForChange(target: CalendarRequest, changes: CalendarRequestChanges, calendarId: string | null): EventSaveFields {
  return eventFieldsForRequest({
    ...target,
    ...(changes.title !== undefined ? { title: changes.title } : {}),
    ...(changes.startAt !== undefined ? { startAt: changes.startAt } : {}),
    ...(changes.endAt !== undefined ? { endAt: changes.endAt } : {}),
    ...(changes.allDay !== undefined ? { allDay: changes.allDay } : {}),
    ...(changes.location !== undefined ? { location: changes.location } : {}),
    ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
  }, calendarId);
}
