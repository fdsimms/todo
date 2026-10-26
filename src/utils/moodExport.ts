/**
 * The mood log as a file somebody else can read.
 *
 * `mood-log.md` says the app has no business folding two spellings of a
 * symptom together because the chart is one "somebody may be about to show a
 * doctor" — and until this module there was no way to show anybody anything.
 * A backup is the wrong shape for it twice over: it is JSON meant for
 * `parseBackup` to restore from, and it is the *whole database*, so handing one
 * to a clinician means handing over the shopping list and everybody's birthday
 * as well.
 *
 * So: CSV, one row per entry, only the mood log, and only the range the user
 * picked. Four rules hold it:
 *
 * - **Every entry is a row, and no day is collapsed.** The screens average a
 *   day because a screen has to show one number; a record has no such excuse,
 *   and the morning that was fine is part of what happened. This is the one
 *   read of the log with no `dayMoodAverage` in it.
 * - **Oldest first**, unlike every list in the app. A record is read forwards.
 * - **Nothing is derived.** No averages, no streaks, no correlations, and
 *   above all none of `moodInsights.ts` — those are associations, they carry
 *   their sample size and their hedging in the UI around them, and a
 *   spreadsheet cell holding "moderate" with no such context is exactly the
 *   overclaim that file exists to prevent. What leaves the device is what the
 *   user typed.
 * - **The scale is spelled out.** "2" means nothing on a page on its own, so
 *   the mood column carries the number and the label beside it, and severity
 *   is written as its word.
 */

import { format } from 'date-fns/format';
import type { MoodLog } from '../types';
import { moodLabel, severityLabel } from './moodLog';

export const MOOD_EXPORT_COLUMNS = [
  'Day', 'Logged at', 'Mood', 'Mood label', 'Symptoms', 'Context', 'Note',
] as const;

/**
 * One CSV cell, quoted when it has to be.
 *
 * Quotes everything containing a comma, a quote or a newline, and doubles the
 * quotes inside — RFC 4180, which is what a spreadsheet expects. A note is
 * free text the user typed, so all three are ordinary rather than edge cases:
 * "Long day, skipped lunch" is the first note in the demo seed and would split
 * into two columns unquoted.
 */
export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/** "Headache (severe); Poor sleep (mild)" — the symptom column. */
function symptomCell(log: MoodLog): string {
  return log.symptoms
    .map(s => `${s.name} (${severityLabel(s.severity).toLowerCase()})`)
    .join('; ');
}

/**
 * The whole export, as CSV text.
 *
 * The timestamp column is the entry's own ISO instant rather than a formatted
 * time: a spreadsheet can parse it, a person can read it, and it carries the
 * offset, which matters for a log whose entire point is which part of the day
 * something happened in. The day column beside it is the app's logical day
 * (see `MoodLog.dayKey`) and the two can differ by one for anybody whose day
 * does not start at midnight, which is exactly why both are here.
 */
export function moodExportCsv(logs: readonly MoodLog[]): string {
  const ordered = [...logs].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const rows = ordered.map(log => csvRow([
    log.dayKey,
    log.loggedAt,
    log.mood === null ? '' : String(log.mood),
    log.mood === null ? '' : moodLabel(log.mood),
    symptomCell(log),
    log.contextTags.join('; '),
    log.note ?? '',
  ]));
  // A trailing newline: a text file ends with one, and a spreadsheet importing
  // a file without one is the usual way a last row goes missing.
  return [csvRow(MOOD_EXPORT_COLUMNS), ...rows].join('\n') + '\n';
}

/** `mood-log-2026-09-09.csv` — dated, so two exports never collide in Files. */
export function moodExportFileName(exportedAt: Date): string {
  return `mood-log-${format(exportedAt, 'yyyy-MM-dd')}.csv`;
}

/**
 * "128 entries from Mar 3, 2026 to Sep 9, 2026" — what is about to be shared.
 *
 * Said before the share sheet opens rather than after, because the range picker
 * offers windows and the honest thing to confirm is what the file actually
 * holds, not what was asked for: a person picking "last 3 months" two weeks
 * after installing should see that they are sending two weeks.
 */
export function moodExportSummary(logs: readonly MoodLog[]): string {
  if (logs.length === 0) return 'No entries in this range.';
  const days = logs.map(l => l.dayKey).sort();
  const entries = `${logs.length} ${logs.length === 1 ? 'entry' : 'entries'}`;
  const from = format(new Date(`${days[0]}T12:00:00`), 'MMM d, yyyy');
  if (days[0] === days[days.length - 1]) return `${entries} from ${from}.`;
  const to = format(new Date(`${days[days.length - 1]}T12:00:00`), 'MMM d, yyyy');
  return `${entries} from ${from} to ${to}.`;
}
