/**
 * A task that starts a planned experiment (`Task.experimentId`): what its row
 * shows, and the words for starting it. See `docs/arch/mood-log.md`,
 * "Experiments", "Planned, and started by a task".
 *
 * Modeled on `templateLink.ts`, with one difference: finishing the task by a
 * plain check-off never starts the experiment. The start day is what the
 * comparison is anchored to, so a check-off done a day late, or to clear the
 * list, would silently move it; the row's button, or an explicit yes when
 * checking off, is what starts it.
 *
 * A deleted experiment leaves the id on the task and the row says so, the
 * same choice `templateLink.ts` makes. So does an experiment that is not on
 * this phone: tasks sync everywhere, experiments only with the health logs.
 */
import { format } from 'date-fns/format';
import type { Experiment, Task } from '@/types';
import { experimentDayKey, experimentSpan, experimentStatus } from './experiments';

export type ExperimentLinkState =
  | { kind: 'none' }
  /** Planned: the row offers "Start <label>". */
  | { kind: 'start'; experiment: Experiment }
  /** Already begun (upcoming, running or finished): the row offers "View experiment". */
  | { kind: 'view'; experiment: Experiment }
  | { kind: 'missing' };

/** What a task's experiment link looks like on its row. A finished or archived task shows no button. */
export function experimentLinkState(
  task: Pick<Task, 'experimentId' | 'completed' | 'archived'>,
  experiments: readonly Experiment[],
  todayKey: string,
): ExperimentLinkState {
  if (!task.experimentId || task.completed || task.archived) return { kind: 'none' };
  const experiment = experiments.find(e => e.id === task.experimentId);
  if (!experiment) return { kind: 'missing' };
  return experimentStatus(experiment, todayKey) === 'planned'
    ? { kind: 'start', experiment }
    : { kind: 'view', experiment };
}

export function startExperimentLabel(experiment: Pick<Experiment, 'label'>): string {
  return `Start ${experiment.label}`;
}

/** The row's words for a link that has nothing to start. */
export const VIEW_EXPERIMENT_LABEL = 'View experiment';
export const MISSING_EXPERIMENT_LABEL = 'Experiment not found';

function shortDate(dayKey: string): string {
  return format(new Date(`${dayKey}T00:00:00`), 'MMM d');
}

/** The confirmation after starting: "CoQ10 started, ends Dec 15." or, with no last day, "runs until you stop it." */
export function experimentStartedMessage(experiment: Pick<Experiment, 'label' | 'startDate' | 'endDate'>): string {
  const span = experiment.startDate ? experimentSpan(experiment, experimentDayKey(experiment.startDate)) : null;
  const ends = experiment.endDate && span ? `ends ${shortDate(span.endKey)}` : 'runs until you stop it';
  return `${experiment.label} started, ${ends}.`;
}

/** Open tasks that start each of the given experiments, counted per experiment id. */
export function linkedExperimentTaskCounts(
  tasks: readonly Pick<Task, 'experimentId' | 'completed' | 'archived' | 'parentId'>[],
  experimentIds: readonly string[],
): Map<string, number> {
  const wanted = new Set(experimentIds);
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (!t.experimentId || !wanted.has(t.experimentId)) continue;
    if (t.completed || t.archived) continue;
    counts.set(t.experimentId, (counts.get(t.experimentId) ?? 0) + 1);
  }
  return counts;
}

/** The sentence a delete confirmation adds when open tasks start the experiment. Empty when none do. */
export function linkedExperimentTasksNote(count: number): string {
  if (count <= 0) return '';
  const who = count === 1 ? '1 task starts' : `${count} tasks start`;
  const it = count === 1 ? 'It' : 'They';
  return `${who} this experiment from ${count === 1 ? 'its' : 'their'} row. ${it} will keep the reminder, but the button will read "${MISSING_EXPERIMENT_LABEL}" until you remove the link.`;
}
