import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import {
  NO_RELEASES, SHIELD_RELEASES_SETTING, SHIELD_RELEASE_LOG_SETTING, parseReleaseLog,
  parseShieldReleases, withRecord, withReleased, type ReleaseRecord, type ShieldReleases,
} from '../utils/shieldRelease';

/**
 * What has been released early, and the record of each time it happened.
 *
 * Both live in the settings table and stay on this device (the sync allowlist
 * names settings that travel, and these are not on it): a gate task or a focus
 * session id means nothing on another phone, and a block ended here should not
 * read as ended there.
 *
 * The shield itself is not written here. `useAppShieldSync` watches this store
 * and `appShield.ts` decides; `releaseAllBlocks` (`utils/releaseBlocks.ts`) is
 * what calls into it, so the other reasons (the key lock, schedules, a penalty)
 * are ended where they already live and only a gate and a focus session need a
 * place to remember being released.
 *
 * Held in memory and written through, so demo mode has to `reload()` it when
 * the database swaps (see `useDemoStore`).
 */
interface ShieldReleaseStore {
  releases: ShieldReleases;
  log: ReleaseRecord[];
  initialize: () => void;
  /** Re-read from the current database, after a demo-mode swap. */
  reload: () => void;
  /** Remember a gate's or a focus session's block as ended, forgetting what no longer matters. */
  release: (
    added: { focusSessionId?: string | null; gateTaskIds?: readonly string[] },
    stillRelevant: { focusSessionId: string | null; outstandingGateIds: ReadonlySet<string> },
  ) => void;
  addRecord: (record: ReleaseRecord) => void;
}

function readState(): { releases: ShieldReleases; log: ReleaseRecord[] } {
  return {
    releases: parseShieldReleases(dbGetSetting(SHIELD_RELEASES_SETTING)),
    log: parseReleaseLog(dbGetSetting(SHIELD_RELEASE_LOG_SETTING)),
  };
}

export const useShieldReleaseStore = create<ShieldReleaseStore>((set, get) => ({
  releases: NO_RELEASES,
  log: [],

  initialize() {
    set(readState());
  },

  reload() {
    set(readState());
  },

  release(added, stillRelevant) {
    const releases = withReleased(get().releases, added, stillRelevant);
    dbSetSetting(SHIELD_RELEASES_SETTING, JSON.stringify(releases));
    set({ releases });
  },

  addRecord(record) {
    const log = withRecord(get().log, record);
    dbSetSetting(SHIELD_RELEASE_LOG_SETTING, JSON.stringify(log));
    set({ log });
  },
}));
