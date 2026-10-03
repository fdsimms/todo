import type { Project } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import { awayFieldsFromEvent, projectForTripEvent, spansDays, tripSpanOf } from '../utils/tripEvents';
import { dayKeyOf } from '../utils/dateUtils';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const ev = (over: Partial<BusyEvent>): BusyEvent => ({
  id: 'e', title: 'Lisbon', start: '', end: '', allDay: false, calendarId: 'c',
  location: null, status: 'confirmed', availability: 'free', ...over,
});

/** All-day on local dates, stored at UTC midnight as calendars store them. */
const allDay = (from: [number, number], toExclusive: [number, number], over: Partial<BusyEvent> = {}) => ev({
  allDay: true,
  start: new Date(Date.UTC(2026, from[0], from[1])).toISOString(),
  end: new Date(Date.UTC(2026, toExclusive[0], toExclusive[1])).toISOString(),
  ...over,
});

const timed = (start: Date, end: Date) => ev({ start: start.toISOString(), end: end.toISOString() });

describe('spansDays', () => {
  it('takes an all-day event naming two dates or more, Free or not', () => {
    expect(spansDays(allDay([9, 19], [9, 26]))).toBe(true);
    expect(spansDays(allDay([9, 19], [9, 21]))).toBe(true);
    expect(spansDays(allDay([9, 19], [9, 20]))).toBe(false);
  });

  it('takes a timed event a day long or more, but not an overnight flight', () => {
    expect(spansDays(timed(new Date(2026, 9, 19, 8), new Date(2026, 9, 25, 18)))).toBe(true);
    expect(spansDays(timed(new Date(2026, 9, 19, 22), new Date(2026, 9, 20, 6)))).toBe(false);
  });

  it('never takes a cancelled event', () => {
    expect(spansDays(allDay([9, 19], [9, 26], { status: 'canceled' }))).toBe(false);
  });
});

describe('tripSpanOf / awayFieldsFromEvent', () => {
  it('makes the return day the first day an all-day event no longer covers', () => {
    const span = tripSpanOf(allDay([9, 19], [9, 26]))!;
    expect(dayKeyOf(span.start)).toBe('2026-10-19');
    expect(dayKeyOf(span.end)).toBe('2026-10-26');
  });

  it('makes a timed trip end on the day it ends', () => {
    const span = tripSpanOf(timed(new Date(2026, 9, 19, 8), new Date(2026, 9, 25, 18)))!;
    expect(dayKeyOf(span.start)).toBe('2026-10-19');
    expect(dayKeyOf(span.end)).toBe('2026-10-25');
  });

  it('writes both dates at noon, like every other away date', () => {
    const fields = awayFieldsFromEvent(allDay([9, 19], [9, 26]))!;
    expect(new Date(fields.awayStart).getHours()).toBe(12);
    expect(dayKeyOf(new Date(fields.awayStart))).toBe('2026-10-19');
    expect(dayKeyOf(new Date(fields.awayEnd))).toBe('2026-10-26');
  });
});

describe('projectForTripEvent', () => {
  const project = (over: Partial<Project>) => ({
    id: 'p', archived: false, completed: false, awayStart: null, awayEnd: null, ...over,
  } as Pick<Project, 'id' | 'awayStart' | 'awayEnd' | 'archived' | 'completed'>);

  it('finds a live project away for exactly those days', () => {
    const event = allDay([9, 19], [9, 26]);
    const fields = awayFieldsFromEvent(event)!;
    const match = project({ id: 'trip', ...fields });
    expect(projectForTripEvent([project({ id: 'other' }), match], event)?.id).toBe('trip');
  });

  it('ignores a filed project, or one away for different days', () => {
    const event = allDay([9, 19], [9, 26]);
    const fields = awayFieldsFromEvent(event)!;
    expect(projectForTripEvent([project({ archived: true, ...fields })], event)).toBeNull();
    expect(projectForTripEvent([project({ ...fields, awayEnd: awayFieldsFromEvent(allDay([9, 19], [9, 27]))!.awayEnd })], event)).toBeNull();
  });
});
