import { format } from 'date-fns/format';
import type { LoggedSymptom, MoodLevel, MoodLog, SymptomSeverity } from '../types';

/**
 * The mood/symptom log: the scale, the vocabulary, and the day reads.
 *
 * The pure half of the feature — no store, no SQLite — so every rule here is
 * exercisable without standing either up. `moodInsights.ts` beside it holds
 * the part that reads a pile of these *against your tasks*, and is separate
 * for the reason `stats.ts` is separate from the stores it reads: what an
 * entry is and what a month of entries means are two different questions, and
 * the second one is where all the arithmetic that can lie lives.
 *
 * The scope decision issue #1223 left open is settled in two halves, and the
 * split is the design rather than a compromise (see `MoodLevel` in
 * `types/index.ts`):
 *
 * - **The scale is fixed.** 1..5, the app's, not configurable. Its whole value
 *   is comparability — against your own other days, and against what you got
 *   done on them — and a per-user scale makes every number in `moodInsights`
 *   incomparable along the one axis the feature exists to read.
 * - **The vocabulary is yours.** A symptom is whatever you call it. No fixed
 *   list could have guessed "brain fog", and the freeform half costs a
 *   `trim()` and a case-insensitive match rather than the define-your-own-
 *   tracker UI that made the issue size this as `effort:high`.
 */

/** The scale, low to high. Storage values — reword the labels, never renumber. */
export const MOOD_LEVELS: readonly { value: MoodLevel; label: string; emoji: string }[] = [
  { value: 1, label: 'Very low', emoji: '😞' },
  { value: 2, label: 'Low', emoji: '🙁' },
  { value: 3, label: 'OK', emoji: '😐' },
  { value: 4, label: 'Good', emoji: '🙂' },
  { value: 5, label: 'Very good', emoji: '😄' },
];

/**
 * The line below which a day counts as a low one, for the nudge in
 * `moodTasks.ts` and the "low days" count on the Mood screen.
 *
 * 2, not 3: "OK" is not a bad day, and a threshold that catches it would have
 * the app offering to cheer up somebody who said they were fine. The one rule
 * this feature cannot break is telling a person how they feel.
 */
export const LOW_MOOD_AT_OR_BELOW = 2;

export const SYMPTOM_SEVERITIES: readonly { value: SymptomSeverity; label: string }[] = [
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'Severe' },
];

export function moodLabel(mood: MoodLevel): string {
  return MOOD_LEVELS.find(m => m.value === mood)?.label ?? 'OK';
}

export function moodEmoji(mood: MoodLevel): string {
  return MOOD_LEVELS.find(m => m.value === mood)?.emoji ?? '😐';
}

export function severityLabel(severity: SymptomSeverity): string {
  return SYMPTOM_SEVERITIES.find(s => s.value === severity)?.label ?? 'Mild';
}

/**
 * The key two spellings of one symptom agree on.
 *
 * Case and surrounding space only. Deliberately not stemming, de-pluralising
 * or fuzzy-matching: `groceryPlural.ts` does that for a catalog the app is
 * trying to *merge*, and being wrong there costs a duplicate row on a shopping
 * list. Being wrong here would silently fold "headache" and "head aches" into
 * one series in a chart somebody may be about to show a doctor, and the app
 * has no business deciding two symptoms are the same complaint.
 */
export function symptomKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Add a symptom to a set, or replace the severity if it's already there.
 *
 * One entry cannot carry "headache: mild" and "headache: severe" at once —
 * that is one symptom you changed your mind about while filling the sheet in,
 * not two. Keeps the *existing* row's name, so re-picking a remembered
 * symptom with different capitalisation doesn't rewrite what you first called
 * it.
 */
export function withSymptom(
  symptoms: readonly LoggedSymptom[],
  name: string,
  severity: SymptomSeverity,
): LoggedSymptom[] {
  const trimmed = name.trim();
  if (!trimmed) return [...symptoms];
  const key = symptomKey(trimmed);
  const existing = symptoms.find(s => symptomKey(s.name) === key);
  if (existing) {
    return symptoms.map(s => (symptomKey(s.name) === key ? { ...s, severity } : s));
  }
  return [...symptoms, { name: trimmed, severity }];
}

export function withoutSymptom(
  symptoms: readonly LoggedSymptom[],
  name: string,
): LoggedSymptom[] {
  const key = symptomKey(name);
  return symptoms.filter(s => symptomKey(s.name) !== key);
}

/**
 * Every symptom name you have ever logged, most-used first, then alphabetical.
 *
 * **Derived on read rather than stored**, which is the one place this feature
 * deliberately departs from `tag_registry`. A tag registry exists so a tag
 * that is currently on no task doesn't disappear — the user *named* it as a
 * thing that exists. A symptom is named by having happened, so the honest
 * vocabulary is exactly the set of things that have happened: nothing to
 * migrate, nothing to prune, and a symptom logged once three years ago drops
 * off the suggestions by itself instead of sitting in a registry forever.
 *
 * The display name is whichever casing you used most recently, since the
 * entries arrive newest-first and the first spelling seen for a key wins.
 */
export function symptomVocabulary(logs: readonly MoodLog[]): string[] {
  return symptomCounts(logs).map(e => e.name);
}

/** A symptom in the vocabulary: what it is called, its match key, how often. */
export interface SymptomCount {
  name: string;
  key: string;
  /** Entries carrying it, not days — an entry is what a rename rewrites. */
  count: number;
}

/**
 * The vocabulary with its counts, most-used first then alphabetical.
 *
 * `symptomVocabulary` is this with the counts dropped; they are one function so
 * the "which spelling wins" rule above is stated once. The counts are what the
 * symptom list on the Mood screen shows, and what a rename's confirmation
 * counts — a person agreeing to rewrite their own history should be told how
 * much of it.
 */
export function symptomCounts(logs: readonly MoodLog[]): SymptomCount[] {
  const counts = new Map<string, SymptomCount>();
  for (const log of logs) {
    for (const symptom of log.symptoms) {
      const key = symptomKey(symptom.name);
      if (!key) continue;
      const seen = counts.get(key);
      if (seen) seen.count++;
      else counts.set(key, { name: symptom.name.trim(), key, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Every entry on one logical day, oldest first — the order a day reads in. */
export function logsOnDay(logs: readonly MoodLog[], dayKey: string): MoodLog[] {
  return logs
    .filter(l => l.dayKey === dayKey)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
}

/**
 * The day's mood, averaged over the entries that stated one.
 *
 * Null for a day with entries that were all symptoms-only, which is different
 * from a day with no entries at all and must stay different: the first is "you
 * logged, and said nothing about your mood", the second is "you didn't log".
 * Collapsing them would have a day you deliberately recorded a headache on
 * counting as a day you skipped.
 *
 * Not rounded. Every caller either formats it to one decimal or feeds it
 * straight into arithmetic, and rounding here would quantise a 12-day average
 * to the 5 points of the scale before any of them saw it.
 */
export function dayMoodAverage(logs: readonly MoodLog[], dayKey: string): number | null {
  const moods = logs.filter(l => l.dayKey === dayKey && l.mood !== null).map(l => l.mood as number);
  if (moods.length === 0) return null;
  return moods.reduce((sum, m) => sum + m, 0) / moods.length;
}

/** Every symptom logged on one day, de-duplicated by name at its worst severity. */
export function daySymptoms(logs: readonly MoodLog[], dayKey: string): LoggedSymptom[] {
  const worst = new Map<string, LoggedSymptom>();
  for (const log of logs) {
    if (log.dayKey !== dayKey) continue;
    for (const symptom of log.symptoms) {
      const key = symptomKey(symptom.name);
      if (!key) continue;
      const seen = worst.get(key);
      // The worst it got is the honest summary of a day: a headache that
      // started mild and ended severe was a severe-headache day, and averaging
      // the two would report a day nobody had.
      if (!seen || symptom.severity > seen.severity) worst.set(key, symptom);
    }
  }
  return [...worst.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether anything at all was recorded on a day — the "did you log" read. */
export function hasLogOnDay(logs: readonly MoodLog[], dayKey: string): boolean {
  return logs.some(l => l.dayKey === dayKey);
}

/**
 * A one-line summary of an entry, for a list row.
 *
 * Mood first because it is the thing on a fixed scale, then the symptoms by
 * name. An entry with neither can still exist (a bare note), and reads as its
 * note rather than as an empty row.
 */
/**
 * Whether an entry matches what somebody typed into the history's search field.
 *
 * Plain case-insensitive substring, deliberately not `fuzzySearch`: that ranks
 * a result list, and this decides membership of a filtered list where a near
 * miss silently dropping a day is the failure that matters. Same reason
 * `symptomKey` refuses to guess — a history is read to check something, so it
 * may not quietly answer about a different set of days than the one asked for.
 *
 * It searches the note, the symptom names and their severities, the mood label,
 * and the entry's date written out. **The date is how "jump to a month" is
 * answered** rather than by a picker: "august" narrows to August, "friday" to
 * Fridays, "2026" to a year. Both a long and a short form of the date are
 * matched against, so "aug" works as well as "august".
 */
export function moodLogMatches(log: MoodLog, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (log.note && log.note.toLowerCase().includes(q)) return true;
  if (log.symptoms.some(s =>
    s.name.toLowerCase().includes(q) || severityLabel(s.severity).toLowerCase().includes(q)
  )) return true;
  if (log.mood !== null && moodLabel(log.mood).toLowerCase().includes(q)) return true;
  const date = dayKeyDate(log.dayKey);
  return `${format(date, 'EEEE d MMMM yyyy')} ${format(date, 'EEE d MMM yyyy')}`
    .toLowerCase()
    .includes(q);
}

/**
 * A day key as a Date, at noon.
 *
 * Deliberately not `dayKeyToDate` from `dateUtils`, which would be the obvious
 * reuse: that module reaches `useSettingsStore` for `dayResetTime` and so pulls
 * SQLite in behind it, and this module is the pure half of the feature —
 * `moodLog.test.ts` stands it up with no mocks at all, which is the property
 * worth keeping. Nothing here needs the reset time: a day key already names the
 * logical day, and this only ever formats it for display. Noon for the reason
 * every other date the app parks is at noon — midnight can be dragged across
 * the boundary by a DST hour, and which day it reads as is the whole point.
 */
function dayKeyDate(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** What a rename would do, decided before anything is written. */
export interface SymptomRename {
  /** One per entry that changes, carrying the symptom list to store. */
  changes: { id: string; symptoms: LoggedSymptom[] }[];
  /** True when the new name is already in use, so this folds two into one. */
  merges: boolean;
}

/**
 * Rename a symptom across every entry carrying it, merging into an existing
 * name when one already matches.
 *
 * The vocabulary is derived from the entries rather than stored (see
 * `symptomVocabulary`), so there is no registry row to edit and correcting a
 * typo means rewriting history. That is the one thing the store otherwise
 * refuses to do casually — `updateLog` cannot move `dayKey` or `loggedAt` — so
 * this is computed whole first, and the caller confirms against
 * `changes.length` before any of it is written.
 *
 * The merge case is the point rather than a side effect. `symptomKey` matches
 * on case and space only and must keep refusing to guess that "head ache" and
 * "headache" are one complaint, because being wrong there folds two things
 * together in a chart somebody may be about to show a doctor. The honest
 * consequence of refusing to guess is that the user needs a way to say so, and
 * this is it: they are the same when you say they are.
 *
 * Where an entry ends up holding the same symptom twice, the two collapse at
 * **the worse of the two severities**, the rule `daySymptoms` already applies
 * to a day — one complaint you named twice, at the worst it got, not two.
 */
export function renameSymptomInLogs(
  logs: readonly MoodLog[],
  fromKey: string,
  toName: string,
): SymptomRename {
  const trimmed = toName.trim();
  const toKey = symptomKey(trimmed);
  const changes: { id: string; symptoms: LoggedSymptom[] }[] = [];
  if (!fromKey || !toKey) return { changes, merges: false };

  for (const log of logs) {
    if (!log.symptoms.some(s => symptomKey(s.name) === fromKey)) continue;
    const symptoms: LoggedSymptom[] = [];
    for (const symptom of log.symptoms) {
      const key = symptomKey(symptom.name);
      if (key !== fromKey && key !== toKey) {
        symptoms.push(symptom);
        continue;
      }
      // Both the renamed symptom and any existing one under the target name
      // land here, so the target's own casing is normalised to what was typed
      // and the pair collapses to one row rather than to two identical ones.
      const already = symptoms.find(s => symptomKey(s.name) === toKey);
      if (already) already.severity = Math.max(already.severity, symptom.severity) as SymptomSeverity;
      else symptoms.push({ name: trimmed, severity: symptom.severity });
    }
    changes.push({ id: log.id, symptoms });
  }

  const merges = toKey !== fromKey
    && logs.some(l => l.symptoms.some(s => symptomKey(s.name) === toKey));
  return { changes, merges };
}

export function moodLogSummary(log: MoodLog): string {
  const parts: string[] = [];
  if (log.mood !== null) parts.push(`${moodEmoji(log.mood)} ${moodLabel(log.mood)}`);
  if (log.symptoms.length > 0) parts.push(log.symptoms.map(s => s.name).join(', '));
  if (parts.length === 0 && log.note) return log.note;
  return parts.join(' · ');
}
