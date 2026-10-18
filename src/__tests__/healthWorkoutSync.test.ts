/**
 * The workout write's own rules: when it is allowed to try, what it sends, and
 * that demo mode never reaches the native module, for a write or for the read
 * beside it. The store's handling of each outcome is in useWorkoutStore.test.
 */
import type { WorkoutSession } from '../types';

const mockNative = {
  isHealthAvailable: jest.fn(() => true),
  writeHealthWorkout: jest.fn(),
  deleteHealthWorkout: jest.fn(() => Promise.resolve(true)),
  readWorkouts: jest.fn(() => Promise.resolve('[]')),
};
jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, Linking: { openURL: jest.fn() } }));
jest.mock('todo-health-bridge', () => mockNative);

const mockSettings = { healthWriteEnabled: true, workoutHealthWrite: true, workoutsEnabled: true };
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => mockSettings } }));

let mockDemo = false;
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemo }));

import {
  PENDING_WORKOUT_WRITE_MAX_AGE_DAYS,
  WORKOUT_HEALTH_ACTIVITY,
  logWorkoutToHealth,
  pendingWorkoutWriteAction,
  retractWorkoutFromHealth,
  workoutHealthWriteOn,
  workoutSpanWritable,
} from '../utils/healthWorkoutSync';
import { readHealthWorkouts } from '../utils/healthWorkouts';

const NOW = new Date(2026, 9, 18, 12);

function session(over: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 's1', routineId: null, programId: null, taskId: null, title: 'Upper A',
    startedAt: new Date(2026, 9, 18, 9).toISOString(),
    endedAt: new Date(2026, 9, 18, 10).toISOString(),
    notes: '', effort: null, healthWorkoutId: null, healthWritePending: false,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDemo = false;
  Object.assign(mockSettings, { healthWriteEnabled: true, workoutHealthWrite: true, workoutsEnabled: true });
  mockNative.writeHealthWorkout.mockResolvedValue({ workoutId: 'HK-1', sampleIds: [] });
});

describe('workoutSpanWritable', () => {
  it('takes a finished session up to a day long that has already ended', () => {
    expect(workoutSpanWritable(session(), NOW)).toBe(true);
  });

  it('refuses a live session, an end not after the start, a session over a day and one ending in the future', () => {
    expect(workoutSpanWritable(session({ endedAt: null }), NOW)).toBe(false);
    expect(workoutSpanWritable(session({ endedAt: session().startedAt }), NOW)).toBe(false);
    expect(workoutSpanWritable(session({ endedAt: new Date(2026, 9, 19, 9, 1).toISOString() }), new Date(2026, 9, 20))).toBe(false);
    expect(workoutSpanWritable(session({ endedAt: new Date(2026, 9, 18, 12, 10).toISOString() }), NOW)).toBe(false);
  });

  it('allows the bridge\'s five minutes of clock skew', () => {
    expect(workoutSpanWritable(session({ endedAt: new Date(2026, 9, 18, 12, 4).toISOString() }), NOW)).toBe(true);
  });
});

describe('pendingWorkoutWriteAction', () => {
  it('writes a finished session that ended within the week', () => {
    expect(pendingWorkoutWriteAction(session(), NOW)).toBe('write');
  });

  it('drops one already in Health, one still live, and one that ended over the limit ago', () => {
    expect(pendingWorkoutWriteAction(session({ healthWorkoutId: 'HK-1' }), NOW)).toBe('drop');
    expect(pendingWorkoutWriteAction(session({ endedAt: null }), NOW)).toBe('drop');
    const old = new Date(NOW.getTime() - (PENDING_WORKOUT_WRITE_MAX_AGE_DAYS * 86_400_000 + 60_000));
    expect(pendingWorkoutWriteAction(session({ startedAt: new Date(old.getTime() - 3_600_000).toISOString(), endedAt: old.toISOString() }), NOW)).toBe('drop');
  });

  it('waits on a span the bridge would refuse, such as one logged with no length, until the limit drops it', () => {
    const end = new Date(2026, 9, 18, 10).toISOString();
    expect(pendingWorkoutWriteAction(session({ startedAt: end, endedAt: end }), NOW)).toBe('wait');
    const old = new Date(NOW.getTime() - (PENDING_WORKOUT_WRITE_MAX_AGE_DAYS * 86_400_000 + 60_000)).toISOString();
    expect(pendingWorkoutWriteAction(session({ startedAt: old, endedAt: old }), NOW)).toBe('drop');
  });
});

describe('workoutHealthWriteOn', () => {
  it('needs Log to Health, its Workouts row and the Workouts area', () => {
    expect(workoutHealthWriteOn()).toBe(true);
    for (const key of ['healthWriteEnabled', 'workoutHealthWrite', 'workoutsEnabled'] as const) {
      Object.assign(mockSettings, { healthWriteEnabled: true, workoutHealthWrite: true, workoutsEnabled: true, [key]: false });
      expect(workoutHealthWriteOn()).toBe(false);
    }
  });
});

describe('logWorkoutToHealth', () => {
  it('writes a strength workout over the session\'s own span, with no energy', async () => {
    const s = session({ startedAt: new Date(2026, 0, 2, 9).toISOString(), endedAt: new Date(2026, 0, 2, 10).toISOString() });
    await expect(logWorkoutToHealth(s)).resolves.toEqual({ outcome: 'written', workoutId: 'HK-1', sampleIds: [] });
    // The session's id is the workout's sync identifier, so a second write
    // of the same session replaces the first in Health.
    expect(mockNative.writeHealthWorkout).toHaveBeenCalledWith(s.startedAt, s.endedAt, WORKOUT_HEALTH_ACTIVITY, null, null, s.id);
  });

  it('says written with no id when the phone saved it locked, so nothing retries it', async () => {
    mockNative.writeHealthWorkout.mockResolvedValue({ workoutId: null, sampleIds: [] });
    await expect(logWorkoutToHealth(session({ startedAt: new Date(2026, 0, 2, 9).toISOString(), endedAt: new Date(2026, 0, 2, 10).toISOString() })))
      .resolves.toMatchObject({ outcome: 'written', workoutId: null });
  });

  it('calls a null answer a refusal', async () => {
    mockNative.writeHealthWorkout.mockResolvedValue(null);
    await expect(logWorkoutToHealth(session({ startedAt: new Date(2026, 0, 2, 9).toISOString(), endedAt: new Date(2026, 0, 2, 10).toISOString() })))
      .resolves.toMatchObject({ outcome: 'refused' });
  });

  it('attempts nothing with a switch off, or a span the bridge would refuse', async () => {
    mockSettings.workoutHealthWrite = false;
    await expect(logWorkoutToHealth(session())).resolves.toMatchObject({ outcome: 'off' });
    mockSettings.workoutHealthWrite = true;
    await expect(logWorkoutToHealth(session({ endedAt: null }))).resolves.toMatchObject({ outcome: 'notWritable' });
    expect(mockNative.writeHealthWorkout).not.toHaveBeenCalled();
  });
});

describe('retractWorkoutFromHealth', () => {
  it('deletes what it is given whatever the switches say, and answers true for nothing', async () => {
    Object.assign(mockSettings, { healthWriteEnabled: false, workoutHealthWrite: false });
    await expect(retractWorkoutFromHealth(['HK-1'])).resolves.toBe(true);
    expect(mockNative.deleteHealthWorkout).toHaveBeenCalledWith(['HK-1']);
    await expect(retractWorkoutFromHealth([])).resolves.toBe(true);
    expect(mockNative.deleteHealthWorkout).toHaveBeenCalledTimes(1);
  });
});

/**
 * Through the real `healthBridge()` gate, so this holds the whole path: demo
 * mode must never reach the native module, for the write, the retraction or
 * the read of other apps' workouts.
 */
describe('demo mode', () => {
  it('writes, retracts and reads nothing', async () => {
    mockDemo = true;
    await expect(logWorkoutToHealth(session({ startedAt: new Date(2026, 0, 2, 9).toISOString(), endedAt: new Date(2026, 0, 2, 10).toISOString() })))
      .resolves.toMatchObject({ outcome: 'unavailable' });
    await expect(retractWorkoutFromHealth(['HK-1'])).resolves.toBe(false);
    await expect(readHealthWorkouts(new Date(2026, 9, 1), 30)).resolves.toEqual([]);
    expect(mockNative.writeHealthWorkout).not.toHaveBeenCalled();
    expect(mockNative.deleteHealthWorkout).not.toHaveBeenCalled();
    expect(mockNative.readWorkouts).not.toHaveBeenCalled();
  });

  it('reads through the same gate once demo mode is off', async () => {
    await readHealthWorkouts(new Date(2026, 9, 1), 30);
    expect(mockNative.readWorkouts).toHaveBeenCalledTimes(1);
  });
});
