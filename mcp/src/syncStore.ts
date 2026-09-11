/**
 * The payload store: append an opaque string, read back the ones after a
 * cursor. That is the entire product.
 *
 * It is what lets a replica be a sync peer (#2367, phase 1). CloudKit carries
 * phone to phone and cannot carry phone to a server, so this is the second
 * destination `httpSyncTransport` speaks to — see docs/arch/mcp-server.md for
 * why a second transport rather than a replacement.
 *
 * ## It never parses a payload, and that is the design
 *
 * A payload is a serialised `SyncPayload` and this file does not know that. The
 * merge rules, the echo filter and the tombstone semantics all live on the
 * devices, in `syncMerge.ts`, where they are tested without a network. Teaching
 * the store what a task is would put a second, untested copy of that reasoning
 * on the one machine nobody is looking at, and would make every schema change a
 * deployment. An opaque blob makes the store outlive the schema.
 *
 * It also means the box holding somebody's entire database cannot read it
 * without deserialising it itself, which is not encryption and is not nothing.
 *
 * ## The cursor is the sequence number, as a string
 *
 * `syncEngine` stores a cursor verbatim and never interprets it, so a store is
 * free to pick its own. An autoincrement rowid is the obvious one: monotonic,
 * gapless enough, and `WHERE seq > ?` is the whole pull query. It is returned
 * as a string because that is the type the engine's cursor is, and converting
 * at the boundary beats a number that has to be re-parsed on every pull.
 */
import BetterSqlite3 from 'better-sqlite3';

/** What a pull hands back, shaped as `httpSyncTransport` expects to read it. */
export interface PullPage {
  payloads: string[];
  /** Null when nothing new, which leaves the caller's stored cursor alone. */
  cursor: string | null;
}

export interface SyncStore {
  push(payload: string): void;
  pull(since: string | null, limit?: number): PullPage;
  /** Drops payloads older than the horizon. Returns how many went. */
  prune(olderThanDays: number, now?: Date): number;
  count(): number;
}

/**
 * How many payloads one pull may return.
 *
 * A device that has been off for a month asks for everything at once, and the
 * whole backlog in one response is a request big enough to time out on a phone
 * on cellular. Paging is free here because the engine already advances its
 * cursor per batch and comes back: a short page is not a partial sync, it is a
 * sync that finishes next time.
 */
export const DEFAULT_PULL_LIMIT = 200;

/**
 * How long a payload is kept.
 *
 * Matched to the app's own `TOMBSTONE_RETENTION_DAYS` (90) rather than picked
 * independently, because the two bound the same thing: a device away longer
 * than the tombstone window already needs a full reconcile rather than a
 * catch-up, so keeping payloads past that point preserves changes whose
 * deletions have already been forgotten. Pruning on a *shorter* horizon than
 * the app's would be the real hazard, and this is the line that stops somebody
 * setting one casually.
 */
export const DEFAULT_RETENTION_DAYS = 90;

export function openSyncStore(filePath: string): SyncStore {
  const db = new BetterSqlite3(filePath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS payloads (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const insert = db.prepare('INSERT INTO payloads (payload, created_at) VALUES (?, ?)');
  const selectSince = db.prepare(
    'SELECT seq, payload FROM payloads WHERE seq > ? ORDER BY seq ASC LIMIT ?'
  );
  const deleteOld = db.prepare('DELETE FROM payloads WHERE created_at < ?');
  const countAll = db.prepare('SELECT COUNT(*) AS n FROM payloads');

  return {
    push(payload: string): void {
      insert.run(payload, new Date().toISOString());
    },

    pull(since: string | null, limit = DEFAULT_PULL_LIMIT): PullPage {
      const rows = selectSince.all(parseCursor(since), limit) as { seq: number; payload: string }[];
      if (rows.length === 0) return { payloads: [], cursor: null };

      return {
        payloads: rows.map(r => r.payload),
        // The last row of *this page*, not the table's maximum. Advancing past
        // rows that were not returned is the one way to lose a change here.
        cursor: String(rows[rows.length - 1].seq),
      };
    },

    prune(olderThanDays: number, now = new Date()): number {
      const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
      return deleteOld.run(cutoff.toISOString()).changes;
    },

    count: () => (countAll.get() as { n: number }).n,
  };
}

/**
 * A cursor from the wire, as a sequence number.
 *
 * Anything unreadable reads as 0, which replays everything the store still
 * holds rather than skipping it. That is the safe direction and it is cheap:
 * applying a payload twice is a no-op by `syncMerge`'s tie rule, while skipping
 * one loses an edit permanently. A device sending nonsense gets a slow sync,
 * not a wrong one.
 */
export function parseCursor(since: string | null): number {
  if (since === null) return 0;
  const n = Number.parseInt(since, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
