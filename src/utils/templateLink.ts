/**
 * A task that points at a template to run later (`Task.templateId`): the
 * rules for what its row shows, what deleting the template does to it, and
 * where the apply sheet starts.
 *
 * The link is a reminder to run a template once its questions can be
 * answered, so nothing here ever requires a run: the task is an ordinary
 * task, and running the template is one way to finish it.
 *
 * A deleted template leaves the id behind on purpose and the row says so
 * ("Template deleted"), because a button that vanishes or does nothing is a
 * failure nobody is told about. Deleting a template warns about the tasks
 * that point at it first (`linkedTasksNote`).
 */
import type { Project, Task, TaskTemplate } from '@/types';
import type { TemplateAnchors } from './templateUtils';

export type TemplateLinkState =
  | { kind: 'none' }
  | { kind: 'ready'; template: TaskTemplate }
  | { kind: 'missing' };

/** What a task's template link looks like on its row. A finished task shows no button. */
export function templateLinkState(
  task: Pick<Task, 'templateId' | 'completed' | 'archived'>,
  templates: readonly TaskTemplate[],
): TemplateLinkState {
  if (!task.templateId || task.completed || task.archived) return { kind: 'none' };
  const template = templates.find((t) => t.id === task.templateId);
  return template ? { kind: 'ready', template } : { kind: 'missing' };
}

export function runTemplateLabel(template: Pick<TaskTemplate, 'name'>): string {
  return `Run ${template.name}`;
}

/** Open tasks that run each of the given templates, counted per template id. */
export function linkedTaskCounts(
  tasks: readonly Pick<Task, 'templateId' | 'completed' | 'archived' | 'parentId'>[],
  templateIds: readonly string[],
): Map<string, number> {
  const wanted = new Set(templateIds);
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (!t.templateId || !wanted.has(t.templateId)) continue;
    if (t.completed || t.archived) continue;
    counts.set(t.templateId, (counts.get(t.templateId) ?? 0) + 1);
  }
  return counts;
}

/** The sentence a delete confirmation adds when open tasks run the template. Empty when none do. */
export function linkedTasksNote(count: number, templates = 1): string {
  if (count <= 0) return '';
  const which = templates > 1 ? 'these templates' : 'this template';
  const who = count === 1 ? '1 task runs' : `${count} tasks run`;
  const them = count === 1 ? 'it' : 'them';
  return `${who} ${which} from ${count === 1 ? 'its' : 'their'} row. ${count === 1 ? 'It' : 'They'} will keep ${count === 1 ? 'its' : 'their'} reminder, but the button will read "Template deleted" until you remove the link or pick another template. Undoing the delete brings ${them} back.`;
}

/**
 * The dates the apply sheet starts from for a task in a project. A project
 * with a trip span is left to the sheet, which already reads it; a project
 * that has only an event date starts and ends on that day.
 */
export function anchorsForRun(
  project: Pick<Project, 'awayStart' | 'eventDate'> | null | undefined,
): TemplateAnchors | undefined {
  if (!project || project.awayStart) return undefined;
  if (!project.eventDate) return undefined;
  const day = new Date(project.eventDate);
  if (Number.isNaN(day.getTime())) return undefined;
  return { start: day, end: day };
}
