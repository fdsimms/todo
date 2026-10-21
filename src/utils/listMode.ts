import type { Project, Task, TaskGroup } from '../types';

/**
 * Lists inside Projects: a project or a section whose rows are items to check
 * off (a wish list, gift ideas, a packing list) rather than tasks to schedule.
 *
 * Every reader of "is this a list" goes through here, because the answer is
 * two fields deep: `Project.list` makes the whole project a list, and a
 * section can say otherwise in either direction (`TaskGroup.checklist` turns
 * one section of an ordinary project into a list, `TaskGroup.keepsTasks` keeps
 * one section of a list project a task section). Reading either field alone
 * gets the other case wrong.
 *
 * What a list changes is deliberately small, and adds no actions of its own:
 * the counts ("7 items · 1 checked" instead of progress and "Next"), what a
 * row shows (no category chip), a plain add field, which editor rows show,
 * and that nothing in it is offered as complete, nudged or pulled. An item is
 * still an ordinary task underneath, so one given a date is on Today like any
 * other. The List project type this replaces (#3574) grew a dozen list-only
 * controls and rewrote the project's settings on every conversion; neither is
 * coming back.
 */

type ListFlags = Pick<TaskGroup, 'checklist' | 'keepsTasks'>;
type ProjectListFlag = Pick<Project, 'list'>;

/** Whether a project section is a list. A section's own setting outranks its project's. */
export function sectionIsList(group: ListFlags, project: ProjectListFlag | null | undefined): boolean {
  if (group.checklist) return true;
  return !!project?.list && !group.keepsTasks;
}

/**
 * The patch the section editor's List switch writes. Only one of the two
 * flags is ever left on, and which one depends on the project: in a list
 * project "List" is the default and off is the override, in any other
 * project it is the other way round.
 */
export function sectionListPatch(
  wantList: boolean,
  project: ProjectListFlag | null | undefined,
): Required<ListFlags> {
  if (project?.list) return { checklist: false, keepsTasks: !wantList };
  return { checklist: wantList, keepsTasks: false };
}

/**
 * A finder for list items over one snapshot of the sections and projects,
 * built once per pass rather than once per task.
 *
 * A subtask is never an item: it is a step under its row, list or not. A row
 * in a project section follows `sectionIsList` with the section's own home
 * project. Anything else (no section, or a stack that isn't a project
 * section) is an item exactly when its own project is a list.
 */
export function listItemFinder(
  groups: readonly TaskGroup[],
  projects: readonly Project[],
): (task: Pick<Task, 'groupId' | 'projectId' | 'parentId'>) => boolean {
  const projectsById = new Map(projects.map(p => [p.id, p]));
  const sectionLists = new Map<string, boolean>();
  for (const g of groups) {
    if (g.projectId) sectionLists.set(g.id, sectionIsList(g, projectsById.get(g.projectId)));
  }
  return task => {
    if (task.parentId) return false;
    if (task.groupId) {
      const section = sectionLists.get(task.groupId);
      if (section !== undefined) return section;
    }
    return !!(task.projectId && projectsById.get(task.projectId)?.list);
  };
}

/**
 * A project with no finish line: never offered as complete, never
 * auto-completed, left out of completion stats. Ongoing says so outright; a
 * list says so by being a list.
 */
export function isOpenEnded(project: Pick<Project, 'ongoing' | 'list'>): boolean {
  return project.ongoing || !!project.list;
}

/** "7 items · 1 checked": a list's count, where a task project shows progress. */
export function listCountNote(open: number, checked: number): string {
  if (open === 0 && checked === 0) return 'No items yet';
  const items = `${open} ${open === 1 ? 'item' : 'items'}`;
  return checked > 0 ? `${items} · ${checked} checked` : items;
}

/**
 * The task editor's rows a list item shows (`EditorGroupRow.key`), on top of
 * any row that already holds a value. The rest of the form (kind, repeat,
 * deadline, time window, blockers, follow-ups, supply, streaks, priority and
 * effort, and so on) is a task's, and is one "Show all fields" away.
 *
 * Category is deliberately not here: it shows only when set, which is the
 * same rule every other hidden row follows.
 */
export const LIST_ITEM_EDITOR_ROWS: ReadonlySet<string> = new Set([
  'date', 'remindMe',
  'pin',
  'tags', 'project', 'stack',
  'people', 'location',
  'link',
]);

/** Does an editor row render for a list item? A row holding a value always does. */
export function listItemRowShown(key: string, set: boolean): boolean {
  return set || LIST_ITEM_EDITOR_ROWS.has(key);
}
