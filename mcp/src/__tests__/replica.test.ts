/**
 * The load-bearing test for the whole package: the app's db layer, its stores
 * and its visibility model, standing up in Node against a real SQLite file
 * through the shim.
 *
 * If this passes, the premise of docs/arch/mcp-server.md holds — `src/db` and
 * `src/utils` do not need React Native, and the MCP server is a second host for
 * the layer that is already here rather than a reimplementation of it. If it
 * ever fails, something in the app has grown a native dependency below
 * `database.ts`, and that is worth knowing on the PR that does it rather than
 * the next time somebody runs the server.
 *
 * `installExpoSqliteShim` is not exercised: jest keeps its own module registry,
 * so priming Node's `require.cache` does nothing here. `jest.mock` reaches the
 * same place through the same `openShimDatabase`, which is the part with the
 * behaviour in it.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

/**
 * Rows go in as SQL naming only the columns a case is about, so every other
 * column takes its schema default. That is deliberate on two counts: the tasks
 * table has thirty-odd NOT NULL columns and a fixture listing them is a copy of
 * database.test.ts's that nobody will update, and a row with defaults
 * everywhere else is exactly the shape an install upgrading into a new column
 * has. The read path is what matters here anyway — the server never writes, and
 * `rowToTask` is what it leans on.
 */
function insert(row: { id: string; title: string; dueDate?: string; deferUntil?: string; tags?: string[]; category?: string; priority?: number; parentId?: string }): void {
  mockRaw.runSync(
    'INSERT INTO tasks (id, title, created_at, due_date, defer_until, tags, category, priority, parent_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      row.id,
      row.title,
      '2026-01-01T00:00:00.000Z',
      row.dueDate ?? null,
      row.deferUntil ?? null,
      JSON.stringify(row.tags ?? []),
      row.category ?? null,
      row.priority ?? 0,
      row.parentId ?? null,
    ]
  );
}

describe('the replica', () => {
  let replica: ReturnType<typeof openReplica>;

  // Opened once: database.ts opens its handle at module scope and every test
  // here shares it, so a per-case reopen would re-run every migration against
  // the same database rather than starting a fresh one. `mockRaw` also only
  // exists from here on, since the mock factory does not run until openReplica
  // first requires expo-sqlite.
  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM tasks');
    replica.refresh();
  });

  it('opens, migrates and hydrates without React Native', () => {
    // initDatabase ran: the schema exists and reads answer.
    expect(replica.tasks()).toEqual([]);
    // The stores hydrated: a device id is minted and the db is a real one.
    expect(replica.deviceId()).toEqual(expect.any(String));
    expect(replica.syncable()).toBe(true);
  });

  it('round-trips a task through the app\'s own row mapping', () => {
    insert({ id: 't1', title: 'Buy milk', tags: ['errand'], category: 'Home', priority: 3 });
    replica.refresh();

    const task = replica.taskById('t1');
    expect(task).toMatchObject({ id: 't1', title: 'Buy milk', category: 'Home', priority: 3 });
    // The JSON columns came back as arrays rather than as strings, which is the
    // half of rowToTask a hand-written `SELECT *` would have got wrong.
    expect(task?.tags).toEqual(['errand']);
    expect(task?.timeSegments).toEqual([]);
  });

  it('sorts tasks into the app\'s four lenses, which a date comparison could not', () => {
    insert({ id: 'today', title: 'Due now', dueDate: new Date().toISOString() });
    insert({ id: 'later', title: 'Deferred', deferUntil: '2099-01-01T00:00:00.000Z' });
    insert({ id: 'unscheduled', title: 'Someday', category: 'Home' });
    // Bare: no date, no category, no tags, no priority. That is what makes it
    // an inbox task rather than an unscheduled one.
    insert({ id: 'inbox', title: 'Untriaged' });
    replica.refresh();

    const idsWhere = (p: (t: Parameters<typeof replica.isVisible>[0]) => boolean) =>
      replica.tasks().filter(p).map(t => t.id);

    expect(idsWhere(t => replica.isVisible(t))).toEqual(['today']);
    expect(idsWhere(t => replica.isUnscheduled(t))).toEqual(['unscheduled']);
    expect(idsWhere(t => replica.isInbox(t))).toEqual(['inbox']);
    // The lenses are disjoint, which is the property `matchesView` leans on.
    expect(idsWhere(t => replica.isVisible(t) || replica.isUnscheduled(t) || replica.isInbox(t)))
      .toEqual(['today', 'unscheduled', 'inbox']);

    expect(replica.visibleAt(replica.taskById('later')!).getFullYear()).toBe(2099);
  });

  it('ranks a search with the app\'s own ranking', () => {
    insert({ id: 'a', title: 'Water the plants' });
    insert({ id: 'b', title: 'Call the plumber' });
    replica.refresh();

    expect(replica.search('plant').map(h => h.task.id)).toEqual(['a']);
    expect(replica.search('').map(h => h.task.id)).toEqual([]);
  });

  it('reads the log tables through the app\'s own row mapping', () => {
    // food_logs, mood_logs and medication_logs all arrived on main long after
    // this package was written, so this is the case that says the shim keeps up
    // with the schema rather than only with the tables it was built against.
    mockRaw.runSync(
      "INSERT INTO food_logs (id, day_key, at_iso, slot, label, quantity, nutrition, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        'f1',
        '2026-09-11',
        '2026-09-11T08:00:00.000Z',
        'breakfast',
        'Porridge',
        '1 bowl',
        // A real panel, because parseFoodNutrition refuses one with no basis,
        // no recordedAt or no amounts, and rowToFoodLogEntry drops the row
        // rather than inventing figures for it. That refusal is the behaviour
        // being relied on here, not an obstacle to the fixture.
        JSON.stringify({
          basis: 'perServing',
          recordedAt: '2026-09-11T08:00:00.000Z',
          amounts: { calorieKcal: 210 },
        }),
        '2026-09-11T08:00:00.000Z',
      ]
    );
    mockRaw.runSync(
      "INSERT INTO mood_logs (id, logged_at, day_key, mood, symptoms, context_tags) VALUES (?,?,?,?,?,?)",
      ['m1', '2026-09-11T09:00:00.000Z', '2026-09-11', 4, JSON.stringify([{ name: 'Headache', severity: 2 }]), '[]']
    );
    mockRaw.runSync(
      "INSERT INTO medication_logs (id, name, taken_at, day_key, amount, unit, as_needed) VALUES (?,?,?,?,?,?,?)",
      ['d1', 'Ibuprofen', '2026-09-11T20:00:00.000Z', '2026-09-11', 400, 'mg', 1]
    );
    replica.refresh();

    expect(replica.foodLogEntries('2026-09-01', '2026-09-30').map(e => e.label)).toEqual(['Porridge']);

    const mood = replica.moodLogs('2026-09-01', '2026-09-30');
    expect(mood).toHaveLength(1);
    // The JSON column came back as objects, and as_needed's 0/1 came back a
    // boolean — the two halves of rowToTask's discipline that a hand-written
    // query would have to redo.
    expect(mood[0].symptoms).toEqual([{ name: 'Headache', severity: 2 }]);

    const doses = replica.medicationLogs('2026-09-01', '2026-09-30');
    expect(doses[0].asNeeded).toBe(true);
    expect(replica.medicationSummary(doses[0])).toContain('Ibuprofen');
  });

  it('bounds a log range on the logical day rather than the calendar one', () => {
    // getLogicalToday honours dayResetTime, so a read at 1am under a 2am reset
    // asks about the day the user would name. Only the shape is asserted here;
    // dateUtils owns the arithmetic and tests it.
    expect(replica.todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(replica.shiftDayKey('2026-03-02', -7)).toBe('2026-02-23');
    expect(replica.shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('clears cached reads on refresh, so a sync landing mid-session is seen', () => {
    insert({ id: 'first', title: 'First' });
    replica.refresh();
    expect(replica.tasks()).toHaveLength(1);

    insert({ id: 'second', title: 'Second' });
    // Without a refresh the cache still answers, which is the point of it.
    expect(replica.tasks()).toHaveLength(1);
    replica.refresh();
    expect(replica.tasks()).toHaveLength(2);
  });
});

describe('the expo-sqlite shim', () => {
  it('reports `changes`, which the purge paths read', () => {
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)');
    db.runSync('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 1]);
    db.runSync('INSERT INTO t (id, n) VALUES (?, ?)', ['b', 2]);

    expect(db.runSync('DELETE FROM t WHERE n > ?', [0]).changes).toBe(2);
  });

  it('binds undefined as null and booleans as 0/1', () => {
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT PRIMARY KEY, flag INTEGER, note TEXT)');
    // better-sqlite3 throws on both of these unbidden; the device path coerces.
    db.runSync('INSERT INTO t (id, flag, note) VALUES (?, ?, ?)', ['a', true, undefined]);

    expect(db.getFirstSync('SELECT flag, note FROM t WHERE id = ?', ['a'])).toEqual({
      flag: 1,
      note: null,
    });
  });

  it('returns null rather than undefined for a miss', () => {
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT PRIMARY KEY)');
    expect(db.getFirstSync('SELECT * FROM t WHERE id = ?', ['nope'])).toBeNull();
  });

  it('rolls a transaction back as one unit', () => {
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT PRIMARY KEY)');

    expect(() =>
      db.withTransactionSync(() => {
        db.runSync('INSERT INTO t (id) VALUES (?)', ['a']);
        throw new Error('nope');
      })
    ).toThrow('nope');

    expect(db.getAllSync('SELECT * FROM t')).toEqual([]);
  });
});
