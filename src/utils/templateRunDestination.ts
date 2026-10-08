import type { Task } from '../types';
import { isInboxTask, isTaskVisible, isUnscheduledTask } from './visibilityUtils';

/** The four sub-views of the Today screen, which a run's tasks can land in. */
export type TemplateRunView = 'today' | 'later' | 'unscheduled' | 'inbox';

/**
 * Where a template run's tasks ended up, for the "Go to" button on the toast
 * shown after applying one. A run that made a project (or applied into one)
 * is that project's page; anything else is whichever Today sub-view holds it.
 */
export type TemplateRunDestination =
  | { kind: 'project'; projectId: string }
  | { kind: 'view'; mode: TemplateRunView };

function viewOf(task: Task): TemplateRunView {
  return isInboxTask(task)
    ? 'inbox'
    : isTaskVisible(task) ? 'today'
    : isUnscheduledTask(task) ? 'unscheduled'
    : 'later';
}

// The order a mixed run is read in: a run with anything due now is "on Today",
// and a run that is all deferred is on Later before it is anywhere undated.
const VIEW_PRIORITY: TemplateRunView[] = ['today', 'later', 'unscheduled', 'inbox'];

/**
 * A run spreads its tasks over several dates, so there is no one view they all
 * landed in. The button takes you to the most immediate one that holds any of
 * them. Subtasks are skipped: they sit under their parent and have no view of
 * their own. Null when the run created nothing.
 */
export function templateRunDestination(created: readonly Task[]): TemplateRunDestination | null {
  const top = created.filter(t => !t.parentId);
  const rows = top.length > 0 ? top : created;
  if (rows.length === 0) return null;

  const projectId = rows.find(t => t.projectId)?.projectId;
  if (projectId) return { kind: 'project', projectId };

  const views = new Set(rows.map(viewOf));
  const mode = VIEW_PRIORITY.find(v => views.has(v));
  return mode ? { kind: 'view', mode } : null;
}

const VIEW_LABEL: Record<TemplateRunView, string> = {
  today: 'Today',
  later: 'Later',
  unscheduled: 'Unscheduled',
  inbox: 'Inbox',
};

/** The button's text: "View project", or "Go to Later" and the like. */
export function templateRunDestinationLabel(destination: TemplateRunDestination): string {
  return destination.kind === 'project' ? 'View project' : `Go to ${VIEW_LABEL[destination.mode]}`;
}
