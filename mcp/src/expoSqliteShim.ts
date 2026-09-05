/**
 * `expo-sqlite`, reimplemented over better-sqlite3, so `src/db/database.ts`
 * runs in Node.
 *
 * This is not a port of anything. The db layer's only React Native dependency
 * is this one module, and the surface it actually uses is the five methods
 * below — which is why `src/__tests__/database.test.ts` has been standing the
 * whole layer up on better-sqlite3 since it was written. This file is that
 * mock, generalised to open a file instead of `:memory:` and to live outside
 * jest. Keep the two in step: a sixth method appearing in database.ts has to
 * appear here, and the test is where you will find out.
 *
 * See docs/arch/mcp-server.md for how it gets in front of the real package
 * (module cache priming, in replica.ts) and why that ordering is load-bearing.
 */
import BetterSqlite3 from 'better-sqlite3';

/** The slice of expo-sqlite's `SQLiteDatabase` that database.ts calls. */
export interface ShimDatabase {
  execSync(sql: string): void;
  runSync(sql: string, params?: unknown[]): { changes: number; lastInsertRowId: number };
  getAllSync<T>(sql: string, params?: unknown[]): T[];
  getFirstSync<T>(sql: string, params?: unknown[]): T | null;
  withTransactionSync(fn: () => void): void;
}

/** What `require('expo-sqlite')` resolves to once the shim is installed. */
export interface ShimModule {
  openDatabaseSync(name: string): ShimDatabase;
}

/**
 * better-sqlite3 binds a narrower set of types than expo-sqlite does: it
 * throws on `undefined` and on booleans, where the device path coerces them.
 * database.ts is already careful enough that the jest mock needs none of this
 * (booleans are stored as 0/1 by hand, per CLAUDE.md), so this exists to make
 * a mismatch a wrong value rather than a crashed server — the replica is read
 * from a long-running process, not a test that fails loudly.
 */
function bindable(params: unknown[]): unknown[] {
  return params.map(p => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

export function openShimDatabase(filePath: string): ShimDatabase {
  const raw = new BetterSqlite3(filePath);

  return {
    execSync(sql: string): void {
      raw.exec(sql);
    },

    // expo-sqlite and better-sqlite3 both report `changes`; only the casing of
    // the rowid differs. dbPurgeOldMealPlanEntries reads `changes` to say what
    // a purge took, so it has to survive the trip.
    runSync(sql: string, params: unknown[] = []) {
      const result = raw.prepare(sql).run(...bindable(params));
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
    },

    getAllSync<T>(sql: string, params: unknown[] = []): T[] {
      return raw.prepare(sql).all(...bindable(params)) as T[];
    },

    getFirstSync<T>(sql: string, params: unknown[] = []): T | null {
      return (raw.prepare(sql).get(...bindable(params)) as T | undefined) ?? null;
    },

    withTransactionSync(fn: () => void): void {
      raw.transaction(fn)();
    },
  };
}

/**
 * The module object to prime the require cache with. One handle for the whole
 * process: database.ts opens at module scope and never closes, and the name it
 * asks for is ignored because on device that name is resolved against the app's
 * own SQLite directory, which has no meaning here.
 *
 * Demo mode is the one caller that asks for a *different* name (`demo.db`), and
 * it is unreachable from the server: nothing here calls `enterDemoMode`, and
 * seeded fiction is not something a replica should ever be able to serve. If
 * that stops being true this is where it stops being true.
 */
export function shimModule(filePath: string): ShimModule {
  const handle = openShimDatabase(filePath);
  return { openDatabaseSync: () => handle };
}
