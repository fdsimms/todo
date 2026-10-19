/**
 * Two real devices, one iCloud: the sync loop end to end.
 *
 * Every other sync test exercises one half — the merge rules, the loop against
 * a fake local, or one database applying a hand-built payload. None of them
 * can show the failure people actually notice, which is what two databases
 * look like after they have traded payloads for a while: a task that exists
 * twice, a deletion that comes back, a row that never arrives. So this loads
 * database.ts twice, each copy over its own in-memory SQLite, and runs the
 * real `runSync` between them through a transport that behaves like the
 * CloudKit bridge (an append-only list of payloads, a change token that is a
 * position in it, and every device's own payloads handed back to it).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockOpened: any[] = [];

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BS = require('better-sqlite3');
    const raw = new BS(':memory:');
    mockOpened.push(raw);
    return {
      execSync(sql: string) {
        raw.exec(sql);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) {
        return raw.prepare(sql).run(...params);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAllSync<T>(sql: string, params: any[] = []): T[] {
        return raw.prepare(sql).all(...params) as T[];
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFirstSync<T>(sql: string, params: any[] = []): T | null {
        return (raw.prepare(sql).get(...params) as T) ?? null;
      },
      withTransactionSync(fn: () => void) {
        raw.exec('BEGIN');
        try {
          fn();
          raw.exec('COMMIT');
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        }
      },
    };
  },
}));

import type { SyncLocal, SyncTransport } from '../utils/syncEngine';
import { runSync } from '../utils/syncEngine';

type DatabaseModule = typeof import('../db/database');

interface Device {
  name: string;
  db: DatabaseModule;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
  local: SyncLocal;
}

/** A fresh install: its own database file, initialized the way App.tsx does. */
function newDevice(name: string): Device {
  let db!: DatabaseModule;
  mockOpened = [];
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../db/database');
  });
  db.initDatabase();
  // The first handle opened is the real database (the demo one opens lazily).
  const raw = mockOpened[0];
  const local: SyncLocal = {
    deviceId: db.dbGetDeviceId,
    isSyncable: db.isSyncableDatabase,
    changesSince: db.dbSyncChangesSince,
    apply: db.dbApplySyncChanges,
    getCursor: db.dbGetSyncCursor,
    setCursor: db.dbSetSyncCursor,
  };
  return { name, db, raw, local };
}

/** The CloudKit bridge as the app sees it: append-only, every record returned. */
function fakeICloud(): SyncTransport & { records: string[] } {
  const records: string[] = [];
  return {
    name: 'cloudkit',
    records,
    async push(payload: string) {
      records.push(payload);
    },
    async pull(since: string | null) {
      const from = since === null ? 0 : Number(since);
      return { payloads: records.slice(from), cursor: String(records.length) };
    },
  };
}

/**
 * Lets SQLite's clock move on, so the next write's stamp is strictly later
 * than the last one's. The triggers stamp with the database's own 'now' and
 * the push window is read on that same clock, so the test writes no stamps of
 * its own: a hand-written one outside the window would never be sent.
 */
function later(): void {
  const until = Date.now() + 3;
  while (Date.now() < until) { /* spin: a few milliseconds */ }
}

function addTask(d: Device, id: string, title: string, extra: Record<string, unknown> = {}): void {
  later();
  const cols = { id, title, created_at: '2026-10-01T00:00:00.000Z', ...extra };
  const names = Object.keys(cols);
  d.raw.prepare(
    `INSERT INTO tasks (${names.map(n => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
  ).run(...Object.values(cols));
}

function editTask(d: Device, id: string, fields: Record<string, unknown>): void {
  later();
  d.raw.prepare(
    `UPDATE tasks SET ${Object.keys(fields).map(c => `"${c}" = ?`).join(', ')} WHERE id = ?`
  ).run(...Object.values(fields), id);
}

function deleteTask(d: Device, id: string): void {
  later();
  d.raw.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

function tasks(d: Device): Array<{ id: string; title: string }> {
  return d.raw.prepare('SELECT id, title FROM tasks ORDER BY id').all();
}

function titles(d: Device): string[] {
  return tasks(d).map(t => t.title).sort();
}

async function sync(cloud: SyncTransport, ...devices: Device[]): Promise<void> {
  for (const d of devices) {
    later();
    const result = await runSync(cloud, d.local);
    expect(result.status).toBe('ok');
  }
}

/** Every device syncs a few times over, the way the foreground timer does. */
async function settle(cloud: SyncTransport, ...devices: Device[]): Promise<void> {
  for (let i = 0; i < 3; i++) await sync(cloud, ...devices);
}

describe('two devices through iCloud', () => {
  it('turning sync on with tasks on one device copies them once', async () => {
    const cloud = fakeICloud();
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    addTask(phone, 'a', 'Pay rent');
    addTask(phone, 'b', 'Call mum');

    await settle(cloud, phone, mac);

    expect(titles(phone)).toEqual(['Call mum', 'Pay rent']);
    expect(titles(mac)).toEqual(['Call mum', 'Pay rent']);
  });

  it('the same tasks on both devices (a restored backup) stay one copy each', async () => {
    const cloud = fakeICloud();
    const phone = newDevice('phone');
    addTask(phone, 'a', 'Pay rent');
    addTask(phone, 'b', 'Call mum');
    const mac = newDevice('mac');
    const backup = phone.db.dbExportTables();
    mac.db.dbReplaceAllData(backup);

    await settle(cloud, phone, mac);

    expect(titles(phone)).toEqual(['Call mum', 'Pay rent']);
    expect(titles(mac)).toEqual(['Call mum', 'Pay rent']);
  });

  it('settling repeatedly never sends a row back and forth', async () => {
    const cloud = fakeICloud();
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    addTask(phone, 'a', 'Pay rent');
    await settle(cloud, phone, mac);
    const after = cloud.records.length;

    await settle(cloud, phone, mac);

    expect(cloud.records.length).toBe(after);
  });

  it('edits and deletions on either side converge', async () => {
    const cloud = fakeICloud();
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    addTask(phone, 'a', 'Pay rent');
    addTask(phone, 'b', 'Call mum');
    addTask(phone, 'c', 'Water plants');
    await settle(cloud, phone, mac);

    editTask(mac, 'a', { title: 'Pay rent (Oct)' });
    deleteTask(phone, 'b');
    addTask(mac, 'd', 'Book flights');
    await settle(cloud, phone, mac);

    expect(titles(phone)).toEqual(['Book flights', 'Pay rent (Oct)', 'Water plants']);
    expect(tasks(mac)).toEqual(tasks(phone));
  });

  it('a reinstalled device rebuilds from the whole history without duplicates or resurrections', async () => {
    const cloud = fakeICloud();
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    addTask(phone, 'a', 'Pay rent');
    addTask(phone, 'b', 'Call mum');
    await settle(cloud, phone, mac);
    deleteTask(mac, 'b');
    editTask(phone, 'a', { title: 'Pay rent (Oct)' });
    await settle(cloud, phone, mac);

    const fresh = newDevice('new phone');
    await settle(cloud, fresh, mac);

    expect(titles(fresh)).toEqual(['Pay rent (Oct)']);
    expect(tasks(mac)).toEqual(tasks(fresh));
  });

  it('a deletion that reaches a device before the row it deletes still holds', async () => {
    const cloud = fakeICloud();
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    const ipad = newDevice('ipad');
    // The iPad makes a task offline. The Mac hears of it some other way (the
    // sync server, say) and deletes it; its deletion reaches iCloud before the
    // iPad's own push of the row does.
    addTask(ipad, 'x', 'Offline idea');
    const ipadPush = ipad.db.dbSyncChangesSince(null);
    mac.db.dbApplySyncChanges({ format: 1, deviceId: 'relay', ...ipadPush });
    deleteTask(mac, 'x');
    await sync(cloud, mac);
    await sync(cloud, ipad);

    await settle(cloud, phone, mac, ipad);

    expect(titles(phone)).toEqual([]);
    expect(titles(mac)).toEqual([]);
    expect(titles(ipad)).toEqual([]);
  });

  it('sync turned off and back on resumes without re-adding anything', async () => {
    const cloud = fakeICloud();
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    addTask(phone, 'a', 'Pay rent');
    await settle(cloud, phone, mac);
    // Off for a while: both sides keep working.
    addTask(phone, 'b', 'Call mum');
    deleteTask(mac, 'a');
    await settle(cloud, phone, mac);

    expect(titles(phone)).toEqual(['Call mum']);
    expect(tasks(mac)).toEqual(tasks(phone));
  });
});
