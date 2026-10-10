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
import { countWords, isSealed, openEntries } from '../../src/utils/journal';

export interface JournalRow {
  id: string;
  kind: JournalKind;
  /** `YYYY-MM-DD`, the day it files under (a dream: the day they woke). */
  day: string;
  loggedAt: string;
  text: string;
  /** Words in the text, not counting formatting markers. */
  words: number;
}

function row(entry: JournalEntry): JournalRow {
  return { id: entry.id, kind: entry.kind, day: entry.dayKey, loggedAt: entry.loggedAt, text: entry.text, words: countWords(entry.text) };
}

/**
 * A note to the person's future self is sealed until its day
 * (JournalEntry.openOn), and stays sealed here too: listed only as a count,
 * and refused by id, so a reply can't read it to them early.
 */
export function listJournalEntries(
  replica: Replica,
  input: LogRangeInput & { kind?: JournalKind } = {},
): { range: DayRange; entries: JournalRow[]; sealedNotes?: number; wordGoal?: number } {
  const range = resolveRange(replica, input);
  const all = replica.journalEntries(range.from, range.to, input.kind);
  const open = openEntries(all, replica.todayKey());
  const sealed = all.length - open.length;
  const goal = replica.journalWordGoal();
  return {
    range,
    entries: open.map(row),
    ...(sealed > 0 ? { sealedNotes: sealed } : {}),
    // A day's goal, in words, for the journal only. Never said of a dream.
    ...(goal !== null && input.kind !== 'dream' ? { wordGoal: goal } : {}),
  };
}

function refuseSealed(replica: Replica, id: string): void {
  const entry = replica.journalEntries('0000-01-01', '9999-12-31').find(e => e.id === id);
  if (entry && isSealed(entry, replica.todayKey())) {
    throw new Error(`That is a note the person left for their future self, sealed until ${entry.openOn}. It can't be read or changed before then.`);
  }
}

export function logJournalEntry(
  replica: Replica,
  input: { kind: JournalKind; text: string; at?: string },
): { entry: JournalRow } {
  return { entry: row(replica.addJournalEntry(input.kind, input.text, atFrom(input.at))) };
}

export function updateJournalEntry(replica: Replica, id: string, text: string): { entry: JournalRow } {
  refuseSealed(replica, id);
  return { entry: row(replica.updateJournalEntry(id, text)) };
}

export function deleteJournalEntry(replica: Replica, id: string): { deleted: JournalRow } {
  refuseSealed(replica, id);
  return { deleted: row(replica.deleteJournalEntry(id)) };
}
