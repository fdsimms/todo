import {
  hiddenEventFromEvent,
  hiddenEventKey,
  isHiddenEventStale,
  pruneStaleHiddenEvents,
  type HiddenEvent,
} from '../utils/hiddenEvents';
import type { BusyEvent } from '../utils/calendarBusy';

const makeEvent = (overrides: Partial<BusyEvent> = {}): BusyEvent => ({
  id: 'evt-1',
  title: 'Standup',
  start: '2026-01-10T09:00:00.000Z',
  end: '2026-01-10T09:15:00.000Z',
  allDay: false,
  calendarId: 'cal-1',
  location: null,
  status: 'confirmed',
  availability: 'busy',
  ...overrides,
});

describe('hiddenEventKey', () => {
  it('combines id and start, so recurring occurrences never collide', () => {
    const key = hiddenEventKey(makeEvent());
    expect(key).toBe('evt-1|2026-01-10T09:00:00.000Z');
  });

  it('differs for two occurrences of the same series', () => {
    const monday = hiddenEventKey(makeEvent({ start: '2026-01-05T09:00:00.000Z' }));
    const tuesday = hiddenEventKey(makeEvent({ start: '2026-01-06T09:00:00.000Z' }));
    expect(monday).not.toBe(tuesday);
  });
});

describe('hiddenEventFromEvent', () => {
  it('carries the event id, start and end', () => {
    const hidden = hiddenEventFromEvent(makeEvent());
    expect(hidden.eventId).toBe('evt-1');
    expect(hidden.eventStart).toBe('2026-01-10T09:00:00.000Z');
    expect(hidden.eventEnd).toBe('2026-01-10T09:15:00.000Z');
    expect(hidden.key).toBe('evt-1|2026-01-10T09:00:00.000Z');
  });
});

describe('isHiddenEventStale / pruneStaleHiddenEvents', () => {
  const past: HiddenEvent = {
    key: 'past', eventId: 'e1',
    eventStart: '2026-01-01T09:00:00.000Z', eventEnd: '2026-01-01T09:15:00.000Z',
  };
  const running: HiddenEvent = {
    key: 'running', eventId: 'e2',
    eventStart: '2026-01-09T23:00:00.000Z', eventEnd: '2026-01-10T01:00:00.000Z',
  };
  const future: HiddenEvent = {
    key: 'future', eventId: 'e3',
    eventStart: '2026-01-20T09:00:00.000Z', eventEnd: '2026-01-20T09:15:00.000Z',
  };
  const now = new Date('2026-01-10T00:00:00.000Z');

  it('is stale once the occurrence has ended, not merely started', () => {
    expect(isHiddenEventStale(past, now)).toBe(true);
    expect(isHiddenEventStale(running, now)).toBe(false);
    expect(isHiddenEventStale(future, now)).toBe(false);
  });

  it('drops only the stale entries, keeping the rest', () => {
    const pruned = pruneStaleHiddenEvents({ past, running, future }, now);
    expect(pruned).toEqual({ running, future });
  });
});
