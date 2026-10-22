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
import {
  applyWithRecipeImages,
  hasRecipeImageForSync,
  readRecipeImageForSync,
  recipeImageNames,
  writeRecipeImageFromSync,
} from './recipeImageSync';
import {
  hasTaskFileForSync,
  readTaskFileForSync,
  routeStoredFileName,
  taskFileNames,
  writeTaskFileFromSync,
} from './taskFileSync';

export function databaseSyncLocal(): SyncLocal {
  return {
    deviceId: dbGetDeviceId,
    isSyncable: isSyncableDatabase,
    changesSince: dbSyncChangesSince,
    // Wrapped so a recipe photo a peer stopped pointing at loses its file too
    // (#2704); the rows themselves are applied exactly as before.
    apply: (payload, transport) => applyWithRecipeImages(payload, transport, dbApplySyncChanges),
    getCursor: dbGetSyncCursor,
    setCursor: dbSetSyncCursor,
    // Recipe photos and task files share one namespace, and a task file's
    // name says it is one (taskFileSync.ts), which is what routes each call.
    imageNames: () => [...recipeImageNames(), ...taskFileNames()],
    readImage: name => (routeStoredFileName(name) === 'task' ? readTaskFileForSync(name) : readRecipeImageForSync(name)),
    writeImage: (name, data) => (routeStoredFileName(name) === 'task' ? writeTaskFileFromSync(name, data) : writeRecipeImageFromSync(name, data)),
    hasImage: name => (routeStoredFileName(name) === 'task' ? hasTaskFileForSync(name) : hasRecipeImageForSync(name)),
  };
}
