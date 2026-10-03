import type { BusyEvent } from '../utils/calendarBusy';
import { busyEveningOn, describeBusyEvening } from '../utils/busyEvenings';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const event = (start: Date, end: Date, over: Partial<BusyEvent> = {}): BusyEvent => ({
  id: `${start.getTime()}`, title: 'Dinner at Mia\'s', start: start.toISOString(), end: end.toISOString(),
  allDay: false, calendarId: 'c', location: null, status: 'confirmed', availability: 'busy', ...over,
});

const at = (h: number, m = 0) => new Date(2026, 9, 6, h, m);
const times = { eveningStart: '18:00', nightStart: '21:00' };
const covered = { start: new Date(2026, 9, 3), end: new Date(2026, 9, 17) };

describe('busyEveningOn', () => {
  it('names the event taking the most of the evening', () => {
    const result = busyEveningOn(
      [event(at(17), at(18, 30), { title: 'Standup' }), event(at(19), at(22))],
      '2026-10-06', times, covered,
    );
    expect(result).toEqual({ title: "Dinner at Mia's", minutes: 150 });
  });

  it('says nothing under an hour of the evening', () => {
    expect(busyEveningOn([event(at(17), at(18, 45))], '2026-10-06', times, covered)).toBeNull();
  });

  it('ignores all-day, free and cancelled events, like every busy reader', () => {
    const events = [
      event(at(0), new Date(2026, 9, 7), { allDay: true }),
      event(at(18), at(21), { availability: 'free' }),
      event(at(18), at(21), { status: 'canceled' }),
    ];
    expect(busyEveningOn(events, '2026-10-06', times, covered)).toBeNull();
  });

  it('says nothing about a day the calendar was not read for', () => {
    const events = [event(at(18), at(21))];
    expect(busyEveningOn(events, '2026-10-06', times, null)).toBeNull();
    expect(busyEveningOn(events, '2026-10-06', times, { start: covered.start, end: at(20) })).toBeNull();
  });

  it('follows the evening the settings define', () => {
    const events = [event(at(21), at(23))];
    expect(busyEveningOn(events, '2026-10-06', times, covered)).toBeNull();
    expect(busyEveningOn(events, '2026-10-06', { eveningStart: '20:00', nightStart: '23:00' }, covered)?.minutes).toBe(120);
  });

  it('says nothing when the times make no span', () => {
    expect(busyEveningOn([event(at(18), at(21))], '2026-10-06', { eveningStart: '21:00', nightStart: '18:00' }, covered)).toBeNull();
  });
});

describe('describeBusyEvening', () => {
  it('names the event, or stands alone without one', () => {
    expect(describeBusyEvening({ title: "Dinner at Mia's", minutes: 120 })).toBe("Busy evening: Dinner at Mia's");
    expect(describeBusyEvening({ title: '', minutes: 120 })).toBe('Busy evening');
  });
});
