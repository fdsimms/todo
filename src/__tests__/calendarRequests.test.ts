import {
  CALENDAR_REQUEST_RETENTION_DAYS,
  eventFieldsForRequest,
  isCalendarRequestWriter,
  planCalendarRequestDrain,
} from '../utils/calendarRequests';
import type { CalendarRequest } from '../types';

const NOW = new Date(2026, 9, 5, 12);

function request(over: Partial<CalendarRequest> = {}): CalendarRequest {
  return {
    id: 'r1',
    title: 'Dentist',
    startAt: new Date(2026, 9, 8, 15).toISOString(),
    endAt: new Date(2026, 9, 8, 16).toISOString(),
    allDay: false,
    location: null,
    notes: null,
    status: 'pending',
    failureReason: null,
    eventExternalId: null,
    resolvedAt: null,
    createdAt: new Date(2026, 9, 5, 9).toISOString(),
    ...over,
  };
}

describe('isCalendarRequestWriter', () => {
  it('is this device only when the synced writer names it', () => {
    expect(isCalendarRequestWriter('me', 'me')).toBe(true);
    expect(isCalendarRequestWriter('other', 'me')).toBe(false);
  });

  it('is nobody when nobody is set', () => {
    expect(isCalendarRequestWriter(null, 'me')).toBe(false);
    expect(isCalendarRequestWriter('', '')).toBe(false);
  });
});

describe('planCalendarRequestDrain', () => {
  it('writes a pending request that is still ahead', () => {
    const plan = planCalendarRequestDrain([request()], NOW);
    expect(plan.write.map(r => r.id)).toEqual(['r1']);
    expect(plan.expire).toEqual([]);
  });

  it('writes one that has started but not ended', () => {
    const r = request({ startAt: new Date(2026, 9, 5, 11).toISOString(), endAt: new Date(2026, 9, 5, 13).toISOString() });
    expect(planCalendarRequestDrain([r], NOW).write).toHaveLength(1);
  });

  it('expires a pending request that is already over instead of writing it into the past', () => {
    const r = request({ endAt: new Date(2026, 9, 5, 12).toISOString() });
    const plan = planCalendarRequestDrain([r], NOW);
    expect(plan.write).toEqual([]);
    expect(plan.expire.map(x => x.id)).toEqual(['r1']);
  });

  it('expires a request whose end cannot be read', () => {
    expect(planCalendarRequestDrain([request({ endAt: 'nonsense' })], NOW).expire).toHaveLength(1);
  });

  it('leaves answered requests alone until the retention window passes', () => {
    const day = 24 * 60 * 60 * 1000;
    const recent = request({ id: 'recent', status: 'written', resolvedAt: new Date(NOW.getTime() - day).toISOString() });
    const old = request({
      id: 'old',
      status: 'failed',
      resolvedAt: new Date(NOW.getTime() - (CALENDAR_REQUEST_RETENTION_DAYS + 1) * day).toISOString(),
    });
    const plan = planCalendarRequestDrain([recent, old], NOW);
    expect(plan.write).toEqual([]);
    expect(plan.expire).toEqual([]);
    expect(plan.purge).toEqual(['old']);
  });

  it('never purges a pending request, however old', () => {
    const r = request({ createdAt: new Date(2025, 0, 1).toISOString(), endAt: new Date(2027, 0, 1).toISOString() });
    expect(planCalendarRequestDrain([r], NOW).purge).toEqual([]);
  });
});

describe('eventFieldsForRequest', () => {
  it('writes exactly what was asked, into the chosen calendar', () => {
    const fields = eventFieldsForRequest(request({ location: 'Main St', notes: 'Bring forms', allDay: false }), 'cal-1');
    expect(fields).toEqual({
      title: 'Dentist',
      start: new Date(2026, 9, 8, 15),
      end: new Date(2026, 9, 8, 16),
      allDay: false,
      location: 'Main St',
      notes: 'Bring forms',
      calendarId: 'cal-1',
    });
  });

  it('leaves out an empty location and notes', () => {
    const fields = eventFieldsForRequest(request(), null);
    expect(fields).not.toHaveProperty('location');
    expect(fields).not.toHaveProperty('notes');
    expect(fields.calendarId).toBeNull();
  });
});
