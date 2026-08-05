/**
 * Demo mode swaps the whole SQLite data source out from under the stores, so
 * what needs proving here is containment: while it's on, nothing reads or
 * writes the user's real database, and turning it off puts everything back
 * exactly as it was.
 *
 * expo-sqlite is mocked with better-sqlite3 keyed BY DATABASE NAME (unlike
 * database.test.ts, which only ever needs one), so 'todo.db' and 'demo.db'
 * are genuinely separate stores and a leak between them would show up as a
 * real test failure rather than being papered over by a shared handle.
 */
import { useDemoStore } from '../store/useDemoStore';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { isUsingDemoDatabase } from '../db/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDbs: Map<string, any>;
// Set by the "survives a failed delete" test to reproduce what the device
// actually does when the file can't be removed — deleteDatabaseSync throws
// if the database is still open, and never removes -wal/-shm sidecars.
let mockDeleteThrows = false;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BS = require('better-sqlite3');
  mockDbs = new Map();

  const handleFor = (name: string) => {
    // Resolved per call, not captured: deleting a database and then using a
    // handle to it again has to come back empty rather than throwing, the
    // same as reopening a deleted file on device would.
    const raw = () => {
      if (!mockDbs.has(name)) mockDbs.set(name, new BS(':memory:'));
      return mockDbs.get(name);
    };
    return {
      execSync(sql: string) {
        raw().exec(sql);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) {
        raw().prepare(sql).run(...params);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAllSync<T>(sql: string, params: any[] = []): T[] {
        return raw().prepare(sql).all(...params) as T[];
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFirstSync<T>(sql: string, params: any[] = []): T | null {
        return (raw().prepare(sql).get(...params) as T) ?? null;
      },
      withTransactionSync(fn: () => void) {
        raw().transaction(fn)();
      },
      closeSync() {
        // Left open on purpose: deleteDatabaseSync below is what discards the
        // demo data, and closing an in-memory better-sqlite3 handle the mock
        // may hand out again would break the next open.
      },
    };
  };

  return {
    openDatabaseSync: (name: string) => handleFor(name),
    deleteDatabaseSync: (name: string) => {
      if (mockDeleteThrows) throw new Error('DeleteDatabaseException');
      mockDbs.delete(name);
    },
  };
});

// Same as useTaskStore.test.ts: stubbed to keep react-native out of the
// module graph. Reminder hygiene across the swap comes free — initialize()
// already reschedules from whichever task list it just loaded.
jest.mock('../utils/notifications', () => ({
  scheduleTaskReminder: jest.fn(),
  cancelTaskReminder: jest.fn(),
  rescheduleAllReminders: jest.fn(),
}));

// ---------------------------------------------------------------------------

function realDbTaskTitles(): string[] {
  return (mockDbs.get('todo.db').prepare('SELECT title FROM tasks').all() as { title: string }[])
    .map(r => r.title);
}

beforeEach(() => {
  mockDeleteThrows = false;
  if (useDemoStore.getState().active) useDemoStore.getState().exitDemoMode();
  mockDbs.clear();
  useTaskStore.getState().initialize();
});

describe('demo mode', () => {
  it('replaces the real task list and restores it on exit', () => {
    useTaskStore.getState().addTask({ title: 'Real private task', category: 'Finance' });
    const realTasks = useTaskStore.getState().tasks.map(t => t.title);
    expect(realTasks).toEqual(['Real private task']);

    useDemoStore.getState().enterDemoMode();

    const demoTitles = useTaskStore.getState().tasks.map(t => t.title);
    expect(useDemoStore.getState().active).toBe(true);
    expect(isUsingDemoDatabase()).toBe(true);
    expect(demoTitles.length).toBeGreaterThan(10);
    expect(demoTitles).not.toContain('Real private task');

    useDemoStore.getState().exitDemoMode();

    expect(useDemoStore.getState().active).toBe(false);
    expect(isUsingDemoDatabase()).toBe(false);
    expect(useTaskStore.getState().tasks.map(t => t.title)).toEqual(realTasks);
  });

  it('hides real categories, tags, projects and stacks too, not just tasks', () => {
    useTaskStore.getState().addCategory('Therapy');
    useTaskStore.getState().addTag('confidential');
    useProjectStore.getState().createProject('Divorce paperwork', null, null);
    useTaskGroupStore.getState().createGroup('Medications', null);

    useDemoStore.getState().enterDemoMode();

    expect(useCategoryStore.getState().categories.map(c => c.name)).not.toContain('Therapy');
    expect(useTaskStore.getState().tagRegistry).not.toContain('confidential');
    expect(useProjectStore.getState().projects.map(p => p.title)).not.toContain('Divorce paperwork');
    expect(useTaskGroupStore.getState().groups.map(g => g.title)).not.toContain('Medications');

    // ...and they're all still there afterwards.
    useDemoStore.getState().exitDemoMode();
    expect(useCategoryStore.getState().categories.map(c => c.name)).toContain('Therapy');
    expect(useTaskStore.getState().tagRegistry).toContain('confidential');
    expect(useProjectStore.getState().projects.map(p => p.title)).toContain('Divorce paperwork');
    expect(useTaskGroupStore.getState().groups.map(g => g.title)).toContain('Medications');
  });

  it('writes nothing to the real database while demo mode is on', () => {
    useTaskStore.getState().addTask({ title: 'Real private task' });
    const before = realDbTaskTitles();

    useDemoStore.getState().enterDemoMode();
    // Everything a user might do during a demo, aimed at the real db if the
    // swap were incomplete.
    useTaskStore.getState().addTask({ title: 'Added during the demo' });
    const first = useTaskStore.getState().tasks[0];
    useTaskStore.getState().updateTask(first.id, { title: 'Renamed during the demo' });
    useTaskStore.getState().completeTask(useTaskStore.getState().tasks[1].id);
    useTaskStore.getState().addCategory('Made up in the demo');

    expect(realDbTaskTitles()).toEqual(before);

    useDemoStore.getState().exitDemoMode();
    expect(realDbTaskTitles()).toEqual(before);
    expect(useTaskStore.getState().tasks.map(t => t.title)).toEqual(before);
  });

  it('discards the demo database, so a second demo starts clean', () => {
    useDemoStore.getState().enterDemoMode();
    const seeded = useTaskStore.getState().tasks.length;
    useTaskStore.getState().addTask({ title: 'Scribbled in the first demo' });
    useDemoStore.getState().exitDemoMode();

    useDemoStore.getState().enterDemoMode();
    expect(useTaskStore.getState().tasks.map(t => t.title))
      .not.toContain('Scribbled in the first demo');
    expect(useTaskStore.getState().tasks.length).toBe(seeded);
    useDemoStore.getState().exitDemoMode();
  });

  it('starts clean even when the demo file survives being deleted', () => {
    mockDeleteThrows = true;

    useDemoStore.getState().enterDemoMode();
    const seeded = useTaskStore.getState().tasks.length;
    useTaskStore.getState().addTask({ title: 'Scribbled in the first demo' });
    useDemoStore.getState().exitDemoMode();

    // The file is still sitting there with the first demo's rows in it, so
    // entering again has to wipe it rather than assume it's gone.
    useDemoStore.getState().enterDemoMode();
    expect(useTaskStore.getState().tasks.map(t => t.title))
      .not.toContain('Scribbled in the first demo');
    expect(useTaskStore.getState().tasks.length).toBe(seeded);

    // And a failed delete must never strand the app on the demo database.
    useDemoStore.getState().exitDemoMode();
    expect(isUsingDemoDatabase()).toBe(false);
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it('ignores a repeated enter or exit rather than reseeding or double-swapping', () => {
    useDemoStore.getState().enterDemoMode();
    const seeded = useTaskStore.getState().tasks.length;
    useDemoStore.getState().enterDemoMode();
    expect(useTaskStore.getState().tasks.length).toBe(seeded);

    useDemoStore.getState().exitDemoMode();
    useDemoStore.getState().exitDemoMode();
    expect(isUsingDemoDatabase()).toBe(false);
  });

  it('seeds something into every view the app has', () => {
    useDemoStore.getState().enterDemoMode();
    const s = useTaskStore.getState();

    expect(s.visibleTasks().length).toBeGreaterThan(0);   // Today
    expect(s.deferredTasks().length).toBeGreaterThan(0);  // Later
    expect(s.unscheduledTasks().length).toBeGreaterThan(0);
    expect(s.inboxTasks().length).toBeGreaterThan(0);
    expect(s.completedTasks().length).toBeGreaterThan(0); // Logbook / Stats
    expect(useProjectStore.getState().projects.length).toBeGreaterThan(0);
    expect(useTaskGroupStore.getState().groups.length).toBeGreaterThan(0);
    expect(useCategoryStore.getState().categories.length).toBeGreaterThan(0);
    expect(s.tagRegistry.length).toBeGreaterThan(0);

    useDemoStore.getState().exitDemoMode();
  });
});
