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
import { addMonths } from 'date-fns/addMonths';
import { lastDayOfMonth } from 'date-fns/lastDayOfMonth';

import { shimModule } from './expoSqliteShim';
import type {
  Category,
  Cookbook,
  DeliverableKind,
  EventTaskRule,
  FoodLogEntry,
  HealthRule,
  Milestone,
  ScreenTimeRule,
  TitleRule,
  WeatherRule,
  GroceryItem,
  GroceryListEntry,
  MealPlanEntry,
  MealSlot,
  MedicationLog,
  MoodLog,
  Person,
  PersonGroup,
  PersonNote,
  Project,
  ProjectKind,
  Recipe,
  TaskTemplate,
  Task,
  TaskDraft,
} from '../../src/types';
import type { FoodLogTotals } from '../../src/utils/foodLog';
import type { LookAhead } from '../../src/utils/lookAhead';
import type { AgentNote } from '../../src/utils/agentNotes';
import type { MostMissedGroup } from '../../src/utils/missed';
import type { OnTimeSummary } from '../../src/utils/stats';
import type { SyncSummary, SyncTransport } from '../../src/utils/syncEngine';
import { DEFAULT_SCHEDULE, resolveRef, validateTemplatePlan, type TemplatePlan } from './templatePlan';
import { deliverableRefusal } from './deliverableAsk';
import { eventNoonIso, taskFieldsPatch, type TaskFieldsInput } from './taskFields';
import { adoptTimeZone, DEVICE_TIME_ZONE_KEY } from './timeZone';
import { toLedgerEntries, withAgentLedger } from './agentLedger';

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
type RewardsModule = typeof import('../../src/utils/rewards');
type TemplateUtilsModule = typeof import('../../src/utils/templateUtils');
type TaskDraftModule = typeof import('../../src/utils/taskDraft');
type TaskCompletionModule = typeof import('../../src/utils/taskCompletion');
type TaskMovesModule = typeof import('../../src/utils/taskMoves');
type GroceryAddModule = typeof import('../../src/utils/groceryAdd');
type GroceryAislesModule = typeof import('../../src/utils/groceryAisles');
type GroceryParseModule = typeof import('../../src/utils/groceryParse');
type IdModule = typeof import('../../src/utils/id');
type TaskUpdateModule = typeof import('../../src/utils/taskUpdate');
type BlockingModule = typeof import('../../src/utils/blocking');
type FollowUpModule = typeof import('../../src/utils/followUpTask');
type MealPlanModule = typeof import('../../src/utils/mealPlan');
type PersonHistoryModule = typeof import('../../src/utils/personHistory');
type BirthdayModule = typeof import('../../src/utils/birthdayTasks');
type LookAheadModule = typeof import('../../src/utils/lookAhead');
type MissedModule = typeof import('../../src/utils/missed');
type StatsModule = typeof import('../../src/utils/stats');
type SettingsIndexModule = typeof import('../../src/utils/settingsIndex');
type SettingsSearchModule = typeof import('../../src/utils/settingsSearch');

/**
 * The handful of settings a reader needs to talk about the user's day the way
 * the app does. Not the whole store: most of it is device configuration that
 * no answer about the person's tasks turns on.
 */
export interface ReplicaSettings {
  /** "HH:MM", when the logical day turns over. */
  dayResetTime: string;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: number;
  /** "HH:MM" boundaries of the four parts of the day. */
  morningStart: string;
  afternoonStart: string;
  eveningStart: string;
  nightStart: string;
  /** "HH:MM": the hours the person counts as their day, for reminders and planning. */
  activeHoursStart: string;
  activeHoursEnd: string;
  vacationMode: boolean;
  vacationEnd: string | null;
  /** Groceries, recipes and the meal plan. Off means that whole area is hidden in the app. */
  kitchenEnabled: boolean;
  /** Simplified mode: the advanced half of the app is hidden. */
  simpleMode: boolean;
  rewardsEnabled: boolean;
  /** Days completed tasks are kept, or null for for ever. */
  completedRetentionDays: number | null;
}

/**
 * The app's pure reader modules, for tools that compose several of them.
 *
 * Handed out through the replica for the reason every other value is: each
 * reaches `database.ts` somewhere down its imports, so a static import from
 * `mcp/src` would evaluate it before the shim is in place (see the rule at the
 * top of this file). One handle rather than a method per function, because a
 * report built from eight readers would otherwise add eight pass-throughs here
 * and a stub for each in every test. Only modules with no store writes and no
 * device calls belong in it.
 */
export interface ReplicaLib {
  rhythms: typeof import('../../src/utils/rhythms');
  calibration: typeof import('../../src/utils/estimateCalibration');
  moodInsights: typeof import('../../src/utils/moodInsights');
  moodLog: typeof import('../../src/utils/moodLog');
  nutritionStats: typeof import('../../src/utils/nutritionStats');
  retention: typeof import('../../src/utils/retention');
  taskInstances: typeof import('../../src/utils/taskInstances');
  visibility: typeof import('../../src/utils/visibilityUtils');
  parse: typeof import('../../src/utils/parseTaskInput');
  taskMoves: typeof import('../../src/utils/taskMoves');
  deloadPlan: typeof import('../../src/utils/deloadPlan');
  dayLoad: typeof import('../../src/utils/dayLoad');
  awayDates: typeof import('../../src/utils/awayDates');
  dates: typeof import('../../src/utils/dateUtils');
  agentNotes: typeof import('../../src/utils/agentNotes');
  nutritionEstimate: typeof import('../../src/utils/nutritionEstimate');
  generatedTasks: typeof import('../../src/utils/generatedTasks');
  titleRules: typeof import('../../src/utils/titleRules');
  weatherTasks: typeof import('../../src/utils/weatherTasks');
  eventTasks: typeof import('../../src/utils/eventTasks');
  healthRules: typeof import('../../src/utils/healthRules');
  screenTimeRules: typeof import('../../src/utils/screenTimeRules');
}

/** The rule lists an agent may edit, by the name the tools use. */
export type RuleListType = 'title' | 'weather' | 'event' | 'health' | 'screenTime';

export interface RuleLists {
  title: TitleRule[];
  weather: WeatherRule[];
  event: EventTaskRule[];
  health: HealthRule[];
  screenTime: ScreenTimeRule[];
}

/** A recipe as a tool states it. Ingredients are typed lines ("2 cloves garlic, minced"). */
export interface RecipeInput {
  name: string;
  /** A cookbook by title, created when there is none by that name. */
  cookbook?: string | null;
  ingredients?: { text: string; section?: string | null; alternativeGroup?: string | null }[];
  steps?: { text: string; section?: string | null }[];
  servings?: number | null;
  estimatedMinutes?: number | null;
  mealType?: string | null;
  tags?: string[];
  sourceUrl?: string | null;
  notes?: string;
}

export interface FoodInput {
  label: string;
  /** How much, in words: "1 bowl", "2 slices". */
  quantity?: string;
  /** Estimated amounts for the whole of what was eaten, by nutrient key. */
  amounts: Record<string, number>;
  slot?: MealSlot | null;
  at?: Date;
}

export interface MoodInput {
  mood?: number | null;
  symptoms?: { name: string; severity?: number }[];
  contextTags?: string[];
  note?: string | null;
  at?: Date;
}

export interface DoseInput {
  name: string;
  amount?: number | null;
  unit?: string | null;
  asNeeded?: boolean;
  note?: string | null;
  at?: Date;
}

/** One Settings row, located the way a person would have to walk to it. */
export interface SettingsHit {
  label: string;
  /** "Settings › Day & time › When the day turns over › Morning". */
  path: string;
  /** Why it matched when the label did not: a keyword or the section name. */
  matchedVia?: string;
}

/** What a caller may say about a completion. `CompletionOptions` without the miss. */
export type CompletionOptions = Pick<
  import('../../src/utils/taskCompletion').CompletionOptions,
  'deliverableValue' | 'completedAt'
>;

/** What a caller may say about one grocery add, past the name. */
export interface GroceryAddOptions {
  quantity?: string | null;
  note?: string | null;
  /** Which trolley. Omitted or null is the list at home. */
  listId?: string | null;
}

/** What an add did. `isNew` separates a minted shelf item from a re-listed one. */
export interface GroceryAddOutcome {
  item: GroceryItem;
  isNew: boolean;
  /**
   * True when the row was already in the trolley it was added to, so this
   * changed little. Another list holding it doesn't count: adding it here
   * still put it somewhere it wasn't.
   */
  wasOnList: boolean;
}

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

/** One step of a `create_project` plan. `waitsOn` counts from 0 over the plan's own steps. */
export interface ProjectPlanStep {
  fields: TaskFieldsInput;
  subtasks?: string[];
  waitsOn?: number[];
  /** Shown only for these answers to an earlier step's question, by position. */
  onlyIfAnswerTo?: { step: number; answers: string[] };
}

export interface ProjectPlan {
  title: string;
  /** Lets `defaultTaskCategory` name a category that doesn't exist yet, creating it. */
  newCategory?: boolean;
  notes?: string;
  deadline?: string | null;
  /** The day the project is for (Project.eventDate), as an ISO date. */
  eventDate?: string | null;
  /** A project category (the Projects page's grouping), by name. */
  category?: string | null;
  /** The task category every step falls back to, by name. */
  defaultTaskCategory?: string | null;
  kind?: ProjectKind;
  steps: ProjectPlanStep[];
}

/** What `moveProjectTasks` did. */
export interface ProjectTaskMove {
  deltaDays: number;
  moved: Task[];
  skipped: { task: Task; reason: string }[];
}

export interface ProjectPatch {
  /** Lets `defaultTaskCategory` name a category that doesn't exist yet, creating it. */
  newCategory?: boolean;
  title?: string;
  notes?: string;
  deadline?: string | null;
  eventDate?: string | null;
  category?: string | null;
  defaultTaskCategory?: string | null;
  kind?: ProjectKind;
  completed?: boolean;
  archived?: boolean;
}

export interface Replica {
  /** Where the database being served came from. Reported by `describe`. */
  readonly path: string;
  /** Drop cached reads. The server calls this once per request. */
  refresh(): void;

  tasks(): Task[];
  taskById(id: string): Task | null;
  projects(): Project[];
  /**
   * How far through a project is, by the app's own reckoning.
   *
   * `projectProgress` rather than a count of incomplete members, because the
   * two disagree on every project holding a recurring task or a dated series.
   * A daily habit leaves one tombstone per completion, so counting rows grows
   * the denominator for ever; the real read groups rows by identity (a
   * `seriesId`, else the root of the `previousOccurrenceId` chain) and counts
   * each once. It also excludes archived members from both sides, so an
   * archived-but-incomplete task cannot cap a project below 100% for good.
   *
   * Safe to reach from here even though it lives in a store module: it is a
   * top-level export taking the tasks as an argument, and `useProjectStore`'s
   * own imports are clean of anything native.
   */
  projectProgress(projectId: string): { done: number; total: number };
  /**
   * The project's answered questions, newest first: `projectDecisions`, the
   * same read as the Decisions block on the project's page, so a repeating
   * question lists its latest answer once and a chain step's answer counts.
   */
  projectDecisions(projectId: string): Task[];
  categories(): Category[];
  groceryItems(): GroceryItem[];
  /**
   * Which trolley each row is in (see `GroceryListEntry`). The list tools read
   * the home list's entries from this rather than `GroceryItem.onList`, which
   * is the broader "in any trolley" flag and would fold a trip's list into the
   * one at home.
   */
  groceryListEntries(): GroceryListEntry[];

  isVisible(task: Task): boolean;
  isUnscheduled(task: Task): boolean;
  isInbox(task: Task): boolean;
  isBlocked(task: Task): boolean;
  /** On a branch that wasn't taken: its answer gate's question got another answer (`isTaskNotNeeded`). */
  isNotNeeded(task: Task): boolean;
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
  /** The answers a Yes/No or Pick one question offers, or [] for any other. */
  deliverableOptions(task: Task): string[];

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

  /** See `ReplicaSettings`. Read fresh from the settings store, so it follows a sync. */
  settings(): ReplicaSettings;
  /**
   * The app's own look-ahead (`buildLookAhead`) from the start of the logical
   * today across `days` days: per-day rows, projected recurring occurrences,
   * each day's load, what is carried over, and deadlines that will not fit.
   */
  lookAhead(days: number): LookAhead;
  /** The logical day an instant falls on, under the user's `dayResetTime`. */
  logicalDayKeyOf(iso: string): string;
  /** Completed by a person, as opposed to swept as missed. Every statistic counts only these. */
  isRealCompletion(task: Task): boolean;
  onTimeSummary(tasks: readonly Task[]): OnTimeSummary;
  mostMissed(tasks: readonly Task[]): MostMissedGroup[];
  /**
   * The Settings search the app's own search field runs, over the rows this
   * person can actually see (the kitchen and simplified-mode gates applied).
   */
  searchSettings(query: string): SettingsHit[];
  /** When the replica last finished a sync, or null if it has not since starting. */
  lastSyncedAt(): string | null;
  /** See `ReplicaLib`. */
  lib(): ReplicaLib;
  /** Every mood check-in, unfiltered: the insights need the whole log. */
  allMoodLogs(): MoodLog[];
  milestones(): Milestone[];
  /** Every tag the person has, used or not. */
  tagRegistry(): string[];
  /**
   * A recipe, through the recipe store's own add and setters, the same calls
   * the app's create sheet makes. Refused when the name is taken in that book.
   */
  createRecipe(input: RecipeInput): Recipe;
  /**
   * A food entry with an estimated panel, through `readNutritionEstimate`,
   * `estimateToPanel` and `buildFoodLogEntry`. Marked estimated for good, and
   * never written to Apple Health: only the device a meal is logged on may.
   */
  logFood(input: FoodInput): FoodLogEntry;
  /** A mood check-in through the mood store, symptoms and tags in the spellings already in the log. */
  logMood(input: MoodInput): MoodLog;
  /** A dose through the medication store, the name in the spelling already in the log. */
  logMedication(input: DoseInput): MedicationLog;
  /** Every automation rule list, as the settings store holds it. */
  ruleLists(): RuleLists;
  /** Replace one rule list through the settings store's own setter. The list must already be normalized. */
  setRuleList<T extends RuleListType>(type: T, rules: RuleLists[T]): void;
  /** Whether an automation is on, by its settings key (`GeneratedKindSpec.enabledKey`). */
  generatorEnabled(key: string): boolean;
  setGeneratorEnabled(key: string, on: boolean): void;
  /** What the person wants an agent to keep in mind (`src/utils/agentNotes.ts`). */
  agentNotes(): AgentNote[];
  writeAgentNotes(notes: readonly AgentNote[]): void;
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
  /** What `completeTask` would refuse, without writing anything; null when it would go through. */
  completionProblem(id: string, options?: CompletionOptions): string | null;

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

  /**
   * Archive a task, or restore an archived one, as the app's own
   * `archiveTask` / `unarchiveTask` do. This is the replica's only way to take
   * a task back off every list: there is deliberately no delete, since an
   * archived row can be restored in the app and a deleted one cannot.
   *
   * Archiving unpins. Restoring breaks the streak (the gap is real) and folds
   * the run into `priorBestStreak`, as the app's resume does. A subtask is
   * refused: it goes with its parent.
   */
  setTaskArchived(id: string, archived: boolean): Task;

  /**
   * Put a name on the shopping list, exactly as typing it into the app would.
   *
   * `planGroceryAdd` (`src/utils/groceryAdd.ts`) decides everything; this only
   * writes what it decided. The two rules worth knowing before reading the
   * code, both from docs/arch/groceries.md:
   *
   * **There is one catalog and it is also the list.** A `GroceryItem` is the
   * shelf item and lives for ever; `GroceryListEntry` is whether it is in a
   * trolley right now. So adding a name the user has bought before writes no
   * new row at all, it re-lists the row that is already there, with its aisle,
   * its purchase history and its pantry state intact.
   *
   * **The find is not an equality test.** `catalogItemForKey` resolves
   * singular against plural, so "serrano pepper" finds an existing "Serrano
   * peppers" rather than minting a near-duplicate that splits one shelf item in
   * two. This is the read the arch doc names as the mistake to avoid.
   *
   * What it does not do: the cart-hold animation, the undo, and the AI aisle
   * classification a row landing in Other triggers on device. The last is the
   * only one with teeth, and it is the right call here regardless — it is a
   * network request to Anthropic, and a server quietly making them on the
   * user's key because a model added milk is not a thing to do unasked.
   */
  addGroceryItem(name: string, opts?: GroceryAddOptions): GroceryAddOutcome;

  /**
   * Tick something off in the trolley at home, or un-tick it. Every grocery
   * write here acts on the home list, which is the one `list_grocery_items`
   * reports.
   *
   * Written straight through `dbSetGroceryListEntry` rather than through a
   * builder, because unlike the add there is nothing to decide: checked lives
   * on the membership, and that db function is also the only writer of the
   * mirror columns on the item row (`dbSyncGroceryHomeColumns`), so the row and
   * the entry cannot disagree.
   */
  setGroceryChecked(id: string, checked: boolean): GroceryItem;

  /**
   * Take something off the home list, which parks it rather than deleting it.
   *
   * The catalog row stays, with everything anyone ever recorded on it. That is
   * the app's own rule and not a shortcut: a row leaves only when asked, and
   * dropping one wrongly destroys a substitute or a price history with no undo.
   * A recipe's claim on the quantity ends with the shop, so that is cleared.
   */
  removeFromGroceryList(id: string): GroceryItem;

  /**
   * The `Task` fields a `create_task`/`update_task` input stands for, checked
   * the way the app's editor would check them (see taskFields.ts), with
   * `waitsOn` resolved here because it needs the other tasks: each blocker has
   * to exist, be a live top-level task, and not wait on this one in turn.
   * Throws with every problem at once.
   */
  taskPatch(input: TaskFieldsInput, current: Task | null, isSubtask: boolean): Partial<Task>;

  /**
   * Edit a task, exactly as the app's own `updateTask` would.
   *
   * The row is built by `mergeTaskUpdate` (`src/utils/taskUpdate.ts`), which
   * was lifted out of the store for this: the anchor day a schedule edit
   * re-derives, the anchor date it clears, the postpone count a date push
   * bumps, the wait stamp, the pin rank, the clears a dropped repeat implies.
   * A dated series' later dates get the content fields the edit named, through
   * `seriesFanOutRows`, as the editor's default "this and later" scope does.
   *
   * What it does not do is the device work around the write (reminders, quota
   * nudges, calendar events), for the reason `createTask` gives. A completed
   * task is refused: reopening one is a decision about history, and raising a
   * done target's count is the one edit the store turns into a reopen.
   */
  updateTask(id: string, patch: Partial<Task>): { task: Task; alsoUpdated: number };

  /**
   * A project and its whole plan, in one transaction, so a dropped connection
   * can't leave half a project. Built by `useProjectStore.createProject` and
   * `updateProject`, which are reachable here (the store's imports are clean)
   * and loaded on every refresh. Steps are tasks; a step's `waitsOn` names
   * earlier steps by position, written as real blockers once their ids exist.
   */
  createProjectPlan(plan: ProjectPlan): { project: Project; tasks: Task[] };
  /**
   * Steps added to a project that already exists, checked and written together
   * the way `createProjectPlan` writes a new one's. A step's `waitsOn` names
   * earlier steps in this batch by position; its `fields.waitsOn` names tasks
   * already in the app by id.
   */
  addProjectSteps(projectId: string, steps: ProjectPlanStep[]): Task[];
  /** Rename, re-date, re-file, complete or archive a project. Its tasks are untouched. */
  updateProject(id: string, patch: ProjectPatch): Project;
  /**
   * Move a project's dated tasks by the days its event (or any date) moved,
   * as the app's own offer does when the date is changed in the editor:
   * `buildAwayShiftPlan` decides each row, and a row the app would offer
   * unticked (pinned, urgent, a running timer, a streak, someone's task) is
   * left where it is and reported, since nobody is here to tick it.
   */
  moveProjectTasks(projectId: string, from: Date, to: Date): ProjectTaskMove;

  recipes(): Recipe[];
  cookbooks(): Cookbook[];
  /** Planned meals between two day keys, inclusive. */
  mealPlan(fromDayKey: string, toDayKey: string): MealPlanEntry[];
  /**
   * Put a meal on the plan, built by `buildMealPlanEntry` as the app's own
   * `planMeal` does. Not done: the slot's task and the calendar event, which
   * are device work and catch up on the next launch there.
   */
  planMeal(draft: { date: string; slot: MealSlot; title?: string; recipeId?: string | null }): MealPlanEntry;

  people(): Person[];
  personGroups(): PersonGroup[];
  personNotes(): PersonNote[];
  /** Completed tasks naming this person, newest first: the app's history for them. */
  personHistory(personId: string): { taskId: string; title: string; at: string }[];
  /** The next birthday on or after the logical today, or null. */
  nextBirthday(person: Person): Date | null;
  /**
   * Add something to a person's history, exactly as "Add to history" on their
   * page does: a task naming them, completed at `at`. There is no separate
   * history table, by design (docs/arch/people.md).
   */
  addPersonHistory(personIds: string[], title: string, at: Date): Task;

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
/**
 * The transport with a log line per request: what it was, how long it took,
 * and how big. A sync that stalls on the server shows as a request with a
 * start line and no end, which is the one question a hang otherwise leaves
 * nobody able to answer from outside the machine.
 */
function loggedTransport(transport: SyncTransport): SyncTransport {
  const timed = async <T>(what: string, call: () => Promise<T>, size: (r: T) => string): Promise<T> => {
    const started = Date.now();
    console.error(`replica sync: ${what} started`);
    try {
      const result = await call();
      console.error(`replica sync: ${what} done in ${Date.now() - started}ms${size(result)}`);
      return result;
    } catch (e) {
      console.error(`replica sync: ${what} failed after ${Date.now() - started}ms`);
      throw e;
    }
  };
  return {
    ...transport,
    push: payload => timed(`push (${payload.length} chars)`, () => transport.push(payload), () => ''),
    pull: since =>
      timed(`pull since ${since ?? 'start'}`, () => transport.pull(since), r =>
        `, ${r.payloads.length} payloads, ${r.payloads.reduce((n, p) => n + p.length, 0)} chars`
      ),
  };
}

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
  const rewards = require('../../src/utils/rewards') as RewardsModule;
  const syncEngine = require('../../src/utils/syncEngine') as SyncEngineModule;
  const syncLocal = require('../../src/utils/syncLocal') as SyncLocalModule;
  const httpTransport = require('../../src/utils/httpSyncTransport') as HttpTransportModule;
  const templateUtils = require('../../src/utils/templateUtils') as TemplateUtilsModule;
  const taskDraft = require('../../src/utils/taskDraft') as TaskDraftModule;
  const completion = require('../../src/utils/taskCompletion') as TaskCompletionModule;
  const moves = require('../../src/utils/taskMoves') as TaskMovesModule;
  const awayShift = require('../../src/utils/awayShift') as typeof import('../../src/utils/awayShift');
  const groceryAdd = require('../../src/utils/groceryAdd') as GroceryAddModule;
  const aisles = require('../../src/utils/groceryAisles') as GroceryAislesModule;
  const parse = require('../../src/utils/groceryParse') as GroceryParseModule;
  const { generateId } = require('../../src/utils/id') as IdModule;
  const { useMedicationStore } = require('../../src/store/useMedicationStore') as typeof import('../../src/store/useMedicationStore');
  const { useRewardStore } = require('../../src/store/useRewardStore') as typeof import('../../src/store/useRewardStore');
  const { registerTaskSource } = require('../../src/utils/blockerRegistry') as typeof import('../../src/utils/blockerRegistry');
  const { registerPersonSource } = require('../../src/utils/peopleRegistry') as typeof import('../../src/utils/peopleRegistry');
  const { registerPausedProjectSource } = require('../../src/utils/projectPause') as typeof import('../../src/utils/projectPause');
  const { useSettingsStore } = require('../../src/store/useSettingsStore') as typeof import('../../src/store/useSettingsStore');
  const { useCategoryStore } = require('../../src/store/useCategoryStore') as typeof import('../../src/store/useCategoryStore');
  const { projectProgress, projectDecisions, useProjectStore } = require('../../src/store/useProjectStore') as typeof import('../../src/store/useProjectStore');
  const taskUpdate = require('../../src/utils/taskUpdate') as TaskUpdateModule;
  const streakRecord = require('../../src/utils/streakRecord') as typeof import('../../src/utils/streakRecord');
  const blocking = require('../../src/utils/blocking') as BlockingModule;
  const followUp = require('../../src/utils/followUpTask') as FollowUpModule;
  const mealPlanUtils = require('../../src/utils/mealPlan') as MealPlanModule;
  const personHistoryUtils = require('../../src/utils/personHistory') as PersonHistoryModule;
  const birthdays = require('../../src/utils/birthdayTasks') as BirthdayModule;
  const lookAheadUtils = require('../../src/utils/lookAhead') as LookAheadModule;
  const missed = require('../../src/utils/missed') as MissedModule;
  const stats = require('../../src/utils/stats') as StatsModule;
  const settingsIndex = require('../../src/utils/settingsIndex') as SettingsIndexModule;
  const settingsSearch = require('../../src/utils/settingsSearch') as SettingsSearchModule;
  /* eslint-enable @typescript-eslint/no-require-imports */

  db.initDatabase();
  // Before anything computes a day: the stores below read "today" as they
  // hydrate. See timeZone.ts.
  adoptTimeZone(db.dbGetSetting(DEVICE_TIME_ZONE_KEY));
  useSettingsStore.getState().initialize();
  useCategoryStore.getState().initialize();
  // Loaded rather than left empty: `newTaskFromDraft` reads a project's default
  // task category from this store, so with it empty a task created into a
  // project here ignored that setting. createProjectPlan writes through it too.
  useProjectStore.getState().initialize();

  // Read caches, cleared per request by `refresh`. They exist because the
  // blocker registry resolves one id at a time: without them, a list of 200
  // tasks in which 20 are blocked is 20 full table reads.
  let taskCache: Task[] | null = null;
  let personCache: Person[] | null = null;
  let projectCache: Project[] | null = null;
  let syncedAt: string | null = null;
  let libCache: ReplicaLib | null = null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const notesModule = () => require('../../src/utils/agentNotes') as typeof import('../../src/utils/agentNotes');

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
    useProjectStore.getState().initialize();
  };

  /**
   * `dueDaysFromEvent` / `deadlineDaysFromEvent` turned into the dates they
   * name, counted from the event date of the project the task is in (or is
   * going into). Midday, like every date the app places.
   */
  const resolveEventDays = (
    input: TaskFieldsInput,
    current: Task | null,
    eventDate: string | null | undefined,
  ): { fields: TaskFieldsInput; errors: string[] } => {
    const { dueDaysFromEvent, deadlineDaysFromEvent, dueEndOfMonthAfterEvent, deadlineEndOfMonthAfterEvent, ...fields } = input;
    const errors: string[] = [];
    const asks = [dueDaysFromEvent, deadlineDaysFromEvent, dueEndOfMonthAfterEvent, deadlineEndOfMonthAfterEvent];
    if (asks.every(a => a === undefined)) return { fields, errors };
    const projectId = fields.projectId !== undefined ? fields.projectId : current?.projectId ?? null;
    const event = eventDate !== undefined ? eventDate : projects().find(p => p.id === projectId)?.eventDate ?? null;
    if (!event) {
      errors.push('The ...FromEvent and ...AfterEvent fields count from the project\'s event date, and this task\'s project has none. Set one with update_project, or give a date.');
      return { fields, errors };
    }
    const at = (days: number): string => {
      const d = addDays(new Date(event), days);
      d.setHours(12, 0, 0, 0);
      return d.toISOString();
    };
    const monthEnd = (months: number): string => {
      const d = lastDayOfMonth(addMonths(new Date(event), months));
      d.setHours(12, 0, 0, 0);
      return d.toISOString();
    };
    const ways = [
      [dueDaysFromEvent, 'dueDate', 'dueDaysFromEvent', at],
      [dueEndOfMonthAfterEvent, 'dueDate', 'dueEndOfMonthAfterEvent', monthEnd],
      [deadlineDaysFromEvent, 'deadline', 'deadlineDaysFromEvent', at],
      [deadlineEndOfMonthAfterEvent, 'deadline', 'deadlineEndOfMonthAfterEvent', monthEnd],
    ] as const;
    for (const [n, key, name, resolve] of ways) {
      if (n === undefined) continue;
      if (!Number.isInteger(n)) errors.push(`${name} must be a whole number.`);
      else if (fields[key] !== undefined) errors.push(`Give one of ${key}, ${key === 'dueDate' ? 'dueDaysFromEvent or dueEndOfMonthAfterEvent' : 'deadlineDaysFromEvent or deadlineEndOfMonthAfterEvent'}, not more.`);
      else fields[key] = resolve(n);
    }
    return { fields, errors };
  };

  /** A batch's checked step fields, and each gated step's answers (by position) as the question spells them. */
  interface CheckedSteps {
    patches: Partial<Task>[];
    gates: Record<number, string[]>;
  }

  /**
   * The answers a gate opens on, spelled as the question offers them, or null
   * with a reason in `errors` for any the question doesn't offer: a gate on
   * "Cityhall" would never open, and the task would be not needed for good.
   */
  const gateFor = (answers: string[], offered: string[], errors: string[]): string[] | null => {
    const out: string[] = [];
    for (const a of answers) {
      const match = offered.find(o => o.toLowerCase() === a.toLowerCase());
      if (match) { if (!out.includes(match)) out.push(match); } else errors.push(`onlyIfAnswer: "${a}" isn't one of its answers (${offered.join(', ')}).`);
    }
    return out.length === answers.length ? out : null;
  };

  /**
   * A category name as the person spelled it, matched ignoring case and outer
   * spaces, or the name itself when `allowNew` says a new one is meant. Any
   * other name is refused with the list: a free-text category that matches
   * nothing files the task under a section the person never made, which is
   * how a typo becomes a stray heading on Today.
   */
  const categoryNamed = (name: string, allowNew: boolean, errors: string[], field = 'category'): string | null => {
    const wanted = name.trim();
    if (!wanted) { errors.push(`${field} can't be blank.`); return null; }
    const match = useCategoryStore.getState().categories.find(c => c.name.toLowerCase() === wanted.toLowerCase());
    if (match) return match.name;
    if (allowNew) return wanted;
    errors.push(`${field}: "${wanted}" isn't one of your categories (${categoryList()}). Use one of those, or pass newCategory: true to create it.`);
    return null;
  };
  const categoryList = (): string => useCategoryStore.getState().categories.map(c => c.name).join(', ') || 'none yet';

  /**
   * Creates a category a checked patch named with `newCategory`, inside the
   * write that uses it. Validation only lets an unknown name through with that
   * flag, so a name missing here is always one the caller asked for.
   */
  const ensureCategory = (name: string | null | undefined): void => {
    if (name && !useCategoryStore.getState().getCategoryByName(name)) useCategoryStore.getState().addCategory(name);
  };

  /** A step or task's fields, checked, with blockers resolved against the live tasks. */
  const taskPatch = (
    input: TaskFieldsInput,
    current: Task | null,
    isSubtask: boolean,
    ctx: {
      /** The event date to count from, for a project that isn't written yet. Otherwise read off the task's project. */
      eventDate?: string | null;
      /** The default task category of a project that isn't written yet. Otherwise read off the task's project. */
      projectCategory?: string | null;
    } = {},
  ): Partial<Task> => {
    const { newCategory, ...rest } = input;
    const { fields, errors: eventErrors } = resolveEventDays(rest, current, ctx.eventDate);
    const { patch, waitsOn, onlyIfAnswer, errors } = taskFieldsPatch(fields, current, {
      newId: generateId,
      emptyFollowUpDraft: followUp.emptyFollowUpTaskDraft,
    }, { isSubtask });
    errors.unshift(...eventErrors);

    // ---- category ------------------------------------------------------------
    if (typeof fields.category === 'string') {
      const named = categoryNamed(fields.category, newCategory === true, errors);
      if (named) patch.category = named;
    }
    // Every top-level task created here lands in a category: one named, the
    // project's own default, or one a title rule of the person's supplies.
    // A checklist item has no section of its own, so it's exempt.
    if (!current && !isSubtask && !patch.category) {
      const projectId = fields.projectId ?? null;
      const fromProject = ctx.projectCategory !== undefined
        ? ctx.projectCategory
        : projectId ? projects().find(p => p.id === projectId)?.defaultTaskCategory ?? null : null;
      const fromRule = fields.title ? taskDraft.applyTitleRulesToDraft({ title: fields.title }).category ?? null : null;
      if (!fromProject && !fromRule) {
        errors.push(`"${fields.title ?? 'This task'}" needs a category. Pick the one it belongs under from yours (${categoryList()}), or name a new one with newCategory: true.`);
      }
    }

    if (waitsOn !== undefined) {
      const all = tasks();
      const resolve = blocking.resolverFor(all);
      const ids = waitsOn;
      for (const id of waitsOn ?? []) {
        const candidate = resolve(id);
        if (!candidate) errors.push(`waitsOn: no task with id ${id}.`);
        else if (!blocking.canBeBlockerOf(candidate, current?.id ?? null, resolve)) {
          errors.push(`waitsOn: "${candidate.title}" can't be waited on: it is done, archived, a subtask, or already waits on this task.`);
        }
      }
      Object.assign(patch, blocking.blockerFields(ids));
    }
    if (onlyIfAnswer && errors.length === 0) {
      const resolve = blocking.resolverFor(tasks());
      const question = resolve(onlyIfAnswer.taskId);
      if (!question) errors.push(`onlyIfAnswer: no task with id ${onlyIfAnswer.taskId}.`);
      else if (!blocking.canBeGateOf(question, current?.id ?? null, resolve)) {
        errors.push(`onlyIfAnswer: "${question.title}" can't decide this task: it has to ask a Yes/No or pick-one question, be a live top-level task, and not wait on this one.`);
      } else {
        const gate = gateFor(onlyIfAnswer.answers, deliverables.deliverableOptionsFor(question), errors);
        if (gate) patch.answerGate = { taskId: question.id, answers: gate };
      }
    }
    if (errors.length > 0) throw new Error(errors.join(' '));
    return patch;
  };

  /**
   * The refusals a completion makes before it builds anything, and the answer
   * as it will be stored. Shared by `completeTask` and `completionProblem`, so
   * a preview refuses exactly what the write would.
   */
  const vetCompletion = (task: Task, options?: CompletionOptions): CompletionOptions | undefined => {
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

    // A question with a fixed set of answers takes one of them, stored in
    // the option's own spelling so the project's tally counts it. Anything
    // else would be recorded and then counted as "no answer".
    const offered = deliverables.deliverableOptionsFor(task);
    const given = options?.deliverableValue;
    if (offered.length > 0 && typeof given === 'string') {
      const match = offered.find(o => o.toLowerCase() === given.trim().toLowerCase());
      if (!match) {
        throw new Error(`That task's answer is one of: ${offered.join(', ')}. Pass one of those as deliverableValue, or null to complete it without an answer.`);
      }
      options = { ...options, deliverableValue: match };
    }
    return options;
  };

  /**
   * A batch of project steps, checked in full before anything is written, so
   * a bad step fails the whole batch with all its problems listed rather than
   * leaving a project with half its steps. `waitsOn` positions count over the
   * batch itself; a step's own `fields.waitsOn` names tasks that already exist.
   */
  const checkSteps = (steps: ProjectPlanStep[], eventDate: string | null, projectCategory: string | null): CheckedSteps => {
    const errors: string[] = [];
    const gates: Record<number, string[]> = {};
    const patches = steps.map((step, i) => {
      for (const n of step.waitsOn ?? []) {
        if (!Number.isInteger(n) || n < 0 || n >= i) errors.push(`steps[${i}].waitsOn: ${n} is not an earlier step. Steps can only wait on steps before them.`);
      }
      if (!step.fields.title?.trim()) errors.push(`steps[${i}] needs a title.`);
      try {
        return taskPatch({ ...step.fields, projectId: undefined }, null, false, { eventDate, projectCategory });
      } catch (e) {
        errors.push(`steps[${i}]: ${e instanceof Error ? e.message : String(e)}`);
        return {};
      }
    });
    // Checked once every step's own fields are, since the question is another
    // step's patch: it has to be earlier and ask something with listed answers.
    steps.forEach((step, i) => {
      const to = step.onlyIfAnswerTo;
      if (!to) return;
      if (!Number.isInteger(to.step) || to.step < 0 || to.step >= i) {
        errors.push(`steps[${i}].onlyIfAnswerTo: ${to.step} is not an earlier step.`);
        return;
      }
      const offered = deliverables.deliverableOptionsFor(patches[to.step] as Task);
      if (offered.length < 2) {
        errors.push(`steps[${i}].onlyIfAnswerTo: step ${to.step} has to ask a Yes/No or pick-one question.`);
        return;
      }
      const answers = [...new Set((to.answers ?? []).map(a => a.trim()).filter(Boolean))];
      if (answers.length === 0) errors.push(`steps[${i}].onlyIfAnswerTo needs at least one answer.`);
      const gate = gateFor(answers, offered, errors);
      if (gate && gate.length > 0) gates[i] = gate;
    });
    if (errors.length > 0) throw new Error(errors.join(' '));
    return { patches, gates };
  };

  /** Writes checked steps (and their checklists) into a project. Call inside a transaction. */
  const writeSteps = (projectId: string, steps: ProjectPlanStep[], { patches, gates }: CheckedSteps): Task[] => {
    const created: Task[] = [];
    const now = new Date().toISOString();
    let order = nextTaskOrder();
    const ids: string[] = [];
    steps.forEach((step, i) => {
      const blockers = (step.waitsOn ?? []).map(n => ids[n]);
      // The question is an earlier step of this batch, so its id exists now.
      const answers = gates[i];
      const draft = {
        ...patches[i],
        ...(answers ? { answerGate: { taskId: ids[steps[i].onlyIfAnswerTo!.step], answers } } : {}),
        projectId,
        ...(blockers.length > 0
          ? blocking.blockerFields([...blocking.blockerIdsOf({ blockedById: patches[i].blockedById ?? null, blockedByIds: patches[i].blockedByIds }), ...blockers])
          : {}),
      } as Partial<TaskDraft>;
      const task = taskDraft.newTaskFromDraft(taskDraft.applyTitleRulesToDraft(draft), now, order++, true);
      ensureCategory(task.category);
      db.dbInsertTask(task);
      ids.push(task.id);
      created.push(task);
      (step.subtasks ?? []).forEach((subtitle, j) => {
        if (!subtitle.trim()) return;
        const sub = taskDraft.newTaskFromDraft({ title: subtitle.trim(), parentId: task.id }, now, j + 1, false, undefined, true);
        db.dbInsertTask(sub);
        created.push(sub);
      });
    });
    return created;
  };

  /** The next free `sortOrder` across every task, which is where a new one goes. */
  const nextTaskOrder = (): number => db.dbGetAllTasks().reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1;

  registerTaskSource(tasks);
  registerPersonSource(people);
  // After the project store's own module has registered its (never loaded,
  // so empty) list: without this every paused project's tasks read as on
  // Today here while the app hides them.
  registerPausedProjectSource(projects);

  const replica: Replica = {
    path,

    refresh,

    tasks,
    projects,
    projectProgress: (projectId: string) => projectProgress(projectId, tasks()),
    projectDecisions: (projectId: string) => projectDecisions(projectId, tasks()),
    taskById: (id: string) => tasks().find(t => t.id === id) ?? null,
    categories: () => db.dbGetAllCategories(),
    groceryItems: () => db.dbGetAllGroceryItems(),
    groceryListEntries: () => db.dbGetAllGroceryListEntries(),

    isVisible: (task: Task) => visibility.isTaskVisible(task),
    isUnscheduled: (task: Task) => visibility.isUnscheduledTask(task),
    isInbox: (task: Task) => visibility.isInboxTask(task),
    isBlocked: (task: Task) => visibility.isTaskBlocked(task),
    isNotNeeded: (task: Task) => visibility.isTaskNotNeeded(task),
    visibleAt: (task: Task) => visibility.getVisibleAt(task),

    displayTitle: (task: Task) => visibility.displayTitleFor(task),
    estimatedMinutes: (task: Task) => effort.estimatedMinutesFor(task),
    deliverableKind: (task: Task) => deliverables.deliverableKindFor(task),
    deliverableOptions: (task: Task) => deliverables.deliverableOptionsFor(task),

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

    settings(): ReplicaSettings {
      const s = useSettingsStore.getState();
      return {
        dayResetTime: s.dayResetTime,
        weekStartsOn: s.weekStartsOn,
        morningStart: s.morningStart,
        afternoonStart: s.afternoonStart,
        eveningStart: s.eveningStart,
        nightStart: s.nightStart,
        activeHoursStart: s.activeHoursStart,
        activeHoursEnd: s.activeHoursEnd,
        vacationMode: s.vacationMode,
        vacationEnd: s.vacationEnd,
        kitchenEnabled: s.kitchenEnabled,
        simpleMode: s.simpleMode,
        rewardsEnabled: s.rewardsEnabled,
        completedRetentionDays: s.completedRetentionDays,
      };
    },

    // No calendar events: a Node process cannot read EventKit, so every day
    // comes back `busyKnown: false`, which is the module's own word for "not
    // known" rather than "free".
    lookAhead(days: number): LookAhead {
      const { dayResetTime } = useSettingsStore.getState();
      return lookAheadUtils.buildLookAhead(tasks(), {
        cutoff: addDays(dates.getLogicalToday(dayResetTime), days),
        dayResetTime,
      });
    },

    logicalDayKeyOf: (iso: string) =>
      dates.getLogicalDayKey(new Date(iso), useSettingsStore.getState().dayResetTime),
    isRealCompletion: (task: Task) => missed.isRealCompletion(task),
    onTimeSummary: (list: readonly Task[]) => stats.onTimeSummary(list),
    mostMissed: (list: readonly Task[]) => missed.mostMissed(list),

    searchSettings(query: string): SettingsHit[] {
      const { kitchenEnabled, simpleMode } = useSettingsStore.getState();
      // 'ios' because that is the only platform the app ships on. No active-row
      // set: a row behind a switch that is off is still the answer to "where is
      // the setting for X", and the path says which switch to look under.
      const entries = settingsIndex.visibleSettingsEntries('ios', kitchenEnabled, simpleMode);
      return settingsSearch.searchSettings(entries, query).map(r => {
        const group = settingsIndex.settingsGroup(r.entry.groupId);
        const where = group?.screen ? `Menu › ${group.title}` : `Settings › ${group?.title ?? r.entry.groupId}`;
        return {
          label: r.entry.label,
          path: `${where} › ${r.entry.section} › ${r.entry.label}`,
          ...(r.matchedVia ? { matchedVia: r.matchedVia } : {}),
        };
      });
    },

    lastSyncedAt: () => syncedAt,

    lib(): ReplicaLib {
      /* eslint-disable @typescript-eslint/no-require-imports */
      return (libCache ??= {
        rhythms: require('../../src/utils/rhythms'),
        calibration: require('../../src/utils/estimateCalibration'),
        moodInsights: require('../../src/utils/moodInsights'),
        moodLog: require('../../src/utils/moodLog'),
        nutritionStats: require('../../src/utils/nutritionStats'),
        retention: require('../../src/utils/retention'),
        taskInstances: require('../../src/utils/taskInstances'),
        visibility,
        parse: require('../../src/utils/parseTaskInput'),
        taskMoves: moves,
        deloadPlan: require('../../src/utils/deloadPlan'),
        dayLoad: require('../../src/utils/dayLoad'),
        awayDates: require('../../src/utils/awayDates'),
        dates,
        agentNotes: require('../../src/utils/agentNotes'),
        nutritionEstimate: require('../../src/utils/nutritionEstimate'),
        generatedTasks: require('../../src/utils/generatedTasks'),
        titleRules: require('../../src/utils/titleRules'),
        weatherTasks: require('../../src/utils/weatherTasks'),
        eventTasks: require('../../src/utils/eventTasks'),
        healthRules: require('../../src/utils/healthRules'),
        screenTimeRules: require('../../src/utils/screenTimeRules'),
      });
      /* eslint-enable @typescript-eslint/no-require-imports */
    },
    allMoodLogs: () => db.dbGetAllMoodLogs(),
    milestones: () => db.dbGetAllMilestones(),
    tagRegistry: () => db.dbGetTagRegistry(),
    createRecipe(input: RecipeInput): Recipe {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { useRecipeStore } = require('../../src/store/useRecipeStore') as typeof import('../../src/store/useRecipeStore');
      const recipeUtils = require('../../src/utils/recipeUtils') as typeof import('../../src/utils/recipeUtils');
      /* eslint-enable @typescript-eslint/no-require-imports */
      // Loaded here rather than on every refresh: only this write reads it, and
      // the library is the largest thing a refresh would otherwise re-read.
      useRecipeStore.getState().initialize();
      const store = useRecipeStore.getState();

      const book = input.cookbook?.trim() ? store.ensureCookbook(input.cookbook.trim()) : null;
      const recipe = store.addRecipe(input.name, book?.id ?? null);
      if (!recipe) {
        throw new Error(recipeUtils.cleanRecipeName(input.name)
          ? `There is already a recipe called "${input.name.trim()}"${book ? ` in ${book.title}` : ''}.`
          : 'A recipe needs a name.');
      }
      const id = recipe.id;
      const ingredients = (input.ingredients ?? [])
        .map(line => {
          const made = recipeUtils.makeIngredient(line.text, line.section?.trim() || null);
          return made ? { ...made, choiceGroup: recipeUtils.cleanChoiceGroup(line.alternativeGroup) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (ingredients.length > 0) useRecipeStore.getState().addStructuredIngredients(id, ingredients);
      for (const step of input.steps ?? []) useRecipeStore.getState().addStep(id, step.text, step.section ?? null);
      const after = useRecipeStore.getState();
      if (input.servings != null) after.setServings(id, input.servings);
      if (input.estimatedMinutes != null) after.setEstimatedMinutes(id, input.estimatedMinutes);
      if (input.mealType) after.setMealType(id, input.mealType as Recipe['mealType']);
      if (input.tags?.length) after.setTags(id, input.tags);
      if (input.sourceUrl) after.setSourceUrl(id, input.sourceUrl);
      if (input.notes?.trim()) after.setNotes(id, input.notes.trim());
      return useRecipeStore.getState().recipes.find(r => r.id === id)!;
    },

    logFood(input: FoodInput): FoodLogEntry {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const estimate = require('../../src/utils/nutritionEstimate') as typeof import('../../src/utils/nutritionEstimate');
      const builder = require('../../src/utils/foodLogEntry') as typeof import('../../src/utils/foodLogEntry');
      /* eslint-enable @typescript-eslint/no-require-imports */
      // The app's own reader for a model's estimate: unknown keys dropped, a
      // figure nobody stated left absent rather than zero.
      const read = estimate.readNutritionEstimate({ label: input.label, quantity: input.quantity ?? '', amounts: input.amounts, basis: 'typical', confidence: 'medium' });
      if (!read) throw new Error('A food entry needs a name and at least one nutrient amount (calorieKcal, proteinG, carbsG, fatG, ...).');
      const panel = estimate.estimateToPanel(read);
      if (!panel) throw new Error('A food entry needs at least one nutrient amount.');
      const entry = builder.buildFoodLogEntry(
        { label: read.label, quantity: input.quantity ?? '', grams: null, nutrition: panel, slot: input.slot ?? null, at: input.at },
        dayKey => db.dbGetFoodLogEntries(dayKey, dayKey),
        generateId,
      );
      if (!entry) throw new Error('That entry could not be logged.');
      db.dbInsertFoodLogEntry(entry);
      return entry;
    },

    logMood(input: MoodInput): MoodLog {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { useMoodStore } = require('../../src/store/useMoodStore') as typeof import('../../src/store/useMoodStore');
      const moodLog = require('../../src/utils/moodLog') as typeof import('../../src/utils/moodLog');
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (input.mood != null && (!Number.isInteger(input.mood) || input.mood < 1 || input.mood > 5)) {
        throw new Error('mood is a whole number from 1 (low) to 5 (great), or left out.');
      }
      // The spelling already in the log, so "headache" lands on the existing
      // "Headache" rather than starting a second symptom the insights would
      // count apart.
      const logs = db.dbGetAllMoodLogs();
      const spelled = (vocab: string[], key: (s: string) => string) => {
        const byKey = new Map(vocab.map(v => [key(v), v]));
        return (name: string) => byKey.get(key(name)) ?? name.trim();
      };
      const symptom = spelled(moodLog.symptomVocabulary(logs), moodLog.symptomKey);
      const tag = spelled(moodLog.contextTagVocabulary(logs), moodLog.contextTagKey);
      const symptoms = (input.symptoms ?? []).map(s => ({
        name: symptom(s.name),
        severity: (s.severity === 1 || s.severity === 3 ? s.severity : 2) as 1 | 2 | 3,
      }));
      const log = useMoodStore.getState().addLog(
        (input.mood ?? null) as MoodLog['mood'],
        symptoms,
        input.note ?? null,
        input.at,
        (input.contextTags ?? []).map(tag),
      );
      if (!log) throw new Error('A check-in needs a mood, a symptom, a tag or a note.');
      return log;
    },

    logMedication(input: DoseInput): MedicationLog {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { useMedicationStore: meds } = require('../../src/store/useMedicationStore') as typeof import('../../src/store/useMedicationStore');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const known = medication.medicationVocabulary(db.dbGetAllMedicationLogs(), []);
      const name = known.find(n => medication.medicationKey(n) === medication.medicationKey(input.name)) ?? input.name.trim();
      if ((input.amount == null) !== (input.unit == null || input.unit === '')) {
        throw new Error('Give amount and unit together ("400" and "mg"), or neither.');
      }
      const log = meds.getState().addLog({
        name,
        amount: input.amount ?? undefined,
        unit: input.unit ?? undefined,
        asNeeded: input.asNeeded,
        note: input.note ?? undefined,
        at: input.at ?? new Date(),
      });
      if (!log) throw new Error('A dose needs the medication\'s name.');
      return log;
    },

    ruleLists(): RuleLists {
      const s = useSettingsStore.getState();
      return { title: s.titleRules, weather: s.weatherRules, event: s.eventRules, health: s.healthRules, screenTime: s.screenTimeRules };
    },

    setRuleList(type, rules) {
      const s = useSettingsStore.getState();
      switch (type) {
        case 'title': s.setTitleRules(rules as TitleRule[]); break;
        case 'weather': s.setWeatherRules(rules as WeatherRule[]); break;
        case 'event': s.setEventRules(rules as EventTaskRule[]); break;
        case 'health': s.setHealthRules(rules as HealthRule[]); break;
        case 'screenTime': s.setScreenTimeRules(rules as ScreenTimeRule[]); break;
      }
    },

    generatorEnabled: (key: string) => (useSettingsStore.getState() as unknown as Record<string, unknown>)[key] === true,

    setGeneratorEnabled(key: string, on: boolean) {
      // The stored form every switch's own setter writes; the store re-reads it
      // on the refresh below, defaults and all.
      db.dbSetSetting(key, on ? 'true' : 'false');
      refresh();
    },

    agentNotes: () => notesModule().readAgentNotes(),
    writeAgentNotes: (notes: readonly AgentNote[]) => notesModule().writeAgentNotes(notes),

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

      // Keyed items get their ids now, so an onlyIfAnswer can name one; the
      // answers are re-spelled as the question offers them (validated above).
      const itemIds = new Map<string, string>();
      for (const item of plan.items ?? []) if (item.key !== undefined) itemIds.set(item.key, generateId());
      const offeredBy = new Map((plan.items ?? []).filter(i => i.key !== undefined).map(i => [i.key!, deliverables.deliverableOptionsFor(templateUtils.normalizeTemplateItem({ deliverableKind: i.deliverableKind ?? null, deliverableOptions: i.deliverableOptions }))]));
      const items = (plan.items ?? []).map(item => {
        const { groupKey, conditions, refTemplate, key, onlyIfAnswer, ...fields } = item;
        const ref = refTemplate === undefined ? null : resolveRef(refTemplate, existing)[0];
        const offered = onlyIfAnswer ? offeredBy.get(onlyIfAnswer.item) ?? [] : [];
        return templateUtils.normalizeTemplateItem({
          ...fields,
          ...(key !== undefined ? { id: itemIds.get(key) } : {}),
          answerGate: onlyIfAnswer
            ? {
                itemId: itemIds.get(onlyIfAnswer.item)!,
                answers: onlyIfAnswer.answers.map(a => offered.find(o => o.toLowerCase() === a.trim().toLowerCase()) ?? a),
              }
            : null,
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
      ensureCategory(task.category);
      db.dbInsertTask(task);
      refresh();
      return task;
    },

    completionProblem(id: string, options?: CompletionOptions): string | null {
      const task = tasks().find(t => t.id === id);
      if (!task) return `No task with id ${id}.`;
      try {
        vetCompletion(task, options);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },

    completeTask(id: string, options?: CompletionOptions): CompletedResult {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      options = vetCompletion(task, options);

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

      // Coins, kept for the same reason: the ledger is a record, and a task
      // finished here should earn what it would have earned on the phone.
      // Through the app's own store and rules, keyed by the completed row, so
      // the device that later syncs this completion converges on one entry.
      // A no-op while rewards are off (the setting syncs, so this replica
      // reads the same answer the phone does).
      if (rewards.taskEarnsCoins(task)) {
        useRewardStore.getState().recordEarn(
          id,
          rewards.coinsForCompletion(task, built.completed.streakCount),
          visibility.displayTitleFor(task),
          new Date().toISOString(),
        );
      }

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

      // Through the same merge the app's updateTask runs, so a push here counts
      // toward the postpone count and re-derives the anchors the way a push on
      // the phone does. Writing the move straight onto the row skipped both.
      const { dayResetTime } = useSettingsStore.getState();
      const moved = taskUpdate.mergeTaskUpdate(task, moves.scheduleMoveUpdates(task, date, dayResetTime), {
        scope: 'series',
        freshPinnedOrder: 0,
        dayResetTime,
      });
      db.dbUpdateTask(moved);
      refresh();
      return moved;
    },

    setTaskArchived(id: string, archived: boolean): Task {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (task.parentId) throw new Error('That is a checklist item. Archive the task it belongs to instead.');
      if (task.archived === archived) return task;

      const patch: Partial<Task> = archived
        ? { archived: true, archivedAt: new Date().toISOString(), pinned: false }
        : {
            archived: false,
            archivedAt: null,
            streakCount: 0,
            streakDate: null,
            priorBestStreak: streakRecord.nextStreakRecord(task, 0),
          };
      const updated = taskUpdate.mergeTaskUpdate(task, patch, {
        scope: 'series',
        freshPinnedOrder: 0,
        dayResetTime: useSettingsStore.getState().dayResetTime,
      });
      db.dbUpdateTask(updated);
      refresh();
      return updated;
    },

    addGroceryItem(name: string, opts?: GroceryAddOptions): GroceryAddOutcome {
      if (!name.trim()) throw new Error('An item needs a name.');

      const items = db.dbGetAllGroceryItems();
      const entries = db.dbGetAllGroceryListEntries();
      const plan = groceryAdd.planGroceryAdd(
        name,
        {
          items,
          itemProducts: db.dbGetAllItemProducts(),
          listEntries: entries,
          aisleOverrides: db.dbGetGroceryAisleOverrides(),
          // The stored order alone is not the live one: normalizeAisleOrder
          // re-appends the shipped defaults on every read, which is how a
          // later version's bigger list arrives with no migration, and applies
          // the hidden-aisle tombstones that stop a deleted one coming back.
          // Skipping it would let placeAisle clamp a perfectly good aisle to
          // Other on a device that has never reordered anything.
          aisleOrder: aisles.normalizeAisleOrder(
            db.dbGetGroceryAisleOrder(),
            items.map(i => i.aisle),
            db.dbGetGroceryHiddenAisles(),
          ),
          listId: opts?.listId ?? null,
          now: new Date().toISOString(),
        },
        // Only the fields a caller here can state. A brand, a variant, a
        // barcode category and a choice group all belong to paths with more
        // context than a name typed at a server.
        //
        // Supplying an override means the parse is skipped, so the name has to
        // be parsed out first or "2 gal milk" with an explicit note would file
        // a shelf item called "2 gal milk".
        opts?.quantity !== undefined || opts?.note !== undefined
          ? (() => {
            const parsed = parse.parseGroceryInput(name);
            return {
              name: parsed.name,
              quantity: opts?.quantity ?? parsed.quantity,
              note: opts?.note ?? null,
            };
          })()
          : undefined,
      );

      if (plan.product) db.dbSetItemProduct(plan.product);
      if (plan.isNew) db.dbInsertGroceryItem(plan.item);
      else db.dbUpdateGroceryItem(plan.item);
      // After the row, and the only writer of the item's mirror columns.
      if (plan.entry) db.dbSetGroceryListEntry(plan.entry);

      refresh();
      // plan.wasOnList is "in any trolley", which reads a row on the Airbnb
      // list as already added to the list at home.
      const listId = opts?.listId ?? null;
      const wasOnList = !plan.isNew && entries.some(e => e.itemId === plan.item.id && e.listId === listId);
      return { item: plan.item, isNew: plan.isNew, wasOnList };
    },

    setGroceryChecked(id: string, checked: boolean): GroceryItem {
      const item = db.dbGetAllGroceryItems().find(i => i.id === id);
      if (!item) throw new Error(`No grocery item with id ${id}.`);

      // Checked belongs to a trolley, so there has to be one holding this item.
      const entry = db.dbGetAllGroceryListEntries().find(e => e.itemId === id && e.listId === null);
      if (!entry) throw new Error(`"${item.name}" is not on the home list, so there is nothing to check off.`);

      db.dbSetGroceryListEntry({ ...entry, checked });
      refresh();
      return db.dbGetAllGroceryItems().find(i => i.id === id)!;
    },

    removeFromGroceryList(id: string): GroceryItem {
      const item = db.dbGetAllGroceryItems().find(i => i.id === id);
      if (!item) throw new Error(`No grocery item with id ${id}.`);
      // The home entry, not item.onList: that flag is also true for a row
      // only on a trip's list, which this would park without taking it off
      // anything.
      const onHomeList = db.dbGetAllGroceryListEntries().some(e => e.itemId === id && e.listId === null);
      if (!onHomeList) throw new Error(`"${item.name}" is not on the home list.`);

      // A recipe's claim on the quantity ends with the shop, so it does not
      // ride back onto the catalog row, and nor does its credit: the same
      // parking `useGroceryStore.removeFromList` does. Left on, a hand-typed
      // re-add weeks later still read 'For "Chili"'.
      const parked: GroceryItem = {
        ...item,
        quantity: item.quantityFromRecipe ? null : item.quantity,
        quantityFromRecipe: false,
        sourceRecipeId: null,
        sourceRecipeTitle: null,
      };
      db.dbUpdateGroceryItem(parked);
      db.dbDeleteGroceryListEntry(id, null);

      refresh();
      return db.dbGetAllGroceryItems().find(i => i.id === id)!;
    },

    taskPatch: (input: TaskFieldsInput, current: Task | null, isSubtask: boolean) => taskPatch(input, current, isSubtask),

    updateTask(id: string, patch: Partial<Task>): { task: Task; alsoUpdated: number } {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (task.completed) throw new Error('That task is completed. Reopen it in the app before editing it.');
      if (task.archived) throw new Error('That task is archived. Restore it in the app before editing it.');

      const all = tasks();
      const updated = taskUpdate.mergeTaskUpdate(task, patch, {
        scope: 'series',
        freshPinnedOrder: patch.pinned === true ? taskUpdate.nextPinnedOrder(all) : 0,
        dayResetTime: useSettingsStore.getState().dayResetTime,
      });
      const siblings = taskUpdate.seriesFanOutRows(updated, patch, all);
      db.dbTransaction(() => {
        ensureCategory(updated.category);
        db.dbUpdateTask(updated);
        for (const row of siblings) db.dbUpdateTask(row);
      });
      refresh();
      return { task: updated, alsoUpdated: siblings.length };
    },

    createProjectPlan(plan: ProjectPlan): { project: Project; tasks: Task[] } {
      const title = plan.title?.trim();
      if (!title) throw new Error('A project needs a title.');

      const eventDate = plan.eventDate ? eventNoonIso(plan.eventDate) : null;
      if (plan.eventDate && !eventDate) throw new Error(`eventDate: "${plan.eventDate}" is not a date I can read. Use an ISO date like 2027-06-14.`);
      const categoryErrors: string[] = [];
      const defaultTaskCategory = plan.defaultTaskCategory
        ? categoryNamed(plan.defaultTaskCategory, plan.newCategory === true, categoryErrors, 'defaultTaskCategory')
        : null;
      if (categoryErrors.length > 0) throw new Error(categoryErrors.join(' '));
      const checked = checkSteps(plan.steps, eventDate, defaultTaskCategory);

      let project: Project | undefined;
      const created: Task[] = [];
      try {
        db.dbTransaction(() => {
          const store = useProjectStore.getState();
          project = store.createProject(title, {
            deadline: plan.deadline ?? null,
            eventDate,
            category: plan.category ?? null,
            kind: plan.kind ?? 'project',
          });
          ensureCategory(defaultTaskCategory);
          if (plan.notes || defaultTaskCategory) {
            store.updateProject(project.id, {
              ...(plan.notes ? { notes: plan.notes } : {}),
              ...(defaultTaskCategory ? { defaultTaskCategory } : {}),
            });
          }
          created.push(...writeSteps(project.id, plan.steps, checked));
        });
      } finally {
        // Also what puts the store back if the transaction rolled back.
        refresh();
      }
      return { project: projects().find(p => p.id === project!.id)!, tasks: created };
    },

    addProjectSteps(projectId: string, steps: ProjectPlanStep[]): Task[] {
      const project = projects().find(p => p.id === projectId);
      if (!project) throw new Error(`No project with id ${projectId}.`);
      if (steps.length === 0) throw new Error('Nothing to add: name at least one step.');
      const checked = checkSteps(steps, project.eventDate ?? null, project.defaultTaskCategory ?? null);
      let created: Task[] = [];
      try {
        db.dbTransaction(() => {
          created = writeSteps(projectId, steps, checked);
        });
      } finally {
        refresh();
      }
      return created;
    },

    updateProject(id: string, patch: ProjectPatch): Project {
      const store = useProjectStore.getState();
      if (!store.projects.some(p => p.id === id)) throw new Error(`No project with id ${id}.`);
      if (patch.title !== undefined && !patch.title.trim()) throw new Error('A project title cannot be blank.');
      const { completed, archived, newCategory, ...content } = patch;
      if (content.defaultTaskCategory) {
        const errors: string[] = [];
        const named = categoryNamed(content.defaultTaskCategory, newCategory === true, errors, 'defaultTaskCategory');
        if (!named) throw new Error(errors.join(' '));
        content.defaultTaskCategory = named;
      }
      if (content.eventDate) {
        const noon = eventNoonIso(content.eventDate);
        if (!noon) throw new Error(`eventDate: "${content.eventDate}" is not a date I can read. Use an ISO date like 2027-06-14.`);
        content.eventDate = noon;
      }
      db.dbTransaction(() => {
        ensureCategory(content.defaultTaskCategory);
        if (Object.keys(content).length > 0) {
          store.updateProject(id, { ...content, ...(content.title ? { title: content.title.trim() } : {}) });
        }
        if (completed !== undefined) useProjectStore.getState().applyProjectCompleted(id, completed);
        if (archived !== undefined) useProjectStore.getState().applyProjectArchived(id, archived);
      });
      refresh();
      return projects().find(p => p.id === id)!;
    },

    moveProjectTasks(projectId: string, from: Date, to: Date): ProjectTaskMove {
      const { dayResetTime } = useSettingsStore.getState();
      const members = tasks().filter(t => t.projectId === projectId);
      const plan = awayShift.buildAwayShiftPlan(members, from, to, dayResetTime);
      const moved: Task[] = [];
      const skipped: { task: Task; reason: string }[] = [];
      db.dbTransaction(() => {
        for (const proposal of plan.proposals) {
          const updates = proposal.selected ? awayShift.awayShiftUpdates(proposal, dayResetTime) : null;
          if (!updates) {
            skipped.push({ task: proposal.task, reason: proposal.blockerLabel ?? 'Not moved' });
            continue;
          }
          // No postpone count: the event moving isn't the person putting the
          // task off, the same exemption the app's shiftAwayTasks makes.
          const next = taskUpdate.mergeTaskUpdate(proposal.task, updates, {
            scope: 'series',
            freshPinnedOrder: 0,
            dayResetTime,
            skipPostponeCount: true,
          });
          db.dbUpdateTask(next);
          moved.push(next);
        }
      });
      refresh();
      return { deltaDays: plan.deltaDays, moved, skipped };
    },

    recipes: () => db.dbGetAllRecipes(),
    cookbooks: () => db.dbGetAllCookbooks(),
    mealPlan: (from: string, to: string) => db.dbGetMealPlanEntries(from, to),

    planMeal(draft: { date: string; slot: MealSlot; title?: string; recipeId?: string | null }): MealPlanEntry {
      const recipe = draft.recipeId ? db.dbGetAllRecipes().find(r => r.id === draft.recipeId) : undefined;
      if (draft.recipeId && !recipe) throw new Error(`No recipe with id ${draft.recipeId}.`);
      const title = mealPlanUtils.cleanMealTitle(draft.title ?? recipe?.name ?? '');
      if (!title) throw new Error('A meal needs a title or a recipe.');
      const entry = mealPlanUtils.buildMealPlanEntry(
        { date: draft.date, slot: draft.slot, recipeId: draft.recipeId ?? null, title },
        {
          id: generateId(),
          title,
          recipe,
          sameDay: db.dbGetMealPlanEntries(draft.date, draft.date),
          householdServings: useSettingsStore.getState().householdServings,
          now: new Date().toISOString(),
        },
      );
      db.dbInsertMealPlanEntry(entry);
      return entry;
    },

    people,
    personGroups: () => db.dbGetAllPersonGroups(),
    personNotes: () => db.dbGetAllPersonNotes(),
    personHistory: (personId: string) =>
      personHistoryUtils
        .personHistory(tasks().filter(t => (t.personIds ?? []).includes(personId)))
        .map(e => ({ taskId: e.taskId, title: e.title, at: e.at })),
    nextBirthday: (person: Person) => birthdays.nextBirthday(person, dates.getLogicalToday()),

    addPersonHistory(personIds: string[], title: string, at: Date): Task {
      const known = new Set(people().map(p => p.id));
      const missing = personIds.filter(id => !known.has(id));
      if (missing.length > 0) throw new Error(`No person with id ${missing.join(', ')}.`);
      if (personIds.length === 0) throw new Error('Name at least one person.');
      if (!title.trim()) throw new Error('Say what you did together.');
      if (at.getTime() > Date.now()) throw new Error('History is for things that already happened; that date is in the future.');

      // The app's own three steps (addCompletedTask): add it on that day, complete
      // it, then put the completion on that day too.
      const iso = at.toISOString();
      const task = taskDraft.newTaskFromDraft(
        taskDraft.applyTitleRulesToDraft({ title: title.trim(), dueDate: iso, personIds }),
        new Date().toISOString(),
        nextTaskOrder(),
        true
      );
      const settings = useSettingsStore.getState();
      const built = completion.buildCompletion(task, undefined, {
        dayResetTime: settings.dayResetTime,
        vacationMode: settings.vacationMode,
        now: new Date(),
        allTasks: [...tasks(), task],
        subtasks: [],
      });
      const done = { ...(built?.completed ?? { ...task, completed: true }), completedAt: iso };
      db.dbTransaction(() => {
        db.dbInsertTask(task);
        db.dbUpdateTask(done);
      });
      refresh();
      return done;
    },

    deviceId: () => db.dbGetDeviceId(),
    syncable: () => db.isSyncableDatabase(),

    async sync(): Promise<SyncSummary | null> {
      const config = { url: process.env.SYNC_URL ?? '', token: process.env.SYNC_TOKEN ?? '' };
      if (!httpTransport.isHttpSyncConfigured(config)) return null;

      const runs = await syncEngine.runSyncAll(
        [loggedTransport(httpTransport.httpSyncTransport(config))],
        syncLocal.databaseSyncLocal()
      );
      // A pull can carry the phone's zone, and it has to be in effect before
      // the refresh below re-hydrates the stores that read "today".
      adoptTimeZone(db.dbGetSetting(DEVICE_TIME_ZONE_KEY));
      // Whatever a pull applied is now in the database and not in the caches
      // above, so the next read has to go back to SQLite for it.
      refresh();
      syncedAt = new Date().toISOString();
      return syncEngine.summarizeRuns(runs);
    },
  };

  // Every write recorded in the Activity ledger, where the phone shows it and
  // can take it back. See agentLedger.ts.
  return withAgentLedger(replica, entries => db.dbInsertUnattendedEntries(toLedgerEntries(entries, generateId)));
}
