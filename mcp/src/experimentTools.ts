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
  describeProgress,
  endOfLength,
  experimentProgress,
  experimentResult,
  experimentStatus,
  overlappingChanges,
  roundedSeverity,
  averageSeverityValue,
  type ExperimentSymptomRead,
} from '../../src/utils/experiments';
import { severityLabel } from '../../src/utils/moodLog';
import type { Replica } from './replica';
import { eventNoonIso } from './taskFields';
import { createTask, completeTask } from './tools';
import type { GetTaskResult } from './tools';
import type { TaskFieldsInput } from './taskFields';

const RULES = 'An experiment with status "planned" has no start date yet: it is defined (what, which symptoms) and compared with nothing until start_experiment gives it one, today or an earlier day the person really began. Its baseline is then the same number of days before that real start. One with no end (days left out of start_experiment) runs until stop_experiment, and while it runs its baseline is as long as it has run so far, so its comparison shifts each day; stopping fixes it. One started today records the moment it began, and entries logged earlier that day count as neither before nor during. Each experiment is compared with the same number of days just before it started, counting only days the person logged. Mood and each symptom need at least 3 logged days on each side and 10 in all before a comparison is given. The symptoms under "watched" were picked in advance as what it was meant to change; "otherSymptoms" were not, and with several compared one can differ by chance, so say so if you mention one. A difference between the two stretches does not show the experiment caused it, and "alsoChanged" names other changes in the same days. Experiments reach this server only with Include health logs turned on for the sync server on the phone, so an empty list is not evidence that none exist.';

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

interface SymptomRow {
  name: string;
  before?: { daysWith: number; daysLogged: number; usually?: string; averageSeverity?: number };
  during?: { daysWith: number; daysLogged: number; usually?: string; averageSeverity?: number };
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
    ...(s.averageSeverity !== null
      ? {
        usually: severityLabel(roundedSeverity(s.averageSeverity)).toLowerCase(),
        // 1 (mild) to 3 (severe), one decimal: the word above rounds 1.6 and 2.4 alike.
        averageSeverity: averageSeverityValue(s.averageSeverity),
      }
      : {}),
  });
  return { name: r.name, before: side(r.before), during: side(r.during) };
}

export interface ExperimentRow {
  id: string;
  label: string;
  /** `YYYY-MM-DD`, the first and last day, both included. */
  startDate?: string;
  endDate?: string;
  status: 'planned' | 'upcoming' | 'running' | 'finished';
  /** "12 of 28" while it runs, or just "12" when it has no end. */
  day?: string;
  /** The length it will have when started, for a planned one (null when it will have no end). */
  plannedDays?: number | null;
  /** True while it runs with no last day, until stop_experiment. */
  openEnded?: boolean;
  /** Open tasks whose row starts it (their `experimentId`), by id and title. */
  startTasks?: { id: string; title: string }[];
  /** The days it is compared with, both included. Absent while planned. */
  comparedWith?: { from: string; to: string };
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
  const startTasks = replica.tasks()
    .filter(t => t.experimentId === e.id && !t.completed && !t.archived)
    .map(t => ({ id: t.id, title: t.title }));
  return {
    id: e.id,
    label: e.label,
    ...(span ? { startDate: span.startKey, ...(e.endDate ? { endDate: span.endKey } : {}) } : {}),
    status,
    ...(status === 'running' ? { day: describeProgress(progress) } : {}),
    ...(status === 'planned' ? { plannedDays: e.days } : {}),
    ...(span && !e.endDate ? { openEnded: true } : {}),
    ...(startTasks.length ? { startTasks } : {}),
    ...(span ? { comparedWith: { from: span.baselineFromKey, to: span.baselineToKey } } : {}),
    ...(e.note ? { expected: e.note } : {}),
    ...(status === 'upcoming' || status === 'planned'
      ? {}
      : {
        mood: result.mood
          ? { before: round(result.mood.moodBefore), during: round(result.mood.moodDuring), daysBefore: result.mood.beforeDays, daysDuring: result.mood.duringDays }
          : { note: `Not enough days with a mood yet: ${result.loggedDaysBefore} logged before, ${result.loggedDaysDuring} during.` },
      }),
    watched: status === 'upcoming' || status === 'planned' ? e.symptoms.map(name => ({ name })) : result.picked.map(symptomRow),
    otherSymptoms: status === 'upcoming' || status === 'planned' ? [] : result.others.map(symptomRow),
    alsoChanged: overlappingChanges(e, replica.milestones(), all, todayKey).map(c => ({ kind: c.kind, label: c.label, date: c.dayKey })),
  };
}

/**
 * Planned ones come back apart from the rest: they are not compared with
 * anything, so they sit beside the running and finished ones rather than among
 * them with their numbers missing.
 */
export function listExperiments(replica: Replica): { experiments: ExperimentRow[]; planned: ExperimentRow[]; rules: string } {
  const all = replica.experiments();
  const rows = all.map(e => row(replica, e, all));
  return {
    experiments: rows.filter(r => r.status !== 'planned'),
    planned: rows.filter(r => r.status === 'planned'),
    rules: RULES,
  };
}

/** A bare day as the noon the sheet would store, or a refusal naming the field. */
function noonOf(value: string, field: string): Date {
  const iso = eventNoonIso(value);
  if (!iso) throw new Error(`${field}: "${value}" is not a date I can read. Use YYYY-MM-DD.`);
  return new Date(iso);
}

export interface AddExperimentInput {
  label: string;
  /** `YYYY-MM-DD`. Defaults to the person's logical today, unless `planned`. */
  startDate?: string;
  /** `YYYY-MM-DD`, the last day. Give this or `days`. */
  endDate?: string;
  /** How many days it lasts, counting the first. Used when `endDate` is not given; default 28. */
  days?: number;
  /** Leave it undated: it waits as "planned" until start_experiment. */
  planned?: boolean;
  symptoms?: string[];
  expected?: string;
}

export function addExperiment(replica: Replica, input: AddExperimentInput): { experiment: ExperimentRow; rules: string } {
  if (input.planned && (input.startDate !== undefined || input.endDate !== undefined)) {
    throw new Error('A planned experiment has no dates yet. Leave out startDate and endDate, or leave out planned to start it now.');
  }
  const planned = !!input.planned;
  const startDate = planned ? null : noonOf(input.startDate ?? replica.todayKey(), 'startDate');
  const endDate = planned || !startDate
    ? null
    : input.endDate !== undefined ? noonOf(input.endDate, 'endDate') : endOfLength(startDate, input.days ?? 28);
  const experiment = replica.addExperiment({
    label: input.label,
    startDate,
    endDate,
    ...(planned ? { days: input.days ?? 28 } : {}),
    symptoms: input.symptoms ?? [],
    note: input.expected ?? null,
  });
  return { experiment: row(replica, experiment, replica.experiments()), rules: RULES };
}

export interface StartExperimentInput {
  id: string;
  /** `YYYY-MM-DD`. Default today; an earlier day for "I actually started 3 days ago". */
  startDate?: string;
  /** Length for this run, counting the first day. Defaults to the planned length. `null` runs it until stop_experiment. */
  days?: number | null;
  /** Also check off the open tasks whose row starts it (their `experimentId`), as tapping Start on one does. Default true. */
  completeStartTasks?: boolean;
}

export function startExperiment(
  replica: Replica,
  input: StartExperimentInput,
): { experiment: ExperimentRow; completedTasks: { id: string; title: string }[]; rules: string } {
  const existing = replica.experiments().find(e => e.id === input.id);
  if (!existing) throw new Error(`No experiment with id ${input.id}. list_experiments names them.`);
  if (existing.startDate) throw new Error('That experiment has already started. update_experiment changes its days, and stop_experiment ends one that has no end.');
  const todayKey = replica.todayKey();
  const startKey = input.startDate ?? todayKey;
  if (startKey > todayKey) throw new Error('startDate is in the future. Start it on the day it really begins, or leave it planned until then.');
  const experiment = replica.startExperiment(input.id, {
    startDate: noonOf(startKey, 'startDate'),
    ...(input.days !== undefined ? { days: input.days } : {}),
  });
  const completedTasks: { id: string; title: string }[] = [];
  if (input.completeStartTasks !== false) {
    for (const t of replica.tasks().filter(t => t.experimentId === input.id && !t.completed && !t.archived)) {
      completeTask(replica, t.id);
      completedTasks.push({ id: t.id, title: t.title });
    }
  }
  return {
    experiment: row(replica, experiment, replica.experiments()),
    completedTasks,
    rules: RULES,
  };
}

export function stopExperiment(
  replica: Replica,
  input: { id: string; endDate?: string },
): { experiment: ExperimentRow; rules: string } {
  const existing = replica.experiments().find(e => e.id === input.id);
  if (!existing) throw new Error(`No experiment with id ${input.id}. list_experiments names them.`);
  if (!existing.startDate) throw new Error('That experiment has not started, so there is nothing to stop. start_experiment begins it, or delete_experiment removes it.');
  const todayKey = replica.todayKey();
  if (experimentStatus(existing, todayKey) === 'finished') throw new Error('That experiment has already ended.');
  const experiment = replica.stopExperiment(input.id, noonOf(input.endDate ?? todayKey, 'endDate'));
  return { experiment: row(replica, experiment, replica.experiments()), rules: RULES };
}

export interface PlanExperimentInput extends Omit<AddExperimentInput, 'planned' | 'startDate' | 'endDate'> {
  /** The task whose row starts it: its fields, as create_task takes them (a category is required). `title` defaults to "Start <label>". */
  task: TaskFieldsInput & { title?: string };
}

/**
 * A planned experiment and the task that starts it, in one write, so planning
 * from a chat is one step. The task is an ordinary top-level task: dated or
 * undated, deferred, in a project, waiting on others.
 */
export function planExperiment(
  replica: Replica,
  input: PlanExperimentInput,
): { experiment: ExperimentRow; task: GetTaskResult; rules: string } {
  const { task: taskInput, ...experimentInput } = input;
  const created = replica.addExperiment({
    label: experimentInput.label,
    startDate: null,
    endDate: null,
    days: experimentInput.days ?? 28,
    symptoms: experimentInput.symptoms ?? [],
    note: experimentInput.expected ?? null,
  });
  const task = createTask(replica, {
    ...taskInput,
    title: taskInput.title?.trim() || `Start ${created.label}`,
    experimentId: created.id,
  } as Parameters<typeof createTask>[1]);
  return { experiment: row(replica, created, replica.experiments()), task, rules: RULES };
}

export interface ExperimentPatchInput {
  label?: string;
  startDate?: string;
  endDate?: string;
  /** Replaces the list of symptoms to watch. */
  symptoms?: string[];
  /** Null clears it. */
  expected?: string | null;
  /** The planned length, for one not started yet. */
  days?: number;
}
export function updateExperiment(replica: Replica, id: string, patch: ExperimentPatchInput): { experiment: ExperimentRow } {
  if (Object.values(patch).every(v => v === undefined)) {
    throw new Error('Nothing to change: give a label, dates, symptoms, what is expected or the planned length.');
  }
  const existing = replica.experiments().find(e => e.id === id);
  if (existing && !existing.startDate && patch.startDate !== undefined) {
    throw new Error('That experiment has not started. start_experiment gives it a first day and begins the comparison.');
  }
  if (existing && !existing.startDate && patch.endDate !== undefined) {
    throw new Error('That experiment has not started, so it has no last day to set. Change its planned length with days, or start it first.');
  }
  const experiment = replica.updateExperiment(id, {
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.startDate !== undefined ? { startDate: noonOf(patch.startDate, 'startDate') } : {}),
    ...(patch.endDate !== undefined ? { endDate: noonOf(patch.endDate, 'endDate') } : {}),
    ...(patch.symptoms !== undefined ? { symptoms: patch.symptoms } : {}),
    ...(patch.expected !== undefined ? { note: patch.expected } : {}),
    ...(patch.days !== undefined ? { days: patch.days } : {}),
  });
  return { experiment: row(replica, experiment, replica.experiments()) };
}

export function deleteExperiment(replica: Replica, id: string): { removed: { id: string; label: string } } {
  const removed = replica.deleteExperiment(id);
  return { removed: { id: removed.id, label: removed.label } };
}
