/**
 * Experiments: a change tried for a set stretch of days, read against the same
 * number of days just before it started. See `docs/arch/mood-log.md`,
 * "Experiments", and `Experiment` in `src/types/wellbeing.ts`.
 *
 * Pure, like `moodInsights.ts`, and held to that file's three rules: nothing
 * compared below `MIN_PAIRED_DAYS`, `MIN_CONTRAST_DAYS` on each side, and a day
 * you didn't log is absent rather than a zero. The comparison is between two
 * stretches of time, so it can say what was different and never why.
 */
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import type { Experiment, Milestone, MoodLog, SymptomSeverity } from '../types';
import { dayMoodAverage, symptomKey } from './moodLog';
import { MIN_CONTRAST_DAYS, MIN_PAIRED_DAYS } from './moodInsights';

/** Lengths the sheet offers, in days. A picked end date covers anything else. */
export const EXPERIMENT_LENGTH_PRESETS: readonly { days: number; label: string }[] = [
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 28, label: '4 weeks' },
  { days: 56, label: '8 weeks' },
];

/** A length in days, said the way the presets say it when it is one of them. */
export function describeLength(days: number): string {
  const preset = EXPERIMENT_LENGTH_PRESETS.find(p => p.days === days);
  if (preset) return preset.label;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The length a new experiment starts with. */
export const DEFAULT_EXPERIMENT_DAYS = 28;

export const EXPERIMENT_LABEL_MAX_LENGTH = 80;

export type ExperimentStatus = 'upcoming' | 'running' | 'finished';

// `dayKeyOf`/`dayKeyToDate`'s arithmetic, written out here because importing
// dateUtils pulls in the settings store (and SQLite), which this pure module
// and the MCP server's read of it must not.
function dayKeyOf(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function dayKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function shiftKey(dayKey: string, days: number): string {
  return dayKeyOf(addDays(dayKeyToDate(dayKey), days));
}

/** Whole days from one key to another, off local midnight so DST can't shave one. */
function daysFrom(fromKey: string, toKey: string): number {
  return Math.round((dayKeyToDate(toKey).getTime() - dayKeyToDate(fromKey).getTime()) / 86400000);
}

/** The day a stored noon-anchored date falls on. */
export function experimentDayKey(iso: string): string {
  return dayKeyOf(new Date(iso));
}

/** The experiment's days, and the baseline it is read against. Every bound is inclusive. */
export interface ExperimentSpan {
  startKey: string;
  endKey: string;
  /** Days from start to end, both counted. */
  lengthDays: number;
  /** The same number of days, ending the day before it starts. */
  baselineFromKey: string;
  baselineToKey: string;
}

export function experimentSpan(experiment: Pick<Experiment, 'startDate' | 'endDate'>): ExperimentSpan {
  const startKey = experimentDayKey(experiment.startDate);
  const endKey = experimentDayKey(experiment.endDate);
  const lengthDays = Math.max(1, daysFrom(startKey, endKey) + 1);
  return {
    startKey,
    endKey,
    lengthDays,
    baselineFromKey: shiftKey(startKey, -lengthDays),
    baselineToKey: shiftKey(startKey, -1),
  };
}

export function experimentStatus(
  experiment: Pick<Experiment, 'startDate' | 'endDate'>,
  todayKey: string,
): ExperimentStatus {
  const { startKey, endKey } = experimentSpan(experiment);
  if (todayKey < startKey) return 'upcoming';
  if (todayKey > endKey) return 'finished';
  return 'running';
}

/** Which day of it today is ("day 12 of 28"), clamped to the experiment's own days. */
export function experimentProgress(
  experiment: Pick<Experiment, 'startDate' | 'endDate'>,
  todayKey: string,
): { day: number; of: number } {
  const { startKey, lengthDays } = experimentSpan(experiment);
  const day = Math.min(lengthDays, Math.max(0, daysFrom(startKey, todayKey) + 1));
  return { day, of: lengthDays };
}

/** Symptom names cleaned for storing: trimmed, blanks dropped, one per `symptomKey`, first spelling kept. */
export function cleanExperimentSymptoms(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    const key = symptomKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Why an experiment can't be saved as it stands, or null when it can. The
 * store refuses on exactly this, and the sheet shows it under the field, so
 * the two can't disagree.
 */
export function experimentRefusal(draft: { label: string; startDate: Date; endDate: Date }): string | null {
  if (!draft.label.trim()) return 'Give it a name: what you’re trying, in a few words.';
  if (dayKeyOf(draft.endDate) < dayKeyOf(draft.startDate)) return 'It can’t end before it starts.';
  return null;
}

/** Average mood over the baseline and over the days of the experiment so far. */
export interface ExperimentMoodRead {
  beforeDays: number;
  duringDays: number;
  moodBefore: number;
  moodDuring: number;
  /** Positive means a better mood during it. */
  delta: number;
}

/** One side of a symptom read. */
export interface SymptomSide {
  /** Days logged in the stretch that could have recorded it (on or after it was first logged). */
  loggedDays: number;
  /** Of those, the days it was logged. */
  daysWith: number;
  /** Mean of each day's worst severity, over the days it was logged, or null with none. */
  averageSeverity: number | null;
}

export interface ExperimentSymptomRead {
  key: string;
  /** The name to show: as picked, or as last logged for one that wasn't picked. */
  name: string;
  /** Picked in advance as what the experiment was set up to change. */
  picked: boolean;
  before: SymptomSide;
  during: SymptomSide;
  /** Past the minimums on both sides, so the two rates may be shown against each other. */
  comparable: boolean;
  /** The first day it was ever logged, or null for one never logged at all. */
  firstLoggedKey: string | null;
}

export interface ExperimentResult {
  status: ExperimentStatus;
  span: ExperimentSpan;
  /** The last day read: the end, or today while it's running. Null before it starts. */
  readToKey: string | null;
  /** Days with any entry in each stretch, for the captions. */
  loggedDaysBefore: number;
  loggedDaysDuring: number;
  /** Null until both stretches have enough days with a mood. */
  mood: ExperimentMoodRead | null;
  /** Every picked symptom, comparable or not, in the order picked. */
  picked: ExperimentSymptomRead[];
  /** Every other symptom that is comparable and turned up in either stretch, biggest change in rate first. */
  others: ExperimentSymptomRead[];
}

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Worst severity per symptom key per day, and the set of days with any entry. */
function indexLogs(logs: readonly MoodLog[]) {
  const loggedDays = new Set<string>();
  const worst = new Map<string, Map<string, SymptomSeverity>>();
  const firstLogged = new Map<string, string>();
  const lastName = new Map<string, { at: string; name: string }>();
  for (const log of logs) {
    loggedDays.add(log.dayKey);
    for (const symptom of log.symptoms) {
      const key = symptomKey(symptom.name);
      if (!key) continue;
      let byDay = worst.get(key);
      if (!byDay) { byDay = new Map(); worst.set(key, byDay); }
      const seen = byDay.get(log.dayKey);
      if (seen === undefined || symptom.severity > seen) byDay.set(log.dayKey, symptom.severity);
      const first = firstLogged.get(key);
      if (first === undefined || log.dayKey < first) firstLogged.set(key, log.dayKey);
      const last = lastName.get(key);
      if (!last || log.loggedAt > last.at) lastName.set(key, { at: log.loggedAt, name: symptom.name.trim() });
    }
  }
  return { loggedDays, worst, firstLogged, lastName };
}

function inRange(key: string, from: string, to: string): boolean {
  return key >= from && key <= to;
}

function side(
  days: readonly string[],
  byDay: ReadonlyMap<string, SymptomSeverity> | undefined,
  firstLoggedKey: string | null,
): SymptomSide {
  // Before the symptom was ever logged, a day without it says nothing: the
  // person wasn't recording it yet. Same rule `contrastsFor` applies.
  const eligible = firstLoggedKey === null ? [] : days.filter(d => d >= firstLoggedKey);
  const severities = eligible.map(d => byDay?.get(d)).filter((s): s is SymptomSeverity => s !== undefined);
  return {
    loggedDays: eligible.length,
    daysWith: severities.length,
    averageSeverity: severities.length ? mean(severities) : null,
  };
}

function isComparable(before: SymptomSide, during: SymptomSide): boolean {
  return before.loggedDays >= MIN_CONTRAST_DAYS
    && during.loggedDays >= MIN_CONTRAST_DAYS
    && before.loggedDays + during.loggedDays >= MIN_PAIRED_DAYS;
}

/** A side's share of logged days with the symptom, 0 for a side with none logged. */
export function symptomRate(s: SymptomSide): number {
  return s.loggedDays ? s.daysWith / s.loggedDays : 0;
}

/**
 * The whole read of one experiment against the mood log.
 *
 * Mood and every symptom are compared over the same two stretches: the
 * baseline (as many days as the experiment lasts, ending the day before it
 * starts) and the experiment's own days up to today or its end. A day counts
 * on a side only if something was logged on it; a mood needs a day with a mood.
 */
export function experimentResult(
  experiment: Experiment,
  logs: readonly MoodLog[],
  todayKey: string,
): ExperimentResult {
  const span = experimentSpan(experiment);
  const status = experimentStatus(experiment, todayKey);
  const readToKey = status === 'upcoming' ? null : (status === 'finished' ? span.endKey : todayKey);
  const { loggedDays, worst, firstLogged, lastName } = indexLogs(logs);

  const allDays = [...loggedDays].sort();
  // The baseline ends before today too, for an experiment whose start is
  // still ahead: a day that hasn't happened has nothing to read.
  const beforeDays = allDays.filter(d => inRange(d, span.baselineFromKey, span.baselineToKey) && d <= todayKey);
  const duringDays = readToKey === null ? [] : allDays.filter(d => inRange(d, span.startKey, readToKey));

  const moodsBefore = beforeDays.map(d => dayMoodAverage(logs, d)).filter((m): m is number => m !== null);
  const moodsDuring = duringDays.map(d => dayMoodAverage(logs, d)).filter((m): m is number => m !== null);
  const mood = moodsBefore.length >= MIN_CONTRAST_DAYS
    && moodsDuring.length >= MIN_CONTRAST_DAYS
    && moodsBefore.length + moodsDuring.length >= MIN_PAIRED_DAYS
    ? {
      beforeDays: moodsBefore.length,
      duringDays: moodsDuring.length,
      moodBefore: mean(moodsBefore),
      moodDuring: mean(moodsDuring),
      delta: mean(moodsDuring) - mean(moodsBefore),
    }
    : null;

  const read = (key: string, name: string, picked: boolean): ExperimentSymptomRead => {
    const firstLoggedKey = firstLogged.get(key) ?? null;
    const before = side(beforeDays, worst.get(key), firstLoggedKey);
    const during = side(duringDays, worst.get(key), firstLoggedKey);
    return { key, name, picked, before, during, comparable: isComparable(before, during), firstLoggedKey };
  };

  const pickedKeys = new Set<string>();
  const picked: ExperimentSymptomRead[] = [];
  for (const name of cleanExperimentSymptoms(experiment.symptoms)) {
    const key = symptomKey(name);
    pickedKeys.add(key);
    picked.push(read(key, name, true));
  }

  const others: ExperimentSymptomRead[] = [];
  for (const key of worst.keys()) {
    if (pickedKeys.has(key)) continue;
    const row = read(key, lastName.get(key)?.name ?? key, false);
    if (!row.comparable) continue;
    if (row.before.daysWith === 0 && row.during.daysWith === 0) continue;
    others.push(row);
  }
  others.sort((a, b) =>
    Math.abs(symptomRate(b.during) - symptomRate(b.before)) - Math.abs(symptomRate(a.during) - symptomRate(a.before))
    || a.name.localeCompare(b.name));

  return {
    status,
    span,
    readToKey,
    loggedDaysBefore: beforeDays.length,
    loggedDaysDuring: duringDays.length,
    mood,
    picked,
    others,
  };
}

/** Something else that changed inside the stretch an experiment is read over. */
export interface OverlappingChange {
  kind: 'milestone' | 'experiment';
  id: string;
  label: string;
  /** The milestone's day, or the other experiment's first day. */
  dayKey: string;
}

/**
 * Milestones dated inside the baseline or the experiment's days, and other
 * experiments whose days overlap them. Each one could account for some of a
 * difference, so the page names them rather than leaving the reader to
 * remember.
 */
export function overlappingChanges(
  experiment: Experiment,
  milestones: readonly Milestone[],
  experiments: readonly Experiment[],
): OverlappingChange[] {
  const span = experimentSpan(experiment);
  const from = span.baselineFromKey;
  const to = span.endKey;
  const out: OverlappingChange[] = [];
  for (const m of milestones) {
    const key = experimentDayKey(m.date);
    if (inRange(key, from, to)) out.push({ kind: 'milestone', id: m.id, label: m.label, dayKey: key });
  }
  for (const other of experiments) {
    if (other.id === experiment.id) continue;
    const o = experimentSpan(other);
    if (o.startKey <= to && o.endKey >= from) {
      out.push({ kind: 'experiment', id: other.id, label: other.label, dayKey: o.startKey });
    }
  }
  return out.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.label.localeCompare(b.label));
}

/** Rounds a mean severity to the nearest level, for the words "mild", "moderate", "severe". */
export function roundedSeverity(average: number): SymptomSeverity {
  return Math.min(3, Math.max(1, Math.round(average))) as SymptomSeverity;
}

/** Experiments in the order the Mood screen lists them: running, then upcoming, then finished most recent first. */
export function sortExperimentsForList(experiments: readonly Experiment[], todayKey: string): Experiment[] {
  const rank: Record<ExperimentStatus, number> = { running: 0, upcoming: 1, finished: 2 };
  return [...experiments].sort((a, b) => {
    const sa = experimentStatus(a, todayKey);
    const sb = experimentStatus(b, todayKey);
    if (sa !== sb) return rank[sa] - rank[sb];
    if (sa === 'finished') return b.endDate.localeCompare(a.endDate);
    return a.startDate.localeCompare(b.startDate);
  });
}
