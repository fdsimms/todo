/**
 * The read-only tool surface.
 *
 * Every handler takes a `Replica` and returns plain data. Nothing here knows
 * that MCP exists — `server.ts` is where these become tools with an SDK and a
 * socket around them, and it is the only file in the package that cannot run in
 * the repo's jest. That split is the same one `syncEngine.ts` makes against
 * CloudKit, for the same reason: the part that is expensive to get right should
 * not live behind a build.
 *
 * **The lenses are the app's, not the schema's.** `list_tasks` offers Today,
 * Later, Unscheduled and Inbox because those are what the app shows and what
 * the user will ask about, and they are computed by `isTaskVisible` and
 * `isUnscheduledTask` rather than reimplemented from `due_date`. A server that
 * answered "what's on today" with `WHERE due_date = date('now')` would disagree
 * with the phone in every case the visibility model exists to handle: a
 * deferred task, a time-of-day segment that has not opened, a task held by a
 * blocker, a `dayResetTime` that is not midnight.
 */
import type { FoodLogEntry, GroceryItem, MedicationLog, MoodLog, Project, Task } from '../../src/types';
import type { Replica } from './replica';
import type { TemplatePlan } from './templatePlan';
import type { TaskDraft } from '../../src/types';
import { serializeTasks, type SerializedTask } from './serialize';

/** The four sub-views of TodayScreen, plus the everything case. */
export const TASK_VIEWS = ['today', 'later', 'unscheduled', 'inbox', 'all'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

/**
 * A cap, because a tool result is somebody's context. 50 is roughly what the
 * Today list holds before the user themselves would call it unmanageable, and
 * the response says when it truncated rather than silently ending.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface ListTasksInput {
  view?: TaskView;
  /** Category name, matched exactly — it is a stored string, not a fuzzy label. */
  category?: string;
  tag?: string;
  projectId?: string;
  /** Off by default: a completed task is history, and history is a long list. */
  includeCompleted?: boolean;
  limit?: number;
}

export interface ListTasksResult {
  view: TaskView;
  tasks: SerializedTask[];
  /** How many matched before the cap. Equal to `tasks.length` when nothing was cut. */
  matched: number;
}

function isTopLevel(task: Task): boolean {
  // Subtasks are tasks with a parent, and every top-level selector in the app
  // filters them out. A list that mixed them in would double-count the work.
  return !task.parentId;
}

export function listTasks(replica: Replica, input: ListTasksInput = {}): ListTasksResult {
  const view = input.view ?? 'today';
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const matched = replica
    .tasks()
    .filter(isTopLevel)
    .filter(t => (input.includeCompleted ? true : !t.completed))
    .filter(t => (input.category ? t.category === input.category : true))
    .filter(t => (input.tag ? t.tags.includes(input.tag) : true))
    .filter(t => (input.projectId ? t.projectId === input.projectId : true))
    .filter(t => matchesView(replica, t, view));

  return {
    view,
    matched: matched.length,
    tasks: serializeTasks(replica, matched.slice(0, limit)),
  };
}

/**
 * Today / Later / Unscheduled / Inbox are disjoint lenses over one set, exactly
 * as `TodayScreen` treats them — `isUnscheduledTask` already excludes inbox
 * tasks and `isTaskVisible` already excludes both, so these read as three
 * one-liners rather than as a partition that has to be maintained here.
 */
function matchesView(replica: Replica, task: Task, view: TaskView): boolean {
  switch (view) {
    case 'today':
      return replica.isVisible(task);
    case 'later':
      return !replica.isVisible(task) && !replica.isUnscheduled(task) && !replica.isInbox(task);
    case 'unscheduled':
      return replica.isUnscheduled(task);
    case 'inbox':
      return replica.isInbox(task);
    case 'all':
      return true;
  }
}

export interface SearchTasksInput {
  query: string;
  limit?: number;
}

export interface SearchTasksResult {
  query: string;
  tasks: SerializedTask[];
  matched: number;
}

export function searchTasks(replica: Replica, input: SearchTasksInput): SearchTasksResult {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const hits = replica.search(input.query);

  return {
    query: input.query,
    matched: hits.length,
    tasks: serializeTasks(replica, hits.slice(0, limit).map(h => h.task)),
  };
}

export interface GetTaskResult {
  task: SerializedTask;
  /** The task's own subtasks, in stored order. */
  subtasks: SerializedTask[];
  /** Every step, when the task is a chain, so the shape is visible at once. */
  chain?: { index: number; steps: string[] };
  project?: { id: string; title: string };
  /**
   * Why the task is not on Today, when it is not. Null when it is visible.
   * The date is what `getVisibleAt` returns, which is the earliest moment it
   * surfaces rather than its due date — the two differ whenever a defer, a time
   * segment or a category schedule is what is holding it.
   */
  hiddenUntil?: string;
}

export function getTask(replica: Replica, id: string): GetTaskResult | null {
  const task = replica.taskById(id);
  if (!task) return null;

  const steps = task.chainItems ?? [];
  const project = task.projectId ? replica.projects().find(p => p.id === task.projectId) : null;
  const visible = replica.isVisible(task);

  return {
    task: serializeTasks(replica, [task])[0],
    subtasks: serializeTasks(
      replica,
      replica.tasks().filter(t => t.parentId === task.id)
    ),
    chain: steps.length > 1 ? { index: task.chainIndex ?? 0, steps: steps.map(s => s.title) } : undefined,
    project: project ? { id: project.id, title: project.title } : undefined,
    hiddenUntil: visible ? undefined : replica.visibleAt(task).toISOString(),
  };
}

export interface SerializedProject {
  id: string;
  title: string;
  notes?: string;
  deadline?: string;
  /** Members finished, by the app's own reckoning. */
  done: number;
  /** Members in total. One per *series*, not one per row. */
  total: number;
  /** `total - done`, stated rather than left to be worked out. */
  outstanding: number;
}

export function listProjects(replica: Replica): SerializedProject[] {
  // Archiving is an explicit "keep this, out of my way", so an archived project
  // is not part of the answer to "what am I working on".
  return replica.projects().filter((p: Project) => !p.archived).map((p: Project) => {
    // The app's own progress read. A plain count of incomplete rows was what
    // this reported before, and it disagrees with the app on every project
    // holding a recurring member: each completion leaves a tombstone, so the
    // denominator grew for ever and a project of five habits worked daily for a
    // month read as hundreds of members.
    const { done, total } = replica.projectProgress(p.id);
    return {
      id: p.id,
      title: p.title,
      notes: p.notes || undefined,
      deadline: p.deadline ?? undefined,
      done,
      total,
      outstanding: total - done,
    };
  });
}

export interface SerializedGroceryItem {
  id: string;
  name: string;
  quantity?: string;
  aisle?: string;
  /** On the list right now, as opposed to sitting in the catalog. */
  onList: boolean;
  checked?: boolean;
}

/**
 * One row's projection, shared by the list and by every write that reports what
 * it did. Separate so a write cannot describe an item differently from the way
 * a read does a moment later.
 */
export function serializeGroceryItem(i: GroceryItem): SerializedGroceryItem {
  return {
    id: i.id,
    name: i.name,
    quantity: i.quantity || undefined,
    aisle: i.aisle || undefined,
    onList: i.onList,
    checked: i.checked ? true : undefined,
  };
}

export function listGroceryItems(
  replica: Replica,
  input: { onListOnly?: boolean } = {}
): SerializedGroceryItem[] {
  const items = replica.groceryItems();
  const wanted = input.onListOnly === false ? items : items.filter((i: GroceryItem) => i.onList);
  return wanted.map(serializeGroceryItem);
}

// ---------------------------------------------------------------------------
// The logs: food, mood, medication.
//
// All three are day-keyed, all three grow without bound, and none of them has a
// useful "everything" answer — so they share one range convention rather than
// three. `days` counts back from the logical today (`todayKey`, so a read at 1am
// under a 2am dayResetTime gets the day the user would name), and an explicit
// `from`/`to` overrides it.
//
// The fourth thing a caller will ask for is weight, and it is deliberately not
// here: it lives in Apple Health and the app stores no copy, so a replica over
// SQLite has nothing to read. docs/arch/mcp-server.md says so at more length,
// because "no weight tool" otherwise reads as an oversight rather than as the
// health model working.
// ---------------------------------------------------------------------------

export const DEFAULT_LOG_DAYS = 7;
export const MAX_LOG_DAYS = 365;

export interface LogRangeInput {
  /** Days back from today, inclusive of today. Ignored when `from` is given. */
  days?: number;
  /** `YYYY-MM-DD`. */
  from?: string;
  /** `YYYY-MM-DD`. Defaults to today when `from` is given without it. */
  to?: string;
}

export interface DayRange {
  from: string;
  to: string;
}

export function resolveRange(replica: Replica, input: LogRangeInput = {}): DayRange {
  const today = replica.todayKey();
  if (input.from) return { from: input.from, to: input.to ?? today };

  const days = Math.min(Math.max(input.days ?? DEFAULT_LOG_DAYS, 1), MAX_LOG_DAYS);
  // `days: 1` is today alone, so the shift is one less than the count.
  return { from: replica.shiftDayKey(today, -(days - 1)), to: today };
}

export interface SerializedFoodEntry {
  id: string;
  dayKey: string;
  at: string;
  /** breakfast / lunch / dinner / snack, or absent for something eaten outside a meal. */
  slot?: string;
  label: string;
  quantity?: string;
  grams?: number;
  recipeId?: string;
}

export interface FoodLogResult {
  range: DayRange;
  entries: SerializedFoodEntry[];
  /**
   * Summed nutrients over the range, and how many entries stated each one.
   * A nutrient nobody logged is absent rather than zero, which is the whole
   * point: a day logged thinly is a hole, not a small number.
   */
  totals: { total: Record<string, number>; reported: Record<string, number>; entries: number };
}

export function listFoodLog(replica: Replica, input: LogRangeInput = {}): FoodLogResult {
  const range = resolveRange(replica, input);
  const entries = replica.foodLogEntries(range.from, range.to);
  const totals = replica.foodTotals(entries);

  return {
    range,
    entries: entries.map((e: FoodLogEntry) => ({
      id: e.id,
      dayKey: e.dayKey,
      at: e.atISO,
      slot: e.slot ?? undefined,
      label: e.label,
      quantity: e.quantity || undefined,
      grams: e.grams ?? undefined,
      recipeId: e.recipeId ?? undefined,
    })),
    totals: {
      total: totals.total as Record<string, number>,
      reported: totals.reported as Record<string, number>,
      entries: totals.entries,
    },
  };
}

export interface SerializedMoodLog {
  id: string;
  dayKey: string;
  loggedAt: string;
  /** 1 to 5. Absent when the check-in recorded only symptoms. */
  mood?: number;
  symptoms?: { name: string; severity: string }[];
  contextTags?: string[];
  note?: string;
}

export function listMoodLogs(
  replica: Replica,
  input: LogRangeInput = {}
): { range: DayRange; logs: SerializedMoodLog[] } {
  const range = resolveRange(replica, input);

  return {
    range,
    logs: replica.moodLogs(range.from, range.to).map((log: MoodLog) => ({
      id: log.id,
      dayKey: log.dayKey,
      loggedAt: log.loggedAt,
      mood: log.mood ?? undefined,
      symptoms: log.symptoms.length
        ? log.symptoms.map(s => ({ name: s.name, severity: String(s.severity) }))
        : undefined,
      contextTags: log.contextTags.length ? log.contextTags : undefined,
      note: log.note ?? undefined,
    })),
  };
}

export interface SerializedMedicationLog {
  id: string;
  dayKey: string;
  takenAt: string;
  name: string;
  /** The app's own one-line rendering: name, dose, and whether it was as-needed. */
  summary: string;
  amount?: number;
  unit?: string;
  asNeeded?: boolean;
}

export interface SerializedTemplate {
  id: string;
  name: string;
  category?: string;
  container: string;
  items: number;
  groups?: string[];
  /** Choice questions by name, since those are the ones an item can be gated on. */
  questions?: { name: string; kind: string; options?: string[] }[];
  scheduled?: string;
  anchorsAreAway?: boolean;
}

/**
 * Templates, shallow.
 *
 * Exists as much for writing as for reading: `create_template` can nest one
 * template inside another by name, and a caller cannot name what it cannot see.
 * Item *contents* are left out on purpose — a list of twenty templates with
 * every field of every item is most of a database, and what a caller needs from
 * this is the name to reference and the questions it could condition on.
 */
export function listTemplates(replica: Replica): SerializedTemplate[] {
  return replica.templates().map(t => ({
    id: t.id,
    name: t.name,
    category: t.category ?? undefined,
    container: t.applyContainer,
    items: t.items.length,
    groups: t.itemGroups.length ? t.itemGroups.map(g => g.title) : undefined,
    questions: t.questions.length
      ? t.questions.map(q => ({
          name: q.name,
          kind: q.kind,
          options: q.options.length ? q.options : undefined,
        }))
      : undefined,
    scheduled: t.schedule ? t.schedule.frequency : undefined,
    anchorsAreAway: t.anchorsAreAway ? true : undefined,
  }));
}

export interface CreateTemplateResult {
  id: string;
  name: string;
  items: number;
  groups: number;
  questions: number;
  scheduled: boolean;
}

/**
 * Build a whole template from one plan.
 *
 * The validation is `validateTemplatePlan` and it runs inside
 * `replica.createTemplate`, which throws with every problem at once rather than
 * writing a partial template. That is the shape worth keeping: a half-built
 * template is worse than none, because it looks finished in the user's list.
 */
export function createTemplate(replica: Replica, plan: TemplatePlan): CreateTemplateResult {
  const built = replica.createTemplate(plan);
  return {
    id: built.id,
    name: built.name,
    items: built.items.length,
    groups: built.itemGroups.length,
    questions: built.questions.length,
    scheduled: built.schedule !== null,
  };
}

/**
 * Create a task, and hand back what it actually became.
 *
 * The result is the serialized task rather than an id, because the app fills
 * things the caller did not ask for — a category from `newTaskDefaults`, a
 * time-of-day segment from that category, a title the rules rewrote — and a
 * caller that cannot see those cannot tell the user what it made.
 */
export function createTask(replica: Replica, draft: Partial<TaskDraft>): SerializedTask {
  return serializeTasks(replica, [replica.createTask(draft)])[0];
}

export interface CompleteTaskResult {
  completed: SerializedTask;
  /**
   * What the completion produced, in words rather than as rows.
   *
   * A completion is the one write here whose visible effect is mostly on
   * *other* rows: a recurring task reappears on its next date, a chain moves
   * to its next step, a dated series lays out next month, and every Nth
   * practice earns a separate task. A caller told only "completed: true"
   * would report that a daily task is done for good.
   */
  spawned: string[];
  /** The successor, where one was created, so a caller can say when it lands. */
  nextTask: SerializedTask | null;
  /** True when the task named a medication and a dose was recorded. */
  loggedDose: boolean;
}

/**
 * Complete a task, and say what that did beyond the row itself.
 *
 * The refusals are the interesting half and both are deliberate: a task that
 * cannot be completed (a negative habit, a recurrence not yet due) says so
 * rather than being quietly ignored the way the store's early `return` does,
 * and a task that asks a question with no answer given is sent back for one
 * (see `deliverableAsk.ts`).
 */
export function completeTask(
  replica: Replica,
  id: string,
  options?: { deliverableValue?: string | null; completedAt?: string },
): CompleteTaskResult {
  const result = replica.completeTask(id, options);
  const spawned: string[] = [];
  if (result.nextTask) {
    const when = result.nextTask.dueDate
      ? `due ${result.nextTask.dueDate.slice(0, 10)}`
      : 'with no date';
    spawned.push(`The next occurrence was created, ${when}.`);
  }
  if (result.followUpTask) {
    spawned.push(`This completion earned the follow-up task "${result.followUpTask.title}".`);
  }
  if (result.rolledOver.length > 0) {
    spawned.push(`The last date of the series was completed, so the next set of ${result.rolledOver.length} was created.`);
  }
  if (result.loggedDose) spawned.push('A dose was recorded in the medication log.');
  return {
    completed: serializeTasks(replica, [result.completed])[0],
    spawned,
    nextTask: result.nextTask ? serializeTasks(replica, [result.nextTask])[0] : null,
    loggedDose: result.loggedDose,
  };
}

/**
 * Move a task to a date, or clear its date.
 *
 * The result is the whole task because the field that changed is not
 * predictable from the request: pushing a recurring task out writes
 * `deferUntil` and leaves `dueDate` alone, which is the opposite of what a
 * caller would assume from asking for a date. See `Replica.deferTask`.
 */
export interface GroceryWriteResult {
  item: SerializedGroceryItem;
  /**
   * What actually happened, in words.
   *
   * An add is three different events wearing one name — a shelf item minted, a
   * known one put back in the trolley, a name already in the trolley touched —
   * and a caller told only "ok" would report the wrong one. It matters most in
   * the case that looks like a no-op: re-adding something already on the list
   * deliberately leaves its tick alone, and that is worth saying rather than
   * letting it read as a failed write.
   */
  outcome: string;
}

export function addGroceryItem(
  replica: Replica,
  name: string,
  opts?: { quantity?: string | null; note?: string | null },
): GroceryWriteResult {
  const { item, isNew, wasOnList } = replica.addGroceryItem(name, opts);
  const outcome = isNew
    ? `Added "${item.name}" to the list, filed under ${item.aisle}.`
    : wasOnList
      ? `"${item.name}" was already on the list, so nothing moved. Its tick and its place in the aisle order are untouched.`
      : `"${item.name}" was already in the catalog, so it went back on the list with the aisle and history it already had.`;
  return { item: serializeGroceryItem(item), outcome };
}

export function setGroceryChecked(replica: Replica, id: string, checked: boolean): GroceryWriteResult {
  const item = replica.setGroceryChecked(id, checked);
  return {
    item: serializeGroceryItem(item),
    outcome: checked ? `Checked "${item.name}" off.` : `Un-checked "${item.name}".`,
  };
}

export function removeFromGroceryList(replica: Replica, id: string): GroceryWriteResult {
  const item = replica.removeFromGroceryList(id);
  return {
    item: serializeGroceryItem(item),
    // Worth saying, because "remove" reads as a delete and this is not one.
    outcome: `Took "${item.name}" off the list. It stays in the catalog with everything recorded on it, so adding it again brings its aisle and history back.`,
  };
}

export function deferTask(replica: Replica, id: string, date: string | null): SerializedTask {
  const parsed = date === null ? null : new Date(date);
  if (parsed !== null && Number.isNaN(parsed.getTime())) {
    throw new Error(`"${date}" is not a date I can read. Use an ISO date like 2026-03-14.`);
  }
  return serializeTasks(replica, [replica.deferTask(id, parsed)])[0];
}

export function listMedicationLogs(
  replica: Replica,
  input: LogRangeInput = {}
): { range: DayRange; logs: SerializedMedicationLog[] } {
  const range = resolveRange(replica, input);

  return {
    range,
    logs: replica.medicationLogs(range.from, range.to).map((log: MedicationLog) => ({
      id: log.id,
      dayKey: log.dayKey,
      takenAt: log.takenAt,
      name: log.name,
      summary: replica.medicationSummary(log),
      amount: log.amount ?? undefined,
      unit: log.unit ?? undefined,
      asNeeded: log.asNeeded ? true : undefined,
    })),
  };
}
