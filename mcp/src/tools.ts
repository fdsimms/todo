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
import type { FoodLogEntry, GroceryItem, GroceryListEntry, MedicationLog, MoodLog, Project, Task } from '../../src/types';
import type { AnswerEdit, Replica } from './replica';
import { resolveRef, templateToPlan, type TemplatePatch, type TemplatePlan } from './templatePlan';
import { isRotationTask } from '../../src/utils/rotation';
import {
  describeHealthTarget,
  describeRepeat,
  describeRotation,
  describeSupplyFields,
  type HealthTargetInput,
  type RepeatInput,
  type SupplyInput,
  type TaskFieldsInput,
  type TimedInput,
} from './taskFields';
import { serializeTasks, type SerializedTask } from './serialize';
import { localDateInput } from './timeZone';

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
    // Archived is "out of every list" in the app (CLAUDE.md, "Projects"); an
    // open archived row would otherwise fall through the other lenses into later.
    .filter(t => !t.archived)
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

export interface ChainStepDetail {
  title: string;
  estimatedMinutes?: number;
  asks?: string;
  answerSchedulesNextStep?: boolean;
}

export interface GetTaskResult {
  task: SerializedTask;
  /** The task's own subtasks, in stored order. */
  subtasks: SerializedTask[];
  /** Every step, when the task is a chain, so the shape is visible at once. */
  chain?: { index: number; steps: ChainStepDetail[]; stepsFollowSchedule?: boolean };
  /** The repeat rule, in the shape `create_task` and `update_task` take it. */
  repeat?: RepeatInput;
  /** A count to reach per day or week, and how far today's (or this week's) has got. */
  target?: { count: number; per: 'day' | 'week'; done: number; unit?: string; allowOvershoot?: boolean };
  /** A countdown the task runs once started, in minutes. */
  timed?: TimedInput;
  /** The members of a rotation, and which this week's picks have covered. */
  rotation?: { members: { title: string; doneThisWeek: boolean; lastDone?: string }[] };
  /** Configuration only: the server cannot read Apple Health, so it never says whether the target is reached. */
  healthTarget?: HealthTargetInput;
  /** A stock that counts down as the repeating task is completed. */
  supply?: SupplyInput;
  /**
   * Read-only, deliberately. Each of these changes something outside the task:
   * a gate or penalty blocks apps on the phone, and a medication makes
   * completing the task record a dose. Neither can be set from here.
   */
  gatesApps?: true;
  /** Failing this task blocks the apps the person picked in Settings. Read-only here: only the person sets or changes it. */
  penalty?: { minutes: number; cutoffTime?: string; chargedAt?: string; creditedAt?: string };
  medication?: { name: string; amount?: number; unit?: string };
  /** "HH:MM" bounds: shown from `start`, expired after `end`. */
  window?: { start?: string; end?: string };
  /** Present only for a "don't do this" habit, which is never completed. */
  habit?: 'avoid';
  /**
   * The tasks still holding this one back: `blockedById` and `blockedByIds`,
   * read through the app's `liveBlockersOf`, so a finished, archived or
   * deleted blocker is not listed (it holds nothing).
   */
  waitsOn?: { id: string; title: string }[];
  /** Shown only for these answers to that task's question; `answered` is what it got, once it has. */
  onlyIfAnswer?: { taskId: string; question: string; answers: string[]; answered?: string };
  /** "Every Nth completion, add this task." */
  followUp?: { everyN?: number; atEnd?: boolean; title: string; oneAtATime?: boolean; completionsSoFar?: number };
  project?: { id: string; title: string };
  /** Somebody this task is waiting on. A person, as opposed to `waitsOn`, which is other tasks. */
  waitingOnPerson?: { personId: string; name?: string; since?: string; followUpOn?: string };
  /** Where to reach or find what the task is about. */
  contact?: { link?: string; phone?: string; email?: string; location?: string };
  /** The app's own run count for a habit: days in a row, and the last day it was kept. */
  streak?: { days: number; lastDay?: string };
  /** What completing this task also writes elsewhere, so completing it is not a surprise. */
  onCompletion?: {
    logsMedication?: { name: string; amount?: number; unit?: string };
    logsHealth?: { metric: string; amount?: number };
    logsMealSlot?: string;
  };
  /** A countdown (`minutes`) or an Apple Health reading (`healthTarget`) the task reads as ready at; `measuredMinutes` is how long it actually took. */
  timer?: { minutes: number };
  measuredMinutes?: number;
  /** How often it has been pushed to a later day, and since when. `muted` means the person asked not to be nudged about it. */
  postponed?: { count: number; since?: string; muted?: boolean };
  /** Slips logged against a "don't do this" habit on `day`. */
  slips?: { count: number; day: string };
  /** The app's own sentence on a live coin bounty: what it is worth and what moving the task again costs. */
  bounty?: { summary: string; pushes: number };
  /** When the app put a date on this task unasked (a quiet project's drip). */
  autoScheduledAt?: string;
  /**
   * When a task that is not on Today will surface. Absent when it is visible,
   * and absent when nothing hidden it is a moment: an undated task, one held
   * back by a blocker, a finished one. `getVisibleAt` answers "now" for those,
   * which reads as a delay that is about to end and changes on every call, so
   * only a moment still ahead is reported.
   * The date is what `getVisibleAt` returns, which is the earliest moment it
   * surfaces rather than its due date — the two differ whenever a defer, a time
   * segment or a category schedule is what is holding it.
   */
  hiddenUntil?: string;
}

/**
 * The per-task state `get_task` adds for a task that has been singled out, and
 * that a list row has no room for. Each block appears only when the task
 * actually has it, so an ordinary task adds nothing.
 */
function taskExtras(replica: Replica, task: Task): Partial<GetTaskResult> {
  const out: Partial<GetTaskResult> = {};

  if (task.waitingOnPersonId) {
    const person = replica.people().find(p => p.id === task.waitingOnPersonId);
    out.waitingOnPerson = {
      personId: task.waitingOnPersonId,
      ...(person ? { name: person.name } : {}),
      ...(task.waitingOnPersonSince ? { since: task.waitingOnPersonSince } : {}),
      ...(task.followUpOn ? { followUpOn: task.followUpOn } : {}),
    };
  }

  const contact = {
    ...(task.linkUrl ? { link: task.linkUrl } : {}),
    ...(task.phoneNumber ? { phone: task.phoneNumber } : {}),
    ...(task.emailAddress ? { email: task.emailAddress } : {}),
    ...(task.location ? { location: task.location } : {}),
  };
  if (Object.keys(contact).length > 0) out.contact = contact;

  if ((task.streakCount ?? 0) > 0) {
    out.streak = { days: task.streakCount, ...(task.streakDate ? { lastDay: task.streakDate } : {}) };
  }

  const onCompletion: NonNullable<GetTaskResult['onCompletion']> = {};
  if (task.medicationName) {
    onCompletion.logsMedication = {
      name: task.medicationName,
      ...(task.medicationAmount != null ? { amount: task.medicationAmount } : {}),
      ...(task.medicationUnit ? { unit: task.medicationUnit } : {}),
    };
  }
  if (task.logHealthMetric) {
    onCompletion.logsHealth = {
      metric: task.logHealthMetric,
      ...(task.logHealthAmount != null ? { amount: task.logHealthAmount } : {}),
    };
  }
  if (task.logMealSlot) onCompletion.logsMealSlot = task.logMealSlot;
  if (Object.keys(onCompletion).length > 0) out.onCompletion = onCompletion;

  if (task.timedMinutes != null) out.timer = { minutes: task.timedMinutes };
  if (task.actualMinutes != null) out.measuredMinutes = task.actualMinutes;

  if ((task.postponeCount ?? 0) > 0 || task.postponeMuted) {
    out.postponed = {
      count: task.postponeCount ?? 0,
      ...(task.driftingSince ? { since: task.driftingSince } : {}),
      ...(task.postponeMuted ? { muted: true } : {}),
    };
  }

  if ((task.slipCount ?? 0) > 0 && task.slipDate) out.slips = { count: task.slipCount, day: task.slipDate };
  const bounty = replica.describeBounty(task);
  if (bounty) out.bounty = { summary: bounty, pushes: task.bountyPushes ?? 0 };

  if (task.autoScheduledAt) out.autoScheduledAt = task.autoScheduledAt;

  return out;
}

export function getTask(replica: Replica, id: string): GetTaskResult | null {
  const task = replica.taskById(id);
  if (!task) return null;

  const steps = task.chainItems ?? [];
  const project = task.projectId ? replica.projects().find(p => p.id === task.projectId) : null;
  const visible = replica.isVisible(task);
  const surfacesAt = visible ? null : replica.visibleAt(task);

  return {
    task: serializeTasks(replica, [task])[0],
    subtasks: serializeTasks(
      replica,
      replica.tasks().filter(t => t.parentId === task.id)
    ),
    chain: steps.length > 1
      ? {
          index: task.chainIndex ?? 0,
          steps: steps.map(s => ({
            title: s.title,
            ...(s.estimatedMinutes != null ? { estimatedMinutes: s.estimatedMinutes } : {}),
            ...(s.deliverableKind ? { asks: s.deliverableKind } : {}),
            ...(s.deliverableDatesNextStep ? { answerSchedulesNextStep: true } : {}),
          })),
          ...(task.chainStepOnSchedule ? { stepsFollowSchedule: true } : {}),
        }
      : undefined,
    repeat: describeRepeat(task) ?? undefined,
    target: task.targetCount != null && task.targetCount >= 2 && !isRotationTask(task)
      ? {
          count: task.targetCount,
          per: task.quotaPeriod === 'week' ? 'week' : 'day',
          done: task.progressCount ?? 0,
          ...(task.targetUnit ? { unit: task.targetUnit } : {}),
          ...(task.allowOvershoot ? { allowOvershoot: true } : {}),
        }
      : undefined,
    timed: task.timedMinutes != null && task.timedMinutes > 0 ? { minutes: task.timedMinutes } : undefined,
    rotation: describeRotation(task, new Set(isRotationTask(task) ? replica.rotationDoneIds(task) : [])) ?? undefined,
    healthTarget: describeHealthTarget(task) ?? undefined,
    supply: describeSupplyFields(task) ?? undefined,
    gatesApps: task.gatesApps ? true : undefined,
    penalty: task.penaltyMinutes != null
      ? {
          minutes: task.penaltyMinutes,
          ...(task.penaltyCutoffTime ? { cutoffTime: task.penaltyCutoffTime } : {}),
          ...(task.penaltyFiredAt ? { chargedAt: task.penaltyFiredAt } : {}),
          ...(task.penaltyCreditedAt ? { creditedAt: task.penaltyCreditedAt } : {}),
        }
      : undefined,
    medication: task.medicationName?.trim()
      ? {
          name: task.medicationName.trim(),
          ...(task.medicationAmount != null ? { amount: task.medicationAmount } : {}),
          ...(task.medicationUnit ? { unit: task.medicationUnit } : {}),
        }
      : undefined,
    window: task.windowStart || task.windowEnd
      ? { ...(task.windowStart ? { start: task.windowStart } : {}), ...(task.windowEnd ? { end: task.windowEnd } : {}) }
      : undefined,
    habit: task.polarity === 'negative' ? 'avoid' : undefined,
    waitsOn: (() => {
      const live = replica.liveBlockers(task);
      return live.length > 0 ? live.map(b => ({ id: b.id, title: replica.displayTitle(b) })) : undefined;
    })(),
    onlyIfAnswer: task.answerGate
      ? (() => {
          const q = replica.taskById(task.answerGate.taskId);
          return {
            taskId: task.answerGate.taskId,
            question: q ? replica.displayTitle(q) : '(deleted task)',
            answers: task.answerGate.answers,
            ...(q?.completed && q.deliverableValue != null ? { answered: q.deliverableValue } : {}),
          };
        })()
      : undefined,
    followUp: task.followUpTaskAtEnd && task.followUpTaskTitle
      ? { atEnd: true, title: task.followUpTaskTitle }
      : task.followUpTaskEveryN != null && task.followUpTaskTitle
      ? {
          everyN: task.followUpTaskEveryN,
          title: task.followUpTaskTitle,
          ...(task.followUpTaskOneAtATime ? { oneAtATime: true } : {}),
          completionsSoFar: task.followUpTaskTally ?? 0,
        }
      : undefined,
    project: project ? { id: project.id, title: project.title } : undefined,
    ...taskExtras(replica, task),
    hiddenUntil: surfacesAt && surfacesAt.getTime() > Date.now() ? surfacesAt.toISOString() : undefined,
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

export interface SerializedCategory {
  name: string;
  /** Open top-level tasks filed under it. */
  openTasks: number;
  /** A few of them, so what belongs here can be judged from more than the name. */
  examples?: string[];
}

/**
 * The person's task categories, in their own order, for choosing where a new
 * task goes: create_task and the project tools refuse a task with none, and a
 * name that isn't one of these unless it's flagged as new.
 */
export function listCategories(replica: Replica): SerializedCategory[] {
  const open = replica.tasks().filter(t => !t.parentId && !t.completed && !t.archived);
  return replica.categories().map(c => {
    const mine = open.filter(t => t.category === c.name);
    const examples = mine.slice(0, 3).map(t => replica.displayTitle(t));
    return { name: c.name, openTasks: mine.length, ...(examples.length > 0 ? { examples } : {}) };
  });
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
  /** On the home list right now, as opposed to sitting in the catalog. */
  onList: boolean;
  /** Checked off on the home list. */
  checked?: boolean;
}

/**
 * One row's projection, shared by the list and by every write that reports what
 * it did. Separate so a write cannot describe an item differently from the way
 * a read does a moment later.
 *
 * **Membership and the tick are the home list's, read off its entry.** Every
 * grocery write here acts on the list at home, so that is the list a read has
 * to describe. `GroceryItem.onList` is the broader "in any trolley" flag, so a
 * row only on a trip's list read as on the list and then couldn't be checked
 * off; `GroceryItem.checked` is only a mirror of the home entry.
 */
export function serializeGroceryItem(i: GroceryItem, home: GroceryListEntry | undefined): SerializedGroceryItem {
  return {
    id: i.id,
    name: i.name,
    quantity: i.quantity || undefined,
    aisle: i.aisle || undefined,
    onList: home !== undefined,
    checked: home?.checked ? true : undefined,
  };
}

/** The home list's entries, by item id. */
function homeEntries(replica: Replica): Map<string, GroceryListEntry> {
  const out = new Map<string, GroceryListEntry>();
  for (const e of replica.groceryListEntries()) if (e.listId === null) out.set(e.itemId, e);
  return out;
}

function serializeWithHome(replica: Replica, item: GroceryItem): SerializedGroceryItem {
  return serializeGroceryItem(item, homeEntries(replica).get(item.id));
}

/** The home list, or with `onListOnly: false` the whole catalog. */
export function listGroceryItems(
  replica: Replica,
  input: { onListOnly?: boolean } = {}
): SerializedGroceryItem[] {
  const home = homeEntries(replica);
  const items = replica.groceryItems();
  const wanted = input.onListOnly === false ? items : items.filter((i: GroceryItem) => home.has(i.id));
  return wanted.map(i => serializeGroceryItem(i, home.get(i.id)));
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
export function createTask(replica: Replica, input: TaskFieldsInput & { parentId?: string | null }): GetTaskResult {
  const { parentId, ...fields } = input;
  if (parentId && !replica.taskById(parentId)) throw new Error(`No task with id ${parentId} to add a subtask to.`);
  const patch = replica.taskPatch(fields, null, !!parentId);
  const task = replica.createTask({ ...patch, ...(parentId ? { parentId } : {}) });
  return getTask(replica, task.id)!;
}

export interface UpdateTaskResult extends GetTaskResult {
  /**
   * How many later dates of the same dated series took the edit too. The app's
   * editor applies a content edit to "this and later dates" by default, and
   * this does the same, so a caller should say so rather than report one task.
   */
  alsoUpdatedLaterDates?: number;
}

/**
 * Edit a task. Only the fields named change; `null` clears a field that can be
 * empty. The result is the task in full, the same shape `get_task` returns, so
 * a caller can check what the rules made of the edit.
 */
export function updateTask(replica: Replica, id: string, input: TaskFieldsInput): UpdateTaskResult {
  const current = replica.taskById(id);
  if (!current) throw new Error(`No task with id ${id}.`);
  const patch = replica.taskPatch(input, current, !!current.parentId);
  if (Object.keys(patch).length === 0) throw new Error('Nothing to change: name at least one field.');
  const { alsoUpdated } = replica.updateTask(id, patch);
  return { ...getTask(replica, id)!, ...(alsoUpdated > 0 ? { alsoUpdatedLaterDates: alsoUpdated } : {}) };
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
  options?: { deliverableValue?: string | null; completedAt?: string; why?: string; revisitIf?: string },
): CompleteTaskResult {
  const { why, revisitIf, ...rest } = options ?? {};
  // Reasoning only means something next to an answer; `in` keeps the
  // "was an answer sent at all" test the refusal makes intact.
  const result = replica.completeTask(id, options === undefined ? undefined : {
    ...rest,
    ...(why !== undefined || revisitIf !== undefined
      ? { deliverableReasoning: { why: why ?? null, revisitIf: revisitIf ?? null } }
      : {}),
  });
  const spawned: string[] = [];
  if (result.nextTask) {
    const when = result.nextTask.dueDate
      ? `due ${replica.dayKeyOf(result.nextTask.dueDate)}`
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
  return { item: serializeWithHome(replica, item), outcome };
}

export function setGroceryChecked(replica: Replica, id: string, checked: boolean): GroceryWriteResult {
  const item = replica.setGroceryChecked(id, checked);
  return {
    item: serializeWithHome(replica, item),
    outcome: checked ? `Checked "${item.name}" off.` : `Un-checked "${item.name}".`,
  };
}

export function removeFromGroceryList(replica: Replica, id: string): GroceryWriteResult {
  const item = replica.removeFromGroceryList(id);
  return {
    item: serializeWithHome(replica, item),
    // Worth saying, because "remove" reads as a delete and this is not one.
    outcome: `Took "${item.name}" off the list. It stays in the catalog with everything recorded on it, so adding it again brings its aisle and history back.`,
  };
}

export function deferTask(replica: Replica, id: string, date: string | null): SerializedTask {
  const parsed = date === null ? null : new Date(localDateInput(date));
  if (parsed !== null && Number.isNaN(parsed.getTime())) {
    throw new Error(`"${date}" is not a date I can read. Use an ISO date like 2026-03-14.`);
  }
  return serializeTasks(replica, [replica.deferTask(id, parsed)])[0];
}

/** Correct an answer already recorded, or the reasoning given with it. The result is the task as get_task shows it. */
export function updateAnswer(replica: Replica, id: string, edit: AnswerEdit): GetTaskResult {
  if (edit.answer === undefined && edit.why === undefined && edit.revisitIf === undefined) {
    throw new Error('Nothing to change: give answer, why or revisitIf.');
  }
  replica.updateAnswer(id, edit);
  return getTask(replica, id)!;
}

export function archiveTask(replica: Replica, id: string, archived: boolean): SerializedTask & { archived: boolean } {
  const task = replica.setTaskArchived(id, archived);
  return { ...serializeTasks(replica, [task])[0], archived: task.archived };
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

/** One template as the plan that would recreate it, or null when none matches. */
export function getTemplate(replica: Replica, ref: string) {
  const found = resolveRef(ref, replica.templates());
  if (found.length > 1) throw new Error(`"${ref}" names ${found.length} templates. Use an id.`);
  return found[0] ? templateToPlan(found[0]) : null;
}

/** Apply an edit to a template. See `Replica.updateTemplate` for the rules. */
export function updateTemplate(replica: Replica, ref: string, patch: TemplatePatch): CreateTemplateResult {
  const built = replica.updateTemplate(ref, patch);
  return {
    id: built.id,
    name: built.name,
    items: built.items.length,
    groups: built.itemGroups.length,
    questions: built.questions.length,
    scheduled: built.schedule !== null,
  };
}

export interface DeleteTemplateResult {
  deleted: { id: string; name: string; items: number };
  /** Templates that nested it. Each now has an item whose reference is broken. */
  nestedIn: string[];
}

/** Delete a template. Not undoable from here, so the write tool previews it first. */
export function deleteTemplate(replica: Replica, ref: string): DeleteTemplateResult {
  const { template, nestedIn } = replica.deleteTemplate(ref);
  return { deleted: { id: template.id, name: template.name, items: template.items.length }, nestedIn };
}

/** The templates in their new order, as the template list shows them. */
export function reorderTemplates(replica: Replica, ids: string[]): { id: string; name: string }[] {
  return replica.reorderTemplates(ids).map(t => ({ id: t.id, name: t.name }));
}

export interface ReopenTaskResult {
  task: ReturnType<typeof serializeTasks>[number];
  /** What the reopen took back with it, in words. */
  tookBack: string[];
}

/** Reopen a completed task. The refusals (device state it cannot undo) come from the replica. */
export function reopenTask(replica: Replica, id: string): ReopenTaskResult {
  const { task, removed } = replica.reopenTask(id);
  const tookBack: string[] = [];
  const top = removed.filter(r => !r.parentId);
  if (top.length > 0) tookBack.push(`Removed the ${top.length === 1 ? 'occurrence' : `${top.length} occurrences`} its completion created.`);
  return { task: serializeTasks(replica, [task])[0], tookBack };
}

export interface ApplyTemplateInput {
  runName?: string;
  startDate?: string;
  endDate?: string;
  answers?: Record<string, string>;
  include?: string[];
  leaveOut?: string[];
  projectId?: string;
}

export interface ApplyTemplateResult {
  created: { id: string; title: string; dueDate?: string }[];
  /** What the run put them in, when the template makes a stack, project or parent task. */
  container?: { kind: string; id: string; name: string };
}

/** A bare YYYY-MM-DD as that local day. Never via toISOString, which is UTC. */
function localDay(value: string | undefined, field: string): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`${field} must be YYYY-MM-DD.`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Run a template. See `Replica.applyTemplate`. */
export function applyTemplate(replica: Replica, ref: string, input: ApplyTemplateInput): ApplyTemplateResult {
  const start = localDay(input.startDate, 'startDate');
  const end = localDay(input.endDate, 'endDate');
  if (start && end && end < start) throw new Error('endDate is before startDate.');
  const result = replica.applyTemplate(ref, {
    runName: input.runName,
    start,
    end,
    answers: input.answers,
    include: input.include,
    leaveOut: input.leaveOut,
    projectId: input.projectId,
  });
  return {
    created: result.tasks.map(t => ({ id: t.id, title: t.title, ...(t.dueDate ? { dueDate: replica.dayKeyOf(t.dueDate) } : {}) })),
    ...(result.container ? { container: result.container } : {}),
  };
}
