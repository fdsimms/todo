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
interface WatchHealthStore {
  requests: WatchHealthRequests;
  /** Read the lists from the current database. Safe to call again; also what demo mode calls. */
  reload: () => void;
  /** Asks the watch to retract these Health workouts, each once. */
  retract: (workoutIds: readonly string[]) => void;
  /** The watch has dealt with one (deleted it, or found it gone). */
  retracted: (workoutId: string) => void;
  /** Asks the watch to throw away its measurement of this session, if it is taking one. */
  drop: (sessionId: string) => void;
}

const read = (): WatchHealthRequests => parseWatchHealthRequests(dbGetSetting(WATCH_HEALTH_REQUESTS_SETTING));

export const useWatchHealthStore = create<WatchHealthStore>(set => {
  const write = (requests: WatchHealthRequests) => {
    dbSetSetting(WATCH_HEALTH_REQUESTS_SETTING, JSON.stringify(requests));
    set({ requests });
  };
  return {
    requests: NO_WATCH_HEALTH_REQUESTS,

    reload() {
      set({ requests: currentWatchHealthRequests(read(), new Date()) });
    },

    retract(workoutIds) {
      const before = read();
      const next = withRetractions(before, workoutIds, new Date());
      if (next !== before) write(next);
    },

    retracted(workoutId) {
      const before = read();
      const next = withoutRetraction(before, workoutId);
      if (next !== before) write(next);
    },

    drop(sessionId) {
      write(withDrop(read(), sessionId, new Date()));
    },
  };
});
