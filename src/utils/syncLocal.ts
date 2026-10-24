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
import {
  dishPhotoNames,
  hasDishPhotoForSync,
  readDishPhotoForSync,
  writeDishPhotoFromSync,
} from './dishPhotoSync';

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
    // Recipe photos, task files and dish photos share one namespace, and a
    // task file's or dish photo's name says which it is (`routeStoredFileName`),
    // which is what routes each call.
    imageNames: () => [...recipeImageNames(), ...taskFileNames(), ...dishPhotoNames()],
    readImage: name => {
      const route = routeStoredFileName(name);
      if (route === 'task') return readTaskFileForSync(name);
      return route === 'dish' ? readDishPhotoForSync(name) : readRecipeImageForSync(name);
    },
    writeImage: (name, data) => {
      const route = routeStoredFileName(name);
      if (route === 'task') return writeTaskFileFromSync(name, data);
      return route === 'dish' ? writeDishPhotoFromSync(name, data) : writeRecipeImageFromSync(name, data);
    },
    hasImage: name => {
      const route = routeStoredFileName(name);
      if (route === 'task') return hasTaskFileForSync(name);
      return route === 'dish' ? hasDishPhotoForSync(name) : hasRecipeImageForSync(name);
    },
  };
}
