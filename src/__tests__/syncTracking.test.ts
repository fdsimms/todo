/**
 * The generated SQL is the feature here, so most of these run it for real
 * against an in-memory better-sqlite3 database rather than asserting on
 * strings. A trigger that reads correctly and fires wrongly is exactly the bug
 * this module cannot afford, and it is invisible to a snapshot test.
 *
 * No expo-sqlite mock and no database.ts import: the statements are built from
 * a SyncTable and applied to a table created here, so these tests exercise the
 * SQL itself without dragging in the schema or the stores.
 */
import BetterSqlite3 from 'better-sqlite3';
import {
  KEY_SEPARATOR,
  SYNC_DELETIONS_TABLE,
  SYNC_TRACKED_TABLES,
  TOMBSTONE_RETENTION_DAYS,
  backfillStatements,
  changeTrackingStatements,
  deletionsTableStatements,
  installStatements,
  rowKeyExpr,
  updatedAtMigrations,
  type SyncTable,
} from '../db/syncTracking';

const SIMPLE: SyncTable = { name: 'widgets', key: ['id'] };
const COMPOSITE: SyncTable = { name: 'links', key: ['item_id', 'shop_id'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function makeDb(): Db {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE widgets (id TEXT PRIMARY KEY NOT NULL, label TEXT, updated_at TEXT);
    CREATE TABLE links (
      item_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      PRIMARY KEY (item_id, shop_id)
    );
  `);
  for (const sql of deletionsTableStatements()) db.exec(sql);
  for (const sql of changeTrackingStatements(SIMPLE)) db.exec(sql);
  for (const sql of changeTrackingStatements(COMPOSITE)) db.exec(sql);
  return db;
}

const stampOf = (db: Db, id: string): string | null =>
  db.prepare('SELECT updated_at FROM widgets WHERE id = ?').get(id)?.updated_at ?? null;

const tombstones = (db: Db): Array<{ table_name: string; row_key: string; deleted_at: string }> =>
  db.prepare(`SELECT * FROM ${SYNC_DELETIONS_TABLE} ORDER BY row_key`).all();

describe('table definitions', () => {
  it('never tracks the settings table', () => {
    // Migration flags and device-local records live there; syncing a
    // "..._done = 1" row makes the receiving device skip that migration
    // permanently. See the note on SYNC_TRACKED_TABLES.
    expect(SYNC_TRACKED_TABLES.map(t => t.name)).not.toContain('settings');
  });

  it('gives every tracked table at least one key column', () => {
    for (const t of SYNC_TRACKED_TABLES) {
      expect(t.key.length).toBeGreaterThan(0);
    }
  });

  it('emits one updated_at migration per tracked table', () => {
    const migrations = updatedAtMigrations();
    expect(migrations).toHaveLength(SYNC_TRACKED_TABLES.length);
    expect(migrations).toContain('ALTER TABLE tasks ADD COLUMN updated_at TEXT');
  });

  it('builds a joined row key only for composite keys', () => {
    expect(rowKeyExpr(SIMPLE, 'NEW')).toBe('NEW.id');
    expect(rowKeyExpr(COMPOSITE, 'OLD')).toBe(
      `OLD.item_id || '${KEY_SEPARATOR}' || OLD.shop_id`
    );
  });

  it('creates the deletions table before any trigger that writes to it', () => {
    const statements = installStatements();
    const created = statements.findIndex(s => s.includes(`CREATE TABLE IF NOT EXISTS ${SYNC_DELETIONS_TABLE}`));
    const firstUse = statements.findIndex(s => s.includes(`INSERT OR REPLACE INTO ${SYNC_DELETIONS_TABLE}`));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(firstUse).toBeGreaterThan(created);
  });
});

describe('stamping', () => {
  it('stamps a row on insert', () => {
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'first');
    expect(stampOf(db, 'w1')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('moves the stamp on update', () => {
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'first');
    db.prepare("UPDATE widgets SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = 'w1'").run();

    db.prepare('UPDATE widgets SET label = ? WHERE id = ?').run('second', 'w1');

    expect(stampOf(db, 'w1')).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('keeps an explicitly supplied stamp on insert', () => {
    // This is how the transport applies a peer's row. Restamping it as
    // locally-modified would have the two devices trade it back and forth
    // forever, each seeing the other's write as news.
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label, updated_at) VALUES (?, ?, ?)')
      .run('w1', 'from peer', '2024-05-05T12:00:00.000Z');
    expect(stampOf(db, 'w1')).toBe('2024-05-05T12:00:00.000Z');
  });

  it('keeps an explicitly supplied stamp on update', () => {
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'local');

    db.prepare('UPDATE widgets SET label = ?, updated_at = ? WHERE id = ?')
      .run('from peer', '2024-05-05T12:00:00.000Z', 'w1');

    expect(stampOf(db, 'w1')).toBe('2024-05-05T12:00:00.000Z');
  });

  it('stamps composite-keyed rows independently', () => {
    const db = makeDb();
    db.prepare('INSERT INTO links (item_id, shop_id) VALUES (?, ?)').run('i1', 's1');
    db.prepare('INSERT INTO links (item_id, shop_id, updated_at) VALUES (?, ?, ?)')
      .run('i1', 's2', '2020-01-01T00:00:00.000Z');

    const rows = db.prepare('SELECT shop_id, updated_at FROM links ORDER BY shop_id').all();
    expect(rows[0].updated_at).not.toBeNull();
    expect(rows[1].updated_at).toBe('2020-01-01T00:00:00.000Z');
  });

  it('stamps only the row that changed', () => {
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label, updated_at) VALUES (?, ?, ?)')
      .run('w1', 'a', '2020-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO widgets (id, label, updated_at) VALUES (?, ?, ?)')
      .run('w2', 'b', '2020-01-01T00:00:00.000Z');

    db.prepare('UPDATE widgets SET label = ? WHERE id = ?').run('changed', 'w1');

    expect(stampOf(db, 'w1')).not.toBe('2020-01-01T00:00:00.000Z');
    expect(stampOf(db, 'w2')).toBe('2020-01-01T00:00:00.000Z');
  });

  it('leaves the stamp alone for a write inside the same millisecond', () => {
    // The deliberate trade that makes the update trigger self-terminating.
    // It is only safe because dbSyncChangesSince's lower bound is inclusive,
    // so a row still reports itself under the cursor it already carries.
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'a');
    const stamp = stampOf(db, 'w1');

    // Force the collision rather than racing the clock: put the row's stamp at
    // exactly the value the trigger would compute for this write.
    const now = db.prepare(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now`).get().now;
    db.prepare('UPDATE widgets SET updated_at = ? WHERE id = ?').run(now, 'w1');
    db.prepare('UPDATE widgets SET label = ? WHERE id = ?').run('b', 'w1');

    expect(stampOf(db, 'w1')).toBe(now);
    expect(typeof stamp).toBe('string');
  });

  it('terminates even with recursive triggers enabled', () => {
    // The WHEN guard is what stops this, not the pragma being off by default.
    // If that reasoning is ever wrong, this hangs or throws rather than
    // silently working until someone turns the pragma on.
    const db = makeDb();
    db.pragma('recursive_triggers = ON');
    expect(() => {
      db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'a');
      db.prepare('UPDATE widgets SET label = ? WHERE id = ?').run('b', 'w1');
    }).not.toThrow();
    expect(stampOf(db, 'w1')).not.toBeNull();
  });
});

describe('tombstones', () => {
  it('records a deletion', () => {
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'a');
    db.prepare('DELETE FROM widgets WHERE id = ?').run('w1');

    expect(tombstones(db)).toEqual([
      expect.objectContaining({ table_name: 'widgets', row_key: 'w1' }),
    ]);
  });

  it('joins a composite key into one row key', () => {
    const db = makeDb();
    db.prepare('INSERT INTO links (item_id, shop_id) VALUES (?, ?)').run('i1', 's1');
    db.prepare('DELETE FROM links WHERE item_id = ?').run('i1');

    expect(tombstones(db)[0]).toMatchObject({
      table_name: 'links',
      row_key: `i1${KEY_SEPARATOR}s1`,
    });
  });

  it('records one tombstone per row of a bulk delete', () => {
    const db = makeDb();
    for (const id of ['w1', 'w2', 'w3']) {
      db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run(id, 'x');
    }
    db.prepare('DELETE FROM widgets').run();

    expect(tombstones(db).map(t => t.row_key)).toEqual(['w1', 'w2', 'w3']);
  });

  it('clears the tombstone when a row is restored under its old id', () => {
    // shake-to-undo and bulkDeleteTasks both restore rows this way. A tombstone
    // surviving the restore would have the next sync delete them again on every
    // device — an undo that works locally and loses the data a minute later.
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'a');
    db.prepare('DELETE FROM widgets WHERE id = ?').run('w1');
    expect(tombstones(db)).toHaveLength(1);

    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'a');

    expect(tombstones(db)).toHaveLength(0);
  });

  it('keeps the latest deletion when a row is deleted, restored and deleted again', () => {
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'a');
    db.prepare('DELETE FROM widgets WHERE id = ?').run('w1');
    const first = tombstones(db)[0].deleted_at;

    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('w1', 'a');
    db.prepare("UPDATE " + SYNC_DELETIONS_TABLE + " SET deleted_at = '2020-01-01T00:00:00.000Z'").run();
    db.prepare('DELETE FROM widgets WHERE id = ?').run('w1');

    const rows = tombstones(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBe('2020-01-01T00:00:00.000Z');
    expect(typeof first).toBe('string');
  });

  it('does not confuse rows of the same id in different tables', () => {
    const db = makeDb();
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('shared', 'a');
    db.prepare('INSERT INTO links (item_id, shop_id) VALUES (?, ?)').run('shared', 's1');
    db.prepare('DELETE FROM widgets WHERE id = ?').run('shared');

    // Restoring the widget must not clear a tombstone belonging to links.
    db.prepare('DELETE FROM links WHERE item_id = ?').run('shared');
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('shared', 'a');

    expect(tombstones(db).map(t => t.table_name)).toEqual(['links']);
  });
});

describe('backfill', () => {
  it('stamps rows that predate tracking, and only those', () => {
    const db = new BetterSqlite3(':memory:');
    db.exec('CREATE TABLE widgets (id TEXT PRIMARY KEY NOT NULL, label TEXT)');
    db.prepare('INSERT INTO widgets (id, label) VALUES (?, ?)').run('old', 'a');

    // The real order: add the column, backfill, then install triggers.
    db.exec('ALTER TABLE widgets ADD COLUMN updated_at TEXT');
    expect(stampOf(db, 'old')).toBeNull();

    db.exec(`UPDATE widgets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL`);
    const backfilled = stampOf(db, 'old');

    for (const sql of deletionsTableStatements()) db.exec(sql);
    for (const sql of changeTrackingStatements(SIMPLE)) db.exec(sql);

    expect(backfilled).not.toBeNull();
    expect(stampOf(db, 'old')).toBe(backfilled);
  });

  it('emits one backfill per tracked table, all guarded on NULL', () => {
    const statements = backfillStatements();
    expect(statements).toHaveLength(SYNC_TRACKED_TABLES.length);
    for (const sql of statements) {
      expect(sql).toContain('WHERE updated_at IS NULL');
    }
  });
});

describe('pruning', () => {
  it('drops tombstones past the retention window and keeps the rest', () => {
    const db = makeDb();
    const insert = db.prepare(
      `INSERT INTO ${SYNC_DELETIONS_TABLE} (table_name, row_key, deleted_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))`
    );
    insert.run('widgets', 'ancient', `-${TOMBSTONE_RETENTION_DAYS + 1} days`);
    insert.run('widgets', 'recent', `-${TOMBSTONE_RETENTION_DAYS - 1} days`);

    db.prepare(
      `DELETE FROM ${SYNC_DELETIONS_TABLE}
        WHERE deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
    ).run(`-${TOMBSTONE_RETENTION_DAYS} days`);

    expect(tombstones(db).map(t => t.row_key)).toEqual(['recent']);
  });
});
