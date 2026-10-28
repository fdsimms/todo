import { create } from 'zustand';
import { dbDeleteSetting, dbGetSetting, dbSetSetting } from '../db/database';
import {
  REMINDER_REMOVAL_KEEP_DAYS,
  addReminderRemovals,
  liveReminderRemovals,
  parseReminderRemovals,
  reminderPurchaseTime,
  serializeReminderRemovals,
  type ReminderRemoval,
} from '../utils/reminderRemovals';
import { useGroceryStore } from './useGroceryStore';

/**
 * Grocery rows the Reminders mirror took off the list, waiting for the person
 * to say which were bought. Filled by `mirrorOnce` (`remindersImportSync.ts`),
 * answered from `ReminderRemovalsCard`. The rules are in `reminderRemovals.ts`.
 *
 * In the `groceryImport*` settings family, which `isSyncedSettingKey` leaves
 * off the wire, for the reason the mirror's own links are: only this device
 * saw the reminder go. Its own store rather than a field on `useGroceryStore`
 * because nothing here is a grocery row; it's the shape of `useSharedLinkStore`,
 * a queue in memory written through to the settings table.
 */
const SETTINGS_KEY = 'groceryImportRemovals';

const DAY_MS = 24 * 60 * 60 * 1000;

interface ReminderRemovalState {
  removals: ReminderRemoval[];
  /** Whether the persisted record has been read back yet this launch. */
  hydrated: boolean;
  /** Reads the persisted record. Safe to call twice; the second is a no-op. */
  hydrate: () => void;
  /**
   * Re-reads the record from whichever database is now live: what demo mode
   * and a restore call (`useDemoStore`), for `useSharedLinkStore.reload`'s
   * reason. Without it a demo's Bought would write the real record's rows as
   * purchases into the scratch database.
   */
  reload: () => void;
  /** One mirror pass's removals. `removedAt` defaults to now. */
  record: (removed: readonly { itemId: string; checked: boolean }[], removedAt?: string) => void;
  /**
   * The card's answer about the rows it showed. `boughtIds` are recorded as a
   * purchase through `finishShopping`, which is what puts them in the pantry,
   * and every other shown row is forgotten. Returns how many were recorded.
   *
   * A bought row is left in the record rather than deleted: the purchase is
   * what retires it (`liveReminderRemovals`), so undoing the purchase brings
   * the question back instead of losing it.
   */
  answer: (boughtIds: readonly string[], shownIds: readonly string[]) => number;
}

/**
 * Writes the record, dropping anything past the window so it can't grow
 * without bound. Only the age is pruned here; the rest of what
 * `liveReminderRemovals` checks is read-time, because it can change back.
 */
function persist(removals: readonly ReminderRemoval[], now: Date): ReminderRemoval[] {
  const cutoff = now.getTime() - REMINDER_REMOVAL_KEEP_DAYS * DAY_MS;
  const kept = removals.filter(r => Date.parse(r.removedAt) >= cutoff);
  if (kept.length === 0) dbDeleteSetting(SETTINGS_KEY);
  else dbSetSetting(SETTINGS_KEY, serializeReminderRemovals(kept));
  return kept;
}

export const useReminderRemovalStore = create<ReminderRemovalState>((set, get) => ({
  removals: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    get().reload();
  },

  reload: () => {
    set({ removals: parseReminderRemovals(dbGetSetting(SETTINGS_KEY)), hydrated: true });
  },

  record: (removed, removedAt = new Date().toISOString()) => {
    if (removed.length === 0) return;
    get().hydrate();
    const next = addReminderRemovals(get().removals, removed, removedAt);
    set({ removals: persist(next, new Date()) });
  },

  answer: (boughtIds, shownIds) => {
    get().hydrate();
    const now = new Date();
    const wanted = new Set(boughtIds);
    const bought = liveReminderRemovals(get().removals, useGroceryStore.getState().items, now)
      .filter(r => wanted.has(r.itemId));
    let recorded = 0;
    if (bought.length > 0) {
      recorded = useGroceryStore.getState().finishShopping(
        null,
        {},
        reminderPurchaseTime(bought, now),
        undefined,
        {},
        { itemIds: bought.map(r => r.itemId) }
      );
    }
    const forgotten = new Set(shownIds.filter(id => !wanted.has(id)));
    if (forgotten.size > 0) {
      const next = get().removals.filter(r => !forgotten.has(r.itemId));
      set({ removals: persist(next, now) });
    }
    return recorded;
  },
}));
