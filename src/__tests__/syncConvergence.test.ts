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
import { joinAfterErasing, runSync } from '../utils/syncEngine';

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


/**
 * The CloudKit bridge with deletion, the way its change feed reports one: a
 * record removed after a device's position is listed in `removed`, and is no
 * longer handed out as a payload.
 */
function compactingICloud(compactAfter: number) {
  const log: Array<{ kind: 'save'; id: string; payload: string } | { kind: 'delete'; id: string }> = [];
  const live = new Map<string, string>();
  let next = 0;
  // Runs once after the next pull returns, standing in for another device
  // pushing while this one is between its pull and its compaction.
  let afterPull: (() => void) | null = null;
  const cloud: SyncTransport & {
    live: Map<string, string>;
    removedIds: string[];
    afterNextPull(fn: () => void): void;
  } = {
    name: 'cloudkit',
    compactAfter,
    live,
    removedIds: [],
    afterNextPull(fn) { afterPull = fn; },
    async push(payload: string) {
      const id = `rec-${next++}`;
      live.set(id, payload);
      log.push({ kind: 'save', id, payload });
    },
    async pull(since: string | null) {
      const from = since === null ? 0 : Number(since);
      const payloads: string[] = [];
      const ids: string[] = [];
      const removed: string[] = [];
      for (const entry of log.slice(from)) {
        if (entry.kind === 'delete') removed.push(entry.id);
        else if (live.has(entry.id)) {
          payloads.push(entry.payload);
          ids.push(entry.id);
        }
      }
      const cursor = String(log.length);
      const hook = afterPull;
      afterPull = null;
      hook?.();
      return { payloads, ids, removed, cursor };
    },
    async removeHistory(ids: string[]) {
      for (const id of ids) {
        if (!live.delete(id)) continue;
        log.push({ kind: 'delete', id });
        cloud.removedIds.push(id);
      }
    },
  };
  return cloud;
}

describe('a device erased to join, so the phone stays the source', () => {
  async function eraseAndJoin(cloud: SyncTransport, d: Device): Promise<string> {
    later();
    const result = await joinAfterErasing(cloud, d.local, () => d.db.dbEraseForSyncJoin());
    return result.status;
  }

  it('counts only what a person entered as data of its own', () => {
    const mac = newDevice('mac');
    mac.db.dbSetSetting('theme', 'dark');
    expect(mac.db.dbHasOwnSyncData()).toBe(false);

    addTask(mac, 'm', 'Mac task');
    expect(mac.db.dbHasOwnSyncData()).toBe(true);
  });

  it('takes only the phone\'s data and sends the phone nothing, settings included', async () => {
    const cloud = fakeICloud();
    const phone = newDevice('phone');
    addTask(phone, 'a', 'Pay rent');
    phone.db.dbSetSetting('theme', 'phone-theme');
    await settle(cloud, phone);

    const mac = newDevice('mac');
    addTask(mac, 'm', 'Mac task');
    later();
    // Changed after the phone's, so it would win if it were sent.
    mac.db.dbSetSetting('theme', 'mac-theme');
    mac.db.dbSetSetting('anthropicApiKey', 'mac-key');

    expect(await eraseAndJoin(cloud, mac)).toBe('joined');
    await settle(cloud, phone, mac);

    expect(titles(phone)).toEqual(['Pay rent']);
    expect(titles(mac)).toEqual(['Pay rent']);
    expect(phone.db.dbGetSetting('theme')).toBe('phone-theme');
    expect(mac.db.dbGetSetting('theme')).toBe('phone-theme');
    // This device's own: a credential stays, and so does every migration flag,
    // since the rows arriving are already migrated.
    expect(mac.db.dbGetSetting('anthropicApiKey')).toBe('mac-key');
    expect(mac.db.dbGetSetting('effort_xxs_migration_done')).not.toBeNull();
  });

  it('leaves no deletion behind on a device that had synced, and gets back what only it wrote', async () => {
    const cloud = fakeICloud();
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    addTask(phone, 'a', 'Pay rent');
    addTask(mac, 'm', 'Written on the Mac');
    await settle(cloud, phone, mac);

    expect(await eraseAndJoin(cloud, mac)).toBe('joined');
    await settle(cloud, phone, mac);

    expect(titles(phone)).toEqual(['Pay rent', 'Written on the Mac']);
    expect(tasks(mac)).toEqual(tasks(phone));
  });

  it('hands back the deadline events the erased tasks held, so they can be deleted', () => {
    const mac = newDevice('mac');
    addTask(mac, 'm', 'Mac task', { calendar_event_id: 'ev-1', calendar_event_external_id: 'ext-1' });
    addTask(mac, 'n', 'No event');

    const erased = mac.db.dbEraseForSyncJoin();

    expect(erased.removedTaskEvents).toEqual([{ eventId: 'ev-1', externalId: 'ext-1' }]);
    expect(erased.removedMealEvents).toEqual([]);
    expect(titles(mac)).toEqual([]);
  });

  it('erases nothing when the phone has not synced yet', async () => {
    const cloud = fakeICloud();
    const mac = newDevice('mac');
    addTask(mac, 'm', 'Mac task');

    expect(await eraseAndJoin(cloud, mac)).toBe('nothing-to-join');
    expect(titles(mac)).toEqual(['Mac task']);
  });
});

describe('compacting the history behind a snapshot', () => {
  /** Edits a task enough times on `d` to push past the threshold. */
  async function churn(cloud: SyncTransport, d: Device, others: Device[], times: number) {
    for (let i = 0; i < times; i++) {
      editTask(d, 'a', { title: `Pay rent ${i}` });
      await sync(cloud, d, ...others);
    }
  }

  it('shrinks the store, and a new device rebuilds the same state from what is left', async () => {
    const cloud = compactingICloud(6);
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    addTask(phone, 'a', 'Pay rent');
    addTask(phone, 'b', 'Call mum');
    addTask(mac, 'c', 'Water plants');
    await settle(cloud, phone, mac);
    deleteTask(mac, 'c');
    await churn(cloud, phone, [mac], 10);
    await settle(cloud, phone, mac);

    expect(cloud.removedIds.length).toBeGreaterThan(0);
    const fresh = newDevice('new phone');
    await settle(cloud, fresh);

    expect(tasks(fresh)).toEqual(tasks(phone));
    expect(tasks(mac)).toEqual(tasks(phone));
    expect(titles(fresh)).toEqual(['Call mum', 'Pay rent 9']);
  });

  it('keeps a deletion for a device that was away while the history was compacted', async () => {
    const cloud = compactingICloud(4);
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    const ipad = newDevice('ipad');
    addTask(phone, 'a', 'Pay rent');
    addTask(phone, 'b', 'Call mum');
    await settle(cloud, phone, mac, ipad);
    // The iPad goes quiet. The task is deleted and the history compacted.
    deleteTask(mac, 'b');
    await churn(cloud, phone, [mac], 8);
    await settle(cloud, phone, mac);
    expect(cloud.removedIds.length).toBeGreaterThan(0);

    await settle(cloud, ipad);

    expect(titles(ipad)).toEqual(['Pay rent 7']);
  });

  it('never deletes a payload another device pushed after this one last pulled', async () => {
    const cloud = compactingICloud(4);
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    addTask(phone, 'a', 'Pay rent');
    await settle(cloud, phone, mac);
    await churn(cloud, phone, [], 3);
    // The Mac's edit lands between the phone's pull and its compaction.
    cloud.afterNextPull(() => {
      addTask(mac, 'late', 'Book flights');
      const changes = mac.db.dbSyncChangesSince(mac.db.dbGetSyncCursor('cloudkit:push'));
      void cloud.push(JSON.stringify({ format: 1, deviceId: mac.local.deviceId(), ...changes }));
    });
    editTask(phone, 'a', { title: 'Pay rent (final)' });
    await sync(cloud, phone);
    expect(cloud.removedIds.length).toBeGreaterThan(0);

    const fresh = newDevice('new phone');
    await settle(cloud, fresh);

    expect(titles(fresh)).toContain('Book flights');
  });

  it('never deletes a payload it could only partly read, so a newer device still gets all of it', async () => {
    const cloud = compactingICloud(4);
    const phone = newDevice('phone');
    addTask(phone, 'a', 'Pay rent');
    await sync(cloud, phone);
    // A peer on a newer build sends a table this one doesn't have.
    await cloud.push(JSON.stringify({
      format: 1, deviceId: 'newer-build', since: null, until: '2026-10-19T00:00:00.000Z',
      tables: { future_things: [{ id: 'f1', updated_at: '2026-10-19T00:00:00.000Z' }] }, deletions: [],
    }));
    const newerPayloadId = [...cloud.live.keys()].at(-1)!;
    await churn(cloud, phone, [], 6);

    expect(cloud.removedIds.length).toBeGreaterThan(0);
    expect(cloud.live.has(newerPayloadId)).toBe(true);
  });

  it('two devices compacting the same history lose nothing', async () => {
    const cloud = compactingICloud(3);
    const phone = newDevice('phone');
    const mac = newDevice('mac');
    addTask(phone, 'a', 'Pay rent');
    addTask(mac, 'm', 'Mac only');
    await settle(cloud, phone, mac);
    for (let i = 0; i < 6; i++) {
      editTask(phone, 'a', { title: `Pay rent ${i}` });
      editTask(mac, 'm', { title: `Mac only ${i}` });
      await sync(cloud, phone, mac);
    }
    await settle(cloud, phone, mac);

    const fresh = newDevice('new phone');
    await settle(cloud, fresh);

    expect(titles(fresh)).toEqual(['Mac only 5', 'Pay rent 5']);
    expect(tasks(mac)).toEqual(tasks(phone));
  });
});
