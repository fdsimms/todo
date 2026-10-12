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

export const JOURNAL_EXPORT_COLUMNS = ['Day', 'Written at', 'Text', 'Tags', 'People'] as const;

/** Resolves a `Person.id` to the name to print, or null for one that no longer exists. */
export type PersonNamer = (id: string) => string | null;

function peopleOf(entry: JournalEntry, personName: PersonNamer | undefined): string[] {
  return (entry.personIds ?? []).map(id => personName?.(id) ?? null).filter((n): n is string => n !== null);
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/** One kind's entries as CSV text, oldest first. */
export function journalExportCsv(entries: readonly JournalEntry[], kind: JournalKind, personName?: PersonNamer): string {
  const rows = entries
    .filter(e => e.kind === kind)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
    .map(e => csvRow([e.dayKey, e.loggedAt, e.text, (e.tags ?? []).join('; '), peopleOf(e, personName).join('; ')]));
  // A trailing newline, for the reason the mood export ends on one.
  return [csvRow(JOURNAL_EXPORT_COLUMNS), ...rows].join('\n') + '\n';
}

/**
 * One kind's entries as a Markdown document, oldest first: a heading per day,
 * and under it each entry with its time. The text goes out as it was typed,
 * which is already Markdown, so a heading or a list in an entry carries over.
 * Tags and people are a line under the entry when it has any. The day's own
 * heading is level 2 and the entries sit under it, so an entry's `#` heading
 * is pushed down two levels to stay below it.
 */
export function journalExportMarkdown(
  entries: readonly JournalEntry[],
  kind: JournalKind,
  personName?: PersonNamer,
): string {
  const mine = entries
    .filter(e => e.kind === kind)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const lines: string[] = [`# ${kind === 'dream' ? 'Dreams' : 'Journal'}`, ''];
  let currentDay: string | null = null;
  for (const e of mine) {
    if (e.dayKey !== currentDay) {
      currentDay = e.dayKey;
      lines.push(`## ${format(new Date(`${e.dayKey}T12:00:00`), 'EEEE, MMMM d, yyyy')}`, '');
    }
    lines.push(`*${format(new Date(e.loggedAt), 'h:mm a')}*`, '', demoteHeadings(e.text), '');
    const people = peopleOf(e, personName);
    const meta = [
      ...(people.length > 0 ? [`About ${people.join(', ')}`] : []),
      ...((e.tags ?? []).length > 0 ? [`Tags: ${(e.tags ?? []).join(', ')}`] : []),
    ];
    if (meta.length > 0) lines.push(`*${meta.join(' · ')}*`, '');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

/** Pushes an entry's own `#` headings below the day heading it sits under. */
function demoteHeadings(text: string): string {
  return text.replace(/^#{1,6}(?=\s)/gm, marks => '#'.repeat(Math.min(6, marks.length + 2)));
}

export type JournalExportFormat = 'csv' | 'markdown';

/** `journal-2026-10-06.csv` / `dreams-2026-10-06.md`, dated so two exports never collide. */
export function journalExportFileName(kind: JournalKind, exportedAt: Date, fileFormat: JournalExportFormat = 'csv'): string {
  return `${kind === 'dream' ? 'dreams' : 'journal'}-${format(exportedAt, 'yyyy-MM-dd')}.${fileFormat === 'markdown' ? 'md' : 'csv'}`;
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
