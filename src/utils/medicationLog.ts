import { format } from 'date-fns/format';
import { subDays } from 'date-fns/subDays';
import type { MedicationLog } from '../types';

/**
 * The medication log: the vocabulary, the day reads, and how often you reached
 * for something.
 *
 * The pure half — no store, no SQLite — the same split `moodLog.ts` makes from
 * `moodInsights.ts` beside it, and for the same reason: what a dose *is* and
 * what a month of doses *means* are two different questions, and the second is
 * where the arithmetic that can lie lives.
 *
 * ## Why this exists at all, given a tablet is already a repeating task
 *
 * `docs/arch/mood-log.md` settled the medication question once by answering it
 * without a medication feature: a tablet, a supplement, a stretch or a walk is
 * already a repeating task, `taskMoodContrasts` reads "how do the days I take
 * it compare" straight off that, and a tracker asking you to log the tablets
 * again next to the task reminding you to take them is asking for the same
 * fact twice. **That is still right for anything on a schedule, and this file
 * does not reopen it.** The scheduled case still rides the task;
 * `Task.medicationName` writes the dose from the completion rather than asking
 * for it a second time.
 *
 * Two things that argument doesn't reach, which are the whole of what this is:
 *
 * - **An as-needed dose has no task to complete.** Nobody schedules "take an
 *   ibuprofen if the headache gets bad", so nothing records it — and how often
 *   you reached for it is itself the number worth having. A one-off task
 *   can't stand in: `contrastsFor` needs `MIN_CONTRAST_DAYS` a side, so a task
 *   completed once is excluded by construction.
 * - **A completion carries no amount.** Ticking records that you did it, not
 *   that it was 20mg rather than 10.
 *
 * ## What this file deliberately will not compute
 *
 * There is no medication-against-symptom contrast here, and adding one is not
 * a small extension. For an as-needed medicine the comparison is **structurally
 * backwards**: you take the painkiller *because* your head hurts, so "the
 * symptom was worse on the days you took it" is a restatement of why you took
 * it, not a finding about whether it works. `symptomFoodContrasts` survives
 * that objection because eating bread is not caused by the headache; reaching
 * for the ibuprofen is. A card drawn on that arithmetic would read as evidence
 * against the medicine on exactly the days it was needed most, which is the
 * one wrong answer this must never give.
 *
 * The scheduled case has the same problem from the other end — adherence and
 * how you felt move together for reasons that run both ways — and it already
 * has `taskMoodContrasts`, with all of `moodInsights.ts`'s gates on it.
 *
 * So what is here is tallies and one frequency comparison, and the line
 * between them is the one `docs/arch/mood-log.md` already draws for the
 * symptom page: **counting one thing has no minimum, comparing two does.**
 */

/**
 * The units a dose can be stated in, with the plural where the unit is a thing
 * you can count rather than a measure.
 *
 * `plural: null` means the unit never inflects — "20 mg", not "20 mgs". Kept
 * as data rather than as a rule in `formatDose` because the exceptions are the
 * majority here and a general pluralizer would get every one of them wrong.
 */
export const DOSE_UNITS: readonly { value: string; plural: string | null }[] = [
  { value: 'mg', plural: null },
  { value: 'mcg', plural: null },
  { value: 'g', plural: null },
  { value: 'ml', plural: null },
  { value: 'tablet', plural: 'tablets' },
  { value: 'capsule', plural: 'capsules' },
  { value: 'drop', plural: 'drops' },
  { value: 'puff', plural: 'puffs' },
  { value: 'spray', plural: 'sprays' },
  { value: 'unit', plural: 'units' },
];

/**
 * Both windows of a frequency comparison have to carry this many doses between
 * them before one is offered.
 *
 * A tally of one dose is a fact and gets shown; "one dose last fortnight
 * against two this one" is a doubling, and reporting it as one would be the
 * `MIN_PAIRED_DAYS` mistake in a different coat — a comparison that lands on
 * something eye-catching because the numbers behind it are too small to say
 * anything.
 */
export const MIN_TREND_DOSES = 4;

/**
 * The key two spellings of one medication agree on.
 *
 * Case and surrounding space only — the same refusal `symptomKey` makes, for a
 * harder version of the same reason. Folding two spellings of a symptom
 * together blurs a chart; folding "Ibuprofen 200" into "Ibuprofen 400"
 * misstates a dose, in a record somebody may be reading back to a doctor. The
 * app has no business deciding two medicines are the same medicine.
 */
export function medicationKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Every medication you have ever logged, most-used first, then alphabetical.
 *
 * Derived on read rather than stored, exactly as `symptomVocabulary` is: a
 * medication is named by having been taken, so the honest vocabulary is the
 * set of things that have been taken. Nothing to migrate, nothing to prune,
 * and something taken once two years ago drops off the suggestions by itself.
 */
export function medicationVocabulary(logs: readonly MedicationLog[]): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const log of logs) {
    const key = medicationKey(log.name);
    if (!key) continue;
    const seen = counts.get(key);
    if (seen) seen.count++;
    else counts.set(key, { name: log.name.trim(), count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map(e => e.name);
}

/** Every dose on one logical day, oldest first — the order a day reads in. */
export function logsOnDay(logs: readonly MedicationLog[], dayKey: string): MedicationLog[] {
  return logs
    .filter(l => l.dayKey === dayKey)
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

/** How many doses of one medication were taken on a day. */
export function dosesOnDay(
  logs: readonly MedicationLog[],
  dayKey: string,
  key: string,
): number {
  return logs.filter(l => l.dayKey === dayKey && medicationKey(l.name) === key).length;
}

/** Whether a medication was taken at all on a day. */
export function hasDoseOnDay(
  logs: readonly MedicationLog[],
  dayKey: string,
  key: string,
): boolean {
  return logs.some(l => l.dayKey === dayKey && medicationKey(l.name) === key);
}

/**
 * The dose as a phrase — "20 mg", "2 tablets" — or null when none was stated.
 *
 * Null rather than an empty string so a caller has to decide what a dose with
 * no amount looks like in its own row, instead of concatenating a blank into
 * the middle of a sentence.
 */
export function formatDose(log: MedicationLog): string | null {
  if (log.amount === null || !log.unit) return null;
  const spec = DOSE_UNITS.find(u => u.value === log.unit);
  const unit = log.amount !== 1 && spec?.plural ? spec.plural : log.unit;
  return `${log.amount} ${unit}`;
}

/**
 * A one-line summary of a dose, for a list row.
 *
 * The name leads because it is the thing being identified; the dose follows it
 * where one was stated. An as-needed dose says so, since that is the
 * difference between a dose that was due and a dose somebody decided to take.
 */
export function medicationLogSummary(log: MedicationLog): string {
  const parts: string[] = [log.name.trim()];
  const dose = formatDose(log);
  if (dose) parts.push(dose);
  if (log.asNeeded) parts.push('as needed');
  return parts.join(' · ');
}

/**
 * Whether a medication is one taken as needed.
 *
 * True when *any* dose of it said so, which deliberately errs toward as-needed
 * for a medication logged both ways. That is the safe direction: the reads
 * this gates are the ones that would be drawn backwards for a medicine taken
 * in response to a symptom (see this file's header), so a medication the app
 * is unsure about should be treated as the one where it keeps quiet.
 */
export function isAsNeededMedication(
  logs: readonly MedicationLog[],
  key: string,
): boolean {
  return logs.some(l => medicationKey(l.name) === key && l.asNeeded);
}

/** What one medication's history adds up to. Counting only — no comparisons. */
export interface MedicationStat {
  key: string;
  /** The most recent spelling, since entries arrive newest first. */
  name: string;
  doses: number;
  /** Distinct days carrying at least one dose — not the same as `doses`. */
  days: number;
  lastTakenAt: string;
  asNeeded: boolean;
  /** The dose phrase seen most often, or null when none was ever stated. */
  typicalDose: string | null;
}

/**
 * Every medication you have logged, with what it adds up to, most recent first.
 *
 * **No threshold**, the same call `symptomStats` makes and for the reason
 * `docs/arch/mood-log.md` gives: `MIN_PAIRED_DAYS` and its neighbours govern
 * comparisons between two variables, and counting one variable is not a
 * comparison. Somebody who has taken something twice is entitled to see both
 * of those days.
 */
export function medicationStats(logs: readonly MedicationLog[]): MedicationStat[] {
  const byKey = new Map<string, MedicationLog[]>();
  for (const log of logs) {
    const key = medicationKey(log.name);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(log);
    else byKey.set(key, [log]);
  }

  const stats: MedicationStat[] = [];
  for (const [key, entries] of byKey) {
    const sorted = [...entries].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    const doseCounts = new Map<string, number>();
    for (const entry of sorted) {
      const dose = formatDose(entry);
      if (dose) doseCounts.set(dose, (doseCounts.get(dose) ?? 0) + 1);
    }
    const typicalDose = [...doseCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    stats.push({
      key,
      name: sorted[0].name.trim(),
      doses: sorted.length,
      days: new Set(sorted.map(e => e.dayKey)).size,
      lastTakenAt: sorted[0].takenAt,
      asNeeded: sorted.some(e => e.asNeeded),
      typicalDose,
    });
  }
  return stats.sort((a, b) => b.lastTakenAt.localeCompare(a.lastTakenAt));
}

/**
 * A stored `YYYY-MM-DD` key back into a local-midnight Date.
 *
 * The time marker is load-bearing: `new Date('2026-09-11')` parses as UTC
 * midnight and reads as the previous day anywhere behind UTC, which would slide
 * every window by one. Same rule `dayKeyToDate` follows in `dateUtils.ts`,
 * written out here rather than imported because that module reaches the
 * settings store and this one is deliberately pure — the call `moodInsights.ts`
 * makes for the same reason.
 */
function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

/** The `days` day keys ending on `endDayKey`, inclusive, oldest first. */
function windowKeys(endDayKey: string, days: number): string[] {
  const end = keyToDate(endDayKey);
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(format(subDays(end, i), 'yyyy-MM-dd'));
  return keys;
}

/** How many doses of one medication fall in the `days` days ending on a day. */
export function doseCountInWindow(
  logs: readonly MedicationLog[],
  key: string,
  endDayKey: string,
  days: number,
): number {
  const keys = new Set(windowKeys(endDayKey, days));
  return logs.filter(l => medicationKey(l.name) === key && keys.has(l.dayKey)).length;
}

/**
 * How often you reached for something lately, against the stretch before it.
 *
 * The one comparison in this file, and the only read here that needs a gate.
 * For an as-needed medicine this is the number that actually gets asked about
 * — "nine inhaler uses this month against three last month" is the shape of
 * the question, and it is a question about the medicine's *use*, not a claim
 * about what the medicine did. That is the whole reason it is safe to draw
 * where a symptom contrast is not (see this file's header).
 */
export interface FrequencyTrend {
  /** Doses in the `days` days ending on the day asked about. */
  recent: number;
  /** Doses in the `days` days immediately before that. */
  previous: number;
  days: number;
}

/**
 * The frequency comparison, or null when it would not mean anything.
 *
 * Two refusals, both versions of "a day you didn't log is not a zero":
 *
 * - **The log has to have been running for both windows.** An app installed
 *   ten days ago has an empty earlier window for a reason that has nothing to
 *   do with the medicine, and the comparison would read as a dramatic increase
 *   every time. The test is the whole log's earliest entry rather than this
 *   medication's, because using the medicine's own first dose would put that
 *   dose inside the earlier window by construction and bias it upward.
 * - **`MIN_TREND_DOSES` between the two windows.** One against two is a
 *   doubling and says nothing.
 *
 * What it still cannot know is whether a quiet fortnight was a fortnight of
 * not needing it or a fortnight of not recording it. Nothing here can fix
 * that; it is why the copy around it says "recorded" rather than "taken".
 */
export function frequencyTrend(
  logs: readonly MedicationLog[],
  key: string,
  endDayKey: string,
  days: number,
): FrequencyTrend | null {
  if (days < 1 || logs.length === 0) return null;

  const previousEnd = format(subDays(keyToDate(endDayKey), days), 'yyyy-MM-dd');
  const earliestCovered = windowKeys(previousEnd, days)[0];
  const logStart = logs.reduce(
    (min, l) => (l.dayKey < min ? l.dayKey : min),
    logs[0].dayKey,
  );
  if (logStart > earliestCovered) return null;

  const recent = doseCountInWindow(logs, key, endDayKey, days);
  const previous = doseCountInWindow(logs, key, previousEnd, days);
  if (recent + previous < MIN_TREND_DOSES) return null;

  return { recent, previous, days };
}
