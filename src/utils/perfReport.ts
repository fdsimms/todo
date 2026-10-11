/**
 * Saves and reads the performance log (`perfLog.ts`) through the settings
 * table. A device-local key: it is not in SYNCED_SETTING_KEYS, so it never
 * travels to a peer.
 */
import { dbGetSetting, dbSetSetting } from '../db/database';
import { isDemoModeActive } from './demoState';
import { readDevicePayloads } from './deviceMetrics';
import { collectSummaries, formatDeviceMetrics, parseSummaries, type DeviceMetricSummary } from './metricKit';
import {
  appendRun,
  currentEntries,
  formatPerfReport,
  parseRuns,
  takeEntries,
  type PerfRunKind,
} from './perfLog';

const PERF_RUNS_KEY = 'perf_runs';
const DEVICE_METRICS_KEY = 'device_metrics';

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

/**
 * Reads the daily reports iOS has delivered, folds them into the saved
 * summaries and writes them back if there is anything new. Returns what is
 * saved. Never throws, for the same reason savePerfRun doesn't. In demo mode
 * it returns what it finds without saving, since the demo database is thrown
 * away.
 */
export function collectDeviceMetrics(): DeviceMetricSummary[] {
  let saved: DeviceMetricSummary[] = [];
  try {
    saved = parseSummaries(dbGetSetting(DEVICE_METRICS_KEY));
    const { summaries, changed } = collectSummaries(saved, readDevicePayloads());
    if (changed && !isDemoModeActive()) dbSetSetting(DEVICE_METRICS_KEY, JSON.stringify(summaries));
    return summaries;
  } catch (error) {
    console.error('Could not read device metrics', error);
    return saved;
  }
}

/** The report to copy: saved runs plus anything recorded since, then what iOS measured. */
export function perfReportText(): string {
  let runs = parseRuns(null);
  try {
    runs = parseRuns(dbGetSetting(PERF_RUNS_KEY));
  } catch {
    // The report still has the current session to show.
  }
  return `${formatPerfReport(runs, currentEntries())}\n\n${formatDeviceMetrics(collectDeviceMetrics())}`;
}
