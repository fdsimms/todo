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
    // Recipe photos and task files share one namespace, and a task file's name
    // says which it is (`routeStoredFileName`), which is what routes each call.
    imageNames: () => [...recipeImageNames(), ...taskFileNames()],
    readImage: name => {
      const route = routeStoredFileName(name);
      if (route === 'task') return readTaskFileForSync(name);
      return readRecipeImageForSync(name);
    },
    writeImage: (name, data) => {
      const route = routeStoredFileName(name);
      if (route === 'task') return writeTaskFileFromSync(name, data);
      return writeRecipeImageFromSync(name, data);
    },
    hasImage: name => {
      const route = routeStoredFileName(name);
      if (route === 'task') return hasTaskFileForSync(name);
      return hasRecipeImageForSync(name);
    },
  };
}
