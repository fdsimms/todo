import type { NutrientKey, Task } from '../types';
import { goalTargetDayOf, goalTargetKeyOf } from './goalTargetTasks';
import { figure, limitWarningKeyOf, shortName } from './limitWarningTasks';
import { limitStatus, targetProgress, type NutritionTargets } from './nutritionTargets';

/**
 * The progress bar a Stay under or Aim for task draws under its title, and
 * which nutrients those tasks already cover on Today.
 *
 * **A nutrient is one thing on Today, not a row and a task.** Both used to be
 * drawn for the same nutrient ("Protein 51 of 150g" and "Aim for 150g protein
 * · 51g so far"), so the task now carries the bar the row had and the row
 * steps aside while its task is there, the rule meal rows already follow
 * (`hasCookTask`). A nutrient with no task keeps its plain row.
 *
 * Pure: the bar is a view of the same totals the row read, so the two can't
 * disagree about the fill or the tone.
 */

export interface NutrientTaskBar {
  /** 0..1, full once a limit is reached or a goal met. */
  fraction: number;
  /** Orange when the day is close to a limit, red once it is past; null otherwise. */
  tone: 'near' | 'over' | null;
}

/**
 * The bar for a generated limit or goal task, or null for any other task and
 * for one whose nutrient no longer has a target.
 */
export function nutrientTaskBar(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
  totals: Partial<Record<NutrientKey, number>>,
  targets: NutritionTargets,
  warnPercent: number,
): NutrientTaskBar | null {
  if (task.generatedKind === 'limitWarning') {
    const key = limitWarningKeyOf(task.generatedSourceId);
    const target = key ? targets[key] : undefined;
    if (!key || target === undefined) return null;
    const total = totals[key] ?? 0;
    const status = limitStatus(key, total, targets, warnPercent);
    return {
      // Full at or past the limit, so a day over reads as a solid bar.
      fraction: target > 0 ? Math.min(1, Math.max(0, total / target)) : total > 0 ? 1 : 0,
      tone: status === 'within' ? null : status,
    };
  }
  if (task.generatedKind === 'goalTarget') {
    const key = goalTargetKeyOf(task.generatedSourceId);
    if (!key || targets[key] === undefined) return null;
    // No tone: whether passing a goal is good is not something the app is told.
    return { fraction: targetProgress(key, totals[key], targets), tone: null };
  }
  return null;
}

export interface NutrientTaskLine {
  /** "Sat fat": the nutrient, capitalised. The Stay under / Aim for wording stays in the task's own title. */
  name: string;
  /** "24.9 / 16g": today's total against the target, the unit once. */
  figure: string;
}

/**
 * The one line a Stay under or Aim for row draws in place of its title, or null
 * for any other task and for one whose nutrient no longer has a target. The
 * title still says the whole sentence (it is the accessibility label and what
 * Search finds); the row only needs the nutrient and where the day stands.
 */
export function nutrientTaskLine(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
  totals: Partial<Record<NutrientKey, number>>,
  targets: NutritionTargets,
): NutrientTaskLine | null {
  const key = task.generatedKind === 'limitWarning' ? limitWarningKeyOf(task.generatedSourceId)
    : task.generatedKind === 'goalTarget' ? goalTargetKeyOf(task.generatedSourceId)
    : null;
  const target = key ? targets[key] : undefined;
  if (!key || target === undefined) return null;
  const name = shortName(key);
  const total = Math.round((totals[key] ?? 0) * 10) / 10;
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    figure: `${total.toLocaleString('en-US')} / ${figure(key, target)}`,
  };
}

/**
 * The nutrients a Stay under or Aim for task stands for today, so Today leaves
 * their rows out. Archived tasks don't count (archiving is how a person stops
 * tracking one), and a goal task counts for its own day only. A goal task
 * already checked off still counts: the goal was reached, and the row coming
 * back at a full bar would say it again.
 */
export function nutrientsCoveredByTasks(
  tasks: readonly Pick<Task, 'generatedKind' | 'generatedSourceId' | 'archived'>[],
  todayKey: string,
): NutrientKey[] {
  const covered = new Set<NutrientKey>();
  for (const task of tasks) {
    if (task.archived) continue;
    if (task.generatedKind === 'limitWarning') {
      const key = limitWarningKeyOf(task.generatedSourceId);
      if (key) covered.add(key);
    } else if (task.generatedKind === 'goalTarget' && goalTargetDayOf(task.generatedSourceId) === todayKey) {
      const key = goalTargetKeyOf(task.generatedSourceId);
      if (key) covered.add(key);
    }
  }
  return [...covered];
}
