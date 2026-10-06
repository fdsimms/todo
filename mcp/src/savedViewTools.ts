/**
 * Saved views: the lenses a person has built over every open task (#2679),
 * so an agent can answer "what's in my Errands view" by the name they use.
 *
 * A view is a name, an icon and a list of clauses that every task must pass
 * (`src/utils/savedViews.ts`). The tasks it holds are computed by the app's own
 * matcher through the replica, with the app's own held-back rule and logical
 * day, so the count here is the count the Saved Views screen shows.
 *
 * `create_saved_view` runs the clauses through the app's own parser
 * (`parseSavedViewClauses`), the way the automation rules go through theirs:
 * the parser is tolerant, dropping a clause it cannot read and keeping the
 * first of two of one kind, so a save compares what survived with what was
 * asked and refuses the difference rather than storing a view that means
 * less than it was told to. Category names and project ids are checked
 * against the person's own, since a clause naming a category nobody has
 * matches nothing for ever with nothing on screen to say why.
 */
import type { SavedView, SavedViewClause, Task } from '../../src/types';
import type { Replica } from './replica';
import { serializeTasks, type SerializedTask } from './serialize';
// Pure over its arguments (its header says nothing in it reads a store), so
// safe to import for its value; the matcher itself runs in the replica, since
// the held-back rule it needs does reach the stores.
import {
  DEFAULT_SAVED_VIEW_ICON,
  SAVED_VIEW_CLAUSE_KINDS,
  SAVED_VIEW_ICONS,
  describeSavedView,
  parseSavedViewClauses,
} from '../../src/utils/savedViews';

export const SAVED_VIEW_TASK_LIMIT = 100;

export interface SavedViewRow {
  id: string;
  name: string;
  icon: string;
  /** The clauses as stored, every one of which a task has to pass. */
  clauses: SavedViewClause[];
  /** The clauses in words, the subtitle the app shows under the name. */
  selects: string;
  /** Open top-level tasks the view holds right now. */
  count: number;
}

function projectNames(replica: Replica): Map<string, string> {
  return new Map(replica.projects().map(p => [p.id, p.title]));
}

function row(replica: Replica, view: SavedView, names: Map<string, string>): SavedViewRow {
  return {
    id: view.id,
    name: view.name,
    icon: view.icon,
    clauses: view.clauses,
    selects: describeSavedView(view.clauses, { projectNames: names }),
    count: replica.savedViewTasks(view.clauses).length,
  };
}

export interface SavedViewList {
  views: SavedViewRow[];
  note: string;
}

export function listSavedViews(replica: Replica): SavedViewList {
  const names = projectNames(replica);
  return {
    views: replica.savedViews().map(v => row(replica, v, names)),
    note: 'A view is a lens over every open top-level task, across Today, Later, Unscheduled and Inbox at once; a task has to pass every clause. get_saved_view lists what one holds.',
  };
}

/** A view by id, or by name (case does not matter), or a refusal naming the views there are. */
function findView(replica: Replica, ref: string): SavedView {
  const views = replica.savedViews();
  const wanted = ref.trim().toLowerCase();
  const found = views.find(v => v.id === ref) ?? views.find(v => v.name.trim().toLowerCase() === wanted);
  if (!found) {
    const names = views.map(v => `"${v.name}"`).join(', ');
    throw new Error(`No saved view called "${ref}".${names ? ` The views are ${names}.` : ' There are none yet.'}`);
  }
  return found;
}

export interface SavedViewResult {
  view: SavedViewRow;
  tasks: SerializedTask[];
  /** Set when the view holds more tasks than were returned. */
  truncated?: { shown: number; of: number };
}

export function getSavedView(replica: Replica, ref: string, limit = SAVED_VIEW_TASK_LIMIT): SavedViewResult {
  const view = findView(replica, ref);
  const held: Task[] = replica.savedViewTasks(view.clauses);
  const cap = Math.min(Math.max(limit, 1), SAVED_VIEW_TASK_LIMIT);
  const shown = held.slice(0, cap);
  return {
    view: row(replica, view, projectNames(replica)),
    tasks: serializeTasks(replica, shown),
    ...(held.length > shown.length ? { truncated: { shown: shown.length, of: held.length } } : {}),
  };
}

export interface CreateSavedViewInput {
  name: string;
  /** One of `SAVED_VIEW_ICONS`. Defaults to the bookmark. */
  icon?: string;
  /** Clauses in the stored shape; see the tool description for each kind's fields. */
  clauses?: unknown[];
}

/** What a clause of each kind has to carry, for the refusal that names it. */
const CLAUSE_SHAPES: Record<string, string> = {
  category: '{ kind: "category", values: [category names] }',
  tag: '{ kind: "tag", values: [tags] }',
  project: '{ kind: "project", values: [project ids] }',
  priority: '{ kind: "priority", values: [0 to 4] }',
  effort: '{ kind: "effort", values: [0 to 6] }',
  maxMinutes: '{ kind: "maxMinutes", minutes: a positive number }',
  overdue: '{ kind: "overdue", overdue: true or false }',
  hasReminder: '{ kind: "hasReminder", hasReminder: true or false }',
  heldBack: '{ kind: "heldBack", heldBack: true or false }',
  undated: '{ kind: "undated", undated: true or false }',
};

/**
 * The clauses the app would store for what was asked, or a refusal. The
 * parser is the app's own; this only compares its answer with the request.
 */
export function checkSavedViewClauses(replica: Replica, clauses: readonly unknown[]): SavedViewClause[] {
  const kept = parseSavedViewClauses(JSON.stringify(clauses));
  if (kept.length !== clauses.length) {
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const raw of clauses) {
      const kind = raw && typeof raw === 'object' ? String((raw as { kind?: unknown }).kind) : 'undefined';
      if (!SAVED_VIEW_CLAUSE_KINDS.includes(kind as SavedViewClause['kind'])) {
        problems.push(`"${kind}" is not a clause kind; the kinds are ${SAVED_VIEW_CLAUSE_KINDS.join(', ')}.`);
      } else if (seen.has(kind)) {
        problems.push(`Two ${kind} clauses: a view holds one of each kind.`);
      } else if (!kept.some(c => c.kind === kind)) {
        problems.push(`The ${kind} clause is not in the shape the app stores: ${CLAUSE_SHAPES[kind]}.`);
      }
      seen.add(kind);
    }
    throw new Error(problems.join(' '));
  }
  const categories = new Set(replica.categories().map(c => c.name));
  const projects = new Set(replica.projects().map(p => p.id));
  for (const clause of kept) {
    if (clause.kind === 'category') {
      const unknown = clause.values.filter(v => !categories.has(v));
      if (unknown.length) throw new Error(`No category called ${unknown.map(v => `"${v}"`).join(', ')}. list_categories names them.`);
    }
    if (clause.kind === 'project') {
      const unknown = clause.values.filter(v => !projects.has(v));
      if (unknown.length) throw new Error(`No project with id ${unknown.join(', ')}. list_projects names them.`);
    }
  }
  return kept;
}

export function createSavedView(replica: Replica, input: CreateSavedViewInput): { view: SavedViewRow } {
  const name = input.name.trim();
  if (!name) throw new Error('A saved view needs a name.');
  const taken = replica.savedViews().find(v => v.name.trim().toLowerCase() === name.toLowerCase());
  if (taken) throw new Error(`There is already a saved view called "${taken.name}". Views are referred to by name here, so pick another.`);
  const icon = input.icon ?? DEFAULT_SAVED_VIEW_ICON;
  if (!SAVED_VIEW_ICONS.includes(icon)) throw new Error(`"${icon}" is not an icon a view can wear. The choices are ${SAVED_VIEW_ICONS.join(', ')}.`);
  const clauses = checkSavedViewClauses(replica, input.clauses ?? []);
  const view = replica.createSavedView(name, icon, clauses);
  return { view: row(replica, view, projectNames(replica)) };
}

export function deleteSavedView(replica: Replica, ref: string): { removed: SavedViewRow } {
  const view = findView(replica, ref);
  const names = projectNames(replica);
  const before = row(replica, view, names);
  replica.deleteSavedView(view.id);
  return { removed: before };
}
