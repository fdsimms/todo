import { calendarCovers, firstFreeSlot, overlappingEvents } from '../utils/eventConflicts';
import type { BusyEvent } from '../utils/calendarBusy';

const at = (h: number, m = 0, day = 5) => new Date(2026, 9, day, h, m);
function event(id: string, from: Date, to: Date, overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id, title: id, start: from.toISOString(), end: to.toISOString(), allDay: false,
    calendarId: 'c', location: null, status: 'confirmed', availability: 'busy', ...overrides,
  };
}

describe('overlappingEvents', () => {
  const standup = event('Standup', at(12), at(12, 30));
  it('finds busy events the span runs into, earliest first', () => {
    const late = event('Review', at(13), at(14));
    expect(overlappingEvents(at(12, 15), at(13, 15), [late, standup]).map(e => e.id)).toEqual(['Standup', 'Review']);
  });
  it('lets back-to-back events touch without overlapping', () => {
    expect(overlappingEvents(at(12, 30), at(13), [standup])).toEqual([]);
  });
  it('ignores all-day, free and cancelled events', () => {
    const events = [
      event('Holiday', at(0), at(0, 0, 6), { allDay: true }),
      event('Focus', at(12), at(13), { availability: 'free' }),
      event('Old', at(12), at(13), { status: 'canceled' }),
    ];
    expect(overlappingEvents(at(12), at(13), events)).toEqual([]);
  });
});

describe('firstFreeSlot', () => {
  const events = [event('A', at(9), at(10)), event('B', at(10, 30), at(12))];
  it('finds the first gap long enough, from 9am', () => {
    expect(firstFreeSlot(at(0), 30, events, at(7))).toEqual(at(10));
    expect(firstFreeSlot(at(0), 60, events, at(7))).toEqual(at(12));
  });
  it('starts no earlier than now, on the next quarter hour', () => {
    expect(firstFreeSlot(at(0), 30, [], at(14, 5))).toEqual(at(14, 15));
  });
  it('is null for a day with no room left', () => {
    expect(firstFreeSlot(at(0), 60, [], at(20, 30))).toBeNull();
    expect(firstFreeSlot(at(0), 60, [event('All', at(9), at(21))], at(7))).toBeNull();
  });
});

describe('calendarCovers', () => {
  it('needs the read window to hold the whole span', () => {
    const ws = at(0).toISOString();
    const we = at(0, 0, 8).toISOString();
    expect(calendarCovers(ws, we, at(9), at(10))).toBe(true);
    expect(calendarCovers(ws, we, at(9, 0, 9), at(10, 0, 9))).toBe(false);
    expect(calendarCovers(null, we, at(9), at(10))).toBe(false);
  });
});
