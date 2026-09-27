import { format } from 'date-fns/format';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Project, ProjectSortOption, Task, TaskGroup } from '../types';
import { formatDeadlineDate, getCurrentDayStart } from './dateUtils';
import { describeAwaySpan } from './awayDates';
import { liveProjectSteps } from './projectOrder';
import { buildProjectListItems } from './projectStacks';
import { displayTitleFor, isHeldBack } from './visibilityUtils';

/**
 * What the Projects screen says about each project, and the order and filter
 * it lists them in. Pure, so the card's words can be pinned by tests rather
 * than read off a screenshot.
 */

export type ProjectListFilter = 'active' | 'completed' | 'archived';

export interface ProjectProgress {
  done: number;
  total: number;
}

export interface ProjectCardCaption {
  text: string;
  /** Orange on the card: a deadline passed with work still open. */
  overdue: boolean;
  /**
   * A deadline in the next few days (see DUE_SOON_DAYS), which the card sets
   * in full-strength text rather than the caption grey. Not a color of its
   * own: orange already means late, and the app's yellow doesn't hold up as
   * text on a white card.
   */
  soon?: boolean;
}

/** How many days out a deadline still counts as close: today and the next two. */
export const DUE_SOON_DAYS = 2;

function shortDate(d: Date, today: Date): string {
  return format(d, d.getFullYear() === today.getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

/**
 * A project's deadline as the card and the project screen say it.
 *
 * "Due Friday", "Due today", or "3d overdue" once it has passed with work
 * still open. It used to be `By ${formatDeadlineDate(…)}` with an `Overdue · `
 * prefix added on top, and formatDeadlineDate already says "overdue" for a
 * past date, so a late project read "Overdue · By 3d overdue". A deadline that
 * passed after every task was done isn't late for anything, so it keeps its
 * plain date instead of the count.
 */
export function describeProjectDeadline(
  project: Pick<Project, 'deadline'>,
  pastWindow: boolean,
  dayResetTime?: string,
): ProjectCardCaption | null {
  if (!project.deadline) return null;
  const date = new Date(project.deadline);
  const today = getCurrentDayStart();
  const daysOut = differenceInCalendarDays(date, today);
  if (daysOut < 0) {
    return pastWindow
      ? { text: formatDeadlineDate(project.deadline, dayResetTime), overdue: true }
      : { text: `Due ${shortDate(date, today)}`, overdue: false };
  }
  const label = formatDeadlineDate(project.deadline, dayResetTime);
  // "Today" and "Tomorrow" are relative words, so they read lowercase after
  // "Due"; a weekday or a date is a name and keeps its capital.
  const relative = label === 'Today' || label === 'Tomorrow';
  return { text: `Due ${relative ? label.toLowerCase() : label}`, overdue: false, soon: daysOut <= DUE_SOON_DAYS };
}

/**
 * The one caption under a project's title.
 *
 * On the Completed and Archived lists it's when that happened, since a
 * deadline or a trip on a project that has been filed away is history. On the
 * Active list, a live away span wins the slot over the deadline: for a trip
 * the two say nearly the same thing and the span says it better. A project
 * holding both still shows its deadline once the trip is over, since
 * describeAwaySpan goes quiet then (see docs/arch/away-dates.md).
 */
export function projectCardCaption(
  project: Project,
  pastWindow: boolean,
  filter: ProjectListFilter,
  dayResetTime?: string,
): ProjectCardCaption | null {
  const today = getCurrentDayStart();
  if (filter === 'archived' && project.archivedAt) {
    return { text: `Archived ${shortDate(new Date(project.archivedAt), today)}`, overdue: false };
  }
  if (filter === 'completed' && project.completedAt) {
    return { text: `Completed ${shortDate(new Date(project.completedAt), today)}`, overdue: false };
  }
  const away = describeAwaySpan(project, new Date(), dayResetTime);
  if (away) return { text: away, overdue: false };
  return describeProjectDeadline(project, pastWindow, dayResetTime);
}

/**
 * What the card says in place of a progress bar, or null when the bar says it.
 *
 * An empty project gets a line rather than nothing, so its card doesn't read
 * as a row that failed to load. An ongoing one (see Project.ongoing) has no
 * finish line, so a bar that can never fill is replaced by a count of what's
 * open.
 */
export function projectProgressNote(
  project: Pick<Project, 'ongoing'>,
  progress: ProjectProgress,
): string | null {
  if (progress.total === 0) return 'No tasks yet';
  if (!project.ongoing) return null;
  const open = progress.total - progress.done;
  return open === 0 ? 'Nothing open' : `${open} open`;
}

/**
 * The task the card names as next: the first one the project page lists that
 * can actually be done now. The title is the displayed one, so a chain names
 * the step it's on rather than the chain.
 *
 * Walked in the page's own order (buildProjectListItems), not by sortOrder
 * alone. A section's tasks carry their place *within* the section (1, 2, 3…),
 * so sorting every task on one number put a section's first task ahead of the
 * loose tasks above it, and tied the first tasks of every section. A task
 * waiting on another task or on a person is skipped: "Next" is what you could
 * pick up, and the page already says what it waits on.
 */
export function projectNextStepTitle(
  projectId: string,
  tasks: readonly Task[],
  groups: readonly TaskGroup[] = [],
): string | null {
  const live = liveProjectSteps(projectId, tasks);
  for (const item of buildProjectListItems(live, [...groups], projectId)) {
    const rows = item.type === 'task'
      ? [item.task]
      : [...item.children].sort((a, b) => a.sortOrder - b.sortOrder);
    const next = rows.find(t => !isHeldBack(t));
    if (next) return displayTitleFor(next);
  }
  return null;
}

/** The sort choices, in the order the menu offers them. */
export const PROJECT_SORT_OPTIONS: readonly ProjectSortOption[] = ['manual', 'deadline', 'progress', 'name'];

export const PROJECT_SORT_LABEL: Record<ProjectSortOption, string> = {
  manual: 'Your order',
  deadline: 'Deadline',
  progress: 'Closest to done',
  name: 'Name',
};

/**
 * The projects in the chosen order. Applied before grouping, so each category
 * section is sorted within itself and the sections keep the user's order.
 *
 * Every comparator falls back to the hand-set order, so projects the sort has
 * nothing to say about (no deadline, no tasks) stay where the user put them
 * rather than shuffling on each render. "Closest to done" puts empty projects
 * last: nothing done out of nothing isn't close to anything.
 */
export function sortProjects(
  projects: readonly Project[],
  sort: ProjectSortOption,
  progressById: ReadonlyMap<string, ProjectProgress>,
): Project[] {
  const byHand = (a: Project, b: Project) => a.sortOrder - b.sortOrder;
  const sorted = [...projects];
  switch (sort) {
    case 'deadline': {
      // A trip's date is its departure: trips made from a template carry no
      // deadline (the span is their date), and sank to the bottom without it.
      const due = (p: Project) => p.deadline ?? p.awayStart;
      return sorted.sort((a, b) => {
        const da = due(a);
        const db = due(b);
        if (da && db) return da.localeCompare(db) || byHand(a, b);
        if (da) return -1;
        if (db) return 1;
        return byHand(a, b);
      });
    }
    case 'progress': {
      const fraction = (p: Project) => {
        const progress = progressById.get(p.id);
        return progress && progress.total > 0 ? progress.done / progress.total : -1;
      };
      return sorted.sort((a, b) => fraction(b) - fraction(a) || byHand(a, b));
    }
    case 'name':
      return sorted.sort((a, b) => a.title.localeCompare(b.title) || byHand(a, b));
    default:
      return sorted.sort(byHand);
  }
}

/**
 * Whether a project answers a search. Every word has to appear somewhere: in
 * its name, notes, category or destination, or in the name of one of its open
 * tasks, so "passport" finds the trip it's filed under. Order is left alone,
 * like the editor's field search: a list that re-ranks as you type is one you
 * can't find your place in.
 */
export function projectMatchesQuery(
  project: Project,
  openTaskTitles: readonly string[],
  query: string,
): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    project.title,
    project.notes,
    project.category ?? '',
    project.destination ?? '',
    ...openTaskTitles,
  ].join('\n').toLocaleLowerCase();
  return words.every(word => haystack.includes(word));
}
