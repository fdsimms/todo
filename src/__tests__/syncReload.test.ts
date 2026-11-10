/**
 * The reload after a sync, against a real database holding the demo's data.
 *
 * Two promises are being kept here (#4267, syncReloadScope.ts):
 *
 * - **A store is re-read only when the sync wrote a table it reads.** That
 *   rests on `STORE_RELOAD_READS` being true, so the first block records every
 *   table and setting each part of the fan-out actually reads and fails on one
 *   the list doesn't name. A store that starts reading a new table fails here
 *   rather than going quietly stale after a sync.
 * - **A value that came back the same keeps its identity.** Every Zustand store
 *   the module graph creates is registered below, so "a reload that changed
 *   nothing notifies nobody" is checked for all of them, including one added
 *   after this file was written.
 *
 * The harness is useDemoStore.test.ts's: expo-sqlite over better-sqlite3, and
 * the demo seed for a database with something in every store.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shared = globalThis as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDbs: Map<string, any>;
let mockSchemaSnapshot: Buffer | null = null;

// Every store `create` builds, so a check can cover all of them.
jest.mock('zustand', () => {
  const actual = jest.requireActual('zustand');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  g.mockZustandStores = g.mockZustandStores ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const register = (store: any) => {
    g.mockZustandStores.push(store);
    return store;
  };
  return {
    ...actual,
    // Both spellings: create(init) and the curried create<T>()(init).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (init?: any) => (init ? register(actual.create(init)) : (inner: any) => register(actual.create(inner))),
  };
});

// The fan-out names each part through timedPart, which is what lets a read be
// pinned on the part that made it.
jest.mock('../utils/perfLog', () => {
  const actual = jest.requireActual('../utils/perfLog');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  return {
    ...actual,
    timedPart: <T>(name: string, fn: () => T): T => {
      const outer = g.mockPart ?? null;
      g.mockPart = name;
      if (g.mockPartsRun) g.mockPartsRun.push(name);
      try {
        return fn();
      } finally {
        g.mockPart = outer;
      }
    },
  };
});

jest.mock('../utils/checkInRecording', () => ({ cancelCheckInFor: jest.fn() }));
jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BS = require('better-sqlite3');
  mockDbs = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stmtCaches = new WeakMap<any, Map<string, any>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stmt = (db: any, sql: string) => {
    let cache = stmtCaches.get(db);
    if (!cache) { cache = new Map(); stmtCaches.set(db, cache); }
    let prepared = cache.get(sql);
    if (!prepared) { prepared = db.prepare(sql); cache.set(sql, prepared); }
    return prepared;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noteRead = (sql: string, params: any[]) => {
    if (g.mockReads) g.mockReads.push({ part: g.mockPart ?? null, sql, params });
  };
  const handleFor = (name: string) => {
    const raw = () => {
      if (!mockDbs.has(name)) mockDbs.set(name, new BS(mockSchemaSnapshot ?? ':memory:'));
      return mockDbs.get(name);
    };
    return {
      execSync(sql: string) { raw().exec(sql); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) { stmt(raw(), sql).run(...params); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAllSync<T>(sql: string, params: any[] = []): T[] {
        noteRead(sql, params);
        return stmt(raw(), sql).all(...params) as T[];
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFirstSync<T>(sql: string, params: any[] = []): T | null {
        noteRead(sql, params);
        return (stmt(raw(), sql).get(...params) as T) ?? null;
      },
      withTransactionSync(fn: () => void) { raw().transaction(fn)(); },
      closeSync() {},
    };
  };
  return {
    openDatabaseSync: (name: string) => handleFor(name),
    deleteDatabaseSync: (name: string) => { mockDbs.delete(name); },
  };
});

// The same stand-ins useDemoStore.test.ts needs to keep react-native and the
// native bridges out of the module graph; nothing here exercises them.
jest.mock('../utils/notifications', () => ({
  rescheduleAllPlaceReminders: jest.fn(() => Promise.resolve()),
  scheduleTaskReminder: jest.fn(),
  scheduleFastGoal: jest.fn(() => Promise.resolve()),
  cancelFastGoal: jest.fn(() => Promise.resolve()),
  cancelTaskReminder: jest.fn(),
  scheduleQuotaNudges: jest.fn(),
  cancelQuotaNudges: jest.fn(),
  rescheduleAllReminders: jest.fn(),
  scheduleFocusStepAlarm: jest.fn().mockResolvedValue(undefined),
  cancelFocusStepAlarm: jest.fn().mockResolvedValue(undefined),
  scheduleFocusMeetingHeadsUp: jest.fn().mockResolvedValue(undefined),
  cancelFocusMeetingHeadsUp: jest.fn().mockResolvedValue(undefined),
  scheduleTripReminder: jest.fn(),
  cancelTripReminder: jest.fn(),
  scheduleStepAlarm: jest.fn().mockResolvedValue(undefined),
  cancelStepAlarm: jest.fn().mockResolvedValue(undefined),
  scheduleCompletionTimer: jest.fn().mockResolvedValue(undefined),
  cancelCompletionTimer: jest.fn().mockResolvedValue(undefined),
  // A second initialize() over the demo's unlocks re-aims each one's notice.
  schedulePlayTimeUp: jest.fn().mockResolvedValue(undefined),
  cancelPlayTimeUp: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/alarmSoundDevice', () => ({
  pickSoundFile: jest.fn().mockResolvedValue({ status: 'canceled' }),
  installImportedSound: jest.fn().mockResolvedValue(false),
  removeImportedSound: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/alarmSchedule', () => ({
  syncAlarmToDevice: jest.fn().mockResolvedValue(false),
  removeAlarmFromDevice: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/calendarSync', () => ({
  deleteCalendarEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/deadlineCalendarSync', () => ({
  syncDeadlineEvent: jest.fn().mockResolvedValue({ eventId: null, externalId: null }),
}));
jest.mock('../store/useCalendarStore', () => ({
  useCalendarStore: { getState: () => ({ events: [], pastEvents: [], gridEvents: [], loaded: false }), subscribe: jest.fn() },
}));
jest.mock('../store/useWeatherStore', () => ({
  useWeatherStore: { getState: () => ({ snapshot: null, snapshotDayKey: null, refreshing: false }) },
}));
jest.mock('../store/useScreenTimeStore', () => ({
  useScreenTimeStore: { getState: () => ({ crossings: [], refreshing: false, consume: () => {} }) },
}));
jest.mock('../store/useHealthStore', () => ({
  useHealthStore: { getState: () => ({ today: null, history: null, refreshing: false }) },
}));
jest.mock('../utils/healthBridge', () => ({
  healthBridge: () => null,
  isHealthSupported: () => false,
}));

import { initDatabase, dbApplySyncChanges } from '../db/database';
import { SYNC_TRACKED_TABLES, isSyncedSettingKey } from '../db/syncTracking';
import { useDemoStore } from '../store/useDemoStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMedicationStore } from '../store/useMedicationStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { SYNC_FORMAT, emptyApplyReport, type ApplyReport, type SyncPayload } from '../utils/syncMerge';
import { STORE_RELOAD_READS, type ReloadPart, type ReloadReads } from '../utils/syncReloadScope';

// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = { getState: () => any };
const allStores = (): AnyStore[] => shared.mockZustandStores;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const liveDb = (): any => mockDbs.get('demo.db');

interface Read {
  part: string | null;
  sql: string;
  params: unknown[];
}

/** Runs `fn` with every database read and every part of the fan-out recorded. */
function traced(fn: () => void): { reads: Read[]; parts: string[] } {
  shared.mockReads = [];
  shared.mockPartsRun = [];
  try {
    fn();
    return { reads: shared.mockReads, parts: shared.mockPartsRun };
  } finally {
    shared.mockReads = null;
    shared.mockPartsRun = null;
  }
}

const TRACKED = new Set(SYNC_TRACKED_TABLES.map(t => t.name));

/** The tables a statement reads from. */
function tablesOf(sql: string): string[] {
  return [...sql.matchAll(/\b(?:FROM|JOIN)\s+"?([A-Za-z_]+)"?/gi)].map(m => m[1]);
}

/** Each part's reads as `table` or `settings:key` (`settings:*` for a read that names no key). */
function readsByPart(reads: Read[]): Map<string, Set<string>> {
  const byPart = new Map<string, Set<string>>();
  for (const read of reads) {
    if (read.part === null) continue;
    const seen = byPart.get(read.part) ?? new Set<string>();
    byPart.set(read.part, seen);
    for (const table of tablesOf(read.sql)) {
      if (table !== 'settings') seen.add(table);
      else if (/WHERE key = \?/.test(read.sql) && typeof read.params[0] === 'string') seen.add(`settings:${read.params[0]}`);
      else seen.add('settings:*');
    }
  }
  return byPart;
}

function declares(reads: ReloadReads, seen: string): boolean {
  if (!seen.startsWith('settings:')) return reads.tables.includes(seen);
  if (reads.settings === 'any') return true;
  return (reads.settings ?? []).includes(seen.slice('settings:'.length));
}

// Each edit stamped later than the last, so a second edit to a row still wins.
let peerClock = 0;

/** A peer's edit to one row: the row as it is here, with `changes` and a stamp that wins. */
function editFromPeer(table: string, where: string, changes: Record<string, unknown>): ApplyReport {
  const row = liveDb().prepare(`SELECT * FROM "${table}" WHERE ${where} LIMIT 1`).get() as Record<string, unknown>;
  expect(row).toBeDefined();
  const payload: SyncPayload = {
    format: SYNC_FORMAT,
    deviceId: 'peer-device',
    since: null,
    until: '2099-01-01T00:00:00.000Z',
    tables: { [table]: [{ ...row, ...changes, updated_at: `2099-01-01T00:00:${String(++peerClock).padStart(2, '0')}.000Z` }] },
    deletions: [],
  };
  return dbApplySyncChanges(payload);
}

const nextPeerStamp = (): string => `2099-01-01T00:00:${String(++peerClock).padStart(2, '0')}.000Z`;

function applyFromPeer(change: Pick<SyncPayload, 'tables' | 'deletions'>): ApplyReport {
  return dbApplySyncChanges({ format: SYNC_FORMAT, deviceId: 'peer-device', since: null, until: nextPeerStamp(), ...change });
}

/** A peer's deletion of one row. */
function deleteFromPeer(table: string, rowKey: string): ApplyReport {
  return applyFromPeer({ tables: {}, deletions: [{ table, rowKey, deletedAt: nextPeerStamp() }] });
}

/** A row a peer added: a copy of one that is here, under a new id. */
function addFromPeer(table: string, where: string, changes: Record<string, unknown>): ApplyReport {
  const row = liveDb().prepare(`SELECT * FROM "${table}" WHERE ${where} LIMIT 1`).get() as Record<string, unknown>;
  expect(row).toBeDefined();
  return applyFromPeer({ tables: { [table]: [{ ...row, ...changes, updated_at: nextPeerStamp() }] }, deletions: [] });
}

/** The reload a sync runs for `report`. */
const reloadFor = (report: ApplyReport): void => useTaskStore.getState().initialize({ reload: true, applied: report });

/** The state object of every store, to compare after a reload. */
const snapshotStores = (): Record<string, unknown>[] => allStores().map(s => s.getState());

/** Which stores hold a different state object than they did at `before`. */
function movedStores(before: Record<string, unknown>[]): AnyStore[] {
  return allStores().filter((s, i) => s.getState() !== before[i]);
}

/** A store, named by the state keys that changed, for a failure that says where to look. */
function describeMoved(before: Record<string, unknown>[]): string[] {
  return allStores().flatMap((s, i) => {
    const now = s.getState();
    if (now === before[i]) return [];
    const keys = Object.keys(now).filter(k => now[k] !== before[i][k]);
    return [`{${Object.keys(now).slice(0, 3).join(', ')}, …}: ${keys.join(', ') || '(no key changed, but a new state object)'}`];
  });
}

beforeAll(() => {
  mockDbs.clear();
  initDatabase();
  mockSchemaSnapshot = mockDbs.get('todo.db').serialize();
  mockDbs.clear();
  useTaskStore.getState().initialize();
  useDemoStore.getState().enterDemoMode();
  useSettingsStore.getState().initialize();
  // Once more, so memory holds what the database does. The seed leaves a few
  // values the tables don't round-trip (an off-list item's sort order, a key
  // present as undefined on a row that was read), and a first reload after it
  // would report those rather than what each test changed.
  useTaskStore.getState().initialize({ reload: true });
});

describe('what each part of the reload reads', () => {
  let byPart: Map<string, Set<string>>;
  let partsRun: string[];

  beforeAll(() => {
    const run = traced(() => useTaskStore.getState().initialize());
    byPart = readsByPart(run.reads);
    partsRun = run.parts;
  });

  it('names every part the fan-out runs, and nothing it does not', () => {
    const declared = Object.keys(STORE_RELOAD_READS).sort();
    const gated = declared.filter(name => partsRun.includes(name));
    expect(gated).toEqual(declared);
  });

  it('reads nothing a part does not declare', () => {
    const undeclared: string[] = [];
    for (const [part, reads] of Object.entries(STORE_RELOAD_READS) as [ReloadPart, ReloadReads][]) {
      for (const seen of byPart.get(part) ?? []) {
        // A table the sync never carries can't be what a sync changed.
        if (!seen.startsWith('settings:') && !TRACKED.has(seen)) continue;
        if (!declares(reads, seen)) undeclared.push(`${part} reads ${seen}`);
      }
    }
    expect({ undeclared }).toEqual({ undeclared: [] });
  });

  it('actually saw the stores read, so the check above is not passing on silence', () => {
    expect([...(byPart.get('Grocery') ?? [])]).toEqual(expect.arrayContaining(['grocery_items', 'grocery_list_items', 'settings:grocery_aisle_order']));
    expect([...(byPart.get('Workout') ?? [])]).toEqual(expect.arrayContaining(['workout_sessions', 'workout_sets', 'settings:workoutRoutineGroups']));
    expect([...(byPart.get('read tasks') ?? [])]).toContain('tasks');
  });

  it('declares only tables that exist, and settings by key', () => {
    const real = new Set((liveDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(r => r.name));
    for (const [part, reads] of Object.entries(STORE_RELOAD_READS) as [ReloadPart, ReloadReads][]) {
      for (const table of reads.tables) {
        expect({ part, table, exists: real.has(table) }).toEqual({ part, table, exists: true });
        expect(table).not.toBe('settings');
      }
    }
  });

  it('gives every synced table a part that reloads for it', () => {
    const read = new Set(Object.values(STORE_RELOAD_READS).flatMap((r: ReloadReads) => r.tables));
    const unread = [...TRACKED].filter(t => t !== 'settings' && !read.has(t)).sort();
    // The only synced table no store on the fan-out holds: the error log is
    // read by its own screen when it opens (`dbGetErrorLog`).
    expect(unread).toEqual(['error_log']);
  });
});

describe('a reload that finds nothing changed', () => {
  // A sync that wrote to every table, which is every part of the fan-out run
  // down the same path a real one takes.
  const everything = (): ApplyReport => ({
    ...emptyApplyReport(),
    changedTables: ['settings', ...new Set(Object.values(STORE_RELOAD_READS).flatMap((r: ReloadReads) => r.tables))],
  });

  it('leaves every store exactly as it was, so nothing re-renders', () => {
    // Once to settle what a reload resets on purpose (a prompt, a lazy cache).
    useTaskStore.getState().initialize({ reload: true, applied: everything() });
    useSettingsStore.getState().initialize();
    const before = snapshotStores();

    const parts = traced(() => useTaskStore.getState().initialize({ reload: true, applied: everything() })).parts;
    useSettingsStore.getState().initialize();

    for (const part of Object.keys(STORE_RELOAD_READS)) expect(parts).toContain(part);
    expect(describeMoved(before)).toEqual([]);
  });

  // The whole task table re-read is not compared row by row (it would cost as
  // much again as the read), so that one list is new. Nothing else is.
  it('moves only the task list when the reload re-reads everything from scratch', () => {
    useTaskStore.getState().initialize({ reload: true });
    const before = snapshotStores();
    const tasksBefore = useTaskStore.getState().tasks;

    useTaskStore.getState().initialize({ reload: true });

    expect(movedStores(before)).toEqual([useTaskStore]);
    expect(useTaskStore.getState().tasks).toEqual(tasksBefore);
  });

  it('covers the stores that matter, not an empty list', () => {
    expect(allStores().length).toBeGreaterThan(40);
    expect(allStores()).toEqual(expect.arrayContaining([useTaskStore, useGroceryStore, useSettingsStore, useMedicationStore]));
    expect(useTaskStore.getState().tasks.length).toBeGreaterThan(10);
    expect(useGroceryStore.getState().items.length).toBeGreaterThan(10);
  });
});

describe('a sync that changed one grocery item', () => {
  type GroceryState = ReturnType<typeof useGroceryStore.getState>;
  let was: GroceryState;
  let now: GroceryState;
  let report: ApplyReport;
  let parts: string[];
  let moved: AnyStore[];
  let targetId: string;

  // Everything is read here, before any other test can touch a store, so the
  // tests below hold whatever order they run in.
  beforeAll(() => {
    targetId = useGroceryStore.getState().items[3].id;
    const before = snapshotStores();
    was = useGroceryStore.getState();
    report = editFromPeer('grocery_items', `id = '${targetId}'`, { note: 'From the other phone' });
    parts = traced(() => useTaskStore.getState().initialize({ reload: true, applied: report })).parts;
    moved = movedStores(before);
    now = useGroceryStore.getState();
  });

  it('is reported as one table', () => {
    expect(report.updated).toBe(1);
    expect(report.changedTables).toEqual(['grocery_items']);
    expect(report.folded).toBe(false);
  });

  it('re-reads the grocery store and no other', () => {
    expect(parts).toEqual(['open database', 'Grocery']);
    expect(moved).toEqual([useGroceryStore]);
  });

  it('changes that one row and keeps every other row, and every other list, as the object it was', () => {
    expect(now.items).not.toBe(was.items);
    expect(now.items.find(i => i.id === targetId)?.note).toBe('From the other phone');
    expect(now.items.filter(i => !was.items.includes(i)).map(i => i.id)).toEqual([targetId]);
    const kept = ['shops', 'itemShops', 'itemSubs', 'itemProducts', 'storeAliases', 'lists', 'listEntries', 'aisleOrder', 'hiddenAisles', 'aisleOverrides'] as const;
    for (const key of kept) expect({ key, same: now[key] === was[key] }).toEqual({ key, same: true });
  });
});

describe('a sync that changed one task', () => {
  it('re-reads the task list and what follows from it, replacing only that row', () => {
    const tasksBefore = useTaskStore.getState().tasks;
    const target = tasksBefore.find(t => !t.completed && !t.parentId)!;
    const before = snapshotStores();

    const report = editFromPeer('tasks', `id = '${target.id}'`, { title: 'Renamed on the other phone' });
    const parts = traced(() => useTaskStore.getState().initialize({ reload: true, applied: report })).parts;

    expect(report.changedTables).toEqual(['tasks']);
    expect(report.taskIds).toEqual([target.id]);
    expect(parts).toEqual([
      'open database', 'read tasks', 'backfill recurrence anchors', 'Focus', 'reschedule reminders', 'reconcile leftover tasks',
    ]);
    const tasksNow = useTaskStore.getState().tasks;
    expect(tasksNow.find(t => t.id === target.id)?.title).toBe('Renamed on the other phone');
    expect(tasksNow.filter(t => !tasksBefore.includes(t)).map(t => t.id)).toEqual([target.id]);
    expect(movedStores(before)).toEqual([useTaskStore]);
  });

  it('leaves alone what another screen was in the middle of', () => {
    // initialize() puts these back to null, which closed a prompt the person
    // was answering whenever any sync landed. A sync that wrote no leftover
    // and no grocery row no longer reaches them.
    const leftoverId = useLeftoverStore.getState().leftovers[0].id;
    const itemId = useGroceryStore.getState().items[0].id;
    useLeftoverStore.setState({ pendingFinishLeftoverId: leftoverId });
    useGroceryStore.setState({ pendingUseUpItemId: itemId });
    const target = useTaskStore.getState().tasks.find(t => !t.completed && !t.parentId)!;

    const report = editFromPeer('tasks', `id = '${target.id}'`, { title: 'Renamed again' });
    expect(report.changedTables).toEqual(['tasks']);
    useTaskStore.getState().initialize({ reload: true, applied: report });

    expect(useTaskStore.getState().tasks.find(t => t.id === target.id)?.title).toBe('Renamed again');
    expect(useLeftoverStore.getState().pendingFinishLeftoverId).toBe(leftoverId);
    expect(useGroceryStore.getState().pendingUseUpItemId).toBe(itemId);
    useLeftoverStore.setState({ pendingFinishLeftoverId: null });
    useGroceryStore.setState({ pendingUseUpItemId: null });
  });
});

describe('what a screen was in the middle of', () => {
  afterEach(() => {
    useGroceryStore.setState({ pendingUseUpItemId: null, disposalOffer: null, ratingOffer: null, cartHoldIds: [] });
    useLeftoverStore.setState({ pendingFinishLeftoverId: null, pendingUseUpLeftoverId: null });
  });

  it('stays through a sync that brought grocery rows, while its own item is still here', () => {
    const [asked, offered, ticked, edited] = useGroceryStore.getState().items.slice(10, 14).map(i => i.id);
    useGroceryStore.setState({
      pendingUseUpItemId: asked,
      disposalOffer: { itemId: offered, stage: 'ask' },
      cartHoldIds: [ticked],
    });

    const report = editFromPeer('grocery_items', `id = '${edited}'`, { note: 'Edited elsewhere' });
    expect(report.changedTables).toEqual(['grocery_items']);
    reloadFor(report);

    const now = useGroceryStore.getState();
    expect(now.items.find(i => i.id === edited)?.note).toBe('Edited elsewhere');
    expect(now.pendingUseUpItemId).toBe(asked);
    expect(now.disposalOffer).toEqual({ itemId: offered, stage: 'ask' });
    expect(now.cartHoldIds).toEqual([ticked]);
  });

  it('goes when the sync deleted the item it was about, and only then', () => {
    const [asked, offered, ticked] = useGroceryStore.getState().items.slice(14, 17).map(i => i.id);
    useGroceryStore.setState({
      pendingUseUpItemId: asked,
      disposalOffer: { itemId: offered, stage: 'ask' },
      cartHoldIds: [ticked, asked],
    });

    const report = deleteFromPeer('grocery_items', asked);
    expect(report.deleted).toBe(1);
    reloadFor(report);

    const now = useGroceryStore.getState();
    expect(now.items.some(i => i.id === asked)).toBe(false);
    expect(now.pendingUseUpItemId).toBeNull();
    expect(now.disposalOffer).toEqual({ itemId: offered, stage: 'ask' });
    expect(now.cartHoldIds).toEqual([ticked]);
  });

  it('keeps a leftover prompt through an edit to that leftover, and drops it when the leftover is deleted', () => {
    const leftover = useLeftoverStore.getState().leftovers[0];
    useLeftoverStore.setState({ pendingFinishLeftoverId: leftover.id });

    reloadFor(editFromPeer('leftovers', `id = '${leftover.id}'`, { title: 'Renamed elsewhere' }));
    expect(useLeftoverStore.getState().leftovers.find(l => l.id === leftover.id)?.title).toBe('Renamed elsewhere');
    expect(useLeftoverStore.getState().pendingFinishLeftoverId).toBe(leftover.id);

    reloadFor(deleteFromPeer('leftovers', leftover.id));
    expect(useLeftoverStore.getState().leftovers.some(l => l.id === leftover.id)).toBe(false);
    expect(useLeftoverStore.getState().pendingFinishLeftoverId).toBeNull();
  });

  it('is cleared by a load that may be over another database', () => {
    const itemId = useGroceryStore.getState().items[0].id;
    useGroceryStore.setState({ pendingUseUpItemId: itemId, cartHoldIds: [itemId] });
    useGroceryStore.getState().initialize();
    expect(useGroceryStore.getState().pendingUseUpItemId).toBeNull();
    expect(useGroceryStore.getState().cartHoldIds).toEqual([]);
  });

  it('keeps the food log on the days each screen had loaded, with what the sync brought', () => {
    const row = liveDb().prepare('SELECT id, day_key FROM food_logs ORDER BY day_key ASC LIMIT 1').get() as { id: string; day_key: string };
    expect(row).toBeDefined();
    const store = useFoodLogStore.getState();
    // A day view scrolled back to an earlier day, and the two wider windows.
    store.loadRange(row.day_key, row.day_key);
    store.loadWindow(row.day_key, row.day_key);
    store.loadInsightWindow(row.day_key, row.day_key);
    const before = useFoodLogStore.getState();
    expect(before.entries.length).toBeGreaterThan(0);

    const report = addFromPeer('food_logs', `id = '${row.id}'`, { id: 'peer-food-log-1' });
    expect(report.inserted).toBe(1);
    reloadFor(report);

    const now = useFoodLogStore.getState();
    expect([now.rangeStart, now.rangeEnd]).toEqual([row.day_key, row.day_key]);
    for (const list of [now.entries, now.windowEntries, now.insightEntries]) {
      expect(list.map(e => e.id)).toContain('peer-food-log-1');
      expect(list).toHaveLength(before.entries.length + 1);
    }
    // And the rows that were already there are the objects they were.
    expect(now.entries.filter(e => !before.entries.includes(e)).map(e => e.id)).toEqual(['peer-food-log-1']);
  });
});

describe('a sync that changed a setting', () => {
  it('reaches the one store that reads that key', () => {
    expect(isSyncedSettingKey('medication_archived')).toBe(true);
    liveDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('medication_archived', '[]')").run();
    useTaskStore.getState().initialize({ reload: true });
    const before = snapshotStores();

    const report = editFromPeer('settings', "key = 'medication_archived'", { value: JSON.stringify(['ibuprofen']) });
    const parts = traced(() => useTaskStore.getState().initialize({ reload: true, applied: report })).parts;

    expect(report.changedTables).toEqual(['settings']);
    expect(report.changedSettingKeys).toEqual(['medication_archived']);
    // The two closing passes read settings at large, so they run for any key.
    expect(parts).toEqual(['open database', 'Medication', 'reschedule reminders', 'reconcile leftover tasks']);
    expect(useMedicationStore.getState().archived).toEqual(['ibuprofen']);
    expect(movedStores(before)).toEqual([useMedicationStore]);
  });

  it('gives the settings store a new value for that setting and the old object for every other', () => {
    const key = 'collapsedCategories';
    expect(isSyncedSettingKey(key)).toBe(true);
    liveDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(['Home']));
    useSettingsStore.getState().initialize();
    const was = useSettingsStore.getState() as unknown as Record<string, unknown>;
    expect(was[key]).toEqual(['Home']);

    editFromPeer('settings', `key = '${key}'`, { value: JSON.stringify(['Home', 'Work']) });
    useSettingsStore.getState().initialize();

    const now = useSettingsStore.getState() as unknown as Record<string, unknown>;
    expect(now[key]).toEqual(['Home', 'Work']);
    const moved = Object.keys(now).filter(k => now[k] !== was[k]);
    expect(moved).toEqual([key]);
    // And there were arrays and objects among them to keep: that is the point.
    const held = Object.keys(now).filter(k => typeof now[k] === 'object' && now[k] !== null);
    expect(held.length).toBeGreaterThan(30);
  });
});

describe('a sync that folded two rows into one', () => {
  it('reloads everything, since a fold writes wherever the loser was named', () => {
    const report: ApplyReport = {
      ...editFromPeer('grocery_items', `id = '${useGroceryStore.getState().items[5].id}'`, { note: 'x' }),
      folded: true,
    };
    const parts = traced(() => useTaskStore.getState().initialize({ reload: true, applied: report })).parts;
    for (const part of Object.keys(STORE_RELOAD_READS)) expect(parts).toContain(part);
  });
});
