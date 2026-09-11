/**
 * The medication log as a file somebody else can read.
 *
 * `moodExport.ts` next door exists because the mood record is one somebody may
 * be about to show a doctor, and this is the same argument with more force
 * behind it: what you have taken, how much, and how often you reached for the
 * as-needed things is close to the first question asked in a consultation, and
 * until this module there was no way to get it off the device. A backup is the
 * wrong shape for exactly the reasons given there: it is JSON for `parseBackup`
 * to restore from, and it is the whole database, so handing one over means
 * handing over the shopping list too.
 *
 * Same four rules, and two of its own:
 *
 * - **Every dose is a row, oldest first, and nothing is derived.** No totals,
 *   no `frequencyTrend`, no "usually 400 mg". That last one is the sharpest
 *   version of `moodExport`'s rule: a typical dose is a *mode* over a history,
 *   and a spreadsheet cell holding one with none of that context reads as a
 *   prescription rather than as a summary of what happened.
 * - **`amount` and `unit` are separate columns.** "400 mg" in one cell cannot
 *   be summed, sorted or charted, and a record whose whole point is a quantity
 *   should hand over the quantity as a number. It also keeps the "no amount
 *   stated" case honest: an empty cell rather than a unit standing on its own.
 * - **`taskId` is not exported.** It is provenance, it is a base36 id that
 *   means nothing outside this database, and what it implies (scheduled rather
 *   than as-needed) the "Taken as needed" column already says in words. The
 *   rule that what leaves the device is what the user typed covers it.
 */

import { format } from 'date-fns/format';
import type { MedicationLog } from '../types';
import { csvCell } from './moodExport';

export const MEDICATION_EXPORT_COLUMNS = [
  'Day', 'Taken at', 'Medication', 'Amount', 'Unit', 'Taken as needed', 'Note',
] as const;

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * The whole export, as CSV text.
 *
 * The timestamp column is the dose's own ISO instant, and the day column beside
 * it is the app's logical day — the two differ by one for anybody whose day
 * does not start at midnight, which is why both are here. Same pair, and same
 * reason, as the mood export.
 */
export function medicationExportCsv(logs: readonly MedicationLog[]): string {
  const ordered = [...logs].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const rows = ordered.map(log => csvRow([
    log.dayKey,
    log.takenAt,
    log.name,
    log.amount === null ? '' : String(log.amount),
    log.unit ?? '',
    log.asNeeded ? 'yes' : 'no',
    log.note ?? '',
  ]));
  // A trailing newline: a spreadsheet importing a file without one is the usual
  // way a last row goes missing.
  return [csvRow(MEDICATION_EXPORT_COLUMNS), ...rows].join('\n') + '\n';
}

/** `medication-log-2026-09-11.csv` — dated, so two exports never collide. */
export function medicationExportFileName(exportedAt: Date): string {
  return `medication-log-${format(exportedAt, 'yyyy-MM-dd')}.csv`;
}

/**
 * "34 doses of 2 medications from Aug 12, 2026 to Sep 11, 2026" — what is
 * about to be shared, said before the share sheet opens rather than after.
 *
 * Names the number of medications as well as the number of doses, which the
 * mood summary has no counterpart for: a file of 34 rows is a very different
 * thing to hand somebody depending on whether it covers one medicine or nine,
 * and that is the first thing the reader will want to know.
 */
export function medicationExportSummary(logs: readonly MedicationLog[]): string {
  if (logs.length === 0) return 'Nothing recorded yet.';
  const days = logs.map(l => l.dayKey).sort();
  const names = new Set(logs.map(l => l.name.trim().toLowerCase()));
  const doses = `${logs.length} ${logs.length === 1 ? 'dose' : 'doses'}`;
  const of = `${names.size} ${names.size === 1 ? 'medication' : 'medications'}`;
  const from = format(new Date(`${days[0]}T12:00:00`), 'MMM d, yyyy');
  if (days[0] === days[days.length - 1]) return `${doses} of ${of} from ${from}.`;
  const to = format(new Date(`${days[days.length - 1]}T12:00:00`), 'MMM d, yyyy');
  return `${doses} of ${of} from ${from} to ${to}.`;
}
