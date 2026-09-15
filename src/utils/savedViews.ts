import type { Effort, Priority, SavedViewClause, SavedViewClauseKind, Task } from '../types';
import { EFFORT_LABELS, PRIORITY_LABELS } from '../types';
import { overdueDayCount } from './clockTime';
import { estimatedMinutesFor } from './effort';

/**
 * Matching a saved view against a task (#2679) — the rules half of the lens
 * whose shape lives on `SavedView` in types/index.ts.
 *
 * **Nothing here reads a store.** `visibilityUtils` reaches the settings and
 * category stores and so expo-sqlite, which would drag this module and its
 * tests out of Jest's `node` environment, and `pinSuggest` (which owns the
 * only other overdue read) does the same. So the two things a clause needs
 * from the rest of the app arrive on the context instead: the logical day's
 * start, and the app's own held-back rule. The screen passes the real
 * `isHeldBack` down. Same discipline, and the same reason, as `timeBlock.ts`.
 *
 * **A view is evaluated over every live top-level task, not over one list.**
 * `filterTasksForView` applies that base itself rather than taking Today's
 * selector output, because the whole complaint the feature answers is that
 * the old filter state was scoped to whichever of Today, Later, Unscheduled
 * and Inbox you happened to be looking at. "Everything tagged #errand that has
 * slipped" spans all four, and a lens that stopped at one of them would be the
 * thing it replaced.
 */

/** Clause kinds in the order the editor draws their controls. */
export const SAVED_VIEW_CLAUSE_KINDS: readonly SavedViewClauseKind[] = [
  'category',
  'tag',
  'project',
  'priority',
  'effort',
  'maxMinutes',
  'overdue',
  'hasReminder',
  'heldBack',
  'undated',
];

/** The editor's heading for each clause's control. */
export function savedViewClauseLabel(kind: SavedViewClauseKind): string {
  switch (kind) {
    case 'category': return 'Category';
    case 'tag': return 'Tags';
    case 'project': return 'Project';
    case 'priority': return 'Priority';
    case 'effort': return 'Effort';
    case 'maxMinutes': return 'Time estimate';
    case 'overdue': return 'Overdue';
    case 'hasReminder': return 'Reminder';
    case 'heldBack': return 'Blocked';
    case 'undated': return 'Date';
  }
}

/**
 * The glyphs a view may wear. Closed rather than free text because the name is
 * typed and the icon is picked: a row of choices can't produce an Ionicons
 * name the library doesn't have, and that name renders as nothing at all.
 */
export const SAVED_VIEW_ICONS: readonly string[] = [
  'bookmark-outline',
  'flash-outline',
  'home-outline',
  'briefcase-outline',
  'cart-outline',
  'call-outline',
  'people-outline',
  'alarm-outline',
  'leaf-outline',
  'barbell-outline',
  'book-outline',
  'star-outline',
];

export const DEFAULT_SAVED_VIEW_ICON = SAVED_VIEW_ICONS[0];

/** Everything a clause needs that this module refuses to fetch for itself. */
export interface SavedViewContext {
  /** Start of the current logical day, from `getCurrentDayStart()`. */
  todayStart: Date;
  /** The app's own held-back rule (`isHeldBack`), passed rather than imported. */
  heldBack: (task: Task) => boolean;
}

/**
 * Whether one clause admits a task.
 *
 * **An empty value list is inert, not impossible.** A category clause with
 * nothing selected is a control the user has opened and not yet answered, and
 * reading that as "match nothing" would empty the list underneath them while
 * they were still choosing. It matches the existing filter sheet, where an
 * empty `filterPriorities` means no priority filtering rather than no tasks.
 */
export function matchesClause(
  task: Task,
  clause: SavedViewClause,
  ctx: SavedViewContext,
): boolean {
  switch (clause.kind) {
    case 'category':
      if (clause.values.length === 0) return true;
      return task.category !== null && clause.values.includes(task.category);
    case 'tag':
      if (clause.values.length === 0) return true;
      return task.tags.some(tag => clause.values.includes(tag));
    case 'project':
      if (clause.values.length === 0) return true;
      return task.projectId !== null && clause.values.includes(task.projectId);
    case 'priority':
      if (clause.values.length === 0) return true;
      return clause.values.includes(task.priority);
    case 'effort':
      if (clause.values.length === 0) return true;
      return clause.values.includes(task.effort);
    case 'maxMinutes': {
      // Through estimatedMinutesFor, like every other workload read: mid-chain
      // only one step is on the day, and the task-level number covers the whole
      // chain. A task with neither an estimate nor an effort answers null, and
      // null is refused rather than admitted — an unestimated task is not known
      // to be under ten minutes, and saying it is would be the one way a
      // "quick wins" view fills up with things that aren't.
      const minutes = estimatedMinutesFor(task);
      return minutes !== null && minutes <= clause.minutes;
    }
    case 'overdue': {
      const late = task.dueDate === null
        ? null
        : overdueDayCount(task.dueDate, ctx.todayStart);
      return (late !== null && late > 0) === clause.overdue;
    }
    case 'hasReminder':
      return (task.reminderTime !== null) === clause.hasReminder;
    case 'heldBack':
      return ctx.heldBack(task) === clause.heldBack;
    case 'undated':
      return (task.dueDate === null && task.deferUntil === null) === clause.undated;
  }
}

/** Every clause has to admit the task. No clauses at all means everything. */
export function matchesSavedView(
  task: Task,
  clauses: readonly SavedViewClause[],
  ctx: SavedViewContext,
): boolean {
  return clauses.every(clause => matchesClause(task, clause, ctx));
}

/**
 * Whether a task is eligible to appear in any saved view at all.
 *
 * Top-level only, for the reason every other list applies: a subtask is a step
 * of its parent rather than a row of its own. Completed and archived are out
 * because a view is a lens over work outstanding; Logbook and Archived are
 * where the other two live, and both already have a screen.
 */
export function isSavedViewCandidate(task: Task): boolean {
  return !task.parentId && !task.completed && !task.archived;
}

/** The tasks one view holds, in the caller's incoming order. */
export function filterTasksForView(
  tasks: readonly Task[],
  clauses: readonly SavedViewClause[],
  ctx: SavedViewContext,
): Task[] {
  return tasks.filter(
    task => isSavedViewCandidate(task) && matchesSavedView(task, clauses, ctx),
  );
}

/** Names to render ids with, so a description never shows a raw id. */
export interface SavedViewLabels {
  projectNames?: ReadonlyMap<string, string>;
}

function joinValues(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values[0]}, ${values[1]} +${values.length - 2}`;
}

/** One clause as a phrase, or null when it is inert and says nothing. */
export function describeSavedViewClause(
  clause: SavedViewClause,
  labels?: SavedViewLabels,
): string | null {
  switch (clause.kind) {
    case 'category':
      return joinValues(clause.values);
    case 'tag': {
      const joined = joinValues(clause.values.map(tag => `#${tag}`));
      return joined;
    }
    case 'project': {
      const names = clause.values.map(
        // A project deleted out from under a view still has to render as
        // something a person recognizes as a project, never as a base36 id.
        id => labels?.projectNames?.get(id) ?? 'a project',
      );
      return joinValues(names);
    }
    case 'priority': {
      const joined = joinValues(clause.values.map(p => PRIORITY_LABELS[p]));
      return joined === null ? null : `${joined} priority`;
    }
    case 'effort': {
      const joined = joinValues(clause.values.map(e => EFFORT_LABELS[e]));
      return joined === null ? null : `${joined} effort`;
    }
    case 'maxMinutes':
      return `Under ${clause.minutes} min`;
    case 'overdue':
      return clause.overdue ? 'Overdue' : 'Not overdue';
    case 'hasReminder':
      return clause.hasReminder ? 'Has a reminder' : 'No reminder';
    case 'heldBack':
      return clause.heldBack ? 'Blocked' : 'Not blocked';
    case 'undated':
      return clause.undated ? 'No date' : 'Has a date';
  }
}

/**
 * The subtitle under a view's name: what it actually selects, in one line.
 *
 * A view with no clauses says "Everything" rather than nothing, because an
 * empty subtitle reads as a row that failed to load.
 */
export function describeSavedView(
  clauses: readonly SavedViewClause[],
  labels?: SavedViewLabels,
): string {
  const parts = clauses
    .map(clause => describeSavedViewClause(clause, labels))
    .filter((part): part is string => part !== null);
  return parts.length === 0 ? 'Everything' : parts.join(' · ');
}

// ==== Storage ====

/** The probe shape a stored clause is checked against before it is trusted. */
interface ClauseProbe {
  kind?: unknown;
  values?: unknown;
  minutes?: unknown;
  overdue?: unknown;
  hasReminder?: unknown;
  heldBack?: unknown;
  undated?: unknown;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

function isNumberList(value: unknown, max: number): boolean {
  return Array.isArray(value)
    && value.every(v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max);
}

function isClause(value: unknown): value is SavedViewClause {
  if (typeof value !== 'object' || value === null) return false;
  const probe = value as ClauseProbe;
  switch (probe.kind) {
    case 'category':
    case 'tag':
    case 'project':
      return isStringList(probe.values);
    case 'priority':
      return isNumberList(probe.values, 4);
    case 'effort':
      return isNumberList(probe.values, 6);
    case 'maxMinutes':
      return typeof probe.minutes === 'number'
        && Number.isFinite(probe.minutes)
        && probe.minutes > 0;
    case 'overdue':
      return typeof probe.overdue === 'boolean';
    case 'hasReminder':
      return typeof probe.hasReminder === 'boolean';
    case 'heldBack':
      return typeof probe.heldBack === 'boolean';
    case 'undated':
      return typeof probe.undated === 'boolean';
    default:
      return false;
  }
}

/**
 * Read a view's clauses back out of its JSON column.
 *
 * Deliberately forgiving, on `parsePendingImport`'s reasoning rather than the
 * bare `JSON.parse` most array columns use: this one is parsed while mapping
 * rows, so a throw would take down not just the malformed view but every view
 * after it in the read. A clause that fails its check is dropped and the rest
 * of the view survives, which costs one predicate rather than the whole lens.
 *
 * **At most one clause per kind, first one wins.** Two category clauses would
 * AND against a field holding one value and so could never both match, and the
 * editor draws one control per kind, so a second is corruption rather than
 * intent.
 */
export function parseSavedViewClauses(raw: string | null | undefined): SavedViewClause[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<SavedViewClauseKind>();
  const clauses: SavedViewClause[] = [];
  for (const entry of parsed) {
    if (!isClause(entry)) continue;
    if (seen.has(entry.kind)) continue;
    seen.add(entry.kind);
    clauses.push(entry);
  }
  return clauses;
}

/**
 * The clauses that stand for the task list's own filter state.
 *
 * This is the bridge the feature is reached across: the filter sheet is where
 * someone has already said what they want to see, so "save as view" should
 * mean exactly what is on screen rather than making them rebuild it in a
 * second form. An empty selection contributes no clause at all, for the same
 * reason `matchesClause` treats one as inert: a filter nobody set is not a
 * predicate.
 */
export function clausesFromFilters(filters: {
  priorities: readonly Priority[];
  efforts: readonly Effort[];
  hasReminder: boolean;
}): SavedViewClause[] {
  const clauses: SavedViewClause[] = [];
  if (filters.priorities.length > 0) {
    clauses.push({ kind: 'priority', values: [...filters.priorities] });
  }
  if (filters.efforts.length > 0) {
    clauses.push({ kind: 'effort', values: [...filters.efforts] });
  }
  if (filters.hasReminder) {
    clauses.push({ kind: 'hasReminder', hasReminder: true });
  }
  return clauses;
}

/** The four clauses whose control has three positions: Any, yes, no. */
export type SavedViewTriKind = 'overdue' | 'hasReminder' | 'heldBack' | 'undated';

export type SavedViewTriState = 'any' | 'yes' | 'no';

/**
 * Which position a two-value clause's control sits in.
 *
 * "Any" is the absence of the clause rather than a third stored value, so a
 * view never carries a predicate that admits everything — which is what keeps
 * `describeSavedView` honest about what it is actually filtering on.
 */
export function savedViewTriState(clause: SavedViewClause | undefined): SavedViewTriState {
  if (clause === undefined) return 'any';
  switch (clause.kind) {
    case 'overdue': return clause.overdue ? 'yes' : 'no';
    case 'hasReminder': return clause.hasReminder ? 'yes' : 'no';
    case 'heldBack': return clause.heldBack ? 'yes' : 'no';
    case 'undated': return clause.undated ? 'yes' : 'no';
    default: return 'any';
  }
}

/** The clause a tri-state control's yes/no position means. */
export function savedViewTriClause(kind: SavedViewTriKind, yes: boolean): SavedViewClause {
  switch (kind) {
    case 'overdue': return { kind: 'overdue', overdue: yes };
    case 'hasReminder': return { kind: 'hasReminder', hasReminder: yes };
    case 'heldBack': return { kind: 'heldBack', heldBack: yes };
    case 'undated': return { kind: 'undated', undated: yes };
  }
}

export function serializeSavedViewClauses(clauses: readonly SavedViewClause[]): string {
  return JSON.stringify(clauses);
}

/** Replace a kind's clause, or drop it when `clause` is null. Editor-facing. */
export function withClause(
  clauses: readonly SavedViewClause[],
  kind: SavedViewClauseKind,
  clause: SavedViewClause | null,
): SavedViewClause[] {
  const without = clauses.filter(c => c.kind !== kind);
  if (clause === null) return without;
  // Kept in the editor's own order so a view's description reads the same way
  // the form that built it did, rather than in the order the controls were
  // touched.
  return [...without, clause].sort(
    (a, b) => SAVED_VIEW_CLAUSE_KINDS.indexOf(a.kind) - SAVED_VIEW_CLAUSE_KINDS.indexOf(b.kind),
  );
}

export function clauseOfKind<K extends SavedViewClauseKind>(
  clauses: readonly SavedViewClause[],
  kind: K,
): Extract<SavedViewClause, { kind: K }> | null {
  const found = clauses.find(c => c.kind === kind);
  return (found as Extract<SavedViewClause, { kind: K }> | undefined) ?? null;
}
