import BetterSqlite3 from 'better-sqlite3';
import { openShimDatabase, STATEMENT_CACHE_SIZE } from '../expoSqliteShim';

describe('statement reuse', () => {
  // The bug: a statement prepared per call holds native memory V8 never feels,
  // so a first sync of a few thousand wide rows wedged a 512 MB machine.
  it('prepares each distinct SQL string once', () => {
    const spy = jest.spyOn(BetterSqlite3.prototype, 'prepare');
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)');
    for (let i = 0; i < 50; i++) db.runSync('INSERT INTO t (id, v) VALUES (?, ?)', [`r${i}`, i]);
    for (let i = 0; i < 50; i++) db.getFirstSync('SELECT v FROM t WHERE id = ?', [`r${i}`]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(db.getAllSync<{ v: number }>('SELECT v FROM t WHERE v < ?', [3]).map(r => r.v)).toEqual([0, 1, 2]);
    spy.mockRestore();
  });

  it('keeps no more than the cap, and still answers past it', () => {
    const spy = jest.spyOn(BetterSqlite3.prototype, 'prepare');
    const db = openShimDatabase(':memory:');
    for (let i = 0; i <= STATEMENT_CACHE_SIZE; i++) db.getFirstSync(`SELECT ${i} AS n`);
    // The first was evicted, so asking again prepares it afresh.
    expect(db.getFirstSync<{ n: number }>('SELECT 0 AS n')).toEqual({ n: 0 });
    expect(spy).toHaveBeenCalledTimes(STATEMENT_CACHE_SIZE + 2);
    spy.mockRestore();
  });

  it('sees a column added after a statement was cached', () => {
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT)');
    db.runSync('INSERT INTO t (id) VALUES (?)', ['a']);
    expect(db.getFirstSync('SELECT * FROM t')).toEqual({ id: 'a' });
    db.execSync('ALTER TABLE t ADD COLUMN v INTEGER DEFAULT 7');
    expect(db.getFirstSync('SELECT * FROM t')).toEqual({ id: 'a', v: 7 });
  });
});
