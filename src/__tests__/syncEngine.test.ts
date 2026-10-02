/**
 * The engine's job is orchestration — cursors, echo filtering, and what
 * happens when half a batch fails. The merge rules it calls are tested in
 * syncMerge.test.ts and the SQL that applies them in database.test.ts, so the
 * fakes here deliberately use the *real* decision functions over a Map: a
 * convergence test that used made-up merge rules would prove nothing about
 * whether two devices actually agree.
 */
import {
  runSync,
  runSyncAll,
  summarizeRuns,
  hasChanges,
  imagesSentKey,
  IMAGE_PAYLOAD_BUDGET_CHARS,
  pushCursorKey,
  withholdChanges,
  type SyncLocal,
  type SyncTransport,
} from '../utils/syncEngine';
import {
  SYNC_FORMAT,
  emptyApplyReport,
  remoteDeletionWins,
  remoteRowWins,
  parsePayload,
  serializePayload,
  type SyncChangeSet,
  type SyncPayload,
} from '../utils/syncMerge';
import type { BackupRow } from '../utils/backup';

// ---------------------------------------------------------------------------
// A fake device: rows in a Map, merged with the real rules.
// ---------------------------------------------------------------------------

class FakeDevice implements SyncLocal {
  rows = new Map<string, BackupRow>();
  tombstones = new Map<string, string>();
  cursors = new Map<string, string>();
  syncable = true;
  applyThrows = false;

  constructor(readonly id: string) {}

  /** A local edit, stamped like a trigger would. */
  write(rowId: string, title: string, at: string): void {
    this.rows.set(rowId, { id: rowId, title, updated_at: at });
    this.tombstones.delete(rowId);
  }

  remove(rowId: string, at: string): void {
    this.rows.delete(rowId);
    this.tombstones.set(rowId, at);
  }

  titleOf(rowId: string): string | undefined {
    return this.rows.get(rowId)?.title as string | undefined;
  }

  deviceId() { return this.id; }
  isSyncable() { return this.syncable; }
  getCursor(key: string) { return this.cursors.get(key) ?? null; }
  setCursor(key: string, value: string) { this.cursors.set(key, value); }

  /**
   * Mirrors dbSyncChangesSince: `until` comes from the device's clock and is
   * therefore strictly later than anything already written, so the inclusive
   * lower bound re-sends only what shares the cursor's millisecond.
   */
  private until(): string {
    const stamps = [
      ...[...this.rows.values()].map(r => String(r.updated_at)),
      ...this.tombstones.values(),
    ].sort();
    const max = stamps.at(-1);
    if (max === undefined) return '2026-01-01T00:00:00.000Z';
    return new Date(Date.parse(max) + 1).toISOString();
  }

  changesSince(cursor: string | null): SyncChangeSet {
    const until = this.until();
    const rows = [...this.rows.values()].filter(
      r => cursor === null || String(r.updated_at) >= cursor
    );
    const deletions = [...this.tombstones.entries()]
      .filter(([, at]) => cursor === null || at >= cursor)
      .map(([rowKey, deletedAt]) => ({ table: 'tasks', rowKey, deletedAt }));
    return { since: cursor, until, tables: { tasks: rows }, deletions };
  }

  apply(payload: SyncPayload) {
    if (this.applyThrows) throw new Error('apply blew up');
    const report = emptyApplyReport();

    for (const row of payload.tables.tasks ?? []) {
      const id = String(row.id);
      const local = this.rows.get(id);
      const localStamp = local ? String(local.updated_at) : null;
      if (local && !remoteRowWins(localStamp, String(row.updated_at))) {
        report.skipped++;
        continue;
      }
      this.rows.set(id, { ...row });
      this.tombstones.delete(id);
      if (local) report.updated++;
      else report.inserted++;
    }

    for (const d of payload.deletions) {
      const local = this.rows.get(d.rowKey);
      if (!local) continue;
      if (!remoteDeletionWins(String(local.updated_at), d.deletedAt)) {
        report.deletionsRefused++;
        continue;
      }
      this.rows.delete(d.rowKey);
      this.tombstones.set(d.rowKey, d.deletedAt);
      report.deleted++;
    }

    return report;
  }
}

/** A shared store every device pushes to and pulls from, like CloudKit. */
class FakeCloud implements SyncTransport {
  readonly name: string = 'fake';
  entries: string[] = [];
  pushThrows = false;
  pullThrows = false;

  async push(payload: string) {
    if (this.pushThrows) throw new Error('push blew up');
    this.entries.push(payload);
  }

  async pull(since: string | null) {
    if (this.pullThrows) throw new Error('pull blew up');
    const from = since === null ? 0 : Number(since);
    return { payloads: this.entries.slice(from), cursor: String(this.entries.length) };
  }
}

const payloadOf = (over: Partial<SyncPayload> = {}): SyncPayload => ({
  format: SYNC_FORMAT,
  deviceId: 'someone-else',
  since: null,
  until: '2030-01-01T00:00:00.000Z',
  tables: { tasks: [] },
  deletions: [],
  ...over,
});

describe('hasChanges', () => {
  const base: SyncChangeSet = { since: null, until: 'x', tables: { tasks: [] }, deletions: [] };

  it('is false for an empty changeset', () => expect(hasChanges(base)).toBe(false));

  it('is true for a changed row', () =>
    expect(hasChanges({ ...base, tables: { tasks: [{ id: 'a', updated_at: 'x' }] } })).toBe(true));

  it('is true for a deletion alone', () =>
    expect(hasChanges({ ...base, deletions: [{ table: 'tasks', rowKey: 'a', deletedAt: 'x' }] })).toBe(true));
});

describe('withholdChanges', () => {
  const changes: SyncChangeSet = {
    since: 'a',
    until: 'b',
    tables: {
      tasks: [{ id: 't1', updated_at: 'x' }],
      mood_logs: [{ id: 'm1', updated_at: 'x' }],
      settings: [
        { key: 'theme', value: 'dark', updated_at: 'x' },
        { key: 'medication_archived', value: '["ibuprofen"]', updated_at: 'x' },
      ],
    },
    deletions: [
      { table: 'tasks', rowKey: 't2', deletedAt: 'x' },
      { table: 'mood_logs', rowKey: 'm2', deletedAt: 'x' },
      { table: 'settings', rowKey: 'medication_archived', deletedAt: 'x' },
      { table: 'settings', rowKey: 'theme', deletedAt: 'x' },
    ],
  };
  const health = { tables: ['mood_logs'], settingKeys: ['medication_archived'] };

  it('passes everything through when nothing is withheld', () => {
    expect(withholdChanges(changes, undefined)).toBe(changes);
  });

  it('drops a withheld table, its deletions included', () => {
    const out = withholdChanges(changes, health);
    expect(out.tables.mood_logs).toBeUndefined();
    expect(out.tables.tasks).toEqual(changes.tables.tasks);
    expect(out.deletions.map(d => d.rowKey)).toEqual(['t2', 'theme']);
  });

  it('drops only the named settings rows, not the whole settings table', () => {
    expect(withholdChanges(changes, health).tables.settings.map(r => r.key)).toEqual(['theme']);
  });

  it('keeps the window it was read over, so the cursor still covers it', () => {
    const out = withholdChanges(changes, health);
    expect([out.since, out.until]).toEqual(['a', 'b']);
  });

  it('is applied by runSync: a withheld row is refused, not left pending', async () => {
    const device = new FakeDevice('phone');
    device.write('t1', 'Took a dose', '2026-01-01T00:00:00.000Z');
    const cloud = new FakeCloud();
    Object.defineProperty(cloud, 'withhold', { value: { tables: ['tasks'], settingKeys: [] } });

    await runSync(cloud, device);

    expect(cloud.entries).toHaveLength(0);
    // Advanced past the row: sending it later takes a deliberate rewind.
    expect(device.getCursor(pushCursorKey('fake'))).not.toBeNull();
  });
});

describe('runSync', () => {
  it('refuses to sync the demo database', async () => {
    const device = new FakeDevice('a');
    device.syncable = false;
    device.write('t1', 'Seeded fiction', '2026-01-01T00:00:00.000Z');
    const cloud = new FakeCloud();

    const result = await runSync(cloud, device);

    expect(result.status).toBe('skipped');
    expect(cloud.entries).toHaveLength(0);
  });

  it('pushes local changes and records how far it got', async () => {
    const device = new FakeDevice('a');
    device.write('t1', 'Buy milk', '2026-01-01T00:00:00.000Z');
    const cloud = new FakeCloud();

    const result = await runSync(cloud, device);

    expect(result.pushed).toBe(true);
    expect(cloud.entries).toHaveLength(1);
    expect(device.getCursor('fake:push')).not.toBeNull();
  });

  it('sends nothing when there is nothing to send', async () => {
    const device = new FakeDevice('a');
    const cloud = new FakeCloud();

    const result = await runSync(cloud, device);

    expect(result.pushed).toBe(false);
    expect(cloud.entries).toHaveLength(0);
    // Still advanced: the window was read and held nothing.
    expect(device.getCursor('fake:push')).not.toBeNull();
  });

  it('ignores its own payload coming back', async () => {
    // A store that keeps everything hands this device its own records too.
    const device = new FakeDevice('a');
    device.write('t1', 'Mine', '2026-01-01T00:00:00.000Z');
    const cloud = new FakeCloud();

    await runSync(cloud, device);
    const second = await runSync(cloud, device);

    expect(second.applied).toMatchObject({ inserted: 0, updated: 0 });
  });

  it('applies a peer payload', async () => {
    const device = new FakeDevice('a');
    const cloud = new FakeCloud();
    await cloud.push(serializePayload(payloadOf({
      tables: { tasks: [{ id: 't1', title: 'From peer', updated_at: '2026-01-01T00:00:00.000Z' }] },
    })));

    const result = await runSync(cloud, device);

    expect(result.applied.inserted).toBe(1);
    expect(device.titleOf('t1')).toBe('From peer');
  });

  it('counts an unreadable payload instead of wedging', async () => {
    // A peer on a newer format will keep publishing. Throwing here would stop
    // this device ever syncing again, including with peers it *can* read.
    const device = new FakeDevice('a');
    const cloud = new FakeCloud();
    cloud.entries.push('{not json');
    await cloud.push(serializePayload(payloadOf({
      tables: { tasks: [{ id: 't1', title: 'Readable', updated_at: '2026-01-01T00:00:00.000Z' }] },
    })));

    const result = await runSync(cloud, device);

    expect(result.status).toBe('ok');
    expect(result.unreadable).toBe(1);
    expect(device.titleOf('t1')).toBe('Readable');
  });

  it('does not advance the push cursor when the push fails', async () => {
    const device = new FakeDevice('a');
    device.write('t1', 'Buy milk', '2026-01-01T00:00:00.000Z');
    const cloud = new FakeCloud();
    cloud.pushThrows = true;

    const result = await runSync(cloud, device);

    expect(result.status).toBe('failed');
    expect(device.getCursor('fake:push')).toBeNull();
  });

  it('retries the whole batch when applying throws', async () => {
    // The cursor stays put, so the batch comes back. Re-applying what already
    // landed is a no-op, which is what makes retrying safe.
    const device = new FakeDevice('a');
    const cloud = new FakeCloud();
    await cloud.push(serializePayload(payloadOf({
      tables: { tasks: [{ id: 't1', title: 'From peer', updated_at: '2026-01-01T00:00:00.000Z' }] },
    })));
    device.applyThrows = true;

    const failed = await runSync(cloud, device);
    expect(failed.status).toBe('failed');
    expect(device.getCursor('fake:pull')).toBeNull();

    device.applyThrows = false;
    const retried = await runSync(cloud, device);

    expect(retried.status).toBe('ok');
    expect(device.titleOf('t1')).toBe('From peer');
  });

  it('still publishes local work when receiving fails', async () => {
    // Push first, so a peer's bad batch can't stop this device's own changes
    // ever getting out.
    const device = new FakeDevice('a');
    device.write('t1', 'Buy milk', '2026-01-01T00:00:00.000Z');
    const cloud = new FakeCloud();
    cloud.pullThrows = true;

    const result = await runSync(cloud, device);

    expect(result.status).toBe('failed');
    expect(result.pushed).toBe(true);
    expect(cloud.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Two devices, one store — the property that actually matters.
// ---------------------------------------------------------------------------

describe('two devices converge', () => {
  const sync = async (cloud: FakeCloud, ...devices: FakeDevice[]) => {
    // Twice round, so each device sees what the other published this pass.
    for (let i = 0; i < 2; i++) {
      for (const d of devices) await runSync(cloud, d);
    }
  };

  it('carries a task made on one device to the other', async () => {
    const cloud = new FakeCloud();
    const phone = new FakeDevice('phone');
    const mac = new FakeDevice('mac');
    phone.write('t1', 'Buy milk', '2026-01-01T00:00:00.000Z');

    await sync(cloud, phone, mac);

    expect(mac.titleOf('t1')).toBe('Buy milk');
  });

  it('settles on the later edit when both devices changed one task', async () => {
    const cloud = new FakeCloud();
    const phone = new FakeDevice('phone');
    const mac = new FakeDevice('mac');
    phone.write('t1', 'Original', '2026-01-01T00:00:00.000Z');
    await sync(cloud, phone, mac);

    phone.write('t1', 'Edited on phone', '2026-02-01T00:00:00.000Z');
    mac.write('t1', 'Edited on Mac', '2026-03-01T00:00:00.000Z');
    await sync(cloud, phone, mac);

    expect(phone.titleOf('t1')).toBe('Edited on Mac');
    expect(mac.titleOf('t1')).toBe('Edited on Mac');
  });

  it('carries a deletion across', async () => {
    const cloud = new FakeCloud();
    const phone = new FakeDevice('phone');
    const mac = new FakeDevice('mac');
    phone.write('t1', 'Buy milk', '2026-01-01T00:00:00.000Z');
    await sync(cloud, phone, mac);

    phone.remove('t1', '2026-02-01T00:00:00.000Z');
    await sync(cloud, phone, mac);

    expect(mac.titleOf('t1')).toBeUndefined();
  });

  it('keeps a task one device edited after the other deleted it', async () => {
    // Coming back to a task and changing it says it should still exist.
    const cloud = new FakeCloud();
    const phone = new FakeDevice('phone');
    const mac = new FakeDevice('mac');
    phone.write('t1', 'Buy milk', '2026-01-01T00:00:00.000Z');
    await sync(cloud, phone, mac);

    phone.remove('t1', '2026-02-01T00:00:00.000Z');
    mac.write('t1', 'Actually still want this', '2026-03-01T00:00:00.000Z');
    await sync(cloud, phone, mac);

    expect(mac.titleOf('t1')).toBe('Actually still want this');
    expect(phone.titleOf('t1')).toBe('Actually still want this');
  });

  it('reaches the same state whichever device syncs first', async () => {
    const run = async (order: 'phone-first' | 'mac-first') => {
      const cloud = new FakeCloud();
      const phone = new FakeDevice('phone');
      const mac = new FakeDevice('mac');
      phone.write('t1', 'From phone', '2026-01-01T00:00:00.000Z');
      mac.write('t2', 'From Mac', '2026-01-02T00:00:00.000Z');
      const devices = order === 'phone-first' ? [phone, mac] : [mac, phone];
      await sync(cloud, ...devices);
      return [phone.titleOf('t1'), phone.titleOf('t2'), mac.titleOf('t1'), mac.titleOf('t2')];
    };

    expect(await run('phone-first')).toEqual(await run('mac-first'));
  });

  it('leaves nothing to do once both are caught up', async () => {
    const cloud = new FakeCloud();
    const phone = new FakeDevice('phone');
    const mac = new FakeDevice('mac');
    phone.write('t1', 'Buy milk', '2026-01-01T00:00:00.000Z');
    await sync(cloud, phone, mac);

    const idle = await runSync(cloud, mac);

    expect(idle.pushed).toBe(false);
    expect(idle.applied).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
  });
});

describe('runSyncAll', () => {
  /** A second store, so a device can have two destinations that share nothing. */
  const twoStores = () => [new FakeCloud(), new FakeCloud()] as const;

  it('reaches every store, and keeps their cursors apart', async () => {
    const [icloud, server] = twoStores();
    // The names are what the cursors are keyed by, so two transports sharing
    // one would read each other's position and skip payloads.
    Object.defineProperty(server, 'name', { value: 'server' });

    const phone = new FakeDevice('phone');
    phone.write('t1', 'Buy milk', '2026-01-01T00:00:00.000Z');

    const runs = await runSyncAll([icloud, server], phone);

    expect(runs.map(r => r.transport)).toEqual(['fake', 'server']);
    expect(icloud.entries).toHaveLength(1);
    expect(server.entries).toHaveLength(1);
    expect(phone.cursors.get('fake:push')).toBeDefined();
    expect(phone.cursors.get('server:push')).toBeDefined();
  });

  it('carries on when one store is down', async () => {
    const [icloud, server] = twoStores();
    Object.defineProperty(server, 'name', { value: 'server' });
    icloud.pushThrows = true;

    const phone = new FakeDevice('phone');
    phone.write('t1', 'Buy milk', '2026-01-01T00:00:00.000Z');

    const runs = await runSyncAll([icloud, server], phone);

    // A laptop being off is not a reason to skip iCloud, and the reverse.
    expect(runs[0].result.status).toBe('failed');
    expect(runs[1].result.status).toBe('ok');
    expect(server.entries).toHaveLength(1);
  });

  it('is a no-op for no transports', async () => {
    expect(await runSyncAll([], new FakeDevice('phone'))).toEqual([]);
  });
});

describe('summarizeRuns', () => {
  const run = (transport: string, over: Partial<import('../utils/syncEngine').SyncRunResult>) => ({
    transport,
    result: {
      status: 'ok' as const,
      pushed: false,
      applied: emptyApplyReport(),
      unreadable: 0,
      imagesSent: 0,
      imagesReceived: 0,
      ...over,
    },
  });

  it('adds up what every store applied', () => {
    const summary = summarizeRuns([
      run('fake', { applied: { ...emptyApplyReport(), inserted: 2, updated: 1 } }),
      run('server', { applied: { ...emptyApplyReport(), inserted: 1, deleted: 3 } }),
    ]);

    expect(summary.applied).toMatchObject({ inserted: 3, updated: 1, deleted: 3 });
    expect(summary.ok).toBe(true);
    expect(summary.problem).toBeNull();
  });

  // #2950: the meal calendar reconcile after a sync reads these, and a meal
  // moved on one store and removed on the other has to reach it from both.
  it('keeps every store\'s changed meals and removed meal events', () => {
    const summary = summarizeRuns([
      run('fake', { applied: { ...emptyApplyReport(), updated: 1, mealEntryIds: ['m1'] } }),
      run('server', {
        applied: {
          ...emptyApplyReport(),
          updated: 1,
          deleted: 1,
          mealEntryIds: ['m2'],
          removedMealEvents: [{ eventId: 'evt-3', externalId: null, date: '2026-08-13' }],
        },
      }),
    ]);

    expect(summary.applied.mealEntryIds).toEqual(['m1', 'm2']);
    expect(summary.applied.removedMealEvents).toEqual([{ eventId: 'evt-3', externalId: null, date: '2026-08-13' }]);
  });

  // The same for a task's deadline event and time block.
  it('keeps every store\'s changed tasks and removed deadline events', () => {
    const summary = summarizeRuns([
      run('fake', { applied: { ...emptyApplyReport(), updated: 1, deleted: 1, taskIds: ['t1'], removedTaskEvents: [{ eventId: 'evt-1', externalId: null }] } }),
      run('server', { applied: { ...emptyApplyReport(), inserted: 1, deleted: 1, taskIds: ['t2'], removedTaskEvents: [{ eventId: 'evt-2', externalId: null }] } }),
    ]);

    expect(summary.applied.taskIds).toEqual(['t1', 't2']);
    expect(summary.applied.removedTaskEvents).toEqual([{ eventId: 'evt-1', externalId: null }, { eventId: 'evt-2', externalId: null }]);
  });

  it('names the transport in a failure, because "Sync failed" is unactionable with two', () => {
    const summary = summarizeRuns([
      run('server', { status: 'failed', reason: 'The sync server did not respond.' }),
      run('fake', {}),
    ]);

    // Still ok, because iCloud got through — and the problem still shows, since
    // half a sync is exactly the state worth telling somebody about.
    expect(summary.ok).toBe(true);
    expect(summary.problem).toBe('server: The sync server did not respond.');
  });

  it('reports no problem when every store merely skipped', () => {
    const summary = summarizeRuns([run('fake', { status: 'skipped', reason: 'Demo mode.' })]);
    expect(summary.ok).toBe(false);
    expect(summary.problem).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Recipe photos (#2704): a row carries a photo's path, and the bytes travel in
// payloads of their own, after the rows, once per transport.
// ---------------------------------------------------------------------------

/** A FakeDevice with a folder of photo files beside its rows. */
class PhotoDevice extends FakeDevice {
  files = new Map<string, string>();
  /** Names whose rows point at a photo, whether or not the file is here. */
  referenced = new Set<string>();
  writeThrows = false;

  take(name: string, base64: string): void {
    this.files.set(name, base64);
    this.referenced.add(name);
  }

  imageNames() { return [...new Set([...this.referenced, ...this.files.keys()])]; }
  readImage(name: string) { return this.files.get(name) ?? null; }
  writeImage(name: string, base64: string) {
    if (this.writeThrows) return false;
    if (this.files.has(name)) return false;
    this.files.set(name, base64);
    return true;
  }
}

/** A store like FakeCloud, under a name of its own, so two can run side by side. */
class NamedCloud extends FakeCloud {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
}

const photoPayloads = (cloud: FakeCloud) =>
  cloud.entries
    .map(e => parsePayload(e))
    .filter((p): p is { ok: true; payload: SyncPayload } => p.ok && p.payload.images !== undefined)
    .map(p => p.payload);

describe('recipe photos', () => {
  it('sends a photo after the rows, in a payload with no rows of its own', async () => {
    const a = new PhotoDevice('a');
    a.write('t1', 'Chili', '2026-01-01T00:00:00.000Z');
    a.take('p1.jpg', 'AAAA');
    const cloud = new FakeCloud();

    const result = await runSync(cloud, a);

    expect(result.imagesSent).toBe(1);
    expect(cloud.entries).toHaveLength(2);
    // Rows first, so a peer has the recipe before its photo.
    expect(parsePayload(cloud.entries[0])).toMatchObject({ ok: true, payload: { tables: { tasks: [{ id: 't1' }] } } });
    const [photos] = photoPayloads(cloud);
    expect(photos.images).toEqual({ 'p1.jpg': 'AAAA' });
    expect(photos.tables).toEqual({});
    expect(photos.deletions).toEqual([]);
  });

  it('sends each photo to a transport once, however often the rows change', async () => {
    const a = new PhotoDevice('a');
    a.take('p1.jpg', 'AAAA');
    const cloud = new FakeCloud();

    await runSync(cloud, a);
    a.write('t1', 'Chili, renamed', '2026-02-01T00:00:00.000Z');
    const second = await runSync(cloud, a);

    expect(second.imagesSent).toBe(0);
    expect(photoPayloads(cloud)).toHaveLength(1);
    expect(JSON.parse(a.getCursor(imagesSentKey('fake'))!)).toEqual(['p1.jpg']);
  });

  it('splits photos across payloads rather than exceeding the budget', async () => {
    const a = new PhotoDevice('a');
    const big = 'B'.repeat(Math.floor(IMAGE_PAYLOAD_BUDGET_CHARS * 0.6));
    a.take('p1.jpg', big);
    a.take('p2.jpg', big);
    a.take('p3.jpg', 'small');
    const cloud = new FakeCloud();

    const result = await runSync(cloud, a);

    expect(result.imagesSent).toBe(3);
    const sizes = photoPayloads(cloud).map(p => Object.values(p.images!).join('').length);
    expect(sizes.length).toBe(2);
    sizes.forEach(n => expect(n).toBeLessThanOrEqual(IMAGE_PAYLOAD_BUDGET_CHARS));
  });

  it('delivers a photo to another device, which counts it and keeps it', async () => {
    const a = new PhotoDevice('a');
    const b = new PhotoDevice('b');
    a.take('p1.jpg', 'AAAA');
    const cloud = new FakeCloud();

    await runSync(cloud, a);
    const result = await runSync(cloud, b);

    expect(result.imagesReceived).toBe(1);
    expect(b.files.get('p1.jpg')).toBe('AAAA');
  });

  it('never pushes a photo back to the store it came from, but relays it to another', async () => {
    const a = new PhotoDevice('a');
    const b = new PhotoDevice('b');
    a.take('p1.jpg', 'AAAA');
    const icloud = new NamedCloud('cloudkit');
    const server = new NamedCloud('http');

    await runSync(icloud, a);
    await runSyncAll([icloud, server], b);

    // b got it from iCloud and has nothing new for it...
    expect(photoPayloads(icloud)).toHaveLength(1);
    // ...but the server had never seen it.
    expect(photoPayloads(server).map(p => Object.keys(p.images!))).toEqual([['p1.jpg']]);
  });

  it('skips a photo whose file is not here, and sends it once it arrives', async () => {
    const a = new PhotoDevice('a');
    a.referenced.add('p1.jpg');
    const cloud = new FakeCloud();

    const first = await runSync(cloud, a);
    expect(first.imagesSent).toBe(0);
    expect(photoPayloads(cloud)).toHaveLength(0);

    a.files.set('p1.jpg', 'AAAA');
    const second = await runSync(cloud, a);
    expect(second.imagesSent).toBe(1);
  });

  it('keeps pulling when a photo payload is refused, and tries the photo again next time', async () => {
    const a = new PhotoDevice('a');
    a.write('t1', 'Chili', '2026-01-01T00:00:00.000Z');
    a.take('p1.jpg', 'AAAA');
    const b = new PhotoDevice('b');
    b.write('t2', 'Soup', '2026-01-01T00:00:00.000Z');
    const cloud = new FakeCloud();
    await runSync(cloud, b);

    // A store that takes rows and refuses anything carrying photos.
    const push = cloud.push.bind(cloud);
    cloud.push = async (payload: string) => {
      if (payload.includes('"images"')) throw new Error('Payload too large');
      return push(payload);
    };
    const result = await runSync(cloud, a);

    expect(result.status).toBe('ok');
    expect(result.imageProblem).toBe('Payload too large');
    expect(result.imagesSent).toBe(0);
    // The rows went, and the pull still ran.
    expect(a.titleOf('t2')).toBe('Soup');
    expect(a.getCursor(imagesSentKey('fake'))).toBeNull();

    cloud.push = push;
    const retry = await runSync(cloud, a);
    expect(retry.imagesSent).toBe(1);
    expect(retry.imageProblem).toBeUndefined();
  });

  it('forgets names of photos that are gone as it next records what was sent', async () => {
    const a = new PhotoDevice('a');
    a.take('old.jpg', 'OLD');
    const cloud = new FakeCloud();
    await runSync(cloud, a);

    a.files.delete('old.jpg');
    a.referenced.delete('old.jpg');
    a.take('new.jpg', 'NEW');
    await runSync(cloud, a);

    expect(JSON.parse(a.getCursor(imagesSentKey('fake'))!)).toEqual(['new.jpg']);
  });

  it('syncs rows exactly as before for a local that holds no photos', async () => {
    const plain = new FakeDevice('a');
    plain.write('t1', 'Chili', '2026-01-01T00:00:00.000Z');
    const cloud = new FakeCloud();
    cloud.entries.push(serializePayload(payloadOf({ tables: {}, images: { 'p1.jpg': 'AAAA' } })));

    const result = await runSync(cloud, plain);

    expect(result.status).toBe('ok');
    expect(result.imagesSent).toBe(0);
    expect(result.imagesReceived).toBe(0);
    expect(cloud.entries).toHaveLength(2);
  });

  it('adds up photos received and names the first transport whose photos did not go', () => {
    const base = { status: 'ok' as const, pushed: false, applied: emptyApplyReport(), unreadable: 0, imagesSent: 0 };
    const summary = summarizeRuns([
      { transport: 'cloudkit', result: { ...base, imagesReceived: 2 } },
      { transport: 'http', result: { ...base, imagesReceived: 1, imageProblem: 'Payload too large' } },
    ]);
    expect(summary.imagesReceived).toBe(3);
    expect(summary.imageProblem).toBe('http: Payload too large');
    expect(summary.problem).toBeNull();
  });
});
