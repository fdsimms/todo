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
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { lastDayOfMonth } from 'date-fns/lastDayOfMonth';

import { shimModule } from './expoSqliteShim';
import type {
  CalendarRequest,
  Category,
  ChainItem,
  CoinEntry,
  Cookbook,
  DeliverableKind,
  EventTaskRule,
  FoodLogEntry,
  HealthRule,
  Milestone,
  FocusSessionRecord,
  SavedView,
  SavedViewClause,
  ScreenTimeRule,
  TitleRule,
  WeatherRule,
  GroceryItem,
  GroceryList,
  GroceryListEntry,
  ItemProduct,
  ItemShopLink,
  ItemSubLink,
  Leftover,
  ProductRating,
  ReceiptStyle,
  Shop,
  StoreAlias,
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
  Reward,
  TaskTemplate,
  TemplateItem,
  Task,
  TaskDraft,
  TaskGroup,
} from '../../src/types';
import { parseTaskFieldDefaults } from '../../src/utils/taskFieldDefaults';
import { rotationItemFromInput, rotationMemberTitle, rotationMembers } from '../../src/utils/rotation';
import type { AwaySpan } from '../../src/utils/awayDates';
import type { WaterUnit } from '../../src/utils/waterLog';
import type { FoodLogTotals } from '../../src/utils/foodLog';
import type { LookAhead } from '../../src/utils/lookAhead';
import type { AgentNote } from '../../src/utils/agentNotes';
import type { MostMissedGroup } from '../../src/utils/missed';
import type { OnTimeSummary } from '../../src/utils/stats';
import type { SyncSummary, SyncTransport } from '../../src/utils/syncEngine';
import { CONTAINERS, DEFAULT_SCHEDULE, resolveRef, scheduleErrors as validateScheduleOf, templateToPlan, templateVersion, validateTemplatePlan, type TemplatePatch, type TemplatePlan } from './templatePlan';
import { deliverableRefusal } from './deliverableAsk';
import { eventNoonIso, taskFieldsPatch, type TaskFieldsInput } from './taskFields';
import { adoptTimeZone, DEVICE_TIME_ZONE_KEY } from './timeZone';
import { toLedgerEntries, withAgentLedger, type AgentLedgerEntry } from './agentLedger';

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
type NegativeHabitsModule = typeof import('../../src/utils/negativeHabits');
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
  /** Stamped when the mode was switched on, so it records when they went and never when they are going. */
  vacationStart: string | null;
  vacationEnd: string | null;
  /** The project whose away dates switched vacation mode on, or null when a person did (docs/arch/away-dates.md). */
  vacationDrivenBy: string | null;
  /** The unit the person counts water in. Display only: `waterMl` is stored in millilitres whichever is picked. */
  waterUnit: WaterUnit;
  /** Groceries, recipes and the meal plan. Off means that whole area is hidden in the app. */
  kitchenEnabled: boolean;
  /** Simplified mode: the advanced half of the app is hidden. */
  simpleMode: boolean;
  rewardsEnabled: boolean;
  /** The reward being saved for, or null. */
  rewardGoalId: string | null;
  /** How many coin bounties may be live at once. */
  bountyLimit: number;
  /** Days completed tasks are kept, or null for for ever. */
  completedRetentionDays: number | null;
  /**
   * Whether some device is set to write the calendar events an agent asks for
   * (`calendarRequestDeviceId`). Without one, a request would wait for ever.
   */
  calendarRequestsOn: boolean;
}

/** An event to ask the phone to write. Already parsed: instants, and an exclusive end. */
export interface CalendarRequestInput {
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
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
  rewards: typeof import('../../src/utils/rewards');
  grocerySuggest: typeof import('../../src/utils/grocerySuggest');
  kitchenInventory: typeof import('../../src/utils/kitchenInventory');
  pantryReview: typeof import('../../src/utils/pantryReview');
  pantryCheckTasks: typeof import('../../src/utils/pantryCheckTasks');
  useUpRecipes: typeof import('../../src/utils/useUpRecipes');
  itemDisposal: typeof import('../../src/utils/itemDisposal');
  groceryLists: typeof import('../../src/utils/groceryLists');
  leftovers: typeof import('../../src/utils/leftovers');
  freshness: typeof import('../../src/utils/freshness');
  groceryParse: typeof import('../../src/utils/groceryParse');
  receiptMatch: typeof import('../../src/utils/receiptMatch');
  storeAliases: typeof import('../../src/utils/storeAliases');
  groceryPlural: typeof import('../../src/utils/groceryPlural');
  focusStats: typeof import('../../src/utils/focusStats');
}

/** What switching vacation mode did, read at the moment the hide applied (see `Replica.setVacationMode`). */
export interface VacationSwitchOutcome {
  on: boolean;
  /** Open top-level tasks the mode hides: their own `vacationPause`, or a category set to hide on vacation. */
  hiddenTasks: number;
  /** The categories set to hide on vacation, by name. */
  hiddenCategories: string[];
  /** Streaks re-dated on the way off (`forgiveVacationStreaks`); 0 on the way on. */
  forgivenStreaks: number;
  /** True when the call only moved the end date of a mode already on. */
  endOnly: boolean;
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

export type RecipePatch = Partial<Omit<RecipeInput, 'cookbook'>>;

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
  /** A dream the person woke up with. Filed under the day of the check-in. */
  dream?: string | null;
  at?: Date;
}

export interface TemplateRun {
  /** Names the run, which is what turns the template's container (stack, project, one task) on. */
  runName?: string;
  /** The anchor dates, as local days. Offsets in the template count from these. */
  start?: Date | null;
  end?: Date | null;
  /** Answers to the template's questions, by the question's name. A question left out takes its default. */
  answers?: Record<string, string>;
  /**
   * Item ids to add to what the answers select (an optional item), or to take
   * out of it. A nested template's own item stands for every item inside it.
   */
  include?: string[];
  leaveOut?: string[];
  /** Run into this existing project instead of the template's own container. */
  projectId?: string;
}

export interface TemplateRunResult {
  tasks: Task[];
  /** What the run put the tasks in, by name, when it made one. */
  container: { kind: 'stack' | 'project' | 'task'; id: string; name: string } | null;
  /**
   * Items the run offered but did not create, and why: what the person would
   * have seen unticked in the apply sheet. A run reported by its tasks alone
   * hides exactly the part a caller is most likely to have got wrong.
   */
  leftOut: { itemId: string; title: string; why: string }[];
  /** Blanks in the created text that had no value, and so were dropped from it. */
  unfilledBlanks: string[];
  /** Nested templates that no longer exist, so nothing came from them. */
  brokenRefs: string[];
}

export interface PersonFields {
  name?: string;
  nickname?: string;
  kind?: 'individual' | 'business';
  notes?: string;
  askAbout?: string;
  /** null clears the birthday. */
  birthday?: { month: number; day: number; year?: number | null } | null;
  phoneNumber?: string | null;
  email?: string | null;
  linkUrl?: string | null;
}

export interface FoodPatch {
  label?: string;
  quantity?: string;
  /** Replaces every figure. Only an estimated entry has figures an agent may restate. */
  amounts?: Record<string, number>;
  slot?: MealSlot | null;
}

export type MoodPatch = Partial<Pick<MoodInput, 'mood' | 'symptoms' | 'contextTags' | 'note' | 'dream'>>;

export type DosePatch = Partial<Omit<DoseInput, 'at'>>;

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
  'deliverableValue' | 'completedAt' | 'deliverableReasoning'
>;

/** A correction to a recorded answer. Omitted fields stay as they are; null clears one. */
export interface AnswerEdit {
  answer?: string | null;
  why?: string | null;
  revisitIf?: string | null;
}

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

/**
 * What a caller may say about one grocery item's place in the pantry. Every
 * field is optional and the ones given are applied in the order they are
 * listed here, which is the order the item sheet's own rows run in.
 */
export interface PantryItemChange {
  /** "Got it" (have), "Out of it" (out), or back to the app's own guess (clear). */
  status?: 'have' | 'out' | 'clear';
  /** How it left, recorded with `status: 'out'` (or after the fact on a row already out). */
  outcome?: 'usedUp' | 'spoiled';
  staple?: boolean;
  frozen?: boolean;
  /** Put some of it in the freezer as the item's one unnamed portion, leaving the rest where it is. */
  freezeSome?: boolean;
  opened?: boolean;
  runningLow?: boolean;
  /** `YYYY-MM-DD`, or null to clear. */
  expiresAt?: string | null;
  shelfLifeDays?: number | null;
  /** True or false forces the "Use up X" task on or off for this item; null lets the setting decide. */
  useUpTask?: boolean | null;
}

/** The same questions about one box (a packet, or a frozen portion) of an item. */
export interface PantryBoxChange {
  status?: 'have' | 'out' | 'clear';
  frozen?: boolean;
  opened?: boolean;
}

export interface PantryItemOutcome {
  item: GroceryItem;
  /** The item's boxes as they stand after the write. */
  boxes: ItemProduct[];
  /** One plain phrase per thing that actually changed. Empty when nothing did. */
  changed: string[];
}

export interface PantryBoxOutcome {
  /** Null when the box was a portion and went out, which deletes it. */
  box: ItemProduct | null;
  item: GroceryItem;
  changed: string[];
}


export interface GroceryItemChange {
  name?: string;
  /** One of the aisles that exist. Remembered for the name, as filing it in the app is. */
  aisle?: string;
  quantity?: string | null;
  note?: string;
  /** A hand-set price in minor units, or null to clear. With shopId it also updates that store's existing link. */
  price?: { minor: number | null; shopId?: string | null };
  /** The generic this item is a variety of (a name), or null. */
  varietyOf?: string | null;
  preferredBoxId?: string | null;
  strict?: boolean;
  /** Stores this item can be bought at (store ids). */
  linkShops?: string[];
  unlinkShops?: string[];
  addSubstitutes?: { itemId: string; note?: string | null; ratioFrom?: string | null; ratioTo?: string | null; standing?: boolean; bothWays?: boolean }[];
  removeSubstitutes?: string[];
}

export interface GroceryItemOutcome {
  item: GroceryItem;
  changed: string[];
  /**
   * Whether the change touched only the item's own fields, which is what an
   * Activity undo can put back. A rename, a store or substitute link and a
   * store's price are recorded but not undoable.
   */
  reversible: boolean;
}

export interface GroceryBoxInput {
  /** Omit to add a box. */
  boxId?: string;
  brand?: string | null;
  variant?: string | null;
  note?: string;
  rating?: ProductRating | null;
  delete?: boolean;
}

export interface ReceiptLineInput {
  /** The text printed on the receipt, remembered as this store's name for the item. */
  label: string;
  /** An existing catalog item. Otherwise `name` finds one or makes one. */
  itemId?: string;
  name?: string;
  quantity?: string | null;
  priceMinor?: number | null;
  /** Straight into the freezer. */
  frozen?: boolean;
  /** Default true when the line names an existing item. */
  rememberAlias?: boolean;
}

export interface ReceiptImportInput {
  /** shopping: check the lines off a list and finish the trip. pantry: say the person has them. */
  context: 'shopping' | 'pantry';
  listId: string | null;
  shopId: string | null;
  /** ISO instant the trip happened. */
  purchasedAt: string;
  /** Shopping only: finish the list afterwards, recording the purchase. */
  finish: boolean;
  lines: ReceiptLineInput[];
}

export interface ReceiptImportOutcome {
  lines: { label: string; itemId: string; name: string; created: boolean; priceMinor: number | null; frozen: boolean; aliasRemembered: boolean }[];
  /** Names of everything the trip finished, which includes anything already checked off on the list. */
  finished: string[];
  /** True for a separate list, where a trip records nothing but the unlisting. */
  away: boolean;
  shopId: string | null;
}

export type LeftoverDraftInput = import('../../src/utils/pantryWrite').LeftoverDraft;

export interface LeftoverChange {
  frozen?: boolean;
  /** Finish it, or null to reopen one that was finished. */
  finished?: 'eaten' | 'tossed' | null;
  keepDays?: number;
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
  /** Priority (0 to 4, 0 meaning deliberately none), difficulty and estimate bucket (1 to 6) new tasks start with; null clears. */
  taskDefaults?: { priority?: number | null; difficulty?: 'easy' | 'normal' | 'hard' | null; effort?: number | null } | null;
  kind?: ProjectKind;
  completed?: boolean;
  archived?: boolean;
  /**
   * The away span (docs/arch/away-dates.md): the day you leave and the day you
   * are back, stored at noon like `eventDate`. Checked the way the project
   * editor checks them: an end needs a start and has to fall after it; moving
   * the start moves an existing end with it, keeping the trip the same length;
   * clearing the start clears the end, the destination and both nominations
   * (`awayPauses`, `awayListId`) that hang off the span.
   */
  awayStart?: string | null;
  awayEnd?: string | null;
  /** Free text, where the trip is going. Needs a span to belong to. */
  destination?: string | null;
}

/** A glass (or a bottle) of water, added onto the day's single water entry. */
export interface WaterInput {
  /** Millilitres added. */
  ml: number;
  at?: Date;
}

export interface WaterLogOutcome {
  entry: FoodLogEntry;
  /** Every entry on the day that states water, summed (`waterTotalMl`). */
  dayTotalMl: number;
  /** 'stepped' when the day's row was raised; 'created' for the first glass; 'added' when the day's row was already written to Apple Health and a second row had to carry this one. */
  how: 'created' | 'stepped' | 'added';
}

export interface Replica {
  /** Where the database being served came from. Reported by `describe`. */
  readonly path: string;
  /**
   * Drop cached reads if the database changed since they were read. The server
   * calls this once per request. Skipping the re-read when nothing changed is
   * the point: the full task table is the floor under almost every tool call,
   * about 14 ms per 1,000 tasks.
   */
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
  /**
   * A project's away span through the app's own reader (`awaySpanOf`), which
   * drops an end with no start or on or before it, so every project read here
   * reports the span the phone would. Null when the project has none.
   */
  awaySpan(project: Project): AwaySpan | null;

  isVisible(task: Task): boolean;
  /** Hidden because vacation mode is on: its own `vacationPause`, or a category set to hide on vacation. */
  isHiddenForVacation(task: Task): boolean;
  /** Ids of a rotation's members already logged in the period it is in now. */
  rotationDoneIds(task: Task): string[];
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
  /** The app's own line on a live bounty (what it is worth, what the next push costs), or null when there is none. */
  describeBounty(task: Task): string | null;
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
  /**
   * Milestones through `useMilestoneStore`'s own actions: a blank label is
   * refused as the sheet refuses it, and a date is stored as given (the tool
   * anchors it at noon, as `MilestoneSheet` does). The store is loadable here
   * (it imports only the db layer and `generateId`), so nothing is lifted.
   */
  addMilestone(label: string, date: Date): Milestone;
  updateMilestone(id: string, patch: { label?: string; date?: Date }): Milestone;
  deleteMilestone(id: string): Milestone;
  /**
   * Finished focus sessions, newest first: `focus_session_log`, what Stats
   * reads. The session in flight is `focus_sessions`, which is in
   * `SYNC_EXCLUDED_TABLES` (docs/arch/focus-sessions.md: a cursor two devices
   * could fight over), so it never reaches a replica and there is nothing live
   * to read or drive from here.
   */
  focusHistory(): FocusSessionRecord[];
  /** The person's saved views, in their own order. */
  savedViews(): SavedView[];
  /**
   * The tasks one view holds now, through the app's own matcher
   * (`filterTasksForView`) with the app's own held-back rule and logical day,
   * the way `SavedViewsScreen` counts them.
   */
  savedViewTasks(clauses: readonly SavedViewClause[]): Task[];
  /** A view through `useSavedViewStore.createView`, which takes the next slot at the bottom of the list. The clauses are already checked. */
  createSavedView(name: string, icon: string, clauses: SavedViewClause[]): SavedView;
  deleteSavedView(id: string): SavedView;
  /**
   * Vacation mode through the settings store's own setter, the way the
   * Settings toggle does it. On the way off the protected streaks are forgiven
   * first (`forgiveVacationStreaks`, the rule every off-path shares), or a
   * paused daily habit reads as broken the moment the pause lifts. `until` is
   * the day it turns itself off, stored as that day's start as the Settings
   * picker stores it; with the mode already on, a call with `until` moves only
   * the end date. Already on without `until`, or already off, is refused.
   *
   * `vacationDrivenBy` is deliberately left alone on the way off: the phone's
   * `checkAwayVacation` reads "mode off while a trip still names it" as the
   * person declining that trip, and clearing it here would make the trip arm
   * the mode again tomorrow.
   */
  setVacationMode(on: boolean, until?: Date | null): VacationSwitchOutcome;
  /** Every tag the person has, used or not. */
  tagRegistry(): string[];
  /**
   * A recipe, through the recipe store's own add and setters, the same calls
   * the app's create sheet makes. Refused when the name is taken in that book.
   */
  createRecipe(input: RecipeInput): Recipe;
  /**
   * Change a recipe. Only what is given changes. `ingredients` and `steps` each
   * replace the whole list (ingredient and step ids are new). A rename is
   * refused when another recipe in the same cookbook has the name, and planned
   * meals made from it are retitled; their Today tasks and calendar events
   * catch up on the phone.
   */
  updateRecipe(id: string, patch: RecipePatch): Recipe;
  /**
   * Delete a recipe. Planned meals made from it keep their title and stop
   * pointing at a recipe, as in the app; the phone reconciles their tasks.
   * Not undoable from here.
   */
  deleteRecipe(id: string): { recipe: Recipe; plannedMeals: number };
  /**
   * A food entry with an estimated panel, through `readNutritionEstimate`,
   * `estimateToPanel` and `buildFoodLogEntry`. Marked estimated for good, and
   * never written to Apple Health: only the device a meal is logged on may.
   */
  logFood(input: FoodInput): FoodLogEntry;
  /**
   * Water, onto the day's single water entry (`waterLog.ts`): the first glass
   * creates the row through `buildFoodLogEntry`, every later one raises it, as
   * the food log screen's stepper does. A row the phone has already written to
   * Apple Health is not rewritten, since only that phone can correct the
   * sample; the glass goes on a second row instead, which the app's totals sum
   * exactly as they sum two rows left by a sync. Never a Health write itself.
   */
  logWater(input: WaterInput): WaterLogOutcome;
  /** A mood check-in through the mood store, symptoms and tags in the spellings already in the log. */
  logMood(input: MoodInput): MoodLog;
  /** A dose through the medication store, the name in the spelling already in the log. */
  logMedication(input: DoseInput): MedicationLog;
  /**
   * Edit or delete an entry in the three health logs. None of these can move an
   * entry to another day (`dayKey` is stamped with the instant, as in the app),
   * so a wrong date means delete and log again. Food refuses what only the
   * phone can finish: an entry already written to Apple Health.
   */
  updateFoodEntry(id: string, patch: FoodPatch): FoodLogEntry;
  deleteFoodEntry(id: string): FoodLogEntry;
  updateMoodLog(id: string, patch: MoodPatch): MoodLog;
  deleteMoodLog(id: string): MoodLog;
  updateMedicationLog(id: string, patch: DosePatch): MedicationLog;
  deleteMedicationLog(id: string): MedicationLog;
  /** Every calendar request, oldest first (`CalendarRequest`). */
  calendarRequests(): CalendarRequest[];
  /**
   * Queue an event for the device chosen to write them. Refuses when no device
   * is chosen, since nothing would ever write it. The server never touches a
   * calendar itself: this is a synced row the phone answers.
   */
  requestCalendarEvent(input: CalendarRequestInput): CalendarRequest;
  /** Take back a request that is still pending. One already answered is the phone's to keep. */
  cancelCalendarRequest(id: string): CalendarRequest;
  /** Every automation rule list, as the settings store holds it. */
  ruleLists(): RuleLists;
  /** Replace one rule list through the settings store's own setter. The list must already be normalized. */
  setRuleList<T extends RuleListType>(type: T, rules: RuleLists[T]): void;
  /** Whether an automation is on, by its settings key (`GeneratedKindSpec.enabledKey`). */
  generatorEnabled(key: string): boolean;
  setGeneratorEnabled(key: string, on: boolean): void;
  /**
   * Run a write, record what it would change, and roll all of it back: the
   * preview behind every write tool (see confirmWrites.ts). The result is what
   * the write returned; `effects` are the Activity entries it would have made.
   */
  dryRun<T>(fn: () => T): { result: T; effects: AgentLedgerEntry[] };
  /**
   * Run a confirmed write so every Activity entry it records shares one batch
   * id (`UnattendedEntry.batchId`), which is what "undo all" on the phone acts
   * on. Synchronous on purpose: the id is held only while `fn` runs, so two
   * requests can never write under each other's.
   */
  withBatch<T>(batchId: string, fn: () => T): T;
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
   * Change a template, by id or by exact name. Fields left out stay as they
   * are. `groups`, `questions` and `items` each replace the whole list when
   * given (the three point at each other, so they are rebuilt together); a
   * call naming only scalar fields touches nothing else in the template.
   *
   * Written through `dbUpdateTemplate` for the reason `createTemplate` is
   * written through `dbInsertTemplate`: `templates_sync_stamp_update` stamps it
   * so it syncs like an edit made in the app. Throws, writing nothing, on an
   * invalid result, and refuses a nested reference that would form a cycle.
   */
  updateTemplate(id: string, patch: TemplatePatch, expectedVersion?: string): TaskTemplate;

  /**
   * Delete a template, by id or exact name. Nothing is archived: a template has
   * no archived state in the app, so this is the app's own delete and cannot be
   * undone from here. Other templates that nest it are left as they are, which
   * is what the app does too (the reference keeps its label and shows as
   * broken); their names are returned so the caller can say so.
   */
  deleteTemplate(id: string): { template: TaskTemplate; nestedIn: string[] };

  /**
   * Run a template, as the apply sheet does with its defaults plus what is given:
   * the same container, category, away-span, section and gate rules, because the
   * decisions are `applyTemplateRun`'s (`src/utils/templateApply.ts`) and the app
   * runs the same function. Nothing is written for the device: reminders and
   * calendar events for the new tasks catch up on the phone, as for `createTask`.
   * Written in one transaction, so a failure creates nothing.
   */
  applyTemplate(ref: string, run: TemplateRun): TemplateRunResult;

  /**
   * Put the named templates first, in the order given, and leave the rest
   * after them in the order they were in. Unknown ids are an error.
   */
  reorderTemplates(ids: string[]): TaskTemplate[];

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
   * Give a just-created weekly target a first week scaled to the days left in
   * it, the default the app's own creation paths apply (`firstWeekPatch`).
   * Does nothing to any other task, or on the first day of a week.
   */
  scaleFirstWeek(id: string): void;

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
   * Reopen a completed or missed task: the row goes back to how it was before
   * (streak, daily-target count, follow-up tally), the coins and the dose its
   * completion wrote are taken back, and the occurrence it spawned is removed
   * unless that one was itself completed since. Refuses what leaves something on
   * the phone this server cannot take back (see `reopenRefusal`).
   */
  reopenTask(id: string): { task: Task; removed: Task[] };
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
   * Correct a recorded answer, or the reasoning given with it, as the app's
   * own `setDeliverableValue` does from the Logbook or a project's Decisions:
   * one row written, nothing completed or reopened. A choice answer is
   * matched against the question's options and stored in their spelling.
   * Clearing the answer clears its reasoning.
   */
  updateAnswer(id: string, edit: AnswerEdit): Task;

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
  setGroceryChecked(id: string, checked: boolean, listId?: string | null): GroceryItem;

  /**
   * Take something off the home list, which parks it rather than deleting it.
   *
   * The catalog row stays, with everything anyone ever recorded on it. That is
   * the app's own rule and not a shortcut: a row leaves only when asked, and
   * dropping one wrongly destroys a substitute or a price history with no undo.
   * A recipe's claim on the quantity ends with the shop, so that is cleared.
   */
  removeFromGroceryList(id: string, listId?: string | null): GroceryItem;

  /** Every box (brand, variant, packet or frozen portion) of every grocery item. */
  itemProducts(): ItemProduct[];
  /** Containers of cooked food, live and finished. */
  leftovers(): Leftover[];
  /**
   * Change one item's pantry state: `pantryWrite.ts` decides each row, the same
   * functions the store's actions call. The use-up task is the one thing it
   * does not write, because that goes through the task store; the phone's
   * catch-up pass reconciles it from the rows.
   */
  updatePantryItem(id: string, change: PantryItemChange): PantryItemOutcome;
  /** Change one box of an item. */
  updatePantryBox(id: string, change: PantryBoxChange): PantryBoxOutcome;
  /**
   * "I have flour": a name the catalog knows gets a "Got it", one it does not
   * becomes a row that is not on the shopping list.
   */
  addToPantry(names: string[]): { item: GroceryItem; isNew: boolean }[];
  /** One card of the pantry review. Every answer stamps the card as reviewed. */
  answerPantryReview(id: string, answer: 'have' | 'low' | 'out'): GroceryItem;
  updateLeftover(id: string, change: LeftoverChange): Leftover;
  /** Log a container of cooked food. Null when the title is empty. */
  createLeftover(draft: LeftoverDraftInput): Leftover | null;

  groceryLists(): GroceryList[];
  shops(): Shop[];
  itemShopLinks(): ItemShopLink[];
  itemSubLinks(): ItemSubLink[];
  storeAliases(): StoreAlias[];
  /** Where the person filed each name last time, by name key. */
  aisleOverrides(): Record<string, string>;
  /** The aisles that exist, in the person's walk order. */
  aisleNames(): string[];
  updateGroceryItem(id: string, change: GroceryItemChange): GroceryItemOutcome;
  /** Add, edit or delete one brand/variant box of an item. Returns what it left, or null for a delete. */
  saveGroceryBox(itemId: string, input: GroceryBoxInput): ItemProduct | null;
  saveShop(input: { id?: string; name?: string; receiptStyle?: ReceiptStyle }): Shop;
  /** Removes the item and everything attached to it, returning what was removed so it can be put back. */
  deleteGroceryItem(id: string): import('../../src/utils/groceryItemWrite').DeletedItemSnapshot;
  createGroceryList(name: string): GroceryList;
  renameGroceryList(id: string, name: string): GroceryList;
  /** Items on it are unlisted, not deleted. */
  deleteGroceryList(id: string): { list: GroceryList; unlisted: number };
  /** Finish a list: ticked items are recorded as bought and leave it. */
  finishGroceryTrip(input: { listId: string | null; shopId: string | null; purchasedAt: string; priceById?: Record<string, number>; frozenIds?: string[] }): { finished: string[]; away: boolean; shopId: string | null };
  importReceipt(input: ReceiptImportInput): ReceiptImportOutcome;

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
  /** Every stack, in the app's order. Read from the database each call: a stack is a handful of rows. */
  stacks(): TaskGroup[];
  /**
   * A new, empty stack, through `useTaskGroupStore.createGroup` so it is made
   * collapsed and takes the next slot in the list order exactly as the app's
   * own. `category` is where it renders on Today; null leaves a stack that
   * files its members under nothing in particular.
   */
  createStack(title: string, category: string | null): TaskGroup;
  /**
   * Rename a stack. Only the title: changing its category would move every
   * member, and deleting one is a cascade decision (`deleteGroup`) for the
   * person, so neither is here.
   */
  renameStack(id: string, title: string): TaskGroup;
  /**
   * File a task in a stack, or take it out with a null `stackId`: the app's
   * `addExistingToGroup` / `removeFromGroup`, one task row at a time.
   *
   * **A stack owns its members' category**, so filing a task in one moves it
   * to the stack's category (the app does the same, and says why in
   * `addExistingToGroup`: the category carries a schedule and a vacation
   * setting, so this can change when the task shows). A stack with no
   * category leaves the task's own alone rather than erasing it. Only the
   * live row moves; the finished occurrences behind it stay where they were.
   * Refused for a subtask, a completed task and an archived one.
   */
  setTaskStack(taskId: string, stackId: string | null): Task;

  /**
   * The rewards ledger as it stands: every coin entry (newest first) and every
   * reward (cheapest first), read from the database each call. The balance is
   * never stored, so a reader sums `entries` (`rewards.coinBalance`).
   */
  rewardState(): { entries: CoinEntry[]; rewards: Reward[] };
  /**
   * A new reward, through `useRewardStore.addReward`. Refused while rewards are
   * off, because the Rewards screen is hidden then and a reward made here would
   * sit on a screen the person cannot open. Never a wish-list reward: those
   * read their title off a list item and are made in the app.
   */
  addReward(title: string, cost: number, details: { linkUrl?: string | null; note?: string | null; oneTime?: boolean }): Reward;
  /** Change a reward's cost, or its title, link, note or one-time flag. A wish-list reward is refused: its title, note and link live on the list item. */
  updateReward(id: string, patch: { title?: string; cost?: number; linkUrl?: string | null; note?: string | null; oneTime?: boolean }): Reward;
  /** Delete a reward. Coins already spent on it stay spent, as in the app. */
  deleteReward(id: string): Reward;
  /**
   * Spend a reward's cost, through `useRewardStore.claimReward`. Throws with the
   * reason when it cannot: rewards off, the balance short, or a one-time reward
   * already claimed. A wish-list reward also checks its list item off, neutrally
   * (no coins on top of the spend), as the Rewards screen does. Returns the
   * spend entry, which `unclaimReward` takes back.
   */
  claimReward(id: string): CoinEntry;
  /** Take back a claim by its spend entry: the undo for `claimReward`, which also reopens a wish-list item the claim checked off. */
  unclaimReward(entryId: string): CoinEntry;
  /** The reward being saved for (`rewardGoalId`), or null to clear it. A claimed or deleted reward is refused. */
  setRewardGoal(id: string | null): Reward | null;
  /**
   * Post a bounty on an open task, or withdraw the one posted. `useTaskStore`'s
   * `postBounty` / `withdrawBounty` rules: one bounty per occurrence, a limit on
   * how many are live at once (`bountyLimit`), withdrawing spends it.
   */
  postBounty(id: string): Task;
  withdrawBounty(id: string): Task;
  /**
   * Mark a repeating task's occurrence missed: `useTaskStore.markMissed`, which
   * is `completeTask` with `missed: true`. The streak breaks, the next
   * occurrence is created, and the coins it costs are written. `reopenTask`
   * undoes it. Refused for a one-off task and for one that is not due yet, where
   * the app would silently skip it instead.
   */
  markMissed(id: string): CompletedResult;
  /**
   * Log a slip against a "don't do this" habit, and take back today's latest one.
   * A habit with a penalty is refused: the slip charges an app block on the
   * phone, which only the phone can set.
   */
  logSlip(id: string): Task;
  undoSlip(id: string): Task;
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
  /**
   * Move a planned meal to another day or slot, rename a free-text one, or set a
   * recipe's scale. A recipe- or leftover-backed meal's title says what backs it
   * and is not renamed, as in the app. Marking a meal cooked is not here: that
   * also opens pantry items and ticks the cook task, which the phone does.
   * The slot's task and calendar event catch up on the phone, as for `planMeal`.
   */
  updateMeal(id: string, patch: { date?: string; slot?: MealSlot; title?: string; scale?: number }): MealPlanEntry;
  /** Remove a planned meal. A cooked meal is refused: it is history and feeds the cooking stats. */
  removeMeal(id: string): MealPlanEntry;

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
  /**
   * Add someone, or change who they are. Only identity and contact details:
   * name, nickname, kind, notes, what to ask about, birthday, phone, email and
   * link. Cadence and nudges are never set here (people.md rule 4: a rhythm is
   * the person's own declaration), nor are archiving, ordering or groups.
   * A birthday is validated as a real month and day, with an optional year.
   */
  createPerson(fields: PersonFields): Person;
  updatePerson(id: string, fields: PersonFields): Person;

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

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
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
  const negativeHabits = require('../../src/utils/negativeHabits') as NegativeHabitsModule;
  const syncEngine = require('../../src/utils/syncEngine') as SyncEngineModule;
  const syncLocal = require('../../src/utils/syncLocal') as SyncLocalModule;
  const httpTransport = require('../../src/utils/httpSyncTransport') as HttpTransportModule;
  const templateUtils = require('../../src/utils/templateUtils') as TemplateUtilsModule;
  const taskDraft = require('../../src/utils/taskDraft') as TaskDraftModule;
  const quotaSchedule = require('../../src/utils/quotaSchedule') as typeof import('../../src/utils/quotaSchedule');
  const completion = require('../../src/utils/taskCompletion') as TaskCompletionModule;
  const moves = require('../../src/utils/taskMoves') as TaskMovesModule;
  const awayShift = require('../../src/utils/awayShift') as typeof import('../../src/utils/awayShift');
  const groceryAdd = require('../../src/utils/groceryAdd') as GroceryAddModule;
  const aisles = require('../../src/utils/groceryAisles') as GroceryAislesModule;
  const parse = require('../../src/utils/groceryParse') as GroceryParseModule;
  const pantryWrite = require('../../src/utils/pantryWrite') as typeof import('../../src/utils/pantryWrite');
  const itemWrite = require('../../src/utils/groceryItemWrite') as typeof import('../../src/utils/groceryItemWrite');
  const recipeUtils = require('../../src/utils/recipeUtils') as typeof import('../../src/utils/recipeUtils');
  const grocerySuggest = require('../../src/utils/grocerySuggest') as typeof import('../../src/utils/grocerySuggest');
  const shelfLife = require('../../src/utils/groceryShelfLife') as typeof import('../../src/utils/groceryShelfLife');
  const groceryLists = require('../../src/utils/groceryLists') as typeof import('../../src/utils/groceryLists');
  const { generateId } = require('../../src/utils/id') as IdModule;
  const { reopenedTask } = require('../../src/utils/taskReopen') as typeof import('../../src/utils/taskReopen');
  const { generatedSourceOf } = require('../../src/utils/generatedTasks') as typeof import('../../src/utils/generatedTasks');
  const { completesMealSlot } = require('../../src/utils/mealSlotTasks') as typeof import('../../src/utils/mealSlotTasks');

  /**
   * What reopening cannot undo from here. Each is state on the phone or in a
   * store this server has no copy of: a calendar event the completion logged, a
   * screen-time credit, and a meal marked cooked or logged by a meal task. The
   * app's own Logbook undoes all of them, so the answer is to do it there.
   */
  function reopenRefusal(task: Task): string | null {
    if (task.completionCalendarEventId || task.completionCalendarEventExternalId) {
      return 'That completion logged a calendar event, which only the phone can remove. Reopen it in the app.';
    }
    if (task.penaltyCreditedAt) {
      return 'That completion credited a screen-time penalty, which only the phone can take back. Reopen it in the app.';
    }
    if (generatedSourceOf(task, 'mealCook') || generatedSourceOf(task, 'mealLogNudge') || (generatedSourceOf(task, 'mealSlot') && completesMealSlot(task))) {
      return 'That completion marked a meal on the plan, which only the phone can undo. Reopen it in the app.';
    }
    return null;
  }

  /**
   * The groups, questions and items of a validated plan, with every name
   * resolved to the id minted here. Shared by create and update so a plan means
   * the same thing either way.
   */
  /**
   * A template's category is a name in the `template_categories` registry that
   * the editor's picker lists. A name written without registering it still
   * groups correctly in the picker, but is missing from the editor's list.
   */
  function registerTemplateCategory(name: string | null): void {
    if (name && !db.dbGetAllTemplateCategories().some(c => c.name === name)) db.dbInsertTemplateCategory(name);
  }

  /**
   * Symptom and context-tag spellings already in the log, so "headache" lands
   * on the existing "Headache" rather than starting a second symptom the
   * insights would count apart. Shared by logging and editing a check-in.
   */
  function moodSpelling(): { symptom: (n: string) => string; tag: (n: string) => string } {
    const moodLog = require('../../src/utils/moodLog') as typeof import('../../src/utils/moodLog'); // eslint-disable-line @typescript-eslint/no-require-imports
    const logs = db.dbGetAllMoodLogs();
    const spelled = (vocab: string[], key: (s: string) => string) => {
      const byKey = new Map(vocab.map(v => [key(v), v]));
      return (name: string) => byKey.get(key(name)) ?? name.trim();
    };
    return {
      symptom: spelled(moodLog.symptomVocabulary(logs), moodLog.symptomKey),
      tag: spelled(moodLog.contextTagVocabulary(logs), moodLog.contextTagKey),
    };
  }

  const templateQuestions = require('../../src/utils/templateQuestions') as typeof import('../../src/utils/templateQuestions');
  const templateApply = require('../../src/utils/templateApply') as typeof import('../../src/utils/templateApply');

  /**
   * The replica's half of a template run: `applyTemplateRun` decides, and this
   * supplies the writes over the database and the stores that load in Node.
   * One transaction, and `refresh` after it rolls back or commits, as
   * `createProjectPlan` does.
   */
  function runTemplateIn(
    template: TaskTemplate,
    byId: Map<string, TaskTemplate>,
    selected: Set<string>,
    anchors: { start: Date | null; end: Date | null },
    options: import('../../src/utils/templateApply').TemplateRunOptions,
    onContainer: (c: NonNullable<TemplateRunResult['container']>) => void,
  ): Task[] {
    const projectStore = () => useProjectStore.getState();
    const groupStore = () => useTaskGroupStore.getState();
    let created: Task[] = [];
    try {
      db.dbTransaction(() => {
        created = templateApply.applyTemplateRun(template, byId, selected, anchors, options, {
          addTask: draft => replica.createTask(draft as Partial<TaskDraft>),
          // A stub is a checklist line: no title rules, no category, no time-of-day seeding.
          addSubtask: (parentId, title) => {
            const siblings = db.dbGetAllTasks().filter(t => t.parentId === parentId);
            const stub = taskDraft.newTaskFromDraft(
              { title, parentId } as Partial<TaskDraft>,
              new Date().toISOString(),
              siblings.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1,
              false
            );
            db.dbInsertTask(stub);
            refresh();
          },
          createStack: (title, category) => {
            ensureCategory(category);
            const g = groupStore().createGroup(title, category);
            onContainer({ kind: 'stack', id: g.id, name: title });
            return g;
          },
          groupTasks: (ids, title, category) => {
            ensureCategory(category);
            const g = groupStore().createGroup(title, category);
            ids.forEach(id => replica.setTaskStack(id, g.id));
            return g;
          },
          createProject: (title, opts) => {
            const p = projectStore().createProject(title, opts);
            onContainer({ kind: 'project', id: p.id, name: title });
            return p;
          },
          getProject: id => projectStore().getProjectById(id) ?? undefined,
          updateProject: (id, patch) => projectStore().updateProject(id, patch),
          homeSection: (sectionId, projectId, checklist) => groupStore().updateGroup(sectionId, { projectId, checklist }),
          setAnswerGate: (taskId, gate) => {
            const task = db.dbGetAllTasks().find(t => t.id === taskId);
            if (task) db.dbUpdateTask({ ...task, answerGate: gate });
            refresh();
          },
          setBlockers: (taskId, ids) => {
            const task = db.dbGetAllTasks().find(t => t.id === taskId);
            if (task) db.dbUpdateTask({ ...task, ...blocking.blockerFields(ids) });
            refresh();
          },
        });
      });
    } finally {
      refresh();
    }
    // A 'task' container is the parent every item was filed under.
    const parentId = created.find(t => t.parentId)?.parentId;
    if (parentId) {
      const parent = db.dbGetAllTasks().find(t => t.id === parentId);
      if (parent) onContainer({ kind: 'task', id: parent.id, name: parent.title });
    }
    return created.map(t => db.dbGetAllTasks().find(x => x.id === t.id) ?? t);
  }

  /** The Person columns a PersonFields names, validated. A birthday of null clears all three. */
  function personPatch(f: PersonFields): Partial<Person> {
    const out: Partial<Person> = {};
    if (f.name !== undefined) out.name = f.name.trim();
    if (f.nickname !== undefined) out.nickname = f.nickname.trim();
    if (f.kind !== undefined) {
      if (f.kind !== 'individual' && f.kind !== 'business') throw new Error('kind must be individual or business.');
      out.kind = f.kind;
    }
    if (f.notes !== undefined) out.notes = f.notes;
    if (f.askAbout !== undefined) out.askAbout = f.askAbout;
    if (f.phoneNumber !== undefined) out.phoneNumber = f.phoneNumber?.trim() || null;
    if (f.email !== undefined) out.email = f.email?.trim() || null;
    if (f.linkUrl !== undefined) out.linkUrl = f.linkUrl?.trim() || null;
    if (f.birthday !== undefined) {
      if (f.birthday === null) {
        Object.assign(out, { birthdayMonth: null, birthdayDay: null, birthYear: null });
      } else {
        const { month, day, year } = f.birthday;
        // Leap day is real, so the day is checked against a leap year's month length.
        const length = new Date(2024, month, 0).getDate();
        if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > length) {
          throw new Error('birthday needs a real month (1 to 12) and day of that month.');
        }
        if (year != null && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear())) {
          throw new Error('birthday year must be a year from 1900 to this year, or left out.');
        }
        Object.assign(out, { birthdayMonth: month, birthdayDay: day, birthYear: year ?? null });
      }
    }
    return out;
  }

  function buildTemplateParts(
    plan: TemplatePlan,
    existing: readonly TaskTemplate[],
    /** The template being updated: an id it already has is kept rather than minted anew. */
    base?: TaskTemplate
  ): Pick<TaskTemplate, 'items' | 'itemGroups' | 'questions'> {
    // Groups and questions are built first because an item's `groupId` and
    // its conditions' `questionId`s are ids minted here. The plan names them
    // by key and by name precisely because the caller cannot know these.
    const groupIds = new Map<string, string>();
    const itemGroups = (plan.groups ?? []).map((group, i) => {
      const id = base?.itemGroups.some(g => g.id === group.key) ? group.key : generateId();
      groupIds.set(group.key, id);
      return { id, title: group.title, sortOrder: i + 1, ...(group.checklist ? { checklist: true } : {}) };
    });

    const questionIds = new Map<string, string>();
    const questions = (plan.questions ?? []).map(question => {
      const { key, ...fields } = question;
      // Kept by name, or for one with no name by the key get_template gave it
      // (its id), so its conditions and a people question's id survive an edit.
      const kept = question.name
        ? base?.questions.find(q => q.name === question.name)
        : key !== undefined ? base?.questions.find(q => q.id === key) : undefined;
      const stored = templateUtils.normalizeTemplateQuestion({ ...fields, id: kept?.id ?? generateId() });
      if (stored.name) questionIds.set(stored.name, stored.id);
      else if (key !== undefined) questionIds.set(key, stored.id);
      return stored;
    });

    // Keyed items get their ids now, so an onlyIfAnswer can name one; the
    // answers are re-spelled as the question offers them (validated above).
    const itemIds = new Map<string, string>();
    for (const item of plan.items ?? []) {
      const key = item.key ?? item.id;
      if (key !== undefined) itemIds.set(key, item.id ?? generateId());
    }
    const offeredBy = new Map((plan.items ?? []).filter(i => (i.key ?? i.id) !== undefined).map(i => [(i.key ?? i.id)!, deliverables.deliverableOptionsFor(templateUtils.normalizeTemplateItem({ deliverableKind: i.deliverableKind ?? null, deliverableOptions: i.deliverableOptions }))]));
    const items = (plan.items ?? []).map(item => {
      const { groupKey, conditions, variants, refTemplate, key, onlyIfAnswer, waitsOn, id: keptId, chain, rotation, ...fields } = item;
      // Step and member ids are kept by position and by title on an edit: a
      // recorded answer and a week's ledger are both found through them.
      const stored = keptId !== undefined ? base?.items.find(i => i.id === keptId) : undefined;
      const sequence: Partial<TemplateItem> = chain === undefined && rotation === undefined ? {} : {
        chainEnabled: !!chain,
        chainItems: chain ? chain.steps.map((s, i) => {
          // A stored step is found by title first (a reorder or an insert
          // keeps each step's own id and the fields a plan has no name for,
          // like its link and medication), then by position (a rename).
          const title = s.title.trim();
          const byTitle = stored?.chainItems.find(c => c.title.trim().toLowerCase() === title.toLowerCase());
          const keptStep = byTitle ?? (stored?.chainItems[i] && !chain.steps.some(o => o.title.trim().toLowerCase() === stored.chainItems[i].title.trim().toLowerCase()) ? stored.chainItems[i] : undefined);
          const { deliverableKind: _k, deliverableDatesNextStep: _d, ...carried } = keptStep ?? ({} as Partial<ChainItem>);
          void _k; void _d;
          return {
            ...carried,
            id: keptStep?.id ?? generateId(),
            title,
            estimatedMinutes: s.estimatedMinutes ?? null,
            ...(s.asks ? { deliverableKind: s.asks } : {}),
            ...(s.answerSchedulesNextStep ? { deliverableDatesNextStep: true } : {}),
          };
        }) : [],
        // The step a run starts on has no name in a plan, so an edit keeps the
        // stored one (clamped to the new length) rather than resetting it.
        chainIndex: chain && stored?.chainEnabled ? Math.min(stored.chainIndex, chain.steps.length - 1) : 0,
        rotationEnabled: !!rotation,
        rotationItems: rotation ? rotation.members.map(m => {
          const title = rotationMemberTitle(m);
          const kept = stored?.rotationItems.find(o => o.title.trim().toLowerCase() === title.toLowerCase());
          return rotationItemFromInput(m, kept, generateId);
        }) : [],
      };
      const ref = refTemplate === undefined ? null : resolveRef(refTemplate, existing)[0];
      // A reference whose target was deleted is kept as the stored item had
      // it (validation lets exactly this through), rather than turned into a
      // task item with no title.
      const brokenKept = refTemplate !== undefined && !ref && stored?.refTemplateId === refTemplate ? stored : undefined;
      const offered = onlyIfAnswer ? offeredBy.get(onlyIfAnswer.item) ?? [] : [];
      return templateUtils.normalizeTemplateItem({
        ...fields,
        ...sequence,
        ...((key ?? keptId) !== undefined ? { id: itemIds.get((key ?? keptId)!) } : {}),
        answerGate: onlyIfAnswer
          ? {
              itemId: itemIds.get(onlyIfAnswer.item)!,
              answers: onlyIfAnswer.answers.map(a => offered.find(o => o.toLowerCase() === a.trim().toLowerCase()) ?? a),
            }
          : null,
        groupId: groupKey == null ? null : (groupIds.get(groupKey) ?? null),
        // Left as stored when the plan doesn't say (an update writing other
        // fields over a kept item), resolved from keys when it does.
        ...(waitsOn !== undefined ? { blockedByItemIds: waitsOn.map(k => itemIds.get(k)).filter((id): id is string => !!id) } : {}),
        conditions: (conditions ?? []).map(c => ({
          questionId: questionIds.get(c.question) ?? '',
          values: c.values,
        })),
        variants: (variants ?? []).map(v => ({
          questionId: questionIds.get(v.question) ?? '',
          answer: v.answer,
          ...(v.title ? { title: v.title } : {}),
          ...(v.notes ? { notes: v.notes } : {}),
        })),
        refTemplateId: ref?.id ?? brokenKept?.refTemplateId ?? null,
        // Carried so a broken reference can still say what it pointed at,
        // which is what the field is for (see TemplateItem.refTemplateName).
        refTemplateName: ref?.name ?? brokenKept?.refTemplateName ?? '',
      });
    });
    return { items, itemGroups, questions };
  }
  const { useMedicationStore } = require('../../src/store/useMedicationStore') as typeof import('../../src/store/useMedicationStore');
  const { useRewardStore } = require('../../src/store/useRewardStore') as typeof import('../../src/store/useRewardStore');
  const { registerTaskSource } = require('../../src/utils/blockerRegistry') as typeof import('../../src/utils/blockerRegistry');
  const { registerPersonSource } = require('../../src/utils/peopleRegistry') as typeof import('../../src/utils/peopleRegistry');
  const { registerPausedProjectSource } = require('../../src/utils/projectPause') as typeof import('../../src/utils/projectPause');
  const { useSettingsStore } = require('../../src/store/useSettingsStore') as typeof import('../../src/store/useSettingsStore');
  const { useCategoryStore } = require('../../src/store/useCategoryStore') as typeof import('../../src/store/useCategoryStore');
  const { projectProgress, projectDecisions, useProjectStore } = require('../../src/store/useProjectStore') as typeof import('../../src/store/useProjectStore');
  const { useTaskGroupStore } = require('../../src/store/useTaskGroupStore') as typeof import('../../src/store/useTaskGroupStore');
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
  useTaskGroupStore.getState().initialize();
  // Loaded for the same reason: `claimReward` judges the balance off the store's
  // entries, and recordEarn/recordMiss only add to them. Left empty, a claim
  // here saw a balance of whatever this process had earned since it started.
  useRewardStore.getState().initialize();

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

  // Cheap proof that the file is as it was when the caches were filled.
  // `total_changes()` counts every row this connection has written (triggers
  // included, rolled-back writes too, which only makes it invalidate early), and
  // `data_version` moves when a different connection writes the file. Between
  // them nothing can change the tables without changing the token. Read through
  // `expo-sqlite`'s handle, the same one database.ts holds, so it is the shim in
  // the server and the mock under jest without this file knowing which.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const probe = (require('expo-sqlite') as { openDatabaseSync(name: string): import('./expoSqliteShim').ShimDatabase }).openDatabaseSync('todo.db');
  const changeToken = (): string => {
    const changes = probe.getFirstSync<{ c: number }>('SELECT total_changes() AS c')?.c;
    const version = probe.getFirstSync<{ data_version: number }>('PRAGMA data_version')?.data_version;
    return `${changes}:${version}`;
  };
  let lastChangeToken: string | null = null;

  /** What the server runs before each request: `refresh`, unless nothing changed. */
  const refreshIfChanged = (): void => {
    const token = changeToken();
    if (token === lastChangeToken && taskCache !== null) return;
    refresh();
    lastChangeToken = token;
  };

  // A named function rather than only a method on the returned object, because
  // `sync` has to call it after applying a pull and reaching it through `this`
  // would break the moment somebody destructured the replica.
  const refresh = (): void => {
    lastChangeToken = null;
    taskCache = null;
    personCache = null;
    projectCache = null;
    useSettingsStore.getState().initialize();
    useCategoryStore.getState().initialize();
    useProjectStore.getState().initialize();
    useTaskGroupStore.getState().initialize();
    useRewardStore.getState().initialize();
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

  // ==== rewards ====
  // The Rewards screen is hidden while the setting is off, so a write that
  // would land on it (a reward, a goal, a bounty) is refused rather than
  // quietly filling a screen the person cannot open.
  const requireRewardsOn = (): void => {
    if (!useSettingsStore.getState().rewardsEnabled) {
      throw new Error('Rewards are switched off in the app. The person turns them on from the Rewards screen.');
    }
  };
  const requireReward = (id: string): Reward => {
    const reward = useRewardStore.getState().rewards.find(r => r.id === id);
    if (!reward) throw new Error(`No reward with id ${id}. get_rewards lists them.`);
    return reward;
  };
  const requireRewardCost = (cost: number): void => {
    if (!Number.isInteger(cost) || cost <= 0 || cost > rewards.MAX_REWARD_COST) {
      throw new Error(`A reward's cost is a whole number of coins from 1 to ${rewards.MAX_REWARD_COST}.`);
    }
  };
  const setBountyPushes = (task: Task, bountyPushes: number): Task => {
    // Through the same merge the app's updateTask runs; the app passes
    // SKIP_POSTPONE here so posting is never counted as a push.
    const updated = taskUpdate.mergeTaskUpdate(task, { bountyPushes }, {
      scope: 'occurrence',
      freshPinnedOrder: 0,
      dayResetTime: useSettingsStore.getState().dayResetTime,
    });
    db.dbUpdateTask(updated);
    refresh();
    return updated;
  };
  const requireNegativeHabit = (id: string): Task => {
    const task = tasks().find(t => t.id === id);
    if (!task) throw new Error(`No task with id ${id}.`);
    if (!negativeHabits.isNegativeTask(task) || task.archived) throw new Error('A slip is logged against an active "don\'t do this" habit, and that task is not one.');
    // The app's slip also charges the penalty block on the phone's apps, which
    // is device work this server cannot do. Refused rather than half-logged.
    if (task.penaltyMinutes !== null) throw new Error('That habit has a penalty, and logging a slip charges an app block that only the phone can set. Log the slip in the app.');
    return task;
  };

  /**
   * The write a completion and a miss share: build the rows, write them, then
   * the two records that are the app's own (a dose, the coins). A miss is the
   * same walk with `missed: true`, so the streak breaks and the next occurrence
   * is created by the one rule that does both.
   */
  const finishCompletion = (task: Task, options: CompletionOptions | undefined, mode: 'completed' | 'missed' | 'neutral'): CompletedResult => {
    const id = task.id;
    const missed = mode === 'missed';
    const settings = useSettingsStore.getState();
    const built = completion.buildCompletion(task, missed ? { missed: true } : mode === 'neutral' ? { ...options, neutral: true } : options, {
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
    const dose = missed ? null : medication.medicationFor(task);
    if (dose) useMedicationStore.getState().addLog({ ...dose, taskId: id, at: new Date() });

    // Coins, kept for the same reason: the ledger is a record, and a task
    // finished here should earn what it would have earned on the phone.
    // Through the app's own store and rules, keyed by the completed row, so
    // the device that later syncs this completion converges on one entry.
    // A no-op while rewards are off (the setting syncs, so this replica
    // reads the same answer the phone does).
    // A neutral completion is the app closing something on its own account, so
    // it moves no coins either way (a claimed wish-list item is the one use).
    if (mode !== 'neutral' && rewards.taskEarnsCoins(task)) {
      const store = useRewardStore.getState();
      const title = visibility.displayTitleFor(task);
      const at = new Date().toISOString();
      if (missed) store.recordMiss(id, rewards.coinsForLoss(task), title, at);
      else store.recordEarn(id, rewards.coinsForCompletion(task, built.completed.streakCount), title, at);
    }

    refresh();
    return {
      completed: built.completed,
      nextTask: built.nextTask,
      followUpTask: built.followUpTask,
      rolledOver: built.rolledOver,
      loggedDose: dose !== null,
    };
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

  /**
   * Finish a list: ticked rows are recorded as bought and leave it. The data
   * half of `useGroceryStore.finishShopping`; its use-up task and supply
   * restock go through the task store, which the phone catches up on.
   */
  const finishTrip = (
    listId: string | null,
    shopId: string | null,
    purchasedAt: string,
    priceById: Record<string, number>,
    frozenIds: ReadonlySet<string>,
  ): { finished: string[]; away: boolean; shopId: string | null } => {
    if (listId !== null && !db.dbGetAllGroceryLists().some(l => l.id === listId)) throw new Error(`No list with id ${listId}.`);
    const items = db.dbGetAllGroceryItems();
    const plan = itemWrite.planFinishShopping({
      items,
      entries: db.dbGetAllGroceryListEntries(),
      shops: db.dbGetAllGroceryShops(),
      listId,
      shopId,
      priceById,
      purchasedAt,
    });
    const ids = db.dbFinishGroceryShopping(purchasedAt, plan.shopId, plan.expiresAtById, plan.priceById, frozenIds, listId);
    if (plan.shopId && ids.length > 0) db.dbSetLastShopId(plan.shopId);
    refresh();
    const names = new Map(items.map(i => [i.id, i.name]));
    return { finished: ids.map(i => names.get(i) ?? i), away: plan.away, shopId: plan.shopId };
  };

  const replica: Replica = {
    path,

    refresh: refreshIfChanged,

    tasks,
    projects,
    projectProgress: (projectId: string) => projectProgress(projectId, tasks()),
    projectDecisions: (projectId: string) => projectDecisions(projectId, tasks()),
    taskById: (id: string) => tasks().find(t => t.id === id) ?? null,
    categories: () => db.dbGetAllCategories(),
    groceryItems: () => db.dbGetAllGroceryItems(),
    groceryListEntries: () => db.dbGetAllGroceryListEntries(),
    groceryLists: () => db.dbGetAllGroceryLists(),
    awaySpan(project: Project): AwaySpan | null {
      const awayDates = require('../../src/utils/awayDates') as typeof import('../../src/utils/awayDates'); // eslint-disable-line @typescript-eslint/no-require-imports
      return awayDates.awaySpanOf(project, useSettingsStore.getState().dayResetTime);
    },

    isVisible: (task: Task) => visibility.isTaskVisible(task),
    isHiddenForVacation: (task: Task) => visibility.isHiddenForVacation(task),
    rotationDoneIds: (task: Task) =>
      rotationMembers(task, dates.getCurrentDayStart(), useSettingsStore.getState().weekStartsOn)
        .filter(m => m.doneAt !== null)
        .map(m => m.item.id),
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
        vacationStart: s.vacationStart,
        vacationEnd: s.vacationEnd,
        vacationDrivenBy: s.vacationDrivenBy,
        waterUnit: s.waterUnit,
        kitchenEnabled: s.kitchenEnabled,
        simpleMode: s.simpleMode,
        rewardsEnabled: s.rewardsEnabled,
        rewardGoalId: s.rewardGoalId,
        bountyLimit: s.bountyLimit,
        completedRetentionDays: s.completedRetentionDays,
        // Read off the table, as requestCalendarEvent does, so the two agree.
        calendarRequestsOn: !!db.dbGetSetting('calendarRequestDeviceId'),
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
    describeBounty: (task: Task) => rewards.describeBounty(task),
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
        rewards: require('../../src/utils/rewards'),
        grocerySuggest,
        kitchenInventory: require('../../src/utils/kitchenInventory'),
        pantryReview: require('../../src/utils/pantryReview'),
        pantryCheckTasks: require('../../src/utils/pantryCheckTasks'),
        useUpRecipes: require('../../src/utils/useUpRecipes'),
        itemDisposal: require('../../src/utils/itemDisposal'),
        groceryLists,
        leftovers: require('../../src/utils/leftovers'),
        freshness: require('../../src/utils/freshness'),
        groceryParse: parse,
        receiptMatch: require('../../src/utils/receiptMatch'),
        storeAliases: require('../../src/utils/storeAliases'),
        groceryPlural: require('../../src/utils/groceryPlural'),
        focusStats: require('../../src/utils/focusStats'),
      });
      /* eslint-enable @typescript-eslint/no-require-imports */
    },
    allMoodLogs: () => db.dbGetAllMoodLogs(),
    milestones: () => db.dbGetAllMilestones(),
    // The store, loaded per write and hydrated before acting: a handful of
    // rows, and a dry run's rollback must not leave it holding a milestone the
    // database no longer has.
    addMilestone(label: string, date: Date): Milestone {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMilestoneStore } = require('../../src/store/useMilestoneStore') as typeof import('../../src/store/useMilestoneStore');
      const store = useMilestoneStore.getState();
      store.initialize();
      const milestone = store.addMilestone(label, date);
      if (!milestone) throw new Error('A milestone needs a label: what changed, in a few words.');
      return milestone;
    },
    updateMilestone(id: string, patch: { label?: string; date?: Date }): Milestone {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMilestoneStore } = require('../../src/store/useMilestoneStore') as typeof import('../../src/store/useMilestoneStore');
      const store = useMilestoneStore.getState();
      store.initialize();
      if (!store.milestones.some(m => m.id === id)) throw new Error(`No milestone with id ${id}. list_milestones names them.`);
      if (patch.label !== undefined && !patch.label.trim()) throw new Error('A milestone needs a label: what changed, in a few words.');
      store.updateMilestone(id, {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.date !== undefined ? { date: patch.date.toISOString() } : {}),
      });
      return useMilestoneStore.getState().milestones.find(m => m.id === id)!;
    },
    deleteMilestone(id: string): Milestone {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMilestoneStore } = require('../../src/store/useMilestoneStore') as typeof import('../../src/store/useMilestoneStore');
      const store = useMilestoneStore.getState();
      store.initialize();
      const milestone = store.milestones.find(m => m.id === id);
      if (!milestone) throw new Error(`No milestone with id ${id}. list_milestones names them.`);
      store.removeMilestone(id);
      return milestone;
    },
    focusHistory: () => db.dbGetFocusSessionLog(),
    savedViews: () => db.dbGetAllSavedViews(),
    savedViewTasks(clauses: readonly SavedViewClause[]): Task[] {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const savedViews = require('../../src/utils/savedViews') as typeof import('../../src/utils/savedViews');
      return savedViews.filterTasksForView(tasks(), clauses, {
        todayStart: dates.getCurrentDayStart(),
        heldBack: visibility.isHeldBack,
      });
    },
    createSavedView(name: string, icon: string, clauses: SavedViewClause[]): SavedView {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useSavedViewStore } = require('../../src/store/useSavedViewStore') as typeof import('../../src/store/useSavedViewStore');
      const store = useSavedViewStore.getState();
      store.initialize();
      return store.createView(name, icon, clauses);
    },
    deleteSavedView(id: string): SavedView {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useSavedViewStore } = require('../../src/store/useSavedViewStore') as typeof import('../../src/store/useSavedViewStore');
      const store = useSavedViewStore.getState();
      store.initialize();
      const view = store.views.find(v => v.id === id);
      if (!view) throw new Error(`No saved view with id ${id}. list_saved_views names them.`);
      store.removeView(id);
      return view;
    },
    setVacationMode(on: boolean, until?: Date | null): VacationSwitchOutcome {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const streaks = require('../../src/utils/vacationStreaks') as typeof import('../../src/utils/vacationStreaks');
      const settings = useSettingsStore.getState();
      const hiddenCategories = () => useCategoryStore.getState().categories.filter(c => c.hideOnVacation).map(c => c.name);
      // Only while the mode is on does isHiddenForVacation answer, so the count
      // is taken after switching on and before switching off.
      const hiddenTasks = () => tasks().filter(t => !t.parentId && !t.completed && !t.archived && visibility.isHiddenForVacation(t)).length;
      // Stored as the day's start, as the Settings picker stores it, which is
      // what checkVacationExpiry compares against.
      const end = until === undefined ? undefined : until === null ? null : dates.getTaskDayStart(until).toISOString();

      if (on) {
        if (settings.vacationMode) {
          if (end === undefined) throw new Error('Vacation mode is already on.');
          settings.setVacationEnd(end);
          return { on: true, hiddenTasks: hiddenTasks(), hiddenCategories: hiddenCategories(), forgivenStreaks: 0, endOnly: true };
        }
        settings.setVacationMode(true, end ?? null);
        return { on: true, hiddenTasks: hiddenTasks(), hiddenCategories: hiddenCategories(), forgivenStreaks: 0, endOnly: false };
      }

      if (!settings.vacationMode) throw new Error('Vacation mode is already off.');
      const wasHiding = hiddenTasks();
      const categories = hiddenCategories();
      const forgiven = streaks.forgiveVacationStreaks(tasks(), dates.getCurrentDayStart().toISOString());
      forgiven.forEach(t => db.dbUpdateTask(t));
      taskCache = null;
      settings.setVacationMode(false);
      return { on: false, hiddenTasks: wasHiding, hiddenCategories: categories, forgivenStreaks: forgiven.length, endOnly: false };
    },
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

    updateRecipe(id: string, patch: RecipePatch): Recipe {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { useRecipeStore } = require('../../src/store/useRecipeStore') as typeof import('../../src/store/useRecipeStore');
      const recipeUtils = require('../../src/utils/recipeUtils') as typeof import('../../src/utils/recipeUtils');
      /* eslint-enable @typescript-eslint/no-require-imports */
      useRecipeStore.getState().initialize();
      const recipe = useRecipeStore.getState().recipes.find(r => r.id === id);
      if (!recipe) throw new Error(`No recipe with id ${id}.`);

      // Everything that can refuse is checked before the first write.
      let renamed: { name: string; nameKey: string } | null = null;
      if (patch.name !== undefined) {
        const clean = recipeUtils.cleanRecipeName(patch.name);
        if (!clean) throw new Error('A recipe needs a name.');
        const key = recipeUtils.recipeNameKey(clean);
        const others = useRecipeStore.getState().recipes.filter(r => r.id !== id);
        if (key !== recipe.nameKey && recipeUtils.recipeInBook(others, clean, recipe.cookbookId)) {
          throw new Error(`There is already a recipe called "${clean}" in that cookbook.`);
        }
        renamed = { name: clean, nameKey: key };
      }
      if (patch.servings != null && (!Number.isInteger(patch.servings) || patch.servings < 1)) throw new Error('servings must be a whole number of 1 or more, or null.');

      const store = () => useRecipeStore.getState();
      db.dbTransaction(() => {
        if (patch.servings !== undefined) store().setServings(id, patch.servings);
        if (patch.estimatedMinutes !== undefined) store().setEstimatedMinutes(id, patch.estimatedMinutes);
        if (patch.mealType !== undefined) store().setMealType(id, (patch.mealType ?? null) as Recipe['mealType']);
        if (patch.tags !== undefined) store().setTags(id, patch.tags);
        if (patch.sourceUrl !== undefined) store().setSourceUrl(id, patch.sourceUrl);
        if (patch.notes !== undefined) store().setNotes(id, patch.notes);
        if (patch.ingredients !== undefined) {
          const made = patch.ingredients
            .map(line => {
              const m = recipeUtils.makeIngredient(line.text, line.section?.trim() || null);
              return m ? { ...m, choiceGroup: recipeUtils.cleanChoiceGroup(line.alternativeGroup) } : null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          store().bulkRemoveIngredients(id, recipe.ingredients.map(i => i.id));
          if (made.length > 0) store().addStructuredIngredients(id, made);
        }
        if (patch.steps !== undefined) {
          recipe.steps.forEach(s => store().removeStep(id, s.id));
          for (const step of patch.steps) store().addStep(id, step.text, step.section ?? null);
        }
        if (renamed) {
          // The store's rename also reaches the meal plan store, which Node
          // cannot load, so the two writes it makes are made here: the recipe
          // row, and the captured title on each meal planned from it.
          const current = store().recipes.find(r => r.id === id)!;
          db.dbUpdateRecipe({ ...current, ...renamed });
          for (const e of db.dbGetMealPlanEntriesForRecipe(id)) {
            if (!e.leftoverId && e.title !== renamed.name) db.dbUpdateMealPlanEntry({ ...e, title: renamed.name });
          }
        }
      });
      // Rehydrated, which also puts the store back if the transaction rolled back.
      useRecipeStore.getState().initialize();
      refresh();
      return useRecipeStore.getState().recipes.find(r => r.id === id)!;
    },

    deleteRecipe(id: string): { recipe: Recipe; plannedMeals: number } {
      const recipe = db.dbGetAllRecipes().find(r => r.id === id);
      if (!recipe) throw new Error(`No recipe with id ${id}.`);
      const plannedMeals = db.dbGetMealPlanEntriesForRecipe(id).length;
      db.dbDeleteRecipe(id);
      refresh();
      return { recipe, plannedMeals };
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

    logWater(input: WaterInput): WaterLogOutcome {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const water = require('../../src/utils/waterLog') as typeof import('../../src/utils/waterLog');
      const builder = require('../../src/utils/foodLogEntry') as typeof import('../../src/utils/foodLogEntry');
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (!Number.isFinite(input.ml) || input.ml <= 0) throw new Error('Water is logged as a positive number of millilitres.');
      const at = input.at ?? new Date();
      const dayKey = dates.getLogicalDayKey(at);
      const dayEntries = () => db.dbGetFoodLogEntries(dayKey, dayKey);
      const existing = water.waterEntryOf(dayEntries());

      // The day's row is stepped unless the phone has written it to Apple
      // Health: that sample names the volume the row held, and only the device
      // that wrote it can retract and rewrite it (reviseEntry). Rewriting the
      // row here would leave the medical record saying less than the diary.
      // A second row is what two devices leave after a sync, and every reader
      // sums the day (waterTotalMl), so the figure against the target is right
      // either way.
      const stepping = existing !== null && existing.healthSampleIds.length === 0;
      const total = (stepping ? existing.nutrition.amounts.waterMl ?? 0 : 0) + input.ml;
      const built = water.waterHelping(total, at);
      if (!built) throw new Error('That is not an amount of water the log can hold.');

      let entry: FoodLogEntry;
      if (stepping) {
        entry = { ...existing, ...built };
        db.dbUpdateFoodLogEntry(entry);
      } else {
        const row = builder.buildFoodLogEntry(
          { ...built, grams: null, slot: null, recipeId: null, itemId: null, productId: null, mealPlanEntryId: null, at },
          key => db.dbGetFoodLogEntries(key, key),
          generateId,
        );
        if (!row) throw new Error('That is not an amount of water the log can hold.');
        db.dbInsertFoodLogEntry(row);
        entry = row;
      }
      return {
        entry,
        dayTotalMl: water.waterTotalMl(dayEntries()),
        how: stepping ? 'stepped' : existing ? 'added' : 'created',
      };
    },

    logMood(input: MoodInput): MoodLog {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { useMoodStore } = require('../../src/store/useMoodStore') as typeof import('../../src/store/useMoodStore');
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (input.mood != null && (!Number.isInteger(input.mood) || input.mood < 1 || input.mood > 5)) {
        throw new Error('mood is a whole number from 1 (low) to 5 (great), or left out.');
      }
      const { symptom, tag } = moodSpelling();
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
        input.dream ?? null,
      );
      if (!log) throw new Error('A check-in needs a mood, a symptom, a tag, a note or a dream.');
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

    updateFoodEntry(id: string, patch: FoodPatch): FoodLogEntry {
      const entry = db.dbGetFoodLogEntry(id);
      if (!entry) throw new Error(`No food entry with id ${id}.`);
      const estimated = entry.nutrition.source === 'estimated';
      const touchesFigures = patch.amounts !== undefined || patch.quantity !== undefined;
      if (touchesFigures && !estimated) {
        throw new Error('Only an estimated entry has figures to restate. This one was measured against a food\'s own label or database record, so correct it in the app, which re-measures it.');
      }
      if (touchesFigures && entry.healthSampleIds.length > 0) {
        throw new Error('That entry was written to Apple Health, which only the phone can correct. Edit it in the app.');
      }
      if (patch.label !== undefined && !patch.label.trim()) throw new Error('A food entry needs a name.');

      let nutrition = entry.nutrition;
      if (patch.amounts !== undefined) {
        const estimate = require('../../src/utils/nutritionEstimate') as typeof import('../../src/utils/nutritionEstimate'); // eslint-disable-line @typescript-eslint/no-require-imports
        const read = estimate.readNutritionEstimate({ label: patch.label ?? entry.label, quantity: patch.quantity ?? entry.quantity, amounts: patch.amounts, basis: 'typical', confidence: 'medium' });
        const panel = read && estimate.estimateToPanel(read);
        if (!panel) throw new Error('A food entry needs at least one nutrient amount.');
        nutrition = panel;
      }
      const updated: FoodLogEntry = {
        ...entry,
        label: patch.label !== undefined ? patch.label.trim() : entry.label,
        quantity: patch.quantity !== undefined ? patch.quantity.trim() : entry.quantity,
        slot: patch.slot === undefined ? entry.slot : patch.slot,
        nutrition,
      };
      db.dbUpdateFoodLogEntry(updated);
      return updated;
    },

    deleteFoodEntry(id: string): FoodLogEntry {
      const entry = db.dbGetFoodLogEntry(id);
      if (!entry) throw new Error(`No food entry with id ${id}.`);
      if (entry.healthSampleIds.length > 0) {
        throw new Error('That entry was written to Apple Health, which only the phone can remove it from. Delete it in the app.');
      }
      db.dbDeleteFoodLogEntry(id);
      return entry;
    },

    updateMoodLog(id: string, patch: MoodPatch): MoodLog {
      const { useMoodStore } = require('../../src/store/useMoodStore') as typeof import('../../src/store/useMoodStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const existing = db.dbGetAllMoodLogs().find(l => l.id === id);
      if (!existing) throw new Error(`No mood check-in with id ${id}.`);
      if (patch.mood != null && (!Number.isInteger(patch.mood) || patch.mood < 1 || patch.mood > 5)) {
        throw new Error('mood is a whole number from 1 (low) to 5 (great), or null to clear it.');
      }
      const spelling = moodSpelling();
      const next: Partial<MoodLog> = {};
      if (patch.mood !== undefined) next.mood = patch.mood as MoodLog['mood'];
      if (patch.symptoms !== undefined) next.symptoms = patch.symptoms.map(s => ({ name: spelling.symptom(s.name), severity: (s.severity === 1 || s.severity === 3 ? s.severity : 2) as 1 | 2 | 3 }));
      if (patch.contextTags !== undefined) next.contextTags = patch.contextTags.map(spelling.tag);
      if (patch.note !== undefined) next.note = patch.note;
      if (patch.dream !== undefined) next.dream = patch.dream;
      // An edit may not empty the entry: a check-in recording nothing is a day
      // marked as logged with nothing on it. Delete it instead.
      const after = { ...existing, ...next };
      if (after.mood == null && after.symptoms.length === 0 && after.contextTags.length === 0 && !after.note?.trim() && !after.dream?.trim()) {
        throw new Error('That would leave the check-in empty. Delete it instead.');
      }
      useMoodStore.getState().updateLog(id, next);
      return db.dbGetAllMoodLogs().find(l => l.id === id)!;
    },

    calendarRequests(): CalendarRequest[] {
      return db.dbGetAllCalendarRequests();
    },

    requestCalendarEvent(input: CalendarRequestInput): CalendarRequest {
      if (!db.dbGetSetting('calendarRequestDeviceId')) {
        throw new Error(
          'No device is set to add events to the calendar. On the phone that should add them, pick a calendar in Settings › Reminders & Calendar › Add Claude’s events to.'
        );
      }
      const request: CalendarRequest = {
        id: generateId(),
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        allDay: input.allDay,
        location: input.location,
        notes: input.notes,
        status: 'pending',
        failureReason: null,
        eventExternalId: null,
        resolvedAt: null,
        createdAt: new Date().toISOString(),
      };
      db.dbInsertCalendarRequest(request);
      return request;
    },

    cancelCalendarRequest(id: string): CalendarRequest {
      const existing = db.dbGetCalendarRequest(id);
      if (!existing) throw new Error(`No calendar request with id ${id}.`);
      if (existing.status !== 'pending') {
        throw new Error(
          existing.status === 'written'
            ? 'That event is already on the calendar. Only the person can remove it, in their calendar app.'
            : `That request is already ${existing.status}.`
        );
      }
      const outcome = { status: 'cancelled' as const, failureReason: null, eventExternalId: null, resolvedAt: new Date().toISOString() };
      db.dbResolveCalendarRequest(id, outcome);
      return { ...existing, ...outcome };
    },

    deleteMoodLog(id: string): MoodLog {
      const { useMoodStore } = require('../../src/store/useMoodStore') as typeof import('../../src/store/useMoodStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const existing = db.dbGetAllMoodLogs().find(l => l.id === id);
      if (!existing) throw new Error(`No mood check-in with id ${id}.`);
      useMoodStore.getState().removeLog(id);
      return existing;
    },

    updateMedicationLog(id: string, patch: DosePatch): MedicationLog {
      const { useMedicationStore: meds } = require('../../src/store/useMedicationStore') as typeof import('../../src/store/useMedicationStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const existing = db.dbGetAllMedicationLogs().find(l => l.id === id);
      if (!existing) throw new Error(`No dose with id ${id}.`);
      const amount = patch.amount !== undefined ? patch.amount : existing.amount;
      const unit = patch.unit !== undefined ? patch.unit : existing.unit;
      if ((amount == null) !== (unit == null || unit === '')) {
        throw new Error('Give amount and unit together ("400" and "mg"), or neither.');
      }
      if (patch.name !== undefined && !patch.name.trim()) throw new Error('A dose needs the medication\'s name.');
      const known = medication.medicationVocabulary(db.dbGetAllMedicationLogs(), []);
      const name = patch.name === undefined ? undefined
        : known.find(n => medication.medicationKey(n) === medication.medicationKey(patch.name!)) ?? patch.name.trim();
      meds.getState().updateLog(id, {
        ...(name !== undefined ? { name } : {}),
        ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
        ...(patch.asNeeded !== undefined ? { asNeeded: patch.asNeeded } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      } as import('../../src/store/useMedicationStore').MedicationLogPatch);
      return db.dbGetAllMedicationLogs().find(l => l.id === id)!;
    },

    deleteMedicationLog(id: string): MedicationLog {
      const { useMedicationStore: meds } = require('../../src/store/useMedicationStore') as typeof import('../../src/store/useMedicationStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const existing = db.dbGetAllMedicationLogs().find(l => l.id === id);
      if (!existing) throw new Error(`No dose with id ${id}.`);
      meds.getState().removeLog(id);
      return existing;
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

    // Replaced once the replica is wrapped, below: a dry run has to capture
    // what the ledger wrapper records, so it lives outside this object.
    dryRun: () => { throw new Error('dryRun is only available on the wrapped replica.'); },
    withBatch: () => { throw new Error('withBatch is only available on the wrapped replica.'); },

    agentNotes: () => notesModule().readAgentNotes(),
    writeAgentNotes: (notes: readonly AgentNote[]) => notesModule().writeAgentNotes(notes),

    createTemplate(plan: TemplatePlan): TaskTemplate {
      const existing = db.dbGetAllTemplates();
      const errors = validateTemplatePlan(plan, existing);
      if (errors.length > 0) throw new Error(errors.join(' '));

      const template: TaskTemplate = {
        id: generateId(),
        name: plan.name.trim(),
        ...buildTemplateParts(plan, existing),
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

      registerTemplateCategory(template.category);
      db.dbInsertTemplate(template);
      return template;
    },

    updateTemplate(id: string, patch: TemplatePatch, expectedVersion?: string): TaskTemplate {
      const existing = db.dbGetAllTemplates();
      const found = resolveRef(id, existing);
      if (found.length === 0) throw new Error(`No template with id or name "${id}".`);
      if (found.length > 1) throw new Error(`"${id}" names ${found.length} templates. Use an id.`);
      const before = found[0];
      // Whole lists are rebuilt from what the caller sent, so an edit written
      // against an older read would undo whatever changed since (on the phone,
      // say). The version get_template gave says which read it was.
      if (expectedVersion !== undefined && expectedVersion !== templateVersion(before)) {
        throw new Error(`"${before.name}" has changed since that version was read. Read it again with get_template and redo the edit on what it holds now.`);
      }

      const structural = patch.groups !== undefined || patch.questions !== undefined || patch.items !== undefined;
      let parts: Partial<Pick<TaskTemplate, 'items' | 'itemGroups' | 'questions'>> = {};
      const errors: string[] = [];

      if (structural) {
        // Whatever the patch leaves out comes from the stored template, and an
        // item named by id starts from its stored self, so a field the plan has
        // no name for is never lost to a rebuild.
        const current = templateToPlan(before);
        const storedItems = new Map((current.items ?? []).map(i => [i.id!, i]));
        const plan: TemplatePlan = {
          ...current,
          groups: patch.groups ?? current.groups,
          questions: patch.questions ?? current.questions,
          items: patch.items === undefined
            ? current.items
            : patch.items.map(it => (it.id !== undefined && storedItems.has(it.id) ? { ...storedItems.get(it.id)!, ...stripUndefined(it) } : it)),
        };
        errors.push(...validateTemplatePlan({ ...plan, name: patch.name ?? before.name }, existing, before.id));
        if (errors.length === 0) parts = buildTemplateParts(plan, existing, before);
      } else if (patch.name !== undefined && !patch.name.trim()) {
        errors.push('name is required.');
      }
      if (patch.container !== undefined && !(CONTAINERS as readonly string[]).includes(patch.container)) {
        errors.push(`container must be one of ${CONTAINERS.join(', ')}.`);
      }
      if (patch.schedule) errors.push(...validateScheduleOf(patch.schedule));
      if (errors.length > 0) throw new Error(errors.join(' '));

      const schedule = patch.schedule === undefined
        ? before.schedule
        : patch.schedule === null ? null : { ...DEFAULT_SCHEDULE, ...patch.schedule };
      // Same rule as the app's setSchedule: a changed schedule is a new
      // question about the current period, an unchanged one is not.
      // Compared by value: the reader and the writer build the object in a
      // different key order, and a spurious "changed" re-arms a period that
      // already fired.
      const sameSchedule = (a: object | null, b: object | null) => JSON.stringify(a && Object.entries(a).sort()) === JSON.stringify(b && Object.entries(b).sort());
      const scheduleChanged = !sameSchedule(schedule, before.schedule);

      const updated: TaskTemplate = {
        ...before,
        name: (patch.name ?? before.name).trim(),
        category: patch.category === undefined ? before.category : patch.category,
        applyContainer: patch.container ?? before.applyContainer,
        anchorsAreAway: patch.anchorsAreAway ?? before.anchorsAreAway,
        schedule,
        scheduleLastFiredKey: scheduleChanged ? null : before.scheduleLastFiredKey,
        ...parts,
      };
      registerTemplateCategory(updated.category);
      db.dbUpdateTemplate(updated);
      return updated;
    },

    applyTemplate(ref: string, run: TemplateRun): TemplateRunResult {
      const all = db.dbGetAllTemplates();
      const found = resolveRef(ref, all);
      if (found.length === 0) throw new Error(`No template with id or name "${ref}".`);
      if (found.length > 1) throw new Error(`"${ref}" names ${found.length} templates. Use an id.`);
      const template = found[0];
      const byId = new Map(all.map(t => [t.id, t]));
      if (run.projectId && !projects().some(p => p.id === run.projectId)) throw new Error(`No project with id ${run.projectId}.`);

      const anchors = { start: run.start ?? null, end: run.end ?? null };
      const tree = templateUtils.buildApplyTree(template.items, template.id, byId);
      const questions = templateQuestions.questionsForTree(tree, byId);

      // Answers arrive by the blank's name; the run works in question ids.
      const typed: Record<string, string> = {};
      const errors: string[] = [];
      for (const [name, raw] of Object.entries(run.answers ?? {})) {
        // Matched the way a blank is: "Nights" and "nights" are one question.
        const question = questions.find(q => q.name && templateUtils.placeholderKey(q.name) === templateUtils.placeholderKey(name) && q.kind !== 'people');
        if (!question) { errors.push(`There is no question named "${name}". Its questions: ${questions.filter(q => q.name).map(q => q.name).join(', ') || 'none'}.`); continue; }
        // A choice answer is spelled the way the option is, since a condition
        // compares the stored strings exactly.
        const value = question.kind === 'choice'
          ? question.options.find(o => o.trim().toLowerCase() === raw.trim().toLowerCase()) ?? raw
          : raw;
        if (question.kind === 'choice' && !question.options.includes(value)) errors.push(`"${name}" must be one of ${question.options.join(', ')}.`);
        if (question.kind === 'number' && !Number.isFinite(Number(value))) errors.push(`"${name}" must be a number.`);
        typed[question.id] = value;
      }
      // An id may name a leaf, or a nested template's own item, which stands
      // for every leaf under it: "leave out the packing list" is one id.
      const nodesById = new Map<string, import('../../src/utils/templateUtils').ApplyTreeNode>();
      const walk = (nodes: import('../../src/utils/templateUtils').ApplyTreeNode[]) => nodes.forEach(n => { nodesById.set(n.item.id, n); walk(n.children); });
      walk(tree);
      const leavesFor = (id: string) => {
        const node = nodesById.get(id);
        if (!node || node.broken) { errors.push(`item id "${id}" is not an item of this run.`); return []; }
        return templateUtils.leafIdsUnder(node);
      };
      const include = (run.include ?? []).flatMap(leavesFor);
      const leaveOut = new Set((run.leaveOut ?? []).flatMap(leavesFor));
      if (errors.length > 0) throw new Error(errors.join(' '));

      const answers = templateQuestions.resolveAnswers(questions, typed, anchors);
      const byDefault = templateQuestions.initialLeafSelection(tree, questions, answers);
      const selected = new Set(byDefault);
      for (const id of include) selected.add(id);
      for (const id of leaveOut) selected.delete(id);
      if (selected.size === 0) throw new Error('Nothing in this template is selected for that run.');

      const placeholders = templateQuestions.placeholderValuesFor(questions, answers);
      let container: TemplateRunResult['container'] = null;
      const created = runTemplateIn(template, byId, selected, anchors, {
        runName: run.runName,
        placeholders,
        answers,
        targetProjectId: run.projectId,
      }, c => { container = c; });

      // Why each offered item is off, in the order the apply sheet would ask.
      const leftOut: TemplateRunResult['leftOut'] = [];
      const brokenRefs: string[] = [];
      const explain = (nodes: import('../../src/utils/templateUtils').ApplyTreeNode[], underOptional: boolean) => {
        for (const node of nodes) {
          if (node.broken) { brokenRefs.push(node.item.refTemplateName || node.item.refTemplateId || '(unknown)'); continue; }
          if (node.item.refTemplateId !== null) { explain(node.children, underOptional || node.item.optional); continue; }
          if (selected.has(node.item.id)) continue;
          const conditioned = templateQuestions.liveConditions(node.item.conditions, questions).length > 0;
          const why = leaveOut.has(node.item.id) ? 'left out by request'
            : underOptional ? 'inside a nested template that is optional (include its item to run it)'
            : conditioned ? 'not ticked for these answers'
            : node.item.optional ? 'optional, off unless included'
            : 'not selected';
          leftOut.push({ itemId: node.item.id, title: node.item.title, why });
        }
      };
      explain(tree, false);

      const ran = templateUtils.flattenApplyTree(tree).filter(e => selected.has(e.item.id)).map(e => e.item);
      const filled = new Set(Object.entries(placeholders).filter(([, v]) => v.trim()).map(([k]) => k));
      if (run.runName?.trim()) filled.add(templateUtils.RUN_PLACEHOLDER);
      const unfilledBlanks = [
        ...templateUtils.extractPlaceholders(ran),
        ...(templateUtils.declaresRunPlaceholder(ran) ? [templateUtils.RUN_PLACEHOLDER] : []),
      ].filter(name => !filled.has(name));

      return { tasks: created, container, leftOut, unfilledBlanks, brokenRefs };
    },

    deleteTemplate(id: string): { template: TaskTemplate; nestedIn: string[] } {
      const existing = db.dbGetAllTemplates();
      const found = resolveRef(id, existing);
      if (found.length === 0) throw new Error(`No template with id or name "${id}".`);
      if (found.length > 1) throw new Error(`"${id}" names ${found.length} templates. Use an id.`);
      const template = found[0];
      const nestedIn = existing
        .filter(t => t.id !== template.id && t.items.some(i => i.refTemplateId === template.id))
        .map(t => t.name);
      db.dbDeleteTemplate(template.id);
      return { template, nestedIn };
    },

    reorderTemplates(ids: string[]): TaskTemplate[] {
      const existing = [...db.dbGetAllTemplates()].sort((a, b) => a.sortOrder - b.sortOrder);
      const byId = new Map(existing.map(t => [t.id, t]));
      const unknown = ids.filter(id => !byId.has(id));
      if (unknown.length > 0) throw new Error(`No template with id ${unknown.join(', ')}.`);
      if (new Set(ids).size !== ids.length) throw new Error('A template is listed twice.');
      const listed = new Set(ids);
      const ordered = [...ids.map(id => byId.get(id)!), ...existing.filter(t => !listed.has(t.id))];
      const updated = ordered.map((t, i) => ({ ...t, sortOrder: i + 1 }));
      updated.filter(t => byId.get(t.id)!.sortOrder !== t.sortOrder).forEach(t => db.dbUpdateTemplate(t));
      return updated;
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

    scaleFirstWeek(id: string): void {
      const task = tasks().find(t => t.id === id);
      if (!task) return;
      const { dayResetTime, weekStartsOn } = useSettingsStore.getState();
      const anchor = quotaSchedule.firstWeekAnchor(
        task.dueDate ? dates.getTaskDayStart(new Date(task.dueDate), dayResetTime) : null,
        dates.getCurrentDayStart(),
      );
      const patch = quotaSchedule.firstWeekPatch(task, anchor, weekStartsOn);
      if (patch) replica.updateTask(id, patch);
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
      return finishCompletion(task, vetCompletion(task, options), 'completed');
    },

    markMissed(id: string): CompletedResult {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (task.completed) throw new Error('That task is already completed, so it cannot be marked missed.');
      // The app's own guards (useTaskStore.markMissed): a one-off has no
      // occurrence to miss, and a repeat that has not come round yet is skipped
      // silently there. Refused here instead, because a tool that says "missed"
      // and rolls the task forward unmissed is a claim the person did not make.
      if (task.recurrenceType === 'none') throw new Error('Only a repeating task has an occurrence to miss. Archive a one-off task instead.');
      const refusal = completion.completionRefusal(task);
      if (refusal) throw new Error(refusal);
      return finishCompletion(task, undefined, 'missed');
    },

    reopenTask(id: string): { task: Task; removed: Task[] } {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (!task.completed) throw new Error('That task is not completed, so there is nothing to reopen.');
      const refusal = reopenRefusal(task);
      if (refusal) throw new Error(refusal);

      const updated = reopenedTask(task);

      // Coins and the dose first, as the store does: both are records this
      // replica wrote when it completed the task, so they go back with it.
      useRewardStore.getState().takeBackTask(id);
      if (medication.medicationFor(task)) {
        const log = useMedicationStore.getState();
        if (visibility.isQuotaTask(task) && !visibility.isMissed(task)) log.removeLatestLogForTask(id);
        else log.removeLogsForTask(id);
      }

      // A repeating series rolls over as a set, so every unfinished row that
      // points back here goes, with its subtasks. One already completed is a
      // real completion and stays.
      const all = tasks();
      const followUps = all.filter(t => t.previousOccurrenceId === id && !t.completed);
      const removed = [...followUps, ...followUps.flatMap(f => all.filter(t => t.parentId === f.id))];
      for (const f of followUps) {
        db.dbDeleteSubtasks(f.id);
        db.dbDeleteTask(f.id);
      }
      db.dbUpdateTask(updated);
      refresh();
      return { task: updated, removed };
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

    updateAnswer(id: string, edit: AnswerEdit): Task {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (deliverables.deliverableKindFor(task) === null) throw new Error('That task doesn\'t ask a question, so it has no answer to change.');
      let answer = edit.answer === undefined ? task.deliverableValue : edit.answer;
      const offered = deliverables.deliverableOptionsFor(task);
      if (offered.length > 0 && typeof answer === 'string' && edit.answer !== undefined) {
        const match = offered.find(o => o.toLowerCase() === answer!.trim().toLowerCase());
        if (!match) throw new Error(`That task's answer is one of: ${offered.join(', ')}.`);
        answer = match;
      }
      const held = deliverables.reasoningOf(task);
      const reasoning = answer === null
        ? { why: null, revisitIf: null }
        : deliverables.cleanDeliverableReasoning({
            why: edit.why === undefined ? held.why : edit.why,
            revisitIf: edit.revisitIf === undefined ? held.revisitIf : edit.revisitIf,
          });
      if (answer === null && (edit.why || edit.revisitIf)) {
        throw new Error('Reasoning goes with an answer, and this task has none. Give the answer too.');
      }
      const updated: Task = { ...task, deliverableValue: answer, deliverableWhy: reasoning.why, deliverableRevisitIf: reasoning.revisitIf };
      db.dbUpdateTask(updated);
      refresh();
      return updated;
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

    setGroceryChecked(id: string, checked: boolean, listId: string | null = null): GroceryItem {
      const item = db.dbGetAllGroceryItems().find(i => i.id === id);
      if (!item) throw new Error(`No grocery item with id ${id}.`);

      // Checked belongs to a trolley, so there has to be one holding this item.
      const entry = db.dbGetAllGroceryListEntries().find(e => e.itemId === id && e.listId === listId);
      if (!entry) throw new Error(`"${item.name}" is not on ${listId === null ? 'the home list' : 'that list'}, so there is nothing to check off.`);

      db.dbSetGroceryListEntry({ ...entry, checked });
      refresh();
      return db.dbGetAllGroceryItems().find(i => i.id === id)!;
    },

    removeFromGroceryList(id: string, listId: string | null = null): GroceryItem {
      const item = db.dbGetAllGroceryItems().find(i => i.id === id);
      if (!item) throw new Error(`No grocery item with id ${id}.`);
      // The entry on this list, not item.onList: that flag is also true for a
      // row only on another list, which this would park without taking it off
      // anything.
      const onList = db.dbGetAllGroceryListEntries().some(e => e.itemId === id && e.listId === listId);
      if (!onList) throw new Error(`"${item.name}" is not on ${listId === null ? 'the home list' : 'that list'}.`);

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
      db.dbDeleteGroceryListEntry(id, listId);

      refresh();
      return db.dbGetAllGroceryItems().find(i => i.id === id)!;
    },

    shops: () => db.dbGetAllGroceryShops(),
    itemShopLinks: () => db.dbGetAllItemShopLinks(),
    itemSubLinks: () => db.dbGetAllItemSubLinks(),
    storeAliases: () => db.dbGetAllStoreAliases(),
    aisleOverrides: () => db.dbGetGroceryAisleOverrides(),
    aisleNames: () => {
      const items = db.dbGetAllGroceryItems();
      return aisles.normalizeAisleOrder(db.dbGetGroceryAisleOrder(), items.map(i => i.aisle), db.dbGetGroceryHiddenAisles());
    },

    updateGroceryItem(id: string, change: GroceryItemChange): GroceryItemOutcome {
      const start = db.dbGetAllGroceryItems().find(i => i.id === id);
      if (!start) throw new Error(`No grocery item with id ${id}.`);
      const nowIso = new Date().toISOString();
      const changed: string[] = [];
      let reversible = true;
      db.dbTransaction(() => {
        let item = start;
        const save = (next: GroceryItem, what: string): void => {
          db.dbUpdateGroceryItem(next);
          item = next;
          changed.push(what);
        };
        if (change.name !== undefined && change.name.trim() !== item.name) {
          reversible = false;
          const r = itemWrite.renameRows(db.dbGetAllGroceryItems(), id, change.name);
          if ('refusal' in r) throw new Error(r.refusal);
          db.dbUpdateGroceryItem(r.item);
          for (const o of r.repointed) db.dbUpdateGroceryItem(o);
          item = r.item;
          changed.push(`renamed to "${r.item.name}"`);
          // The remembered aisle and the recipes' ingredient keys follow the
          // rename, or they stay stranded under the old spelling.
          const moved = aisles.renameRememberedAisle(db.dbGetGroceryAisleOverrides(), r.oldKey, r.key);
          if (moved) db.dbSetGroceryAisleOverrides(moved);
          for (const recipe of recipeUtils.remapIngredientKeyIn(db.dbGetAllRecipes(), r.oldKey, r.key)) db.dbUpdateRecipe(recipe);
        }
        if (change.aisle !== undefined) {
          const names = replica.aisleNames();
          const match = names.find(n => n.toLowerCase() === change.aisle!.trim().toLowerCase());
          if (!match) throw new Error(`There is no aisle called "${change.aisle}". The aisles are: ${names.join(', ')}.`);
          if (match !== item.aisle) {
            const next = { ...item, aisle: match };
            save(next, `moved to ${match}`);
            // Filing it is remembered for the name, as in the app.
            const remembered = aisles.rememberAisles(db.dbGetGroceryAisleOverrides(), [next]);
            if (remembered) db.dbSetGroceryAisleOverrides(remembered);
          }
        }
        if (change.quantity !== undefined) {
          const quantity = change.quantity?.trim() || null;
          if (quantity !== item.quantity) save({ ...item, quantity, quantityFromRecipe: false }, quantity ? `quantity set to ${quantity}` : 'quantity cleared');
        }
        if (change.note !== undefined && change.note.trim() !== item.note) save({ ...item, note: change.note.trim() }, 'note changed');
        if (change.price !== undefined) {
          const shopId = change.price.shopId ?? null;
          const link = shopId ? db.dbGetAllItemShopLinks().find(l => l.itemId === id && l.shopId === shopId) : undefined;
          if (shopId) reversible = false;
          const rows = itemWrite.pricedRows(item, link, change.price.minor, nowIso);
          save(rows.item, change.price.minor === null ? 'price cleared' : 'price set');
          if (rows.link) db.dbSetItemShopLink(rows.link);
        }
        if (change.varietyOf !== undefined) {
          const key = change.varietyOf ? parse.groceryNameKey(change.varietyOf) || null : null;
          const next = key === item.nameKey ? null : key;
          if (next !== item.varietyOfKey) save({ ...item, varietyOfKey: next }, next ? `a kind of "${next}"` : 'no longer a kind of something');
        }
        if (change.preferredBoxId !== undefined) {
          const next = itemWrite.preferredProductRow(item, db.dbGetAllItemProducts(), change.preferredBoxId);
          if (next) save(next, 'preferred brand changed');
        }
        if (change.strict !== undefined && item.productStrict !== change.strict) {
          save({ ...item, productStrict: change.strict }, change.strict ? 'only the preferred brand will do' : 'any brand will do');
        }
        const shopsById = new Map(db.dbGetAllGroceryShops().map(sh => [sh.id, sh]));
        for (const shopId of change.linkShops ?? []) {
          const shop = shopsById.get(shopId);
          if (!shop) throw new Error(`No store with id ${shopId}.`);
          reversible = false;
          const row = itemWrite.shopLinkRow(db.dbGetAllItemShopLinks().find(l => l.itemId === id && l.shopId === shopId), id, shopId);
          if (row) {
            db.dbSetItemShopLink(row);
            changed.push(`can be bought at ${shop.name}`);
          }
        }
        for (const shopId of change.unlinkShops ?? []) {
          if (!db.dbGetAllItemShopLinks().some(l => l.itemId === id && l.shopId === shopId)) continue;
          reversible = false;
          db.dbDeleteItemShopLink(id, shopId);
          changed.push(`no longer linked to ${shopsById.get(shopId)?.name ?? 'a store'}`);
        }
        for (const sub of change.addSubstitutes ?? []) {
          const target = db.dbGetAllGroceryItems().find(i => i.id === sub.itemId);
          if (!target) throw new Error(`No grocery item with id ${sub.itemId}.`);
          const rows = itemWrite.subLinkRows(id, sub.itemId, db.dbGetAllItemSubLinks(), sub, nowIso);
          if (!rows) throw new Error('An item cannot be its own substitute.');
          reversible = false;
          for (const l of rows.written) db.dbSetItemSubLink(l);
          for (const l of rows.cleared) db.dbSetItemSubLink(l);
          changed.push(`${target.name} can stand in for it`);
        }
        for (const subId of change.removeSubstitutes ?? []) {
          if (!db.dbGetAllItemSubLinks().some(l => l.itemId === id && l.subItemId === subId)) continue;
          reversible = false;
          db.dbDeleteItemSubLink(id, subId);
          changed.push('a substitute removed');
        }
      });
      refresh();
      return { item: db.dbGetAllGroceryItems().find(i => i.id === id)!, changed, reversible };
    },

    saveGroceryBox(itemId: string, input: GroceryBoxInput): ItemProduct | null {
      const item = db.dbGetAllGroceryItems().find(i => i.id === itemId);
      if (!item) throw new Error(`No grocery item with id ${itemId}.`);
      const boxes = db.dbGetAllItemProducts();
      let result: ItemProduct | null = null;
      db.dbTransaction(() => {
        if (input.delete) {
          const box = boxes.find(b => b.id === input.boxId && b.itemId === itemId);
          if (!box) throw new Error('That item has no such box.');
          db.dbDeleteItemProduct(box.id);
          return;
        }
        if (input.boxId) {
          const box = boxes.find(b => b.id === input.boxId && b.itemId === itemId);
          if (!box) throw new Error('That item has no such box.');
          const edited = itemWrite.productEditRow(box, boxes, input);
          if ('refusal' in edited) throw new Error(edited.refusal);
          db.dbSetItemProduct(edited.row);
          result = edited.row;
          return;
        }
        const brand = input.brand?.trim() || null;
        const variant = input.variant?.trim() || null;
        const ensured = groceryAdd.ensureProductFor(itemId, brand, variant, boxes, new Date().toISOString());
        if (!ensured) throw new Error('A box needs a brand or a variant.');
        const box = ensured.created ? { ...ensured.product, note: input.note?.trim() ?? '', rating: input.rating ?? null } : ensured.product;
        if (ensured.created) db.dbSetItemProduct(box);
        // The first box becomes the preference, as naming one does in the app.
        if (!item.preferredProductId) db.dbUpdateGroceryItem({ ...item, preferredProductId: box.id });
        result = box;
      });
      refresh();
      return result;
    },

    saveShop(input: { id?: string; name?: string; receiptStyle?: ReceiptStyle }): Shop {
      const shops = db.dbGetAllGroceryShops();
      let id = input.id;
      db.dbTransaction(() => {
        if (!id) {
          if (!input.name) throw new Error('A new store needs a name.');
          const shop = itemWrite.newShopRow(input.name, shops, generateId(), new Date().toISOString());
          if (!shop) throw new Error(`There is already a store called "${input.name}", or the name is empty.`);
          db.dbInsertGroceryShop(shop);
          id = shop.id;
          if (input.receiptStyle) db.dbSetShopReceiptStyle(shop.id, input.receiptStyle);
          return;
        }
        const shop = shops.find(x => x.id === id);
        if (!shop) throw new Error(`No store with id ${id}.`);
        if (input.name !== undefined) {
          const renamed = itemWrite.renamedShopRow(shop, input.name, shops);
          if (!renamed) throw new Error(`There is already a store with that name, or the name is empty.`);
          db.dbUpdateGroceryShop(renamed);
        }
        if (input.receiptStyle) db.dbSetShopReceiptStyle(shop.id, input.receiptStyle);
      });
      refresh();
      return db.dbGetAllGroceryShops().find(x => x.id === id)!;
    },

    deleteGroceryItem(id: string): import('../../src/utils/groceryItemWrite').DeletedItemSnapshot {
      const snapshot = itemWrite.deletedItemSnapshot(id, {
        items: db.dbGetAllGroceryItems(),
        entries: db.dbGetAllGroceryListEntries(),
        boxes: db.dbGetAllItemProducts(),
        shopLinks: db.dbGetAllItemShopLinks(),
        subLinks: db.dbGetAllItemSubLinks(),
        aliases: db.dbGetAllStoreAliases(),
        aisleOverrides: db.dbGetGroceryAisleOverrides(),
      });
      if (!snapshot) throw new Error(`No grocery item with id ${id}.`);
      db.dbDeleteGroceryItem(id);
      refresh();
      return snapshot;
    },

    createGroceryList(name: string): GroceryList {
      const lists = db.dbGetAllGroceryLists();
      const problem = itemWrite.listNameProblem(name, lists);
      if (problem) throw new Error(problem);
      const list = itemWrite.newListRow(name, lists, generateId(), new Date().toISOString());
      db.dbInsertGroceryList(list);
      refresh();
      return list;
    },

    renameGroceryList(id: string, name: string): GroceryList {
      const lists = db.dbGetAllGroceryLists();
      const list = lists.find(l => l.id === id);
      if (!list) throw new Error(`No list with id ${id}.`);
      const problem = itemWrite.listNameProblem(name, lists, id);
      if (problem) throw new Error(problem);
      const updated = { ...list, name: name.trim() };
      db.dbUpdateGroceryList(updated);
      refresh();
      return updated;
    },

    deleteGroceryList(id: string): { list: GroceryList; unlisted: number } {
      const list = db.dbGetAllGroceryLists().find(l => l.id === id);
      if (!list) throw new Error(`No list with id ${id}.`);
      const cleared = db.dbDeleteGroceryList(id);
      refresh();
      return { list, unlisted: cleared.length };
    },

    finishGroceryTrip(input) {
      return finishTrip(input.listId, input.shopId, input.purchasedAt, input.priceById ?? {}, new Set(input.frozenIds ?? []));
    },

    importReceipt(input: ReceiptImportInput): ReceiptImportOutcome {
      const nowIso = new Date().toISOString();
      const resolved: ReceiptImportOutcome['lines'] = [];
      const priceById: Record<string, number> = {};
      const frozen = new Set<string>();
      let finished: { finished: string[]; away: boolean; shopId: string | null } = { finished: [], away: input.listId !== null, shopId: null };
      db.dbTransaction(() => {
        for (const line of input.lines) {
          let item: GroceryItem;
          let created = false;
          if (line.itemId) {
            const found = db.dbGetAllGroceryItems().find(i => i.id === line.itemId);
            if (!found) throw new Error(`No grocery item with id ${line.itemId}.`);
            item = found;
          } else if (line.name?.trim()) {
            if (input.context === 'shopping') {
              const out = replica.addGroceryItem(line.name, { listId: input.listId, ...(line.quantity ? { quantity: line.quantity } : {}) });
              item = out.item;
              created = out.isNew;
            } else {
              const [out] = replica.addToPantry([line.name]);
              if (!out) throw new Error(`"${line.name}" has no name in it.`);
              item = out.item;
              created = out.isNew;
            }
          } else {
            throw new Error(`The receipt line "${line.label}" needs an itemId or a name.`);
          }
          const existedBefore = !created;

          if (input.context === 'shopping') {
            const entries = db.dbGetAllGroceryListEntries();
            const entry = entries.find(e => e.itemId === item.id && e.listId === input.listId);
            db.dbSetGroceryListEntry(entry
              ? { ...entry, checked: true }
              : { itemId: item.id, listId: input.listId, checked: true, choiceGroup: null, addedAt: nowIso, sortOrder: groceryLists.nextListSortOrder(entries, input.listId) });
            if (line.priceMinor !== undefined && line.priceMinor !== null) priceById[item.id] = line.priceMinor;
            if (line.frozen) frozen.add(item.id);
          } else {
            // A row named by id is marked on hand here; one named by name was
            // already marked by `addToPantry`, whose rule this repeats.
            if (line.itemId) {
              const got = pantryWrite.onHandRow(item, grocerySuggest.defaultOnHandUntil(item, new Date()));
              db.dbUpdateGroceryItem(got);
              item = got;
            }
            // A new packet of something already in the catalog: the old
            // packet's claims go, and so does the running-low entry.
            if (existedBefore) {
              const fresh = pantryWrite.acquiredRow(item);
              if (fresh) {
                for (const e of pantryWrite.runningLowEntries(db.dbGetAllGroceryListEntries(), item)) db.dbDeleteGroceryListEntry(e.itemId, e.listId);
                db.dbUpdateGroceryItem(fresh);
                item = fresh;
              }
            }
            if (line.frozen) {
              const f = pantryWrite.frozenRow(item, true, new Date());
              if (f) {
                db.dbUpdateGroceryItem(f);
                item = f;
              }
            }
            if (line.priceMinor !== undefined) {
              const link = input.shopId ? db.dbGetAllItemShopLinks().find(l => l.itemId === item.id && l.shopId === input.shopId) : undefined;
              const rows = itemWrite.pricedRows(item, link, line.priceMinor, nowIso);
              db.dbUpdateGroceryItem(rows.item);
              if (rows.link) db.dbSetItemShopLink(rows.link);
            }
          }

          // Remembered only for a row the line named, as the app does for a row
          // the person confirmed: a row this line minted has nothing to alias.
          let aliasRemembered = false;
          if (existedBefore && line.rememberAlias !== false && line.label.trim()) {
            const alias = itemWrite.aliasRow(db.dbGetAllStoreAliases(), input.shopId, line.label, item.id, generateId(), nowIso);
            if (alias) {
              db.dbSetStoreAlias(alias);
              aliasRemembered = true;
            }
          }
          resolved.push({ label: line.label, itemId: item.id, name: item.name, created, priceMinor: line.priceMinor ?? null, frozen: !!line.frozen, aliasRemembered });
        }
        if (input.context === 'shopping' && input.finish) {
          finished = finishTrip(input.listId, input.shopId, input.purchasedAt, priceById, frozen);
        }
      });
      refresh();
      return { lines: resolved, finished: finished.finished, away: finished.away, shopId: finished.shopId };
    },

    itemProducts: () => db.dbGetAllItemProducts(),
    leftovers: () => db.dbGetAllLeftovers(),

    updatePantryItem(id: string, change: PantryItemChange): PantryItemOutcome {
      const now = new Date();
      const nowIso = now.toISOString();
      const start = db.dbGetAllGroceryItems().find(i => i.id === id);
      if (!start) throw new Error(`No grocery item with id ${id}.`);
      if (change.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(change.expiresAt)) {
        throw new Error('expiresAt is a day, YYYY-MM-DD.');
      }
      const changed: string[] = [];
      db.dbTransaction(() => {
        let item = start;
        const save = (next: GroceryItem | null, what: string): void => {
          if (!next) return;
          db.dbUpdateGroceryItem(next);
          item = next;
          changed.push(what);
        };
        if (change.status === 'out') {
          if (item.onHandUntil !== grocerySuggest.OUT_OF_IT_UNTIL) {
            const thawed = pantryWrite.thawedPortionsOf(new Set([id]), db.dbGetAllItemProducts());
            save(pantryWrite.markedOutRow(item, change.outcome, nowIso), 'marked out of it');
            for (const p of thawed) db.dbDeleteItemProduct(p.id);
          } else if (change.outcome) {
            save(pantryWrite.disposalRow(item, change.outcome, nowIso), `recorded that it was ${change.outcome === 'spoiled' ? 'thrown out' : 'used up'}`);
          }
        } else if (change.status === 'have') {
          save(pantryWrite.onHandRow(item, grocerySuggest.defaultOnHandUntil(item, now)), 'marked as on hand');
        } else if (change.status === 'clear' && item.onHandUntil !== null) {
          save(pantryWrite.onHandRow(item, null), 'cleared what was said about having it');
        }
        if (change.staple !== undefined && item.isStaple !== change.staple) {
          save({ ...item, isStaple: change.staple }, change.staple ? 'marked as always on hand' : 'no longer always on hand');
        }
        if (change.frozen !== undefined) save(pantryWrite.frozenRow(item, change.frozen, now), change.frozen ? 'put in the freezer' : 'taken out of the freezer');
        if (change.freezeSome) {
          const existing = db.dbGetAllItemProducts().find(p => p.itemId === id && p.isPortion === true) ?? null;
          const portion = pantryWrite.freezePortionRow(id, existing, nowIso, generateId);
          if (portion) {
            db.dbSetItemProduct(portion);
            changed.push('froze some of it');
          }
        }
        if (change.opened !== undefined) save(pantryWrite.openedRow(item, change.opened, now), change.opened ? 'marked as opened' : 'marked as unopened');
        if (change.runningLow !== undefined) {
          const entries = db.dbGetAllGroceryListEntries();
          const onHome = entries.some(e => e.itemId === id && e.listId === null);
          const next = pantryWrite.runningLowRow(item, change.runningLow, onHome, nowIso);
          save(next, change.runningLow ? 'marked as running low' : 'no longer running low');
          // One direction only, as in the app: running low puts it on the list,
          // and clearing it never takes it off.
          if (next && change.runningLow && !onHome) {
            db.dbSetGroceryListEntry({
              itemId: id, listId: null, checked: false, choiceGroup: null, addedAt: nowIso,
              sortOrder: groceryLists.nextListSortOrder(entries, null),
            });
            changed.push('put on the grocery list');
          }
        }
        if (change.expiresAt !== undefined && item.expiresAt !== change.expiresAt) {
          save({ ...item, expiresAt: change.expiresAt }, change.expiresAt ? `use-by day set to ${change.expiresAt}` : 'use-by day cleared');
        }
        if (change.shelfLifeDays !== undefined) {
          const days = change.shelfLifeDays === null ? null : shelfLife.clampExpiryDays(change.shelfLifeDays);
          if (item.shelfLifeDays !== days) save({ ...item, shelfLifeDays: days }, days === null ? 'shelf life cleared' : `shelf life set to ${days} days`);
        }
        if (change.useUpTask !== undefined && item.useUpTask !== change.useUpTask) {
          save({ ...item, useUpTask: change.useUpTask }, change.useUpTask === null ? 'use-up tasks follow the setting' : change.useUpTask ? 'use-up task turned on' : 'use-up task turned off');
        }
      });
      refresh();
      return {
        item: db.dbGetAllGroceryItems().find(i => i.id === id)!,
        boxes: db.dbGetAllItemProducts().filter(p => p.itemId === id),
        changed,
      };
    },

    updatePantryBox(id: string, change: PantryBoxChange): PantryBoxOutcome {
      const now = new Date();
      const start = db.dbGetAllItemProducts().find(p => p.id === id);
      if (!start) throw new Error(`No box with id ${id}.`);
      const item = db.dbGetAllGroceryItems().find(i => i.id === start.itemId);
      if (!item) throw new Error('That box belongs to an item that no longer exists.');
      const changed: string[] = [];
      let box: ItemProduct | null = start;
      db.dbTransaction(() => {
        const save = (next: ItemProduct | null, what: string): void => {
          if (!next) return;
          db.dbSetItemProduct(next);
          box = next;
          changed.push(what);
        };
        if (change.status === 'out' && box && box.onHandUntil !== grocerySuggest.OUT_OF_IT_UNTIL) {
          const { update, remove } = pantryWrite.productsOutPlan([box]);
          for (const u of update) save(u, 'marked out of it');
          for (const r of remove) {
            db.dbDeleteItemProduct(r.id);
            box = null;
            changed.push('used up, so the portion is gone');
          }
        } else if (change.status === 'have' && box) {
          save(pantryWrite.productOnHandRow(box, grocerySuggest.defaultOnHandUntil(item, now)), 'marked as on hand');
        } else if (change.status === 'clear' && box) {
          save(pantryWrite.productOnHandRow(box, null), 'cleared what was said about having it');
        }
        if (box && change.frozen !== undefined) save(pantryWrite.productFrozenRow(box, item, change.frozen, now), change.frozen ? 'put in the freezer' : 'taken out of the freezer');
        if (box && change.opened !== undefined) save(pantryWrite.productOpenedRow(box, item, change.opened, now), change.opened ? 'marked as opened' : 'marked as unopened');
      });
      refresh();
      return { box, item, changed };
    },

    addToPantry(names: string[]): { item: GroceryItem; isNew: boolean }[] {
      const out: { item: GroceryItem; isNew: boolean }[] = [];
      db.dbTransaction(() => {
        for (const raw of names) {
          // Re-read per name, so the second "flour" in one call finds the row
          // the first one made rather than minting another.
          const items = db.dbGetAllGroceryItems();
          const plan = pantryWrite.planAddToPantry(raw, {
            items,
            aisleOverrides: db.dbGetGroceryAisleOverrides(),
            aisleOrder: aisles.normalizeAisleOrder(
              db.dbGetGroceryAisleOrder(),
              items.map(i => i.aisle),
              db.dbGetGroceryHiddenAisles(),
            ),
            now: new Date(),
          });
          if (!plan) continue;
          if (plan.isNew) db.dbInsertGroceryItem(plan.item);
          else db.dbUpdateGroceryItem(plan.item);
          out.push({ item: plan.item, isNew: plan.isNew });
        }
      });
      refresh();
      return out;
    },

    answerPantryReview(id: string, answer: 'have' | 'low' | 'out'): GroceryItem {
      if (!db.dbGetAllGroceryItems().some(i => i.id === id)) throw new Error(`No grocery item with id ${id}.`);
      const now = new Date();
      db.dbTransaction(() => {
        if (answer === 'low') {
          const item = db.dbGetAllGroceryItems().find(i => i.id === id)!;
          const entries = db.dbGetAllGroceryListEntries();
          const onHome = entries.some(e => e.itemId === id && e.listId === null);
          const next = pantryWrite.runningLowRow(item, true, onHome, now.toISOString());
          if (next) {
            db.dbUpdateGroceryItem(next);
            if (!onHome) {
              db.dbSetGroceryListEntry({
                itemId: id, listId: null, checked: false, choiceGroup: null, addedAt: now.toISOString(),
                sortOrder: groceryLists.nextListSortOrder(entries, null),
              });
            }
          }
        }
        const item = db.dbGetAllGroceryItems().find(i => i.id === id)!;
        const thawed = answer === 'out' ? pantryWrite.thawedPortionsOf(new Set([id]), db.dbGetAllItemProducts()) : [];
        db.dbUpdateGroceryItem(pantryWrite.reviewedRow(item, answer, now));
        for (const p of thawed) db.dbDeleteItemProduct(p.id);
      });
      refresh();
      return db.dbGetAllGroceryItems().find(i => i.id === id)!;
    },

    createLeftover(draft: LeftoverDraftInput): Leftover | null {
      const row = pantryWrite.newLeftoverRow(draft, generateId(), new Date().toISOString());
      if (!row) return null;
      db.dbInsertLeftover(row);
      refresh();
      return row;
    },

    updateLeftover(id: string, change: LeftoverChange): Leftover {
      const start = db.dbGetAllLeftovers().find(l => l.id === id);
      if (!start) throw new Error(`No leftover with id ${id}.`);
      const nowIso = new Date().toISOString();
      db.dbTransaction(() => {
        let row = start;
        const save = (next: Leftover | null): void => {
          if (!next) return;
          db.dbUpdateLeftover(next);
          row = next;
        };
        if (change.frozen !== undefined) save(pantryWrite.leftoverFrozenRow(row, change.frozen, nowIso));
        if (change.finished === null) save(pantryWrite.leftoverReopenedRow(row));
        else if (change.finished) save(pantryWrite.leftoverFinishedRow(row, change.finished, nowIso));
        if (change.keepDays !== undefined) save(pantryWrite.leftoverKeepDaysRow(row, Math.max(1, Math.round(change.keepDays))));
      });
      refresh();
      return db.dbGetAllLeftovers().find(l => l.id === id)!;
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
      const { completed, archived, newCategory, taskDefaults, ...rest } = patch;
      const content: Parameters<typeof store.updateProject>[1] = { ...rest } as never;
      if (taskDefaults !== undefined) {
        content.taskDefaults = taskDefaults === null ? null : parseTaskFieldDefaults(taskDefaults);
        if (taskDefaults !== null && content.taskDefaults === null) throw new Error('taskDefaults: nothing in it is a value I can use. Priority is 0 to 4, difficulty is easy, normal or hard, and effort is 1 to 6.');
      }
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
      // The away span, checked as ProjectEditor checks it (see ProjectPatch).
      // Everything that hangs off the span is settled here and written in the
      // same patch, so a half-written trip cannot land.
      const before = store.projects.find(p => p.id === id)!;
      const { awayStart, awayEnd, destination, ...contentRest } = content;
      const away: Partial<Pick<Project, 'awayStart' | 'awayEnd' | 'destination' | 'awayPauses' | 'awayListId'>> = {};
      if (awayStart !== undefined || awayEnd !== undefined || destination !== undefined) {
        const noonOf = (value: string, field: string): string => {
          const noon = eventNoonIso(value);
          if (!noon) throw new Error(`${field}: "${value}" is not a date I can read. Use an ISO date like 2027-06-14.`);
          return noon;
        };
        const start = awayStart === undefined ? before.awayStart : awayStart === null ? null : noonOf(awayStart, 'awayStart');
        if (start === null) {
          // Clearing the departure clears the return with it, and the
          // destination and both nominations: each is about a trip that is no
          // longer there (ProjectEditor's save does the same).
          if (awayEnd) throw new Error('awayEnd needs awayStart: a return with no departure is not a trip.');
          if (destination) throw new Error('destination needs awayStart: a place belongs to a trip, and this project has no away dates.');
          Object.assign(away, { awayStart: null, awayEnd: null, destination: null, awayPauses: false, awayListId: null });
        } else {
          let end: string | null;
          if (awayEnd !== undefined) {
            end = awayEnd === null ? null : noonOf(awayEnd, 'awayEnd');
          } else if (awayStart !== undefined && before.awayStart && before.awayEnd) {
            // Moving the departure moves the return with it, keeping the trip
            // the same length, as the editor does: a flight moved three days
            // later is the same ten-day trip.
            // Counted in calendar days and re-anchored at noon rather than
            // shifted by milliseconds: across a clock change the latter lands
            // an hour off noon, which `awaySpanOf` would then read as a day out.
            const awayDates = require('../../src/utils/awayDates') as typeof import('../../src/utils/awayDates'); // eslint-disable-line @typescript-eslint/no-require-imports
            const shiftDays = differenceInCalendarDays(new Date(start), new Date(before.awayStart));
            end = awayDates.awayNoonIso(addDays(new Date(before.awayEnd), shiftDays));
          } else {
            end = before.awayEnd;
          }
          if (end !== null && new Date(end).getTime() <= new Date(start).getTime()) {
            throw new Error('Coming back is before leaving. Pick a day after you leave.');
          }
          away.awayStart = start;
          away.awayEnd = end;
          if (destination !== undefined) away.destination = destination === null || !destination.trim() ? null : destination.trim();
        }
      }
      const fields = { ...contentRest, ...away };
      db.dbTransaction(() => {
        ensureCategory(fields.defaultTaskCategory);
        if (Object.keys(fields).length > 0) {
          store.updateProject(id, { ...fields, ...(fields.title ? { title: fields.title.trim() } : {}) });
        }
        if (completed !== undefined) useProjectStore.getState().applyProjectCompleted(id, completed);
        if (archived !== undefined) useProjectStore.getState().applyProjectArchived(id, archived);
      });
      refresh();
      return projects().find(p => p.id === id)!;
    },

    stacks(): TaskGroup[] {
      return db.dbGetAllTaskGroups();
    },

    createStack(title: string, category: string | null): TaskGroup {
      const name = title.trim();
      if (!name) throw new Error('A stack needs a title.');
      let group: TaskGroup | undefined;
      db.dbTransaction(() => {
        ensureCategory(category);
        group = useTaskGroupStore.getState().createGroup(name, category);
      });
      refresh();
      return group!;
    },

    renameStack(id: string, title: string): TaskGroup {
      const name = title.trim();
      if (!name) throw new Error('A stack needs a title.');
      const group = db.dbGetAllTaskGroups().find(g => g.id === id);
      if (!group) throw new Error(`No stack with id ${id}.`);
      useTaskGroupStore.getState().updateGroup(id, { title: name });
      refresh();
      return { ...group, title: name };
    },

    setTaskStack(taskId: string, stackId: string | null): Task {
      const task = tasks().find(t => t.id === taskId);
      if (!task) throw new Error(`No task with id ${taskId}.`);
      if (task.parentId) throw new Error(`"${task.title}" is a subtask. A stack holds top-level tasks.`);
      if (task.completed) throw new Error(`"${task.title}" is completed. Reopen it in the app before moving it.`);
      if (task.archived) throw new Error(`"${task.title}" is archived. Restore it in the app before moving it.`);

      const group = stackId === null ? null : db.dbGetAllTaskGroups().find(g => g.id === stackId) ?? null;
      if (stackId !== null && !group) throw new Error(`No stack with id ${stackId}.`);

      const all = tasks();
      const patch: Partial<Task> = group
        ? {
            groupId: group.id,
            sortOrder: all.filter(t => t.groupId === group.id).reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1,
            ...(group.category ? { category: group.category } : {}),
          }
        : { groupId: null };
      // 'occurrence': the stack holds this row, not the other dates of a series.
      const updated = taskUpdate.mergeTaskUpdate(task, patch, {
        scope: 'occurrence',
        freshPinnedOrder: 0,
        dayResetTime: useSettingsStore.getState().dayResetTime,
      });
      db.dbTransaction(() => {
        ensureCategory(updated.category);
        db.dbUpdateTask(updated);
      });
      refresh();
      return updated;
    },

    rewardState(): { entries: CoinEntry[]; rewards: Reward[] } {
      return {
        entries: rewards.sortCoinEntries(db.dbGetAllCoinEntries()),
        rewards: [...db.dbGetAllRewards()].sort((a, b) => a.cost - b.cost || (a.createdAt < b.createdAt ? -1 : 1)),
      };
    },

    addReward(title, cost, details): Reward {
      requireRewardsOn();
      const name = title.trim();
      if (!name) throw new Error('A reward needs a title.');
      requireRewardCost(cost);
      const reward = useRewardStore.getState().addReward(name, cost, details);
      if (!reward) throw new Error('Could not add the reward.');
      refresh();
      return reward;
    },

    updateReward(id, patch): Reward {
      requireRewardsOn();
      const current = requireReward(id);
      if (current.taskId) throw new Error('That reward is a wish-list item, so its title, note and link are the item\'s. Edit the item instead.');
      if (patch.title !== undefined && !patch.title.trim()) throw new Error('A reward needs a title.');
      if (patch.cost !== undefined) requireRewardCost(patch.cost);
      useRewardStore.getState().updateReward(id, patch);
      refresh();
      return requireReward(id);
    },

    deleteReward(id): Reward {
      requireRewardsOn();
      const reward = requireReward(id);
      useRewardStore.getState().deleteReward(id);
      refresh();
      return reward;
    },

    claimReward(id): CoinEntry {
      requireRewardsOn();
      const reward = requireReward(id);
      const { entries } = useRewardStore.getState();
      if (reward.oneTime && rewards.lastClaimedAt(entries, id) !== null) throw new Error(`"${reward.title}" is a one-time reward and has already been claimed.`);
      // A wish-list reward is its list item: claiming it checks the item off, the
      // app's `claim` in RewardsScreen. Judged before any coin moves, so a
      // refusal leaves the balance alone.
      const item = reward.taskId ? tasks().find(t => t.id === reward.taskId) : undefined;
      if (reward.taskId) {
        if (!item || !rewards.rewardIsOpen(reward, entries, item)) throw new Error(`"${reward.title}" is checked off, archived or gone from the list, so the reward is gone too.`);
        const refusal = completion.completionRefusal(item);
        if (refusal) throw new Error(refusal);
      }
      const balance = rewards.coinBalance(entries);
      if (!rewards.canClaimReward(balance, reward.cost)) {
        throw new Error(`"${reward.title}" costs ${reward.cost} coins and the balance is ${balance}.`);
      }
      let entry: CoinEntry | null = null;
      db.dbTransaction(() => {
        entry = useRewardStore.getState().claimReward(id);
        if (!entry) throw new Error('Could not claim the reward.');
        // Neutral, so checking the item off earns nothing on top of what was spent.
        if (item) finishCompletion(item, undefined, 'neutral');
      });
      refresh();
      return entry!;
    },

    unclaimReward(entryId): CoinEntry {
      const entry = useRewardStore.getState().entries.find(e => e.id === entryId);
      if (!entry || entry.kind !== 'spend') throw new Error(`No claim with id ${entryId}. Only a spend can be taken back.`);
      // The app's undo for a wish-list claim puts the item back with the coins.
      // Only an item checked off at or after the claim is reopened: one the person
      // finished earlier is theirs, and a refused reopen stops the whole undo
      // before any coin moves.
      const reward = entry.rewardId ? useRewardStore.getState().rewards.find(r => r.id === entry.rewardId) : undefined;
      const item = reward?.taskId ? tasks().find(t => t.id === reward.taskId) : undefined;
      if (item?.completed && item.completedAt && item.completedAt >= entry.at) replica.reopenTask(item.id);
      useRewardStore.getState().unclaim(entryId);
      refresh();
      return entry;
    },

    setRewardGoal(id): Reward | null {
      requireRewardsOn();
      let reward: Reward | null = null;
      if (id !== null) {
        reward = requireReward(id);
        const source = reward.taskId ? tasks().find(t => t.id === reward!.taskId) : undefined;
        if (!rewards.rewardIsOpen(reward, useRewardStore.getState().entries, source)) {
          throw new Error(`"${reward.title}" has already been claimed or is gone, so it cannot be the goal.`);
        }
      }
      useSettingsStore.getState().setRewardGoalId(id);
      refresh();
      return reward;
    },

    postBounty(id): Task {
      requireRewardsOn();
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (!rewards.canPostBounty(task)) {
        throw new Error(task.bountyPushes != null
          ? 'That task already had a bounty this occurrence, live or withdrawn. A repeating task can have another on its next occurrence.'
          : 'A bounty needs an open, top-level task that is not a "don\'t do this" habit.');
      }
      const { bountyLimit } = useSettingsStore.getState();
      if (rewards.liveBountyCount(tasks()) >= bountyLimit) {
        throw new Error(`The bounty limit is ${bountyLimit} live at once. Withdraw one first.`);
      }
      return setBountyPushes(task, 0);
    },

    withdrawBounty(id): Task {
      requireRewardsOn();
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (!rewards.isBountyLive(task)) throw new Error('That task has no live bounty to withdraw.');
      return setBountyPushes(task, rewards.BOUNTY_WITHDRAWN);
    },

    logSlip(id): Task {
      const task = requireNegativeHabit(id);
      const updated = { ...task, ...negativeHabits.slipPatch(task, dates.getCurrentDayStart()) };
      db.dbUpdateTask(updated);
      useRewardStore.getState().recordSlip(id, rewards.coinsForLoss(updated), visibility.displayTitleFor(updated));
      refresh();
      return updated;
    },

    undoSlip(id): Task {
      const task = requireNegativeHabit(id);
      const patch = negativeHabits.undoSlipPatch(task, dates.getCurrentDayStart());
      if (!patch) throw new Error('No slip has been logged against that habit today, so there is nothing to undo.');
      const updated = { ...task, ...patch };
      db.dbUpdateTask(updated);
      useRewardStore.getState().takeBackSlip(id);
      refresh();
      return updated;
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

    updateMeal(id: string, patch: { date?: string; slot?: MealSlot; title?: string; scale?: number }): MealPlanEntry {
      const entry = db.dbGetMealPlanEntry(id);
      if (!entry) throw new Error(`No planned meal with id ${id}.`);
      let next: MealPlanEntry = { ...entry };

      if (patch.title !== undefined) {
        const gone = entry.recipeId ? !db.dbGetAllRecipes().some(r => r.id === entry.recipeId) : false;
        if (entry.leftoverId || (entry.recipeId && !gone)) {
          throw new Error('That meal\'s name comes from its recipe or leftover, so it is not renamed here. Move or remove it, or plan a new one.');
        }
        const cleaned = mealPlanUtils.cleanMealTitle(patch.title);
        if (!cleaned) throw new Error('A meal needs a title.');
        // A renamed meal whose recipe is gone is a different meal now, as in the app.
        next = gone ? { ...next, title: cleaned, recipeId: null, recipeChoices: [], recipeScale: 1 } : { ...next, title: cleaned };
      }

      if (patch.scale !== undefined) {
        if (!entry.recipeId) throw new Error('Only a meal with a recipe has a scale.');
        if (!Number.isFinite(patch.scale) || patch.scale <= 0) throw new Error('scale must be above zero (0.5 halves a recipe, 2 doubles it).');
        next = { ...next, recipeScale: patch.scale };
      }

      const date = patch.date ?? entry.date;
      const slot = patch.slot ?? entry.slot;
      if (date !== entry.date || slot !== entry.slot) {
        next = { ...next, date, slot, sortOrder: mealPlanUtils.nextSortOrder(db.dbGetMealPlanEntries(date, date), date, slot) };
      }
      db.dbUpdateMealPlanEntry(next);
      return next;
    },

    removeMeal(id: string): MealPlanEntry {
      const entry = db.dbGetMealPlanEntry(id);
      if (!entry) throw new Error(`No planned meal with id ${id}.`);
      if (entry.cookedAt) throw new Error('That meal is marked cooked, so it is history and feeds the cooking stats. Remove it in the app if you are sure.');
      db.dbDeleteMealPlanEntry(id);
      return entry;
    },

    createPerson(fields: PersonFields): Person {
      if (!fields.name?.trim()) throw new Error('A person needs a name.');
      const { blankPerson } = require('../../src/store/usePersonStore') as typeof import('../../src/store/usePersonStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const person = { ...blankPerson(fields.name, people().reduce((m, p) => Math.max(m, p.sortOrder), 0) + 1), ...personPatch(fields) };
      db.dbInsertPerson(person);
      refresh();
      return person;
    },

    updatePerson(id: string, fields: PersonFields): Person {
      const existing = people().find(p => p.id === id);
      if (!existing) throw new Error(`No person with id ${id}.`);
      if (fields.name !== undefined && !fields.name.trim()) throw new Error('A person needs a name.');
      const next = { ...existing, ...personPatch(fields) };
      db.dbUpdatePerson(next);
      refresh();
      return next;
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
  // can take it back. See agentLedger.ts. While a dry run is capturing, the
  // entries are collected instead, which is what a preview describes.
  let capturing: AgentLedgerEntry[] | null = null;
  let currentBatch: string | null = null;
  const wrapped = withAgentLedger(replica, entries => {
    if (capturing) capturing.push(...entries);
    else db.dbInsertUnattendedEntries(toLedgerEntries(entries, generateId, new Date(), currentBatch));
  });

  wrapped.withBatch = <T>(batchId: string, fn: () => T): T => {
    const outer = currentBatch;
    currentBatch = batchId;
    try {
      return fn();
    } finally {
      currentBatch = outer;
    }
  };

  /** Thrown to roll a dry run back. Never escapes `dryRun`. */
  const DRY_RUN = Symbol('dry run');
  wrapped.dryRun = <T>(fn: () => T): { result: T; effects: AgentLedgerEntry[] } => {
    if (capturing) throw new Error('A dry run is already in progress.');
    const effects: AgentLedgerEntry[] = [];
    capturing = effects;
    let result!: T;
    try {
      // Everything the write does lands inside one transaction that is then
      // thrown away: a nested dbTransaction becomes a savepoint inside it
      // (better-sqlite3 nests them), and a write outside one is still inside
      // this. So the preview is the real write, measured and undone.
      db.dbTransaction(() => {
        result = fn();
        throw DRY_RUN;
      });
    } catch (e) {
      if (e !== DRY_RUN) throw e;
    } finally {
      capturing = null;
      // The stores the write touched in memory (settings, categories,
      // projects) go back to what the database says again.
      refresh();
    }
    return { result, effects };
  };
  return wrapped;
}
