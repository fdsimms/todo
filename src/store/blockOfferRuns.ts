import { dbGetSetting, dbSetSetting } from '../db/database';
import {
  BLOCK_OFFER_RUNS_SETTING, parseBlockOfferRuns, serializeBlockOfferRuns, type BlockOfferRun,
} from '../utils/blockOfferTasks';

/**
 * The accepted block offers, read and written straight through the settings
 * table. Not a Zustand store: nothing renders from it, and the demo-mode
 * database swap needs no `reload()` when every read goes to the current
 * database. Device-local (not in the sync allowlist), because the block a run
 * describes only exists on the phone that started it.
 */
export function readBlockOfferRuns(): BlockOfferRun[] {
  return parseBlockOfferRuns(dbGetSetting(BLOCK_OFFER_RUNS_SETTING));
}

export function writeBlockOfferRuns(runs: readonly BlockOfferRun[]): void {
  dbSetSetting(BLOCK_OFFER_RUNS_SETTING, serializeBlockOfferRuns(runs));
}
