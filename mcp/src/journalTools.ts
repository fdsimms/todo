/**
 * The journal and the dream log (docs/arch/journal.md): what the person wrote,
 * one kind at a time or both.
 *
 * Every write goes through `useJournalStore`'s own actions, by way of the
 * replica, so blank text is refused as the sheet refuses it and an entry's day
 * is fixed once written. Nothing here reads an entry for what it means: the
 * app derives nothing from either kind, and neither should a reply about them.
 */
import type { JournalEntry, JournalKind } from '../../src/types';
import type { Replica } from './replica';
import { atFrom } from './logTools';
import { resolveRange, type DayRange, type LogRangeInput } from './tools';

export interface JournalRow {
  id: string;
  kind: JournalKind;
  /** `YYYY-MM-DD`, the day it files under (a dream: the day they woke). */
  day: string;
  loggedAt: string;
  text: string;
}

function row(entry: JournalEntry): JournalRow {
  return { id: entry.id, kind: entry.kind, day: entry.dayKey, loggedAt: entry.loggedAt, text: entry.text };
}

export function listJournalEntries(
  replica: Replica,
  input: LogRangeInput & { kind?: JournalKind } = {},
): { range: DayRange; entries: JournalRow[] } {
  const range = resolveRange(replica, input);
  return { range, entries: replica.journalEntries(range.from, range.to, input.kind).map(row) };
}

export function logJournalEntry(
  replica: Replica,
  input: { kind: JournalKind; text: string; at?: string },
): { entry: JournalRow } {
  return { entry: row(replica.addJournalEntry(input.kind, input.text, atFrom(input.at))) };
}

export function updateJournalEntry(replica: Replica, id: string, text: string): { entry: JournalRow } {
  return { entry: row(replica.updateJournalEntry(id, text)) };
}

export function deleteJournalEntry(replica: Replica, id: string): { deleted: JournalRow } {
  return { deleted: row(replica.deleteJournalEntry(id)) };
}
