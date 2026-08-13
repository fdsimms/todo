/**
 * The SyncLocal the app actually runs with — the sync engine wired to SQLite.
 *
 * Its own module rather than part of syncEngine.ts so that the engine stays
 * free of any database import: pulling in database.ts drags in expo-sqlite,
 * which throws on sight in the `node` test environment, and the engine is
 * precisely the part most worth testing without one.
 */
import {
  dbApplySyncChanges,
  dbGetDeviceId,
  dbGetSyncCursor,
  dbSetSyncCursor,
  dbSyncChangesSince,
  isSyncableDatabase,
} from '../db/database';
import type { SyncLocal } from './syncEngine';

export function databaseSyncLocal(): SyncLocal {
  return {
    deviceId: dbGetDeviceId,
    isSyncable: isSyncableDatabase,
    changesSince: dbSyncChangesSince,
    apply: dbApplySyncChanges,
    getCursor: dbGetSyncCursor,
    setCursor: dbSetSyncCursor,
  };
}
