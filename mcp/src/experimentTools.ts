/**
 * Experiments: a change tried for a set stretch of days ("No caffeine after
 * noon" for four weeks), read against the same number of days just before it
 * (docs/arch/mood-log.md, "Experiments").
 *
 * The read is the app's own (`experimentResult` in src/utils/experiments.ts),
 * so this server reports exactly what the phone's experiment page shows, under
 * the same minimum-days rules. Every write goes through `useExperimentStore`,
 * by way of the replica, so a blank name or an end before the start is
 * refused as the sheet refuses it.
 *
 * Two rules shape the words. The symptoms picked in advance are what the
 * experiment tests; the others are listed apart because, compared after the
 * fact, one will look different by chance. And the comparison is between two
 * stretches of time: it never says the change caused a difference.
 */
import type { Experiment } from '../../src/types';
import {
  experimentProgress,
  experimentResult,
  overlappingChanges,
  roundedSeverity,
  type ExperimentSymptomRead,
} from '../../src/utils/experiments';
import { severityLabel } from '../../src/utils/moodLog';
import type { Replica } from './replica';
import { eventNoonIso } from './taskFields';

const RULES = 'Each experiment is compared with the same number of days just before it started, counting only days the person logged. Mood and each symptom need at least 3 logged days on each side and 10 in all before a comparison is given. The symptoms under "watched" were picked in advance as what it was meant to change; "otherSymptoms" were not, and with several compared one can differ by chance, so say so if you mention one. A difference between the two stretches does not show the experiment caused it, and "alsoChanged" names other changes in the same days. Experiments reach this server only with Include health logs turned on for the sync server on the phone, so an empty list is not evidence that none exist.';

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

interface SymptomRow {
  name: string;
  before?: { daysWith: number; daysLogged: number; usually?: string };
  during?: { daysWith: number; daysLogged: number; usually?: string };
  note?: string;
}

function symptomRow(r: ExperimentSymptomRead): SymptomRow {
  if (!r.comparable) {
    return {
      name: r.name,
      note: r.firstLoggedKey === null ? 'Never logged, so nothing to compare.' : 'Not enough logged days on both sides yet.',
    };
  }
  const side = (s: ExperimentSymptomRead['before']) => ({
    daysWith: s.daysWith,
    daysLogged: s.loggedDays,
    ...(s.averageSeverity !== null ? { usually: severityLabel(roundedSeverity(s.averageSeverity)).toLowerCase() } : {}),
  });
  return { name: r.name, before: side(r.before), during: side(r.during) };
}

export interface ExperimentRow {
  id: string;
  label: string;
  /** `YYYY-MM-DD`, the first and last day, both included. */
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'running' | 'finished';
  /** "12 of 28" while it runs. */
  day?: string;
  /** The days it is compared with, both included. */
  comparedWith: { from: string; to: string };
  expected?: string;
  mood?: { before: number; during: number; daysBefore: number; daysDuring: number } | { note: string };
  watched: SymptomRow[];
  otherSymptoms: SymptomRow[];
  alsoChanged: { kind: 'milestone' | 'experiment'; label: string; date: string }[];
}

function row(replica: Replica, e: Experiment, all: readonly Experiment[]): ExperimentRow {
  const todayKey = replica.todayKey();
  const result = experimentResult(e, replica.allMoodLogs(), todayKey);
  const { span, status } = result;
  const progress = experimentProgress(e, todayKey);
  return {
    id: e.id,
    label: e.label,
    startDate: span.startKey,
    endDate: span.endKey,
    status,
    ...(status === 'running' ? { day: `${progress.day} of ${progress.of}` } : {}),
    comparedWith: { from: span.baselineFromKey, to: span.baselineToKey },
    ...(e.note ? { expected: e.note } : {}),
    ...(status === 'upcoming'
      ? {}
      : {
        mood: result.mood
          ? { before: round(result.mood.moodBefore), during: round(result.mood.moodDuring), daysBefore: result.mood.beforeDays, daysDuring: result.mood.duringDays }
          : { note: `Not enough days with a mood yet: ${result.loggedDaysBefore} logged before, ${result.loggedDaysDuring} during.` },
      }),
    watched: status === 'upcoming' ? e.symptoms.map(name => ({ name })) : result.picked.map(symptomRow),
    otherSymptoms: status === 'upcoming' ? [] : result.others.map(symptomRow),
    alsoChanged: overlappingChanges(e, replica.milestones(), all).map(c => ({ kind: c.kind, label: c.label, date: c.dayKey })),
  };
}

export function listExperiments(replica: Replica): { experiments: ExperimentRow[]; rules: string } {
  const all = replica.experiments();
  return { experiments: all.map(e => row(replica, e, all)), rules: RULES };
}

/** A bare day as the noon the sheet would store, or a refusal naming the field. */
function noonOf(value: string, field: string): Date {
  const iso = eventNoonIso(value);
  if (!iso) throw new Error(`${field}: "${value}" is not a date I can read. Use YYYY-MM-DD.`);
  return new Date(iso);
}

/** The last day of an experiment `days` long starting on `start`. */
function endAfter(start: Date, days: number): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return end;
}

export interface AddExperimentInput {
  label: string;
  /** `YYYY-MM-DD`. Defaults to the person's logical today. */
  startDate?: string;
  /** `YYYY-MM-DD`, the last day. Give this or `days`. */
  endDate?: string;
  /** How many days it lasts, counting the first. Used when `endDate` is not given; default 28. */
  days?: number;
  symptoms?: string[];
  expected?: string;
}

export function addExperiment(replica: Replica, input: AddExperimentInput): { experiment: ExperimentRow; rules: string } {
  const startDate = noonOf(input.startDate ?? replica.todayKey(), 'startDate');
  const endDate = input.endDate !== undefined ? noonOf(input.endDate, 'endDate') : endAfter(startDate, input.days ?? 28);
  const experiment = replica.addExperiment({
    label: input.label,
    startDate,
    endDate,
    symptoms: input.symptoms ?? [],
    note: input.expected ?? null,
  });
  return { experiment: row(replica, experiment, replica.experiments()), rules: RULES };
}

export interface ExperimentPatchInput {
  label?: string;
  startDate?: string;
  endDate?: string;
  /** Replaces the list of symptoms to watch. */
  symptoms?: string[];
  /** Null clears it. */
  expected?: string | null;
}

export function updateExperiment(replica: Replica, id: string, patch: ExperimentPatchInput): { experiment: ExperimentRow } {
  if (Object.values(patch).every(v => v === undefined)) {
    throw new Error('Nothing to change: give a label, dates, symptoms or what is expected.');
  }
  const experiment = replica.updateExperiment(id, {
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.startDate !== undefined ? { startDate: noonOf(patch.startDate, 'startDate') } : {}),
    ...(patch.endDate !== undefined ? { endDate: noonOf(patch.endDate, 'endDate') } : {}),
    ...(patch.symptoms !== undefined ? { symptoms: patch.symptoms } : {}),
    ...(patch.expected !== undefined ? { note: patch.expected } : {}),
  });
  return { experiment: row(replica, experiment, replica.experiments()) };
}

export function deleteExperiment(replica: Replica, id: string): { removed: { id: string; label: string } } {
  const removed = replica.deleteExperiment(id);
  return { removed: { id: removed.id, label: removed.label } };
}
