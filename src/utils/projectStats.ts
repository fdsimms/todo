import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Project, Task } from '../types';
import { projectProgress } from '../store/useProjectStore';
import { getDayStart } from './dateUtils';

/**
 * What the Stats screen says about projects.
 *
 * There was nothing: `stats.ts` and `StatsScreen` had no project reference at
 * all, even though every input already existed — `projectProgress` for how far
 * along one is, `Project.createdAt`/`completedAt` for how long it took. The
 * area with the app's only progress bar was the one area the stats screen
 * couldn't describe. `cookingStats.ts` is the precedent for a per-area module
 * rather than piling this into `stats.ts`, which is task-only.
 *
 * Deliberately retrospective, like everything else on that screen. "Which
 * project has gone quiet" is a real question and it is *not* this one's: it is
 * answered as a task you can defer (see `projectReviewTasks.ts`), and repeating
 * it here as a statistic would be the banner that feature deleted, wearing a
 * chart.
 */

/** How many finished projects the screen lists back. */
export const RECENT_FINISHED_LIMIT = 5;

export interface FinishedProject {
  project: Project;
  /** Calendar days from creation to completion. Never negative. */
  days: number;
}

export interface ProjectStatsSummary {
  /** Neither finished nor filed away. */
  active: number;
  /** Marked complete, ever — including the ones archived afterwards. */
  finished: number;
  finishedThisYear: number;
  /** Members done and total across the active projects, aggregated. */
  activeDone: number;
  activeTotal: number;
  /**
   * Median days from creation to completion across every finished project, or
   * null with none to measure.
   *
   * Median rather than mean, and the reason is the shape of the data rather
   * than a preference: one project started in January and finished in November
   * drags a mean of five two-week projects past a month, which describes
   * nothing anyone did. Half the projects took less than this is a claim that
   * survives an outlier.
   */
  typicalDays: number | null;
  /** Newest first, capped at RECENT_FINISHED_LIMIT. */
  recentlyFinished: FinishedProject[];
}

/** Calendar days between two stamps, floored at 0. */
function spanDays(from: string, to: string): number {
  return Math.max(0, differenceInCalendarDays(getDayStart(new Date(to)), getDayStart(new Date(from))));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function projectStats(
  projects: readonly Project[],
  tasks: readonly Task[],
  /** Injected so a test can pin it; defaults to the real clock. */
  now: Date = new Date(),
): ProjectStatsSummary {
  const active = projects.filter(p => !p.completed && !p.archived);

  let activeDone = 0;
  let activeTotal = 0;
  for (const project of active) {
    const progress = projectProgress(project.id, tasks as Task[]);
    activeDone += progress.done;
    activeTotal += progress.total;
  }

  // Archived-and-completed still counts as finished: archiving is filing a
  // project away, and a project can be filed away long after it was done.
  // Only `completed` says the work ended.
  const finishedAll = projects.filter(p => p.completed && p.completedAt !== null);
  const thisYear = now.getFullYear();

  const withDays: FinishedProject[] = finishedAll.map(project => ({
    project,
    days: spanDays(project.createdAt, project.completedAt!),
  }));

  const recentlyFinished = [...withDays]
    .sort((a, b) => (b.project.completedAt ?? '').localeCompare(a.project.completedAt ?? ''))
    .slice(0, RECENT_FINISHED_LIMIT);

  return {
    active: active.length,
    finished: finishedAll.length,
    finishedThisYear: finishedAll.filter(p => new Date(p.completedAt!).getFullYear() === thisYear).length,
    activeDone,
    activeTotal,
    typicalDays: median(withDays.map(f => f.days)),
    recentlyFinished,
  };
}
