import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import {
  NO_WATCH_HEALTH_REQUESTS,
  WATCH_HEALTH_REQUESTS_SETTING,
  currentWatchHealthRequests,
  parseWatchHealthRequests,
  withDrop,
  withRetractions,
  withoutRetraction,
  type WatchHealthRequests,
} from '../utils/watchHealthWorkout';

/**
 * What the phone is asking the Apple Watch to do about the workouts the watch
 * saved to Health (see `watchHealthWorkout.ts`): retract some, and throw away
 * a measurement whose workout was deleted. The watch reads both lists from its
 * workout section of the snapshot and answers a retraction with a tap.
 *
 * Device-local, in the settings table, the shape `useWatchClashStore` has and
 * for its reasons: a delete can run in a background launch that never loaded
 * this, so every write reads the stored lists first rather than trusting
 * memory, and demo mode `reload()`s it when the database swaps. Held in memory
 * too, so the watch's snapshot is written again when the lists change.
 */
/**
 * How many retracted workouts the watch found nothing to delete for, not yet
 * told to the person (`useWatchRetractNotice`). Device-local, like the lists.
 */
const NOT_FOUND_SETTING = 'watchRetractNotFound';

interface WatchHealthStore {
  requests: WatchHealthRequests;
  /** Workouts the watch couldn't find to delete, so they may still be in Health. */
  notFound: number;
  /** Read the lists from the current database. Safe to call again; also what demo mode calls. */
  reload: () => void;
  /** Asks the watch to retract these Health workouts, each once. */
  retract: (workoutIds: readonly string[]) => void;
  /**
   * The watch has dealt with one: deleted it, or found nothing to delete by
   * its id (`notFound`), which is counted once for the person to be told.
   */
  retracted: (workoutId: string, notFound?: boolean) => void;
  /** The person has been told about the ones not found. */
  clearNotFound: () => void;
  /** Asks the watch to throw away its measurement of this session, if it is taking one. */
  drop: (sessionId: string) => void;
}

const read = (): WatchHealthRequests => parseWatchHealthRequests(dbGetSetting(WATCH_HEALTH_REQUESTS_SETTING));
const readNotFound = (): number => {
  const n = Number(dbGetSetting(NOT_FOUND_SETTING) ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export const useWatchHealthStore = create<WatchHealthStore>(set => {
  const write = (requests: WatchHealthRequests) => {
    dbSetSetting(WATCH_HEALTH_REQUESTS_SETTING, JSON.stringify(requests));
    set({ requests });
  };
  return {
    requests: NO_WATCH_HEALTH_REQUESTS,
    notFound: 0,

    reload() {
      set({ requests: currentWatchHealthRequests(read(), new Date()), notFound: readNotFound() });
    },

    retract(workoutIds) {
      const before = read();
      const next = withRetractions(before, workoutIds, new Date());
      if (next !== before) write(next);
    },

    retracted(workoutId, notFound = false) {
      const before = read();
      const next = withoutRetraction(before, workoutId);
      if (next === before) return;
      write(next);
      // Counted only while it was on the list, so a tap delivered twice says it once.
      if (notFound) {
        const count = readNotFound() + 1;
        dbSetSetting(NOT_FOUND_SETTING, String(count));
        set({ notFound: count });
      }
    },

    clearNotFound() {
      dbSetSetting(NOT_FOUND_SETTING, '0');
      set({ notFound: 0 });
    },

    drop(sessionId) {
      write(withDrop(read(), sessionId, new Date()));
    },
  };
});
