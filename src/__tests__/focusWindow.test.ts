import type { BusyEvent } from '../utils/calendarBusy';
import { calendarWindow, FOCUS_CALENDAR_HORIZON_MINUTES } from '../utils/focusWindow';

const NOW = new Date(2026, 7, 22, 13, 0, 0);

/** Minutes from NOW, as the ISO strings the calendar hands back. */
const at = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const event = (over: Partial<BusyEvent> = {}): BusyEvent => ({
  id: 'e1',
  title: 'Design review',
  start: at(90),
  end: at(150),
  allDay: false,
  calendarId: 'cal',
  location: null,
  status: 'confirmed',
  availability: 'busy',
  ...over,
});

const OPTS = { minMinutes: 15 };

describe('calendarWindow', () => {
  it('measures the gap to the next event', () => {
    const window = calendarWindow([event()], NOW, OPTS);
    expect(window).not.toBeNull();
    expect(window!.minutes).toBe(90);
    expect(window!.title).toBe('Design review');
    expect(window!.startsAt.toISOString()).toBe(at(90));
  });

  it('takes the soonest of several', () => {
    const events = [
      event({ id: 'late', title: 'Retro', start: at(200), end: at(230) }),
      event({ id: 'soon', title: 'Standup', start: at(40), end: at(55) }),
    ];
    const window = calendarWindow(events, NOW, OPTS);
    expect(window!.minutes).toBe(40);
    expect(window!.title).toBe('Standup');
  });

  it('floors the gap rather than rounding up into the meeting', () => {
    const window = calendarWindow(
      [event({ start: new Date(NOW.getTime() + 45.9 * 60_000).toISOString() })],
      NOW,
      OPTS,
    );
    expect(window!.minutes).toBe(45);
  });

  it('offers nothing when there is nothing next', () => {
    expect(calendarWindow([], NOW, OPTS)).toBeNull();
  });

  it('ignores an event too close to be worth a session', () => {
    expect(calendarWindow([event({ start: at(10) })], NOW, OPTS)).toBeNull();
    // Exactly at the floor still counts.
    expect(calendarWindow([event({ start: at(15) })], NOW, OPTS)?.minutes).toBe(15);
  });

  it('ignores an event beyond the horizon, which is not what bounds the next hour', () => {
    const beyond = FOCUS_CALENDAR_HORIZON_MINUTES + 30;
    expect(calendarWindow([event({ start: at(beyond) })], NOW, OPTS)).toBeNull();
    expect(calendarWindow([event({ start: at(beyond) })], NOW, { ...OPTS, horizonMinutes: beyond + 1 }))
      .not.toBeNull();
  });

  it('skips an all-day event, which bounds nothing', () => {
    expect(calendarWindow([event({ allDay: true })], NOW, OPTS)).toBeNull();
  });

  it('skips a cancelled event', () => {
    expect(calendarWindow([event({ status: 'canceled' })], NOW, OPTS)).toBeNull();
  });

  it('skips one already under way — you are in it, so it is not next', () => {
    expect(calendarWindow([event({ start: at(-20), end: at(30) })], NOW, OPTS)).toBeNull();
  });

  it('gives an untitled event a stand-in rather than dropping it', () => {
    const window = calendarWindow([event({ title: '   ' })], NOW, OPTS);
    expect(window!.title).toBe('your next event');
    expect(window!.minutes).toBe(90);
  });
});
