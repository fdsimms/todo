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
import { countWords, entriesWithTag, isSealed, openEntries, searchJournal } from '../../src/utils/journal';

export interface JournalRow {
  id: string;
  kind: JournalKind;
  /** `YYYY-MM-DD`, the day it files under (a dream: the day they woke). */
  day: string;
  loggedAt: string;
  text: string;
  /** Words in the text, not counting formatting markers. */
  words: number;
  /** Labels the person put on it. Absent when it has none. */
  tags?: string[];
  /** Ids of the people it is about (list_people names them). Absent when it has none. */
  personIds?: string[];
}

function row(entry: JournalEntry): JournalRow {
  return {
    id: entry.id,
    kind: entry.kind,
    day: entry.dayKey,
    loggedAt: entry.loggedAt,
    text: entry.text,
    words: countWords(entry.text),
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
    ...(entry.personIds?.length ? { personIds: entry.personIds } : {}),
  };
}

/**
 * A note to the person's future self is sealed until its day
 * (JournalEntry.openOn), and stays sealed here too: listed only as a count,
 * and refused by id, so a reply can't read it to them early.
 */
export function listJournalEntries(
  replica: Replica,
  input: LogRangeInput & { kind?: JournalKind; tag?: string; personId?: string } = {},
): { range: DayRange; entries: JournalRow[]; sealedNotes?: number; wordGoal?: number } {
  const range = resolveRange(replica, input);
  const all = replica.journalEntries(range.from, range.to, input.kind);
  const open = narrow(openEntries(all, replica.todayKey()), input);
  const sealed = all.length - openEntries(all, replica.todayKey()).length;
  const goal = replica.journalWordGoal();
  return {
    range,
    entries: open.map(row),
    ...(sealed > 0 ? { sealedNotes: sealed } : {}),
    // A day's goal, in words, for the journal only. Never said of a dream.
    ...(goal !== null && input.kind !== 'dream' ? { wordGoal: goal } : {}),
  };
}

function narrow(entries: JournalEntry[], filter: { tag?: string; personId?: string }): JournalEntry[] {
  let out = entries;
  if (filter.tag) out = entriesWithTag(out, filter.tag);
  if (filter.personId) out = out.filter(e => (e.personIds ?? []).includes(filter.personId!));
  return out;
}

export const SEARCH_JOURNAL_LIMIT = 50;

/**
 * Entries containing every word of `query`, over every day written unless a
 * range is given: the app's own search rule (`searchJournal`), so a word
 * can be found without reading a year of entries to look for it. Newest first,
 * capped, and a sealed note is never searched (`openEntries`); a cap that cut
 * results off says so, with the total.
 */
export function searchJournalEntries(
  replica: Replica,
  input: { query: string; kind?: JournalKind; tag?: string; personId?: string; from?: string; to?: string; limit?: number },
): { range: DayRange; entries: JournalRow[]; total: number; truncated?: true } {
  const range: DayRange = { from: input.from ?? '0000-01-01', to: input.to ?? replica.todayKey() };
  const open = openEntries(replica.journalEntries(range.from, range.to, input.kind), replica.todayKey());
  const found = searchJournal(narrow(open, input), input.query);
  const limit = Math.min(Math.max(input.limit ?? SEARCH_JOURNAL_LIMIT, 1), SEARCH_JOURNAL_LIMIT);
  return {
    range,
    entries: found.slice(0, limit).map(row),
    total: found.length,
    ...(found.length > limit ? { truncated: true as const } : {}),
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
  input: { kind: JournalKind; text: string; at?: string; tags?: string[]; personIds?: string[] },
): { entry: JournalRow } {
  return {
    entry: row(replica.addJournalEntry(input.kind, input.text, atFrom(input.at), { tags: input.tags, personIds: input.personIds })),
  };
}

/** Changes the words, the tags, the people, or any of them. What is left out stays as it was. */
export function updateJournalEntry(
  replica: Replica,
  id: string,
  change: { text?: string; tags?: string[]; personIds?: string[] },
): { entry: JournalRow } {
  if (change.text === undefined && change.tags === undefined && change.personIds === undefined) {
    throw new Error('Nothing to change. Give the new text, tags or personIds.');
  }
  refuseSealed(replica, id);
  return { entry: row(replica.updateJournalEntry(id, change)) };
}

export function deleteJournalEntry(replica: Replica, id: string): { deleted: JournalRow } {
  refuseSealed(replica, id);
  return { deleted: row(replica.deleteJournalEntry(id)) };
}
