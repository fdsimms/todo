/**
 * The journal or the dream log as a file — the mood and medication exports'
 * shape (`moodExport.ts`, `medicationExport.ts`) over `JournalEntry`.
 *
 * One kind per file, since the share action lives on each kind's own screen.
 * Every entry is a row, oldest first, and nothing is derived: what leaves the
 * device is what the person wrote, with the day it files under and the instant
 * it was written beside it (the two differ for anybody whose day does not start
 * at midnight, which is why both are here).
 */

import { format } from 'date-fns/format';
import type { JournalEntry, JournalKind } from '../types';
import { csvCell } from './moodExport';

export const JOURNAL_EXPORT_COLUMNS = ['Day', 'Written at', 'Text'] as const;

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/** One kind's entries as CSV text, oldest first. */
export function journalExportCsv(entries: readonly JournalEntry[], kind: JournalKind): string {
  const rows = entries
    .filter(e => e.kind === kind)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
    .map(e => csvRow([e.dayKey, e.loggedAt, e.text]));
  // A trailing newline, for the reason the mood export ends on one.
  return [csvRow(JOURNAL_EXPORT_COLUMNS), ...rows].join('\n') + '\n';
}

/** `journal-2026-10-06.csv` / `dreams-2026-10-06.csv`, dated so two exports never collide. */
export function journalExportFileName(kind: JournalKind, exportedAt: Date): string {
  return `${kind === 'dream' ? 'dreams' : 'journal'}-${format(exportedAt, 'yyyy-MM-dd')}.csv`;
}

/** "12 dreams from Aug 12, 2026 to Oct 6, 2026", said before the share sheet opens. */
export function journalExportSummary(entries: readonly JournalEntry[], kind: JournalKind): string {
  const mine = entries.filter(e => e.kind === kind);
  if (mine.length === 0) return 'Nothing written yet.';
  const noun = kind === 'dream'
    ? (mine.length === 1 ? 'dream' : 'dreams')
    : (mine.length === 1 ? 'journal entry' : 'journal entries');
  const days = mine.map(e => e.dayKey).sort();
  const from = format(new Date(`${days[0]}T12:00:00`), 'MMM d, yyyy');
  if (days[0] === days[days.length - 1]) return `${mine.length} ${noun} from ${from}.`;
  const to = format(new Date(`${days[days.length - 1]}T12:00:00`), 'MMM d, yyyy');
  return `${mine.length} ${noun} from ${from} to ${to}.`;
}
