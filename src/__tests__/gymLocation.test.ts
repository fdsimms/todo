import { initDatabase } from '../db/database';
import { useGymStore } from '../store/useGymStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { applyLocationGym, defaultGymId } from '../utils/gymLocation';
import { getCurrentLocation } from '../utils/weatherLocation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockRawDb: any;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BS = require('better-sqlite3');
  mockRawDb = new BS(':memory:');
  return {
    openDatabaseSync: () => ({
      execSync(sql: string) { mockRawDb.exec(sql); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) { return mockRawDb.prepare(sql).run(...params); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAllSync<T>(sql: string, params: any[] = []): T[] { return mockRawDb.prepare(sql).all(...params) as T[]; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFirstSync<T>(sql: string, params: any[] = []): T | null { return (mockRawDb.prepare(sql).get(...params) as T) ?? null; },
      withTransactionSync(fn: () => void) {
        mockRawDb.exec('BEGIN');
        try { fn(); mockRawDb.exec('COMMIT'); } catch (e) { mockRawDb.exec('ROLLBACK'); throw e; }
      },
    }),
  };
});

jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ tasks: [], completeTask: jest.fn(), logQuotaUnit: jest.fn() }) },
}));
jest.mock('../utils/weatherLocation', () => ({ getCurrentLocation: jest.fn() }));
const mockLocation = getCurrentLocation as jest.Mock;

const HERE = { latitude: 40, longitude: -74, accuracyM: 20 };

beforeAll(() => { initDatabase(); });
beforeEach(() => {
  for (const t of ['gyms', 'gym_exercises', 'workout_sessions', 'workout_sets', 'workout_routines']) mockRawDb.exec(`DELETE FROM ${t}`);
  useGymStore.getState().initialize();
  useWorkoutStore.getState().initialize();
  mockLocation.mockReset();
});

const addGym = (name: string, pin: [number, number] | null) => {
  const g = useGymStore.getState().addGym({ name, equipment: [], latitude: pin?.[0] ?? null, longitude: pin?.[1] ?? null });
  if (typeof g === 'string') throw new Error(g);
  return g;
};
const startAt = (gymId: string | null) => {
  const s = useWorkoutStore.getState().startSession({ gymId });
  if (typeof s === 'string') throw new Error(s);
  return s;
};
const gymOf = (id: string) => useWorkoutStore.getState().sessions.find(s => s.id === id)?.gymId ?? null;

describe('applyLocationGym', () => {
  it('moves the session to the gym the phone is at', async () => {
    const home = addGym('Home', [41, -70]);
    const planet = addGym('Planet', [40, -74]);
    const s = startAt(home.id);
    mockLocation.mockResolvedValue(HERE);
    await applyLocationGym(s.id);
    expect(gymOf(s.id)).toBe(planet.id);
    expect(mockLocation).toHaveBeenCalledWith({ accuracy: 'balanced' });
  });

  it('reads no position when no gym has a pin', async () => {
    addGym('Home', null);
    const s = startAt(null);
    await applyLocationGym(s.id);
    expect(mockLocation).not.toHaveBeenCalled();
    expect(gymOf(s.id)).toBeNull();
  });

  it('leaves the session alone when the fix is unknown, outside every gym or too coarse', async () => {
    const home = addGym('Home', [41, -70]);
    addGym('Planet', [40, -74]);
    const s = startAt(home.id);
    for (const fix of [null, { latitude: 10, longitude: 10, accuracyM: 20 }, { ...HERE, accuracyM: 900 }]) {
      mockLocation.mockResolvedValue(fix);
      await applyLocationGym(s.id);
      expect(gymOf(s.id)).toBe(home.id);
    }
  });

  it('does not move a session that has ended, or one with a set already ticked', async () => {
    const planet = addGym('Planet', [40, -74]);
    mockLocation.mockResolvedValue(HERE);
    const ended = startAt(null);
    useWorkoutStore.getState().updateSession(ended.id, { endedAt: new Date().toISOString() });
    await applyLocationGym(ended.id);
    expect(gymOf(ended.id)).toBeNull();

    const live = startAt(null);
    useWorkoutStore.getState().logSet(live.id, { exerciseId: 'lib:barbell-bench-press', kind: 'working', weightKg: 60, reps: 5 });
    await applyLocationGym(live.id);
    expect(gymOf(live.id)).toBeNull();
    expect(planet.id).toBeTruthy();
  });
});

describe('defaultGymId', () => {
  it('is the gym of the last workout that had one', () => {
    const a = addGym('A', null);
    const s = startAt(a.id);
    useWorkoutStore.getState().updateSession(s.id, { endedAt: new Date().toISOString() });
    expect(defaultGymId()).toBe(a.id);
    useGymStore.getState().updateGym(a.id, { archived: true });
    expect(defaultGymId()).toBeNull();
  });
});
