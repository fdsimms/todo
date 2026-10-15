// The pure builder only; the hook and the stores behind it can't load under
// the node test env, so stub them (tripLiveActivity.test.ts does the same).
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'ios' },
}));
jest.mock('../store/useTaskStore', () => ({ useTaskStore: { subscribe: jest.fn(), getState: jest.fn() } }));
jest.mock('../store/useCalendarStore', () => ({ useCalendarStore: { subscribe: jest.fn(), getState: jest.fn() } }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { subscribe: jest.fn(), getState: jest.fn() } }));
jest.mock('../store/useTravelTimeStore', () => ({
  travelOriginOfEvent: jest.fn(),
  useTravelTimeStore: { subscribe: jest.fn(), getState: jest.fn() },
}));

import {
  ALREADY_THERE_MINUTES,
  buildLeaveRun,
  LEAVE_WINDOW_MS,
  type AlreadyThereCheck,
} from '../utils/leaveLiveActivity';
import { TRAVEL_ESTIMATE_STALE_MS, TRAVEL_ORIGIN_CURRENT, travelSourceId } from '../utils/travelTasks';
import type { BusyEvent } from '../utils/calendarBusy';
import type { Task } from '../types';

const NOW = new Date(2026, 7, 12, 8, 0, 0);
const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60000).toISOString();

function makeEvent(overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: 'ev-1',
    title: 'Dentist',
    start: at(90),
    end: at(150),
    allDay: false,
    calendarId: 'cal-1',
    location: '12 Main St',
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

function travelTaskFor(event: BusyEvent, leaveInMinutes: number, overrides: Partial<Task> = {}): Task {
  return {
    id: `t-${event.id}`,
    generatedKind: 'travel',
    generatedSourceId: travelSourceId(event),
    reminderTime: at(leaveInMinutes),
    completed: false,
    archived: false,
    ...overrides,
  } as Task;
}

describe('buildLeaveRun', () => {
  it('returns nothing when disabled', () => {
    const event = makeEvent();
    expect(buildLeaveRun([travelTaskFor(event, 60)], [event], NOW, { enabled: false })).toBeNull();
  });

  it('describes the next live travel task from the task and its event', () => {
    const event = makeEvent();
    const run = buildLeaveRun([travelTaskFor(event, 60)], [event], NOW, { enabled: true });
    expect(run).toEqual({
      taskId: 't-ev-1',
      eventTitle: 'Dentist',
      location: '12 Main St',
      leaveAtMs: NOW.getTime() + 60 * 60000,
      startMs: NOW.getTime() + 90 * 60000,
      staleAtMs: NOW.getTime() + 60 * 60000,
    });
  });

  it('waits until the leave-by time is inside the window', () => {
    const event = makeEvent({ start: at(600) });
    const minutes = LEAVE_WINDOW_MS / 60000;
    expect(buildLeaveRun([travelTaskFor(event, minutes + 1)], [event], NOW, { enabled: true })).toBeNull();
    expect(buildLeaveRun([travelTaskFor(event, minutes)], [event], NOW, { enabled: true })).not.toBeNull();
  });

  it('still shows once the leave-by time has passed, until the event starts', () => {
    const event = makeEvent();
    expect(buildLeaveRun([travelTaskFor(event, -10)], [event], NOW, { enabled: true })).not.toBeNull();
    const started = makeEvent({ start: at(-5), end: at(55) });
    expect(buildLeaveRun([travelTaskFor(started, -35)], [started], NOW, { enabled: true })).toBeNull();
  });

  it('ends with the task: a completed, archived or other-kind task is not a source', () => {
    const event = makeEvent();
    expect(buildLeaveRun([travelTaskFor(event, 60, { completed: true })], [event], NOW, { enabled: true })).toBeNull();
    expect(buildLeaveRun([travelTaskFor(event, 60, { archived: true })], [event], NOW, { enabled: true })).toBeNull();
    expect(buildLeaveRun([travelTaskFor(event, 60, { generatedKind: 'eventTask' })], [event], NOW, { enabled: true })).toBeNull();
  });

  it('picks the earliest event and skips a task whose event left the calendar window', () => {
    const early = makeEvent({ id: 'early', title: 'Early', start: at(60) });
    const late = makeEvent({ id: 'late', title: 'Late', start: at(180) });
    const gone = makeEvent({ id: 'gone', start: at(30) });
    const tasks = [travelTaskFor(late, 120), travelTaskFor(early, 30), travelTaskFor(gone, 0)];
    const run = buildLeaveRun(tasks, [late, early], NOW, { enabled: true });
    expect(run?.eventTitle).toBe('Early');
  });

  it('shortens a long title and drops a blank location', () => {
    const event = makeEvent({ title: 'x'.repeat(100), location: '   ' });
    const run = buildLeaveRun([travelTaskFor(event, 60)], [event], NOW, { enabled: true });
    expect(run?.eventTitle).toHaveLength(60);
    expect(run?.eventTitle.endsWith('…')).toBe(true);
    expect(run?.location).toBeNull();
  });

  describe('when the phone is already at the place', () => {
    const event = makeEvent();
    const checkWith = (minutes: number, ageMs = 0, originKey = TRAVEL_ORIGIN_CURRENT): AlreadyThereCheck => ({
      estimates: {
        [travelSourceId(event)]: {
          minutes,
          location: '12 Main St',
          mode: 'walking',
          origin: TRAVEL_ORIGIN_CURRENT,
          at: NOW.getTime() - ageMs,
        },
      },
      mode: 'walking',
      modeFor: () => 'walking',
      walkUnderFor: () => 0,
      originKeyFor: () => originKey,
    });
    const run = (check: AlreadyThereCheck) =>
      buildLeaveRun([travelTaskFor(event, 60)], [event], NOW, { enabled: true, check });

    it('starts nothing for a phone-origin trip of a couple of minutes or less', () => {
      expect(run(checkWith(ALREADY_THERE_MINUTES))).toBeNull();
      expect(run(checkWith(0))).toBeNull();
    });

    it('starts for a longer trip', () => {
      expect(run(checkWith(ALREADY_THERE_MINUTES + 1))).not.toBeNull();
    });

    it('cannot tell from a stale estimate, so it starts', () => {
      expect(run(checkWith(0, TRAVEL_ESTIMATE_STALE_MS))).not.toBeNull();
    });

    it('cannot tell when the trip starts from a saved place, so it starts', () => {
      expect(run(checkWith(0, 0, 'at:40.00000,-73.00000'))).not.toBeNull();
    });

    it('moves on to the next event instead of showing nothing', () => {
      const next = makeEvent({ id: 'next', title: 'Lunch', start: at(120) });
      const tasks = [travelTaskFor(event, 60), travelTaskFor(next, 60)];
      const result = buildLeaveRun(tasks, [event, next], NOW, { enabled: true, check: checkWith(0) });
      expect(result?.eventTitle).toBe('Lunch');
    });
  });
});
