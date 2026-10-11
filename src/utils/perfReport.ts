/**
 * Saves and reads the performance log (`perfLog.ts`) through the settings
 * table. A device-local key: it is not in SYNCED_SETTING_KEYS, so it never
 * travels to a peer.
 */
import { dbGetSetting, dbSetSetting } from '../db/database';
import {
  appendRun,
  currentEntries,
  formatPerfReport,
  parseRuns,
  takeEntries,
  type PerfRunKind,
} from './perfLog';

const PERF_RUNS_KEY = 'perf_runs';

/**
 * Saves what has been recorded as one run and starts a new one. Does nothing
 * when nothing was recorded, so an idle call costs no write. Never throws:
 * a diagnostic must not be the reason a launch fails.
 */
export function savePerfRun(kind: PerfRunKind): void {
  try {
    const entries = takeEntries();
    if (entries.length === 0) return;
    const runs = parseRuns(dbGetSetting(PERF_RUNS_KEY));
    dbSetSetting(PERF_RUNS_KEY, JSON.stringify(appendRun(runs, { at: new Date().toISOString(), kind, entries })));
  } catch (error) {
    console.error('Could not save the performance log', error);
  }
}

/** The report to copy: saved runs plus anything recorded since. */
export function perfReportText(): string {
  let runs = parseRuns(null);
  try {
    runs = parseRuns(dbGetSetting(PERF_RUNS_KEY));
  } catch {
    // The report still has the current session to show.
  }
  return formatPerfReport(runs, currentEntries());
}
