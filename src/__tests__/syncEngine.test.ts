/**
 * The engine's job is orchestration — cursors, echo filtering, and what
 * happens when half a batch fails. The merge rules it calls are tested in
 * syncMerge.test.ts and the SQL that applies them in database.test.ts, so the
 * fakes here deliberately use the *real* decision functions over a Map: a
 * convergence test that used made-up merge rules would prove nothing about
 * whether two devices actually agree.
 */
import { runSync, hasChanges, type SyncLocal, type SyncTransport } from '../utils/syncEngine';
import {
  SYNC_FORMAT,
  emptyApplyReport,
  remoteDeletionWins,
  remoteRowWins,
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
  readonly name = 'fake';
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
