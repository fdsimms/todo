/**
 * The agent-scale tools against a real database. Each composes the app's own
 * parsers, loads and refusals, so a stub would only check itself; what is
 * pinned down here is the contract around them: a preview writes nothing, one
 * bad change refuses the whole batch, and every line or proposal says what it
 * did with each part of the input.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { batchUpdateTasks, planDay, quickAdd, rebalanceWeek } from '../agentTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;

/** Noon, `days` from today, local. */
function day(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function keyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeAll(() => {
  replica = openReplica(':memory:');
});

beforeEach(() => {
  mockRaw.runSync('DELETE FROM tasks');
  mockRaw.runSync('DELETE FROM projects');
  replica.refresh();
});

describe('batchUpdateTasks', () => {
  it('previews without writing, then applies the same changes', () => {
    const a = replica.createTask({ title: 'Call plumber' });
    const b = replica.createTask({ title: 'Buy stamps' });
    const changes = [
      { id: a.id, action: 'update' as const, fields: { tags: ['errand'] } },
      { id: b.id, action: 'defer' as const, date: keyOf(day(3)) },
    ];

    const preview = batchUpdateTasks(replica, { changes });
    expect(preview.applied).toBe(false);
    expect(preview.rows[0].changes).toEqual({ tags: { from: [], to: ['errand'] } });
    expect(preview.rows[1].to).toBe(keyOf(day(3)));
    expect(replica.taskById(a.id)!.tags).toEqual([]);

    const done = batchUpdateTasks(replica, { changes, apply: true });
    expect(done.applied).toBe(true);
    expect(replica.taskById(a.id)!.tags).toEqual(['errand']);
    expect(keyOf(replica.taskById(b.id)!.dueDate!)).toBe(keyOf(day(3)));
  });

  it('refuses the whole batch when one change would be refused, and names it', () => {
    const a = replica.createTask({ title: 'Water plants' });
    const asks = replica.createTask({ title: 'Pick a venue', deliverableKind: 'text' });
    const result = batchUpdateTasks(replica, {
      apply: true,
      changes: [
        { id: a.id, action: 'update', fields: { title: 'Water the plants' } },
        { id: asks.id, action: 'complete' },
        { id: 'nope', action: 'complete' },
      ],
    });
    expect(result.applied).toBe(false);
    expect(result.rows[1].problem).toMatch(/answer|deliverableValue/i);
    expect(result.rows[2].problem).toMatch(/No task/);
    expect(replica.taskById(a.id)!.title).toBe('Water plants');
  });

  it('refuses a task named twice', () => {
    const a = replica.createTask({ title: 'Walk' });
    const result = batchUpdateTasks(replica, {
      changes: [
        { id: a.id, action: 'update', fields: { notes: 'x' } },
        { id: a.id, action: 'complete' },
      ],
    });
    expect(result.rows[1].problem).toMatch(/twice/);
  });
});

describe('quickAdd', () => {
  it('reads each line with the app\'s own grammar, and says what it did not use', () => {
    mockRaw.runSync("INSERT INTO categories (id, name, sort_order) VALUES ('c1', 'Home', 1)");
    replica.refresh();
    const preview = quickAdd(replica, { lines: ['- Pay rent tomorrow #home !high ~30m', '2. Fix the #mystery thing'] });

    expect(preview.applied).toBe(false);
    expect(preview.rows[0]).toMatchObject({ title: 'Pay rent', category: 'Home', priority: 3, estimatedMinutes: 30 });
    expect(keyOf(preview.rows[0].dueDate!)).toBe(keyOf(day(1)));
    expect(preview.rows[1].title).toBe('Fix the #mystery thing');
    expect(preview.rows[1].notes?.[0]).toMatch(/#mystery/);
    expect(replica.tasks()).toHaveLength(0);

    const added = quickAdd(replica, { lines: ['Pay rent tomorrow #home'], apply: true });
    expect(added.rows[0].task).toMatchObject({ title: 'Pay rent', category: 'Home' });
    expect(replica.tasks()).toHaveLength(1);
  });

  it('notes a clock time it read as a time of day rather than setting a reminder', () => {
    const [row] = quickAdd(replica, { lines: ['Call mom tomorrow 5pm'] }).rows;
    expect(row.reminderTime).toBeUndefined();
    expect(row.notes?.join(' ')).toMatch(/remind me/);
    const [reminded] = quickAdd(replica, { lines: ['remind me to call mom tomorrow 5pm'] }).rows;
    expect(new Date(reminded.reminderTime!).getHours()).toBe(17);
  });
});

describe('quickAdd and the sun', () => {
  afterEach(() => {
    mockRaw.runSync("DELETE FROM settings WHERE key = 'sunLocation'");
    replica.refresh();
  });

  it('leaves "after sunset" in the title, and says why, with no location saved', () => {
    const [row] = quickAdd(replica, { lines: ['Porch lights after sunset'] }).rows;
    expect(row.title).toBe('Porch lights after sunset');
    expect(row.window).toBeUndefined();
    expect(row.notes?.join(' ')).toMatch(/needs a location/);
  });

  it('reads it as a window start that follows the sun once one is saved', () => {
    mockRaw.runSync("INSERT OR REPLACE INTO settings (key, value) VALUES ('sunLocation', '{\"latitude\":40.71,\"longitude\":-74.01}')");
    replica.refresh();
    const [row] = quickAdd(replica, { lines: ['Porch lights after sunset'] }).rows;
    expect(row.title).toBe('Porch lights');
    expect(row.window).toMatchObject({ startFollows: 'sunset', start: expect.stringMatching(/^\d{2}:\d{2}$/) });
  });
});

describe('planDay', () => {
  it('orders the day around busy time, pinned first, and says what will not fit', () => {
    replica.createTask({ title: 'Report', dueDate: day(0), estimatedMinutes: 90, priority: 3 });
    replica.createTask({ title: 'Inbox', dueDate: day(0), estimatedMinutes: 30, pinned: true });
    replica.createTask({ title: 'Big refactor', dueDate: day(0), estimatedMinutes: 600 });

    const plan = planDay(replica, { startAt: '09:00', endAt: '17:00', busy: [{ start: '09:30', end: '10:00', label: 'Standup' }] });
    expect(plan.plan.map(s => [s.title, s.start, s.end])).toEqual([
      ['Inbox', '09:00', '09:30'],
      ['Report', '10:00', '11:30'],
    ]);
    expect(plan.doesNotFit).toEqual([expect.objectContaining({ title: 'Big refactor', reason: 'no room left before the day ends' })]);
    expect(plan.note).not.toMatch(/No busy times/);
  });

  it('never places a task past its time window', () => {
    replica.createTask({ title: 'Morning pages', dueDate: day(0), estimatedMinutes: 30, windowEnd: '09:15' });
    replica.createTask({ title: 'First', dueDate: day(0), estimatedMinutes: 60, pinned: true });
    const plan = planDay(replica, { startAt: '08:30', endAt: '12:00' });
    expect(plan.doesNotFit.map(d => d.title)).toEqual(['Morning pages']);
    expect(plan.doesNotFit[0].reason).toMatch(/09:15/);
  });

  it('counts the day from the person\'s own reset, so a plan asked for in the small hours is about the day being lived', () => {
    // 01:30 under a 04:00 reset is still "yesterday" in the app, and a night
    // owl's active hours can end after midnight. Measured from calendar
    // midnight, both read as a day that ends before it starts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSettingsStore } = require('../../../src/store/useSettingsStore') as typeof import('../../../src/store/useSettingsStore');
    const settings = useSettingsStore.getState();
    jest.useFakeTimers({ now: new Date(2026, 9, 6, 1, 30) });
    settings.setDayResetTime('04:00');
    settings.setActiveHoursEnd('02:00');
    try {
      const due = new Date(2026, 9, 5, 12).toISOString();
      replica.createTask({ title: 'Wind down', dueDate: due, estimatedMinutes: 20 });
      replica.createTask({ title: 'Long read', dueDate: due, estimatedMinutes: 60 });
      const plan = planDay(replica);
      expect(plan.date).toBe('2026-10-05');
      expect([plan.from, plan.to]).toEqual(['01:30', '02:00']);
      expect(plan.plan.map(s => [s.title, s.start, s.end])).toEqual([['Wind down', '01:30', '01:50']]);
      expect(plan.doesNotFit.map(d => d.title)).toEqual(['Long read']);
    } finally {
      settings.setDayResetTime('00:00');
      settings.setMorningStart('06:00');
      settings.setActiveHoursEnd('22:00');
      jest.useRealTimers();
    }
  });
});

describe('rebalanceWeek', () => {
  it('brings a heavy later day under the busy line by moving its biggest tasks to lighter days', () => {
    for (let i = 0; i < 5; i++) replica.createTask({ title: `Chunk ${i}`, dueDate: day(2), estimatedMinutes: 60 });
    const result = rebalanceWeek(replica, { days: 7 });
    const heavy = result.days.find(d => d.date === keyOf(day(2)))!;
    expect(heavy.minutesBefore).toBe(300);
    expect(heavy.minutesAfter).toBeLessThanOrEqual(180);
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves.every(m => m.from === keyOf(day(2)) && m.to > m.from)).toBe(true);
    // Nothing moved yet: this is a proposal.
    expect(replica.tasks().every(t => keyOf(t.dueDate!) === keyOf(day(2)))).toBe(true);
  });
});
