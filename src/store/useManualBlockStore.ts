import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import {
  MANUAL_BLOCK_SETTING, endsSooner, manualBlockWanted, manualMinutesProblem, newManualBlock, parseManualBlock, serializeManualBlock, type ManualBlock,
} from '../utils/manualBlock';

/**
 * The block the person started by hand, if one is running.
 *
 * Lives in the settings table and stays on this device (the sync allowlist
 * names settings that travel, and this is not on it): it holds a group id that
 * names apps only this phone can resolve, and a block started here must not
 * block another phone.
 *
 * The shield is not written here. `useAppShieldSync` watches this store and
 * `appShield.ts` decides. There is deliberately no `end` action reachable from
 * a button: ending early goes through `releaseAllBlocks`, which records it
 * (`utils/manualBlock.ts` says why). `clear` is for that function.
 *
 * Held in memory and written through, so demo mode has to `reload()` it when
 * the database swaps (see `useDemoStore`).
 */
interface ManualBlockStore {
  block: ManualBlock | null;
  initialize: () => void;
  /** Re-read from the current database, after a demo-mode swap. */
  reload: () => void;
  /** Start a block, timed or (with null minutes) open-ended. Refused (null) for a length the native window can't hold, or one that would end sooner than the block already running. */
  start: (minutes: number | null, groupIds: readonly string[], now?: Date) => ManualBlock | null;
  /** Drop the block. Only `releaseAllBlocks` calls this. */
  clear: () => void;
}

export const useManualBlockStore = create<ManualBlockStore>((set, get) => ({
  block: null,

  initialize() {
    set({ block: parseManualBlock(dbGetSetting(MANUAL_BLOCK_SETTING)) });
  },

  reload() {
    set({ block: parseManualBlock(dbGetSetting(MANUAL_BLOCK_SETTING)) });
  },

  start(minutes, groupIds, now = new Date()) {
    if (manualMinutesProblem(minutes)) return null;
    const block = newManualBlock(minutes, groupIds, now);
    // A running block can be lengthened but never shortened from here: a
    // shorter one would be a way to end it early that leaves no record.
    const running = get().block;
    if (running && manualBlockWanted(running, now) && endsSooner(block, running)) return null;
    dbSetSetting(MANUAL_BLOCK_SETTING, serializeManualBlock(block));
    set({ block });
    return block;
  },

  clear() {
    dbSetSetting(MANUAL_BLOCK_SETTING, '');
    set({ block: null });
  },
}));
