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
  const counts = new Map<string, { name: string; count: number }>();
  for (const log of logs) {
    for (const symptom of log.symptoms) {
      const key = symptomKey(symptom.name);
      if (!key) continue;
      const seen = counts.get(key);
      if (seen) seen.count++;
      else counts.set(key, { name: symptom.name.trim(), count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map(e => e.name);
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
 * The entries a person is looking for, newest first.
 *
 * Two independent narrowings, because they answer different questions: a
 * symptom filter is "show me the days this happened", a query is "I know I
 * wrote something about this". Both empty is the whole history, which is what
 * the screen shows by default.
 *
 * The query matches the note *and* the symptom names, since somebody typing
 * "headache" into a search box means the days they had one, and making them
 * discover that only the note is searched would be the kind of distinction
 * only the code makes.
 */
export function filterMoodLogs(
  logs: readonly MoodLog[],
  opts: { symptom?: string | null; query?: string } = {},
): MoodLog[] {
  const key = opts.symptom ? symptomKey(opts.symptom) : null;
  const query = (opts.query ?? '').trim().toLowerCase();
  return logs.filter(log => {
    if (key && !log.symptoms.some(s => symptomKey(s.name) === key)) return false;
    if (!query) return true;
    if ((log.note ?? '').toLowerCase().includes(query)) return true;
    return log.symptoms.some(s => s.name.toLowerCase().includes(query));
  });
}

/**
 * How many entries name a symptom, for the vocabulary list.
 *
 * Counts *entries* rather than days on purpose: this is what the rename sheet
 * shows before rewriting them, so it has to be the number of rows about to
 * change, not a friendlier figure that happens to be smaller.
 */
export function symptomEntryCount(logs: readonly MoodLog[], name: string): number {
  const key = symptomKey(name);
  return logs.filter(l => l.symptoms.some(s => symptomKey(s.name) === key)).length;
}

/**
 * A one-line summary of an entry, for a list row.
 *
 * Mood first because it is the thing on a fixed scale, then the symptoms by
 * name. An entry with neither can still exist (a bare note), and reads as its
 * note rather than as an empty row.
 */
export function moodLogSummary(log: MoodLog): string {
  const parts: string[] = [];
  if (log.mood !== null) parts.push(`${moodEmoji(log.mood)} ${moodLabel(log.mood)}`);
  if (log.symptoms.length > 0) parts.push(log.symptoms.map(s => s.name).join(', '));
  if (parts.length === 0 && log.note) return log.note;
  return parts.join(' · ');
}
