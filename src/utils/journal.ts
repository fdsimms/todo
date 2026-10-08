/**
 * Reading the journal and the dream log — see `docs/arch/journal.md`.
 *
 * The same posture as `moodHistory.ts`: the log itself, narrowed, and nothing
 * derived from it. No entry here is ever read for what it "means", and
 * `moodInsights.ts` never reads either kind.
 */

import { format } from 'date-fns/format';
import type { JournalEntry, JournalKind, TaskDraft } from '../types';
import { textMatchesQuery } from './moodHistory';

/**
 * Whether a note to your future self is still sealed on `todayKey`, the
 * logical day being read on. An entry with no `openOn` never is.
 */
export function isSealed(entry: Pick<JournalEntry, 'openOn'>, todayKey: string): boolean {
  return typeof entry.openOn === 'string' && entry.openOn > todayKey;
}

/**
 * Every entry that may be read today: the one rule every reader goes through
 * (the screens, the sheet's "so far", the mood day page, Looking back, the
 * export and Claude), so a sealed note's words appear nowhere before its day.
 */
export function openEntries<T extends Pick<JournalEntry, 'openOn'>>(entries: readonly T[], todayKey: string): T[] {
  return entries.filter(e => !isSealed(e, todayKey));
}

/** The sealed notes, soonest to open first. */
export function sealedEntries(entries: readonly JournalEntry[], todayKey: string): JournalEntry[] {
  return entries.filter(e => isSealed(e, todayKey)).sort((a, b) => a.openOn!.localeCompare(b.openOn!));
}

/** How many days a note shows under "Just opened" after it opens. */
export const JUST_OPENED_DAYS = 7;

/**
 * Notes that opened in the last week, newest opening first. A note files
 * under the day it was written, which can be a year down the page, so these
 * are also shown at the top for the week they open.
 */
export function justOpened(entries: readonly JournalEntry[], todayKey: string): JournalEntry[] {
  const today = new Date(`${todayKey}T00:00:00`);
  today.setDate(today.getDate() - (JUST_OPENED_DAYS - 1));
  const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return entries
    .filter(e => typeof e.openOn === 'string' && e.openOn <= todayKey && e.openOn >= from)
    .sort((a, b) => b.openOn!.localeCompare(a.openOn!) || b.loggedAt.localeCompare(a.loggedAt));
}

/** The link a sealed note's reminder task carries, which opens that note. */
export function journalEntryLink(id: string): string {
  return `dundundun://journal?entry=${encodeURIComponent(id)}`;
}

/**
 * The reminder a note to your future self leaves on the day it opens
 * (JournalEntry.openOn): an ordinary task, due that day, whose link opens the
 * note. A plain task rather than a generated one, because the person asked
 * for it by sealing the note; nothing reconciles it, and the two places that
 * take a note's reason away (opening it early, deleting it) take the task too.
 */
export function sealedNoteTaskDraft(entry: Pick<JournalEntry, 'id' | 'dayKey' | 'openOn'>): Partial<TaskDraft> | null {
  if (!entry.openOn) return null;
  const due = new Date(`${entry.openOn}T12:00:00`);
  return {
    title: `Read the note you wrote on ${format(new Date(`${entry.dayKey}T00:00:00`), 'MMM d, yyyy')}`,
    dueDate: due.toISOString(),
    linkUrl: journalEntryLink(entry.id),
  };
}

/** One kind's entries, in the order given (the store keeps newest first). */
export function entriesOfKind(entries: readonly JournalEntry[], kind: JournalKind): JournalEntry[] {
  return entries.filter(e => e.kind === kind);
}

/**
 * The entries containing every word of `query`, in any order, ignoring case.
 * Plain substring matching, the rule the mood note search uses.
 */
export function searchJournal(entries: readonly JournalEntry[], query: string): JournalEntry[] {
  return entries.filter(e => textMatchesQuery(e.text, query));
}

/** One day's entries, oldest first, the way a page reads. */
export interface JournalDay {
  dayKey: string;
  entries: JournalEntry[];
}

/**
 * Entries grouped by the day they file under, newest day first. A day with
 * nothing written is absent rather than an empty group.
 */
export function groupJournalByDay(entries: readonly JournalEntry[]): JournalDay[] {
  const byDay = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const day = byDay.get(entry.dayKey);
    if (day) day.push(entry);
    else byDay.set(entry.dayKey, [entry]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dayKey, list]) => ({
      dayKey,
      entries: [...list].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)),
    }));
}

/**
 * One kind's entries on one day, oldest first: what the sheet shows above the
 * field as "so far" when another snippet is added to that day.
 */
export function entriesOnDay(
  entries: readonly JournalEntry[],
  kind: JournalKind,
  dayKey: string,
): JournalEntry[] {
  return entries
    .filter(e => e.kind === kind && e.dayKey === dayKey)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
}

/**
 * Plain counts of one kind. Counting one thing has no minimum, so nothing
 * here is gated on a sample size.
 */
export interface JournalStats {
  /** Days with at least one entry. The headline number, since a day is the unit. */
  dayCount: number;
  /** Days with an entry whose key starts with `monthPrefix` (`2026-10`). */
  dayCountInMonth: number;
  /** Most recent day with an entry, or null when there are none. `yyyy-MM-dd`. */
  lastDayKey: string | null;
}

/**
 * How many days carry an entry, and when the last one was. A day with no dream
 * is simply not counted: nothing here can tell not dreaming from not writing
 * it down, so it is never "a day without a dream".
 */
export function journalStats(entries: readonly JournalEntry[], monthPrefix: string): JournalStats {
  const days = [...new Set(entries.map(e => e.dayKey))].sort();
  return {
    dayCount: days.length,
    dayCountInMonth: days.filter(k => k.startsWith(monthPrefix)).length,
    lastDayKey: days.length > 0 ? days[days.length - 1] : null,
  };
}

/**
 * Questions the journal sheet can offer over an empty page.
 *
 * Questions only: none names a feeling, assumes how the day went or diagnoses
 * anything, the same line `moodNudge` holds. They are shown as a hint, never
 * written into the entry, and only when the person asks for one.
 */
export const JOURNAL_PROMPTS: readonly string[] = [
  'What went well today?',
  'What took up the most space in your head?',
  'What are you looking forward to?',
  'What do you want to remember about today?',
  'What did you get done that you\'re glad about?',
  'What was hard today, and what helped?',
  'Who did you talk to today?',
  'What would make tomorrow a bit easier?',
  'What did you notice about your body today?',
  'What are you grateful for right now?',
];

/** The prompt at `index`, wrapping, so a caller can step through them with a counter. */
export function journalPromptAt(index: number): string {
  const n = JOURNAL_PROMPTS.length;
  return JOURNAL_PROMPTS[((index % n) + n) % n];
}

/** What a screen and its sheet call one kind. */
export const JOURNAL_KIND_COPY: Record<JournalKind, {
  title: string;
  one: string;
  placeholder: string;
  hint: string | null;
  /** The placeholder once the day already has an entry of this kind. */
  continuePlaceholder: string;
  emptyTitle: string;
  emptySubtitle: string;
}> = {
  journal: {
    title: 'Journal',
    one: 'journal entry',
    placeholder: 'e.g. How the day went, or anything you want to remember',
    hint: null,
    continuePlaceholder: 'e.g. What has happened since then',
    emptyTitle: 'Nothing written yet',
    emptySubtitle: 'Write about your day, as often as you like.',
  },
  dream: {
    title: 'Dreams',
    one: 'dream',
    placeholder: 'e.g. Anything you remember from last night',
    hint: 'A dream is filed under the day you wake.',
    continuePlaceholder: 'e.g. Anything else you remember',
    emptyTitle: 'No dreams written down yet',
    emptySubtitle: 'Write down what you remember when you wake up.',
  },
};
