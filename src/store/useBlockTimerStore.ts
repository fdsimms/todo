import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import {
  BLOCK_SINCE_SETTING, nextBlockStamp, parseBlockStamp, type BlockStamp,
} from '../utils/blockTimer';
import type { ShieldReasonEntry } from '../utils/appShield';

/**
 * When the current run of blocking began (`utils/blockTimer.ts` has the rules).
 *
 * Kept in the settings table and off the sync allowlist: it describes what this
 * phone's shield has been doing. Held in memory and written through, so demo
 * mode has to `reload()` it when the database swaps (see `useDemoStore`).
 * Written only by `reconcileAppShield`, the one place that sees the shield change.
 */
interface BlockTimerStore {
  stamp: BlockStamp | null;
  initialize: () => void;
  /** Re-read from the current database, after a demo-mode swap. */
  reload: () => void;
  /** Record what a reconcile saw. A no-op when it changes nothing. */
  observe: (blocked: boolean, reasons: readonly ShieldReasonEntry[], now: Date) => void;
}

export const useBlockTimerStore = create<BlockTimerStore>((set, get) => ({
  stamp: null,

  initialize() {
    set({ stamp: parseBlockStamp(dbGetSetting(BLOCK_SINCE_SETTING)) });
  },

  reload() {
    set({ stamp: parseBlockStamp(dbGetSetting(BLOCK_SINCE_SETTING)) });
  },

  observe(blocked, reasons, now) {
    const prev = get().stamp;
    const stamp = nextBlockStamp(prev, blocked, reasons, now);
    if (stamp === prev) return;
    dbSetSetting(BLOCK_SINCE_SETTING, stamp ? JSON.stringify(stamp) : '');
    set({ stamp });
  },
}));
