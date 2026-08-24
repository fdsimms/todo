import { create } from 'zustand';
import { dbDeleteSetting, dbGetSetting, dbSetSetting } from '../db/database';
import {
  mergeSharedLinks,
  parseSharedLinkQueue,
  serializeSharedLinkQueue,
} from '../utils/sharedRecipeLinks';

/**
 * Recipe pages shared into the app from another app's share sheet, waiting for
 * someone to import them — the queue behind the "shared link waiting" row on the
 * Recipes screen. Filled by `useSharedRecipeLinks`, emptied by the user.
 *
 * **It persists, and it has to.** The native side hands the queue over by
 * reading the App Group file and *deleting* it (`drainSharedLinks`), which is
 * the only way a page shared once doesn't queue again on every launch. That
 * makes this store the sole remaining copy the moment the drain returns, so a
 * force-quit before the user gets round to tapping the row would otherwise lose
 * a recipe they'd explicitly saved. Written through to the `settings` table on
 * every change, same key/value store the tag registry uses.
 *
 * Deliberately its own store rather than a field on `useRecipeStore`: nothing
 * here is a recipe yet, and a queue of addresses has none of the identity rules
 * (`nameKey` uniqueness, ingredient reconciliation) that store exists to keep.
 * The shape is `useWidgetCompletionStore`'s — an inbox from a second process,
 * drained into the UI — plus the persistence that one doesn't need, since a
 * dropped widget tap is a tap and a dropped share is a recipe.
 */
const SETTINGS_KEY = 'sharedRecipeLinks';

interface SharedLinkState {
  pendingUrls: string[];
  /** Whether the persisted queue has been read back yet this launch. */
  hydrated: boolean;
  /** Reads the persisted queue. Safe to call twice; the second is a no-op. */
  hydrate: () => void;
  /**
   * Re-reads the queue from whichever database is now live — what demo mode
   * calls on the way in and the way out (`useDemoStore`).
   *
   * Required rather than tidy. This is the one queue that lives in memory *and*
   * writes through to the `settings` table, so without it the real queue would
   * still be on screen inside the demo, and the next Discard there would write
   * the real queue into the scratch database (or, on the way out, the demo's
   * invented link into the real one). Every other store gets this for free from
   * its own `initialize()`.
   */
  reload: () => void;
  /** Adds freshly drained addresses, canonicalising and de-duplicating. */
  enqueue: (urls: string[]) => void;
  /** Drops one address — imported, or dismissed from the row. */
  dismiss: (url: string) => void;
  clear: () => void;
}

function persist(urls: string[]): void {
  // A queue that's gone deletes its row rather than storing "[]" — same
  // treatment an emptied registry gets, and it keeps the settings table honest
  // about which features have ever been used.
  if (urls.length === 0) dbDeleteSetting(SETTINGS_KEY);
  else dbSetSetting(SETTINGS_KEY, serializeSharedLinkQueue(urls));
}

export const useSharedLinkStore = create<SharedLinkState>((set, get) => ({
  pendingUrls: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ pendingUrls: parseSharedLinkQueue(dbGetSetting(SETTINGS_KEY)), hydrated: true });
  },

  reload: () => {
    set({ pendingUrls: parseSharedLinkQueue(dbGetSetting(SETTINGS_KEY)), hydrated: true });
  },

  enqueue: urls => {
    if (urls.length === 0) return;
    const merged = mergeSharedLinks(get().pendingUrls, urls);
    // Reference equality matters: the Recipes screen subscribes to this array,
    // and a share of something already queued shouldn't re-render it.
    if (merged.length === get().pendingUrls.length &&
        merged.every((url, i) => url === get().pendingUrls[i])) {
      return;
    }
    set({ pendingUrls: merged });
    persist(merged);
  },

  dismiss: url => {
    const remaining = get().pendingUrls.filter(pending => pending !== url);
    if (remaining.length === get().pendingUrls.length) return;
    set({ pendingUrls: remaining });
    persist(remaining);
  },

  clear: () => {
    if (get().pendingUrls.length === 0) return;
    set({ pendingUrls: [] });
    persist([]);
  },
}));
