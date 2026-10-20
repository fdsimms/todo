import { initDatabase, dbGetAllGymExercises, dbGetAllGyms } from '../db/database';
import { useGymStore } from '../store/useGymStore';
import type { Gym } from '../types';

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

beforeAll(() => { initDatabase(); });
beforeEach(() => {
  mockRawDb.exec('DELETE FROM gyms');
  mockRawDb.exec('DELETE FROM gym_exercises');
  useGymStore.getState().initialize();
});

const state = () => useGymStore.getState();
const ok = (v: Gym | string): Gym => {
  if (typeof v === 'string') throw new Error(`refused: ${v}`);
  return v;
};

describe('gyms', () => {
  it('adds one that survives a reload, with equipment in library order', () => {
    const g = ok(state().addGym({ name: ' Planet  Fitness ', equipment: ['cable', 'barbell'], latitude: 40, longitude: -74 }));
    state().initialize();
    expect(state().gyms).toEqual([g]);
    expect(g).toMatchObject({ name: 'Planet Fitness', equipment: ['barbell', 'cable'], radiusM: 150, archived: false });
  });

  it('refuses a blank name and a taken one, and a rename onto another gym', () => {
    expect(state().addGym({ name: ' ', equipment: [] })).toBe('blank');
    const a = ok(state().addGym({ name: 'Home', equipment: [] }));
    expect(state().addGym({ name: 'home', equipment: [] })).toBe('taken');
    const b = ok(state().addGym({ name: 'Work', equipment: [] }));
    expect(state().updateGym(b.id, { name: 'HOME' })).toBe('taken');
    expect(state().updateGym(a.id, { name: 'Home' })).toMatchObject({ name: 'Home' });
    expect(state().updateGym('nope', { name: 'x' })).toBe('notFound');
  });

  it('keeps a pin as a pair and the radius inside its bounds', () => {
    const g = ok(state().addGym({ name: 'A', equipment: [], latitude: 40, longitude: null, radiusM: 5 }));
    expect(g).toMatchObject({ latitude: null, longitude: null, radiusM: 50 });
    const pinned = ok(state().updateGym(g.id, { latitude: 41, longitude: -70, radiusM: 9999 }));
    expect(pinned).toMatchObject({ latitude: 41, longitude: -70, radiusM: 500 });
    const cleared = ok(state().updateGym(g.id, { latitude: null }));
    expect(cleared).toMatchObject({ latitude: null, longitude: null });
  });

  it('archives without deleting, and hides archived from activeGyms', () => {
    const g = ok(state().addGym({ name: 'A', equipment: [] }));
    state().updateGym(g.id, { archived: true });
    expect(state().activeGyms()).toEqual([]);
    expect(dbGetAllGyms()).toHaveLength(1);
  });
});

describe('per-gym exercise settings', () => {
  it('writes a note, updates it, and deletes the row once it says nothing', () => {
    const g = ok(state().addGym({ name: 'A', equipment: [] }));
    expect(state().setGymExercise(g.id, 'lib:x', { notes: ' Seat 4 ' })).toMatchObject({ notes: 'Seat 4', barKg: null });
    state().setGymExercise(g.id, 'lib:x', { barKg: 15, incrementKg: 2 });
    expect(dbGetAllGymExercises()).toHaveLength(1);
    expect(state().settings[0]).toMatchObject({ notes: 'Seat 4', barKg: 15, incrementKg: 2 });
    state().setGymExercise(g.id, 'lib:x', { notes: '', barKg: null, incrementKg: null });
    expect(state().settings).toEqual([]);
    expect(dbGetAllGymExercises()).toEqual([]);
  });

  it('refuses a setting for a gym that does not exist, and drops a non-positive bar', () => {
    expect(state().setGymExercise('nope', 'lib:x', { notes: 'x' })).toBeNull();
    const g = ok(state().addGym({ name: 'A', equipment: [] }));
    expect(state().setGymExercise(g.id, 'lib:x', { notes: 'n', barKg: -3, incrementKg: 0 })).toMatchObject({ barKg: null, incrementKg: null });
  });

  it('deleting a gym takes its settings with it', () => {
    const g = ok(state().addGym({ name: 'A', equipment: [] }));
    state().setGymExercise(g.id, 'lib:x', { notes: 'n' });
    state().deleteGym(g.id);
    expect(state().gyms).toEqual([]);
    expect(dbGetAllGymExercises()).toEqual([]);
  });
});
