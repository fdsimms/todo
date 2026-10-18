import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import {
  WATCH_CLASHES_SETTING,
  parseWatchClashes,
  withClash,
  withoutClash,
  type WatchClash,
} from '../utils/watchWorkoutClash';

/**
 * The "Keep both workouts?" questions still to ask (see
 * `watchWorkoutClash.ts`). A watch workout can arrive with the app in the
 * background, where nobody can be asked, so the pair waits here, in the
 * settings table, until `useWatchClashPrompt` asks it with the app in front.
 *
 * Device-local (the sync allowlist doesn't name it): the question is about
 * what reached this phone. Every write reads the stored list first rather
 * than trusting memory, so a cold background launch that never loaded it
 * still adds to it rather than over it. Held in memory too, for the hook to
 * watch, so demo mode `reload()`s it when the database swaps (`useDemoStore`).
 */
interface WatchClashStore {
  pending: WatchClash[];
  /** Read the list from the current database. Safe to call again; also what demo mode calls. */
  reload: () => void;
  /** Adds a pair, once. */
  record: (clash: WatchClash) => void;
  /** Takes a pair off the list, with any other pair naming a session in `deleted`. */
  resolve: (clash: WatchClash, deleted?: readonly string[]) => void;
}

const read = (): WatchClash[] => parseWatchClashes(dbGetSetting(WATCH_CLASHES_SETTING));

export const useWatchClashStore = create<WatchClashStore>(set => ({
  pending: [],

  reload() {
    set({ pending: read() });
  },

  record(clash) {
    const pending = withClash(read(), clash);
    dbSetSetting(WATCH_CLASHES_SETTING, JSON.stringify(pending));
    set({ pending });
  },

  resolve(clash, deleted = []) {
    const pending = withoutClash(read(), clash, deleted);
    dbSetSetting(WATCH_CLASHES_SETTING, JSON.stringify(pending));
    set({ pending });
  },
}));
