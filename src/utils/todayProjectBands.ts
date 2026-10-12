import type { Project, Task, TaskGroup } from '../types';
import type { ProjectListItem } from './projectStacks';

/**
 * One project gathered under its own name at the top of Today, holding what it
 * has on the day: its stacks (the project's sections) and its loose tasks.
 */
export interface TodayProjectBand {
  project: Project;
  /** In the project's own order: stacks and loose tasks share one sortOrder space. */
  items: ProjectListItem[];
  /** Every task shown in the band, loose or inside a stack. */
  taskCount: number;
}

export interface TodayProjectBands {
  bands: TodayProjectBand[];
  /** Loose tasks a band took, so the category sections leave them out. */
  bandedTaskIds: Set<string>;
  /** Stacks a band took, for the same reason. */
  bandedGroupIds: Set<string>;
}

/**
 * Pull the projects switched to `groupOnToday` out of Today's category sections
 * and into a band of their own each.
 *
 * Built from the same two inputs the category layout is (`tasks` is the
 * visible, filtered top-level list and `groupItems` the stacks with a visible
 * child), and the result says what it took, so a task is in a band *or* a
 * category section and never both.
 *
 * A stack goes to a project's band when it is homed on that project
 * (`TaskGroup.projectId`, which a template run into the project sets on every
 * section it makes), or, homed nowhere, when every member it shows today is in
 * that project. A stack homed on one project and holding another's tasks is
 * still that one's section: home is what the project page goes by too. A stack
 * whose members are split across projects, and homed on none, stays in its
 * category, since no one project can claim it.
 *
 * A loose task goes to its project's band. A stacked one rides with its stack,
 * wherever that went, so a task never leaves the stack it was filed in.
 *
 * Projects are taken in their Projects page order, and a band with nothing in
 * it today isn't returned at all, so a switched-on project with nothing due
 * draws nothing on Today.
 */
export function buildTodayProjectBands(
  tasks: readonly Task[],
  groupItems: readonly { group: TaskGroup; children: Task[] }[],
  projects: readonly Project[],
): TodayProjectBands {
  const grouped = projects.filter(p => p.groupOnToday && !p.archived);
  const bandedTaskIds = new Set<string>();
  const bandedGroupIds = new Set<string>();
  if (grouped.length === 0) return { bands: [], bandedTaskIds, bandedGroupIds };

  const groupedIds = new Set(grouped.map(p => p.id));
  const rows = new Map<string, Array<{ anchor: number; item: ProjectListItem }>>();
  const counts = new Map<string, number>();
  const add = (projectId: string, anchor: number, item: ProjectListItem, count: number) => {
    const list = rows.get(projectId);
    if (list) list.push({ anchor, item });
    else rows.set(projectId, [{ anchor, item }]);
    counts.set(projectId, (counts.get(projectId) ?? 0) + count);
  };

  for (const { group, children } of groupItems) {
    if (children.length === 0) continue;
    const home = group.projectId
      ?? (children.every(c => c.projectId === children[0].projectId) ? children[0].projectId : null);
    if (!home || !groupedIds.has(home)) continue;
    bandedGroupIds.add(group.id);
    add(home, group.sortOrder, { type: 'group', group, children }, children.length);
  }

  for (const task of tasks) {
    if (task.groupId || !task.projectId || !groupedIds.has(task.projectId)) continue;
    bandedTaskIds.add(task.id);
    add(task.projectId, task.sortOrder, { type: 'task', task }, 1);
  }

  const bands: TodayProjectBand[] = [];
  for (const project of [...grouped].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const list = rows.get(project.id);
    if (!list) continue;
    // Stable on ties, so rows that share a slot keep the order they came in.
    const items = list
      .map((row, i) => ({ ...row, i }))
      .sort((a, b) => a.anchor - b.anchor || a.i - b.i)
      .map(row => row.item);
    bands.push({ project, items, taskCount: counts.get(project.id) ?? 0 });
  }
  return { bands, bandedTaskIds, bandedGroupIds };
}
