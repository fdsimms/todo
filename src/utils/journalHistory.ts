import type { JournalKind } from '../types';
import { joinNames } from './shoppingTrip';

/**
 * Counting a journal entry as time with the people it names — see
 * `docs/arch/journal.md` ("Counting an entry as time together").
 *
 * The sheet offers this once an entry names somebody; nothing here reads the
 * words. The answer is an ordinary completed task through
 * `useTaskStore.addCompletedTask`, the record every other way into a person's
 * history writes (`docs/arch/people.md`, "History is completed tasks"), so no
 * second kind of record exists and nothing marks it as suggested afterwards.
 */
export type JournalHistoryKind = 'hangout' | 'catchup';

export const JOURNAL_HISTORY_OPTIONS: readonly { kind: JournalHistoryKind; label: string }[] = [
  { kind: 'hangout', label: 'Hung out' },
  { kind: 'catchup', label: 'Caught up' },
];

/**
 * Whether the sheet offers the choice at all. Only a new journal entry that is
 * open now: an edit would offer the same entry again every time it is saved,
 * a dream is not time spent with anybody, and a note sealed for later is not
 * something that happened today.
 */
export function canOfferJournalHistory(args: {
  kind: JournalKind;
  editing: boolean;
  sealed: boolean;
  personCount: number;
}): boolean {
  return args.kind === 'journal' && !args.editing && !args.sealed && args.personCount > 0;
}

/** "Hung out with Gideon and Tessa". One entry for everybody the page names, so one afternoon is not recorded twice. */
export function journalHistoryTitle(kind: JournalHistoryKind, names: readonly string[]): string {
  const who = joinNames(names);
  return kind === 'hangout' ? `Hung out with ${who}` : `Caught up with ${who}`;
}

/** The instant the history entry is stamped: now for today's page, noon on a backdated one. */
export function journalHistoryAt(day: Date, isToday: boolean, now: Date): Date {
  if (isToday) return now;
  const at = new Date(day);
  at.setHours(12, 0, 0, 0);
  return at;
}
