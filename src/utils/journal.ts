/**
 * Reading the journal and the dream log — see `docs/arch/journal.md`.
 *
 * The same posture as `moodHistory.ts`: the log itself, narrowed, and nothing
 * derived from it. No entry here is ever read for what it "means", and
 * `moodInsights.ts` never reads either kind.
 */

import type { JournalEntry, JournalKind } from '../types';
import { textMatchesQuery } from './moodHistory';

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
