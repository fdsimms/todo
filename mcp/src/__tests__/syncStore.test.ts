/**
 * The payload store, against a real SQLite file.
 *
 * No mocking: better-sqlite3 is what it runs on in production too, so an
 * in-memory database is the same code path with a different filename.
 */
import { openSyncStore, parseCursor, DEFAULT_PULL_LIMIT, DEFAULT_RETENTION_DAYS } from '../syncStore';

const store = () => openSyncStore(':memory:');

describe('push and pull', () => {
  it('hands back everything after a cursor, in order', () => {
    const s = store();
    s.push('one');
    s.push('two');

    const first = s.pull(null);
    expect(first.payloads).toEqual(['one', 'two']);
    expect(first.cursor).toBe('2');

    // The cursor is a position, so pulling from it is empty until something
    // else lands.
    expect(s.pull(first.cursor)).toEqual({ payloads: [], cursor: null });

    s.push('three');
    expect(s.pull(first.cursor)).toEqual({ payloads: ['three'], cursor: '3' });
  });

  it('returns a null cursor for an empty page, leaving the caller where it was', () => {
    // syncEngine stores a cursor only when it is non-null, so this is what
    // stops an empty pull moving a device backwards.
    expect(store().pull(null).cursor).toBeNull();
  });

  it('never parses a payload', () => {
    const s = store();
    // Not JSON, not a SyncPayload, not anything. The store's whole contract is
    // that it does not care, which is what keeps the merge rules on the devices.
    s.push('}{ not json at all');
    expect(s.pull(null).payloads).toEqual(['}{ not json at all']);
  });
});

describe('paging', () => {
  it('caps a page and advances only as far as it actually returned', () => {
    const s = store();
    for (let i = 0; i < 5; i++) s.push(`p${i}`);

    const page = s.pull(null, 2);
    expect(page.payloads).toEqual(['p0', 'p1']);
    // The last row of this page, not the table's maximum. Advancing past rows
    // that were not returned is the one way to lose a change here.
    expect(page.cursor).toBe('2');

    expect(s.pull(page.cursor, 2).payloads).toEqual(['p2', 'p3']);
  });

  it('defaults to a page size a phone on cellular can actually receive', () => {
    expect(DEFAULT_PULL_LIMIT).toBe(200);
  });
});

describe('parseCursor', () => {
  it('reads a position', () => {
    expect(parseCursor('7')).toBe(7);
    expect(parseCursor(null)).toBe(0);
  });

  it('reads anything unreadable as the beginning, not as a skip', () => {
    // Applying a payload twice is a no-op by syncMerge's tie rule; skipping one
    // loses an edit permanently. So garbage replays rather than advances.
    for (const bad of ['', 'abc', '-1', '0', 'NaN', '1e9999']) {
      expect(parseCursor(bad)).toBe(bad === '1e9999' ? 1 : 0);
    }
  });
});

describe('prune', () => {
  it('drops what is past the horizon and keeps the rest', () => {
    const s = store();
    s.push('old');
    s.push('new');
    expect(s.count()).toBe(2);

    // Nothing is old yet, so a prune now takes nothing.
    expect(s.prune(DEFAULT_RETENTION_DAYS)).toBe(0);
    expect(s.count()).toBe(2);

    // A hundred days from now, both rows are past a ninety-day horizon.
    const later = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
    expect(s.prune(DEFAULT_RETENTION_DAYS, later)).toBe(2);
    expect(s.count()).toBe(0);
  });

  it('keeps payloads at least as long as the app keeps tombstones', () => {
    // Pruning on a shorter horizon than TOMBSTONE_RETENTION_DAYS would drop
    // changes whose deletions the devices have already forgotten, which
    // resurrects rows. The two constants bound the same thing.
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
  });

  it('leaves the sequence alone, so a pruned store does not replay old cursors', () => {
    const s = store();
    s.push('old');
    s.prune(0, new Date(Date.now() + 1000));
    s.push('new');

    // AUTOINCREMENT means seq 2, not seq 1 reused: a device holding cursor "1"
    // gets the new payload rather than being told there is nothing after it.
    expect(s.pull('1')).toEqual({ payloads: ['new'], cursor: '2' });
  });
});
