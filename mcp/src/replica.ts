/**
 * The replica: a real `todo.db` opened in Node, with the app's own db layer in
 * front of it.
 *
 * ## The one rule in `mcp/`
 *
 * **Nothing under `mcp/src` may import an app module for its *value*.** Types
 * are free (`import type` is erased); values come through the `Replica` this
 * file returns. That is not tidiness, it is the mechanism: `database.ts` does
 * `SQLite.openDatabaseSync('todo.db')` at module scope, so the shim has to be
 * in Node's module cache before `database.ts` is ever evaluated. A static
 * import anywhere in this package is hoisted above that, `database.ts`
 * evaluates against the real `expo-sqlite`, and it throws on a
 * TurboModuleRegistry lookup with no native side to answer it. Every `require`
 * below is therefore inside a function, deliberately, and the same goes for
 * `visibilityUtils` and `fuzzySearch` — they reach `database.ts` transitively
 * through `useSettingsStore`, so importing them statically breaks it just as
 * thoroughly and much less obviously.
 *
 * `src/types/index.ts` is the one carve-out, and it is a structural one rather
 * than a judgement call: `database.ts` imports *from* types, so nothing can
 * reach the db layer by going the other way. Its constants (`PRIORITY_LABELS`
 * and friends) are safe to import statically, and serialize.ts does.
 *
 * See docs/arch/mcp-server.md.
 */
// date-fns is safe to import for its values: it is a third-party leaf that
// cannot reach database.ts, so the rule above does not apply to it. The app's
// own modules import it exactly this way.
import { addDays } from 'date-fns/addDays';

import { shimModule } from './expoSqliteShim';
import type {
  Category,
  DeliverableKind,
  FoodLogEntry,
  GroceryItem,
  MedicationLog,
  MoodLog,
  Person,
  Project,
  TaskTemplate,
  Task,
  TaskDraft,
} from '../../src/types';
import type { FoodLogTotals } from '../../src/utils/foodLog';
import type { SyncSummary } from '../../src/utils/syncEngine';
import { DEFAULT_SCHEDULE, resolveRef, validateTemplatePlan, type TemplatePlan } from './templatePlan';
import { deliverableRefusal } from './deliverableAsk';

type DbModule = typeof import('../../src/db/database');
type VisibilityModule = typeof import('../../src/utils/visibilityUtils');
type FuzzyModule = typeof import('../../src/utils/fuzzySearch');
type EffortModule = typeof import('../../src/utils/effort');
type DeliverablesModule = typeof import('../../src/utils/deliverables');
type DateModule = typeof import('../../src/utils/dateUtils');
type SyncEngineModule = typeof import('../../src/utils/syncEngine');
type SyncLocalModule = typeof import('../../src/utils/syncLocal');
type HttpTransportModule = typeof import('../../src/utils/httpSyncTransport');
type FoodLogModule = typeof import('../../src/utils/foodLog');
type MoodHistoryModule = typeof import('../../src/utils/moodHistory');
type MedicationModule = typeof import('../../src/utils/medicationLog');
type TemplateUtilsModule = typeof import('../../src/utils/templateUtils');
type TaskDraftModule = typeof import('../../src/utils/taskDraft');
type TaskCompletionModule = typeof import('../../src/utils/taskCompletion');
type TaskMovesModule = typeof import('../../src/utils/taskMoves');
type IdModule = typeof import('../../src/utils/id');

/** What a caller may say about a completion. `CompletionOptions` without the miss. */
export type CompletionOptions = Pick<
  import('../../src/utils/taskCompletion').CompletionOptions,
  'deliverableValue' | 'completedAt'
>;

/** What a completion did, past the row itself. */
export interface CompletedResult {
  completed: Task;
  /** The next occurrence or chain step, where one was spawned. */
  nextTask: Task | null;
  /** The every-Nth-completion task, where this completion earned one. */
  followUpTask: Task | null;
  /** The next set of a repeating dated series, where its last date just landed. */
  rolledOver: Task[];
  /** True when a dose was recorded against the medication the task names. */
  loggedDose: boolean;
}

/** One task the way `fuzzySearch` ranked it, without the highlight ranges. */
export interface ReplicaSearchHit {
  task: Task;
  score: number;
  projectName: string | null;
}

export interface Replica {
  /** Where the database being served came from. Reported by `describe`. */
  readonly path: string;
  /** Drop cached reads. The server calls this once per request. */
  refresh(): void;

  tasks(): Task[];
  taskById(id: string): Task | null;
  projects(): Project[];
  categories(): Category[];
  groceryItems(): GroceryItem[];

  isVisible(task: Task): boolean;
  isUnscheduled(task: Task): boolean;
  isInbox(task: Task): boolean;
  isBlocked(task: Task): boolean;
  visibleAt(task: Task): Date;
  search(query: string): ReplicaSearchHit[];

  /**
   * The three fields a chain step overrides. They are separate entries rather
   * than raw `task.*` reads for the reason CLAUDE.md gives each of them: mid
   * chain the live step owns the title, the estimate and the question, and a
   * serializer reading the task directly reports the whole chain's answer at
   * every step.
   */
  displayTitle(task: Task): string;
  estimatedMinutes(task: Task): number | null;
  deliverableKind(task: Task): DeliverableKind | null;

  /**
   * The logical day, as a `YYYY-MM-DD` key. Goes through `getLogicalToday` so a
   * read at 1am under a 2am `dayResetTime` gets yesterday, which is the day the
   * user would say they were asking about.
   */
  todayKey(): string;
  /** Shifts a day key by whole days. Used to default a range to "the last N days". */
  shiftDayKey(key: string, days: number): string;

  /** Food log entries between two day keys, inclusive. */
  foodLogEntries(fromDayKey: string, toDayKey: string): FoodLogEntry[];
  /** Summed nutrients over a set of entries. A nutrient nobody stated is absent, never 0. */
  foodTotals(entries: readonly FoodLogEntry[]): FoodLogTotals;

  /** Mood check-ins between two day keys, inclusive. */
  moodLogs(fromDayKey: string, toDayKey: string): MoodLog[];

  /** Doses between two day keys, inclusive. */
  medicationLogs(fromDayKey: string, toDayKey: string): MedicationLog[];
  /** "Ibuprofen · 400 mg · as needed", the app's own one-line rendering of a dose. */
  medicationSummary(log: MedicationLog): string;

  /** Every stored template, for listing and for resolving a nested reference. */
  templates(): TaskTemplate[];
  /**
   * Apply a validated plan, returning the template it built.
   *
   * **Written through `dbInsertTemplate` rather than `useTemplateStore`**, which
   * is the opposite of the rule demo seeding follows, for two reasons.
   *
   * The store is unreachable here at all: it imports `useTaskStore`, which
   * imports `useFocusStore`, which imports `notifications.ts`, which imports
   * `expo-notifications` — a native module with nothing to bind to in Node. The
   * settings and category stores this file already hydrates have no such chain,
   * which is why they work and this one does not.
   *
   * And it costs nothing, because the thing the store would have bought is not
   * the store's to give: `updated_at` is stamped by the SQLite trigger
   * `templates_sync_stamp_insert` (`syncTracking.ts`), on any insert that does
   * not carry one. So a template written this way syncs exactly like one the
   * app wrote. A whole template is also a single row, so one insert is more
   * atomic than the store's group-then-question-then-item sequence, not less.
   *
   * Throws on an invalid plan rather than writing half of one. Validate first.
   */
  createTemplate(plan: TemplatePlan): TaskTemplate;

  /**
   * Create one task, exactly as the app's own create path would.
   *
   * Built by `newTaskFromDraft`, which was lifted out of `useTaskStore` for
   * this (see `src/utils/taskDraft.ts`): it is the only copy of the new-task
   * defaults, the category seed and the recurrence anchor, so a task built any
   * other way would drift from the app's the first time one of them changed.
   *
   * Title rules apply, which is deliberate and matches the app's other headless
   * creations — a dictated Apple reminder, a deep link, a template run all get
   * them. The one field they hold back for those callers, `projectId`, is held
   * back here too, and for the same reason: a rule filing an undated task into
   * a project takes it off every list the person was looking at.
   *
   * What it does **not** do is the device work `addTask` does around it: no
   * reminder is scheduled, no quota nudge, no calendar event. Those belong to
   * whichever device the task syncs to, and `rebuildNotificationQueue` there
   * reschedules from every task rather than from the one that changed.
   */
  createTask(draft: Partial<TaskDraft>): Task;

  /**
   * Complete one task, exactly as ticking it in the app would.
   *
   * Every row comes from `buildCompletion` (`src/utils/taskCompletion.ts`),
   * which was lifted out of `useTaskStore.completeTask` for this. That matters
   * more here than it did for `createTask`: a completion is not a flag, it is
   * a streak judged against the recurrence's own cadence, a supply spent only
   * when a person actually did the thing, a chain advanced by exactly one
   * step, a repeat count a mid-chain step must not burn, and a dated series
   * that rolls over as a whole set. A second implementation would have got one
   * of those wrong silently.
   *
   * A dose is recorded alongside, where the task names a medication, because
   * that is a write into the app's own record rather than device work. The
   * device work is what stays behind: no reminder is cancelled or scheduled,
   * no calendar event is written or deleted, nothing is sent to Apple Health,
   * and none of the pending-prompt ids that drive the meal-log and use-up
   * sheets are set. Those belong to whichever device the completion syncs to,
   * and asking a person a question is not something a replica can do.
   *
   * Throws rather than completing when the task cannot be completed, and when
   * it asks a question that was not answered. See `deliverableRefusal`.
   */
  completeTask(id: string, options?: CompletionOptions): CompletedResult;

  /**
   * Move a task to a date, as the app's own reschedule does.
   *
   * `scheduleMoveUpdates` (`src/utils/taskMoves.ts`) is what decides how, and
   * the asymmetry it encodes is the whole reason this does not simply write
   * `dueDate`: pushing a date-anchored task out writes `deferUntil`, a floor
   * over the stored date, so the grid the rest of its future is measured from
   * does not move; pulling one forward writes `dueDate` with
   * `recurrenceAnchorDate` so the grid keeps its own anchor to step from.
   * Collapsing the two is what made #1953 a bug.
   *
   * Passing null clears the date, which leaves an unscheduled task rather than
   * deleting anything.
   */
  deferTask(id: string, date: Date | null): Task;

  deviceId(): string;
  /** False for a demo database. A demo database is never synced. */
  syncable(): boolean;

  /**
   * Exchange changes with the payload store, as one more device.
   *
   * Returns null when no store is configured, which is the ordinary state for a
   * replica pointed at a file somebody copied. `SyncLocal` is the app's own
   * `databaseSyncLocal()` verbatim: it is six functions over `database.ts`, and
   * `database.ts` is what this whole package exists to run in Node, so there
   * was nothing to write.
   */
  sync(): Promise<SyncSummary | null>;
}

/**
 * Put the shim in front of `expo-sqlite` for the rest of this process.
 *
 * Must be called before `openReplica()`, and there is nothing to undo it — one
 * process serves one database, which is also why `shimModule` hands out a
 * single handle.
 *
 * Deliberately untested: jest keeps its own module registry, so priming Node's
 * `require.cache` does nothing there. Tests reach the same place with
 * `jest.mock('expo-sqlite')` over `openShimDatabase(':memory:')`, which is why
 * this function holds no logic worth losing — the whole hydration path below is
 * covered, and this is the two lines that are not.
 */
export function installExpoSqliteShim(filePath: string): void {
  const resolved = require.resolve('expo-sqlite');
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: shimModule(filePath),
  } as NodeJS.Module;
}

/**
 * Open the replica and hydrate everything a read needs.
 *
 * The store initialisation is not optional and not deferrable. `isTaskVisible`
 * reads `dayResetTime` from `useSettingsStore` and a category's schedule from
 * `useCategoryStore`; unhydrated, both hand back defaults and the visibility
 * check answers confidently and wrongly, which is worse than refusing. Same for
 * the two registries: without a task source `resolveBlocker` returns undefined,
 * `canBlock(undefined)` is false, and a task waiting on another one reads as
 * ready to do.
 */
export function openReplica(path = process.env.TODO_DB_PATH ?? 'todo.db'): Replica {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const db = require('../../src/db/database') as DbModule;
  const visibility = require('../../src/utils/visibilityUtils') as VisibilityModule;
  const fuzzy = require('../../src/utils/fuzzySearch') as FuzzyModule;
  const effort = require('../../src/utils/effort') as EffortModule;
  const deliverables = require('../../src/utils/deliverables') as DeliverablesModule;
  const dates = require('../../src/utils/dateUtils') as DateModule;
  const foodLog = require('../../src/utils/foodLog') as FoodLogModule;
  const moodHistory = require('../../src/utils/moodHistory') as MoodHistoryModule;
  const medication = require('../../src/utils/medicationLog') as MedicationModule;
  const syncEngine = require('../../src/utils/syncEngine') as SyncEngineModule;
  const syncLocal = require('../../src/utils/syncLocal') as SyncLocalModule;
  const httpTransport = require('../../src/utils/httpSyncTransport') as HttpTransportModule;
  const templateUtils = require('../../src/utils/templateUtils') as TemplateUtilsModule;
  const taskDraft = require('../../src/utils/taskDraft') as TaskDraftModule;
  const completion = require('../../src/utils/taskCompletion') as TaskCompletionModule;
  const moves = require('../../src/utils/taskMoves') as TaskMovesModule;
  const { generateId } = require('../../src/utils/id') as IdModule;
  const { useMedicationStore } = require('../../src/store/useMedicationStore') as typeof import('../../src/store/useMedicationStore');
  const { registerTaskSource } = require('../../src/utils/blockerRegistry') as typeof import('../../src/utils/blockerRegistry');
  const { registerPersonSource } = require('../../src/utils/peopleRegistry') as typeof import('../../src/utils/peopleRegistry');
  const { useSettingsStore } = require('../../src/store/useSettingsStore') as typeof import('../../src/store/useSettingsStore');
  const { useCategoryStore } = require('../../src/store/useCategoryStore') as typeof import('../../src/store/useCategoryStore');
  /* eslint-enable @typescript-eslint/no-require-imports */

  db.initDatabase();
  useSettingsStore.getState().initialize();
  useCategoryStore.getState().initialize();

  // Read caches, cleared per request by `refresh`. They exist because the
  // blocker registry resolves one id at a time: without them, a list of 200
  // tasks in which 20 are blocked is 20 full table reads.
  let taskCache: Task[] | null = null;
  let personCache: Person[] | null = null;
  let projectCache: Project[] | null = null;

  const tasks = (): Task[] => (taskCache ??= db.dbGetAllTasks());
  const people = (): Person[] => (personCache ??= db.dbGetAllPeople());
  const projects = (): Project[] => (projectCache ??= db.dbGetAllProjects());

  // A named function rather than only a method on the returned object, because
  // `sync` has to call it after applying a pull and reaching it through `this`
  // would break the moment somebody destructured the replica.
  const refresh = (): void => {
    taskCache = null;
    personCache = null;
    projectCache = null;
    useSettingsStore.getState().initialize();
    useCategoryStore.getState().initialize();
  };

  registerTaskSource(tasks);
  registerPersonSource(people);

  return {
    path,

    refresh,

    tasks,
    projects,
    taskById: (id: string) => tasks().find(t => t.id === id) ?? null,
    categories: () => db.dbGetAllCategories(),
    groceryItems: () => db.dbGetAllGroceryItems(),

    isVisible: (task: Task) => visibility.isTaskVisible(task),
    isUnscheduled: (task: Task) => visibility.isUnscheduledTask(task),
    isInbox: (task: Task) => visibility.isInboxTask(task),
    isBlocked: (task: Task) => visibility.isTaskBlocked(task),
    visibleAt: (task: Task) => visibility.getVisibleAt(task),

    displayTitle: (task: Task) => visibility.displayTitleFor(task),
    estimatedMinutes: (task: Task) => effort.estimatedMinutesFor(task),
    deliverableKind: (task: Task) => deliverables.deliverableKindFor(task),

    todayKey: () => dates.dayKeyOf(dates.getLogicalToday()),
    shiftDayKey: (key: string, days: number) =>
      dates.dayKeyOf(addDays(dates.dayKeyToDate(key), days)),

    // The only one of the three with a ranged db read of its own, because
    // food_logs is the table that grows fastest — several rows a day, for ever.
    // The other two are read whole and filtered, which is what the app does.
    foodLogEntries: (from: string, to: string) => db.dbGetFoodLogEntries(from, to),
    foodTotals: (entries: readonly FoodLogEntry[]) => foodLog.foodLogTotals(entries),

    moodLogs: (from: string, to: string) =>
      moodHistory.logsInDayRange(db.dbGetAllMoodLogs(), from, to),

    medicationLogs: (from: string, to: string) =>
      db.dbGetAllMedicationLogs().filter(l => l.dayKey >= from && l.dayKey <= to),
    medicationSummary: (log: MedicationLog) => medication.medicationLogSummary(log),

    // The same ranking the quick-search sheet gets, project names and all —
    // reimplementing it here would be a second answer to "what matches", which
    // is the drift this whole package is arranged to avoid.
    search(query: string): ReplicaSearchHit[] {
      const names = new Map(projects().map(p => [p.id, p.title]));
      return fuzzy
        .fuzzySearch(tasks(), query, names)
        .map(r => ({ task: r.task, score: r.score, projectName: r.projectName }));
    },

    templates: () => db.dbGetAllTemplates(),

    createTemplate(plan: TemplatePlan): TaskTemplate {
      const existing = db.dbGetAllTemplates();
      const errors = validateTemplatePlan(plan, existing);
      if (errors.length > 0) throw new Error(errors.join(' '));

      // Groups and questions are built first because an item's `groupId` and
      // its conditions' `questionId`s are ids minted here. The plan names them
      // by key and by name precisely because the caller cannot know these.
      const groupIds = new Map<string, string>();
      const itemGroups = (plan.groups ?? []).map((group, i) => {
        const id = generateId();
        groupIds.set(group.key, id);
        return { id, title: group.title, sortOrder: i + 1 };
      });

      const questionIds = new Map<string, string>();
      const questions = (plan.questions ?? []).map(question => {
        const stored = templateUtils.normalizeTemplateQuestion({ ...question, id: generateId() });
        if (stored.name) questionIds.set(stored.name, stored.id);
        return stored;
      });

      const items = (plan.items ?? []).map(item => {
        const { groupKey, conditions, refTemplate, ...fields } = item;
        const ref = refTemplate === undefined ? null : resolveRef(refTemplate, existing)[0];
        return templateUtils.normalizeTemplateItem({
          ...fields,
          groupId: groupKey === undefined ? null : (groupIds.get(groupKey) ?? null),
          conditions: (conditions ?? []).map(c => ({
            questionId: questionIds.get(c.question) ?? '',
            values: c.values,
          })),
          refTemplateId: ref?.id ?? null,
          // Carried so a broken reference can still say what it pointed at,
          // which is what the field is for (see TemplateItem.refTemplateName).
          refTemplateName: ref?.name ?? '',
        });
      });

      const template: TaskTemplate = {
        id: generateId(),
        name: plan.name.trim(),
        items,
        itemGroups,
        questions,
        createdAt: new Date().toISOString(),
        sortOrder: existing.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1,
        category: plan.category ?? null,
        applyContainer: plan.container ?? 'none',
        schedule: plan.schedule ? { ...DEFAULT_SCHEDULE, ...plan.schedule } : null,
        // Never set by a caller. It is state recording that a schedule already
        // fired, so accepting one would let a template be created already
        // suppressed for the current period.
        scheduleLastFiredKey: null,
        anchorsAreAway: plan.anchorsAreAway ?? false,
      };

      db.dbInsertTemplate(template);
      return template;
    },

    createTask(draft: Partial<TaskDraft>): Task {
      if (!draft.title?.trim()) throw new Error('A task needs a title.');

      const all = db.dbGetAllTasks();
      const task = taskDraft.newTaskFromDraft(
        taskDraft.applyTitleRulesToDraft(draft),
        new Date().toISOString(),
        all.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1,
        // Seed time-of-day from the category, as the two from-scratch creation
        // paths in the app do. This is a from-scratch creation.
        true
      );
      db.dbInsertTask(task);
      refresh();
      return task;
    },

    completeTask(id: string, options?: CompletionOptions): CompletedResult {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);

      const refusal = completion.completionRefusal(task);
      if (refusal) throw new Error(refusal);

      // Asked before the rows are built rather than after, so a task that
      // cannot be completed at all reports that instead of reporting a
      // missing answer it was never going to use.
      const unanswered = deliverableRefusal(
        deliverables.deliverableKindFor(task),
        options !== undefined && 'deliverableValue' in options,
        deliverables.chainStepDatedByAnswer(task)?.title ?? null,
      );
      if (unanswered) throw new Error(unanswered);

      const settings = useSettingsStore.getState();
      const built = completion.buildCompletion(task, options, {
        dayResetTime: settings.dayResetTime,
        vacationMode: settings.vacationMode,
        now: new Date(),
        allTasks: tasks(),
        subtasks: tasks().filter(t => t.parentId === id),
      });
      // Unreachable: completionRefusal above is the same guard buildCompletion
      // runs. Narrowing rather than asserting, so a rule added to one and not
      // the other surfaces as a refusal rather than as a crash.
      if (!built) throw new Error('That task cannot be completed.');

      db.dbUpdateTask(built.completed);
      for (const row of [
        ...(built.nextTask ? [built.nextTask] : []),
        ...built.nextSubtasks,
        ...(built.followUpTask ? [built.followUpTask] : []),
        ...built.followUpSubtasks,
        ...built.rolledOver,
      ]) {
        db.dbInsertTask(row);
      }

      // The one cross-store write kept, because it is a record rather than a
      // device effect: a dose taken is a fact about the person, and dropping
      // it would make a medication task completed here invisible in the log
      // that exists to count exactly these. Read through `medicationFor` so a
      // chain step carrying its own medication records that one.
      const dose = medication.medicationFor(task);
      if (dose) useMedicationStore.getState().addLog({ ...dose, taskId: id, at: new Date() });

      refresh();
      return {
        completed: built.completed,
        nextTask: built.nextTask,
        followUpTask: built.followUpTask,
        rolledOver: built.rolledOver,
        loggedDose: dose !== null,
      };
    },

    deferTask(id: string, date: Date | null): Task {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (task.completed) throw new Error('That task is already completed, so there is nothing to reschedule.');

      const { dayResetTime } = useSettingsStore.getState();
      const moved = { ...task, ...moves.scheduleMoveUpdates(task, date, dayResetTime) };
      db.dbUpdateTask(moved);
      refresh();
      return moved;
    },

    deviceId: () => db.dbGetDeviceId(),
    syncable: () => db.isSyncableDatabase(),

    async sync(): Promise<SyncSummary | null> {
      const config = { url: process.env.SYNC_URL ?? '', token: process.env.SYNC_TOKEN ?? '' };
      if (!httpTransport.isHttpSyncConfigured(config)) return null;

      const runs = await syncEngine.runSyncAll(
        [httpTransport.httpSyncTransport(config)],
        syncLocal.databaseSyncLocal()
      );
      // Whatever a pull applied is now in the database and not in the caches
      // above, so the next read has to go back to SQLite for it.
      refresh();
      return syncEngine.summarizeRuns(runs);
    },
  };
}
