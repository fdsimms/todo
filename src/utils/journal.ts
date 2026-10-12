/**
 * Reading the journal and the dream log — see `docs/arch/journal.md`.
 *
 * The same posture as `moodHistory.ts`: the log itself, narrowed, and nothing
 * derived from it. No entry here is ever read for what it "means", and
 * `moodInsights.ts` never reads either kind.
 */

import { format } from 'date-fns/format';
import { addMonths } from 'date-fns/addMonths';
import { addYears } from 'date-fns/addYears';
import type { JournalEntry, JournalKind, TaskDraft } from '../types';
import { textMatchesQuery } from './moodHistory';
import { journalPlainText, parseJournalMarkdown } from './journalMarkdown';

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
 * How many words an entry holds. The formatting markers are not words (a
 * bullet, a `#`, the `**` round bold), so the count is taken from the text as
 * `JournalText` draws it. A word is a run of characters between spaces.
 */
export function countWords(text: string): number {
  let total = 0;
  for (const block of parseJournalMarkdown(text)) {
    const line = block.spans.map(s => s.text).join('').trim();
    if (line) total += line.split(/\s+/).length;
  }
  return total;
}

/**
 * Words written under one day by one kind, every snippet of it. The caller
 * passes open entries only (`openEntries`), so a sealed note adds nothing
 * before its day.
 */
export function wordsOnDay(entries: readonly JournalEntry[], kind: JournalKind, dayKey: string): number {
  return entriesOnDay(entries, kind, dayKey).reduce((sum, e) => sum + countWords(e.text), 0);
}

/** "1 word", "312 words". */
export function formatWordCount(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'word' : 'words'}`;
}

/**
 * The bounds the daily word goal stepper moves within. An absurdity check, not
 * advice, the shape of `SLEEP_GOAL_RANGE`.
 */
export const JOURNAL_WORD_GOAL_RANGE = { min: 25, max: 5000, step: 25, start: 250 } as const;

/** The stored setting back to a word count, or null when unset or unreadable. */
export function parseJournalWordGoal(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value < JOURNAL_WORD_GOAL_RANGE.min || value > JOURNAL_WORD_GOAL_RANGE.max) return null;
  return value;
}

/**
 * Days with at least `goal` words written, among those in `monthPrefix`
 * (`2026-10`) when one is given. A day that fell short is simply not counted:
 * nothing here says a day was missed.
 */
export function daysReachingWordGoal(
  entries: readonly JournalEntry[],
  goal: number,
  monthPrefix?: string,
): number {
  const perDay = new Map<string, number>();
  for (const e of entries) {
    if (monthPrefix && !e.dayKey.startsWith(monthPrefix)) continue;
    perDay.set(e.dayKey, (perDay.get(e.dayKey) ?? 0) + countWords(e.text));
  }
  let days = 0;
  for (const words of perDay.values()) if (words >= goal) days++;
  return days;
}

// ==== Reading back: on this day, the month, a random page ====

/** Earlier years' pages for one calendar day, newest year first. */
export interface OnThisDay {
  dayKey: string;
  /** Whole years before today, always at least 1. */
  yearsAgo: number;
  entries: JournalEntry[];
}

/**
 * The same month and day in earlier years that carry an entry of `kind`.
 * Only a day that has something on it appears, so a year with nothing written
 * is absent rather than a blank to explain. Sealed notes are left out here
 * (`openEntries`), since this is a reader like any other. Feb 29 turns up
 * only on a Feb 29.
 */
export function onThisDay(entries: readonly JournalEntry[], kind: JournalKind, todayKey: string): OnThisDay[] {
  const monthDay = todayKey.slice(5);
  const year = Number(todayKey.slice(0, 4));
  const days = groupJournalByDay(
    openEntries(entriesOfKind(entries, kind), todayKey).filter(e => e.dayKey.slice(5) === monthDay && e.dayKey < todayKey),
  );
  return days.map(d => ({ dayKey: d.dayKey, yearsAgo: year - Number(d.dayKey.slice(0, 4)), entries: d.entries }));
}

/** The days of `monthPrefix` (`2026-10`) that carry an open entry of `kind`. */
export function daysWrittenInMonth(
  entries: readonly JournalEntry[],
  kind: JournalKind,
  monthPrefix: string,
  todayKey: string,
): Set<string> {
  return new Set(
    openEntries(entriesOfKind(entries, kind), todayKey)
      .filter(e => e.dayKey.startsWith(monthPrefix))
      .map(e => e.dayKey),
  );
}

/**
 * A page to reread, chosen by chance from the days that have one. `random` is
 * a parameter so a test pins it. Null when nothing is written. Today is left
 * out when there is anything older, since a page you wrote an hour ago is not
 * one you have forgotten.
 */
export function randomJournalDay(
  entries: readonly JournalEntry[],
  kind: JournalKind,
  todayKey: string,
  random: () => number = Math.random,
): string | null {
  const days = [...new Set(openEntries(entriesOfKind(entries, kind), todayKey).map(e => e.dayKey))].sort();
  const older = days.filter(d => d !== todayKey);
  const pool = older.length > 0 ? older : days;
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** The start of an entry as plain text, cut at a word, for a line that previews it. */
export function journalSnippet(text: string, max = 140): string {
  const plain = journalPlainText(text).replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// ==== Tags and people ====

/** The longest a tag may be, and how many one entry may carry. */
export const JOURNAL_TAG_MAX_LENGTH = 24;
export const JOURNAL_TAGS_PER_ENTRY = 8;

/**
 * A typed tag as stored: trimmed, inner whitespace collapsed, cut to length.
 * Null when nothing is left. Case is kept as typed; two tags that differ only
 * by case are one tag everywhere they are compared (`journalTagKey`).
 */
export function normalizeJournalTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, JOURNAL_TAG_MAX_LENGTH).trim();
  return tag.length > 0 ? tag : null;
}

export function journalTagKey(tag: string): string {
  return tag.toLowerCase();
}

/** A list of typed tags as stored: normalized, de-duplicated, capped, in the order given. */
export function cleanJournalTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const tag = normalizeJournalTag(item);
    if (!tag || seen.has(journalTagKey(tag))) continue;
    seen.add(journalTagKey(tag));
    out.push(tag);
    if (out.length === JOURNAL_TAGS_PER_ENTRY) break;
  }
  return out;
}

/**
 * Every tag in use on `kind`, A to Z. Alphabetical on purpose: ordering by how
 * often a tag is used would rank the person's own labels against each other.
 * The first spelling met is the one shown.
 */
export function journalTagsIn(entries: readonly JournalEntry[], kind: JournalKind): string[] {
  const byKey = new Map<string, string>();
  for (const e of entries) {
    if (e.kind !== kind) continue;
    for (const tag of e.tags ?? []) if (!byKey.has(journalTagKey(tag))) byKey.set(journalTagKey(tag), tag);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** The entries carrying `tag`, in the order given. */
export function entriesWithTag(entries: readonly JournalEntry[], tag: string): JournalEntry[] {
  const key = journalTagKey(tag);
  return entries.filter(e => (e.tags ?? []).some(t => journalTagKey(t) === key));
}

/**
 * Open entries naming `personId`, newest first: the pages listed on a
 * person's page. A list and no more; there is no count of "how often" and no
 * order but time.
 */
export function entriesAboutPerson(
  entries: readonly JournalEntry[],
  personId: string,
  todayKey: string,
): JournalEntry[] {
  return openEntries(entries, todayKey)
    .filter(e => (e.personIds ?? []).includes(personId))
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

/** A list of person ids as stored: de-duplicated, in the order given. */
export function cleanPersonIds(raw: readonly string[]): string[] {
  return [...new Set(raw.filter(id => id.length > 0))];
}

// ==== Hide until: shortcuts ====

export interface SealShortcut {
  label: string;
  dayKey: string;
}

/**
 * Quick answers for "Hide until", worked from the logical today so a 1am
 * entry under a 2am reset counts from yesterday's date. Always later than
 * `todayKey`, which is what a seal needs.
 */
export function sealShortcuts(todayKey: string): SealShortcut[] {
  const today = new Date(`${todayKey}T12:00:00`);
  const key = (d: Date) => format(d, 'yyyy-MM-dd');
  const newYear = new Date(today.getFullYear() + 1, 0, 1, 12);
  return [
    { label: 'In a month', dayKey: key(addMonths(today, 1)) },
    { label: 'In 6 months', dayKey: key(addMonths(today, 6)) },
    { label: 'In a year', dayKey: key(addYears(today, 1)) },
    { label: 'New Year’s Day', dayKey: key(newYear) },
  ];
}

// ==== Prompts ====

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
  'What did you get done that you’re glad about?',
  'What was hard today, and what helped?',
  'Who did you talk to today?',
  'What would make tomorrow easier?',
  'What did you notice about your body today?',
  'What are you grateful for right now?',
];

/** The most prompts a person can add, and the longest one. */
export const JOURNAL_CUSTOM_PROMPTS_MAX = 20;
export const JOURNAL_CUSTOM_PROMPT_MAX_LENGTH = 120;

/** The stored setting (a JSON array of strings) back to the person's own prompts. */
export function parseJournalCustomPrompts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? cleanJournalPrompts(parsed.filter((p): p is string => typeof p === 'string')) : [];
  } catch {
    return [];
  }
}

/** Typed prompts as stored: trimmed, blanks and repeats dropped, capped. */
export function cleanJournalPrompts(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const prompt = item.replace(/\s+/g, ' ').trim().slice(0, JOURNAL_CUSTOM_PROMPT_MAX_LENGTH).trim();
    if (!prompt || seen.has(prompt.toLowerCase())) continue;
    seen.add(prompt.toLowerCase());
    out.push(prompt);
    if (out.length === JOURNAL_CUSTOM_PROMPTS_MAX) break;
  }
  return out;
}

/** The person's own prompts first, then the built-in ones. */
export function journalPromptList(custom: readonly string[] = []): readonly string[] {
  return custom.length > 0 ? [...custom, ...JOURNAL_PROMPTS] : JOURNAL_PROMPTS;
}

/**
 * The prompt at `index` in `prompts`, wrapping, so a caller can step through
 * them with a counter.
 */
export function journalPromptAt(index: number, prompts: readonly string[] = JOURNAL_PROMPTS): string {
  const n = prompts.length;
  return prompts[((index % n) + n) % n];
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
    emptySubtitle: 'Write about your day.',
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
