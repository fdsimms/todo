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
  CalendarRequestChanges,
  Category,
  ChainItem,
  CoinEntry,
  Cookbook,
  CookbookIndexEntry,
  DeliverableKind,
  EventTaskRule,
  FoodLogEntry,
  FoodNutrition,
  GeneratedKind,
  HealthRule,
  Milestone,
  MeterReading,
  JournalEntry,
  JournalKind,
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
  NutrientKey,
  Recipe,
  RecipeVote,
  SavedMeal,
  Reward,
  TaskTemplate,
  TemplateItem,
  Task,
  TaskDraft,
  TaskGroup,
  TimeOfDay,
} from '../../src/types';
import { parseTaskFieldDefaults } from '../../src/utils/taskFieldDefaults';
import { rotationItemFromInput, rotationMemberTitle, rotationMembers } from '../../src/utils/rotation';
import { sunAnchorHHMM } from '../../src/utils/sunTimes';
import type { AwaySpan } from '../../src/utils/awayDates';
import type { WaterUnit } from '../../src/utils/waterLog';
import type { FoodLogTotals } from '../../src/utils/foodLog';
import type { DayProduce } from '../../src/utils/produceServings';
import type { LookAhead } from '../../src/utils/lookAhead';
import type { AgentNote } from '../../src/utils/agentNotes';
import type { DeletedTaskSnapshot } from '../../src/utils/agentRevert';
import type { DeletedProjectSnapshot, DeletedStackSnapshot } from '../../src/utils/agentRecordRevert';
import type { MostMissedGroup } from '../../src/utils/missed';
import type { OnTimeSummary } from '../../src/utils/stats';
import type { SyncSummary, SyncTransport } from '../../src/utils/syncEngine';
import { CONTAINERS, DEFAULT_SCHEDULE, resolveRef, scheduleErrors as validateScheduleOf, templateToPlan, templateVersion, validateTemplatePlan, type TemplatePatch, type TemplatePlan } from './templatePlan';
import { deliverableRefusal } from './deliverableAsk';
import { eventNoonIso, taskFieldsPatch, type TaskFieldsInput } from './taskFields';
import { adoptTimeZone, DEVICE_TIME_ZONE_KEY } from './timeZone';
import { SETTINGS_SPEC } from './settingsSpec';
import { toLedgerEntries, withAgentLedger, type AgentLedgerEntry } from './agentLedger';

/** What `deleteTask` removed: the row and its checklist, as they were. */
export type DeletedTask = DeletedTaskSnapshot;

export type ReorderScope = { projectId: string } | { parentId: string } | { stackId: string } | { pinned: true };

export interface StackPatch {
  title?: string;
  notes?: string;
  tags?: string[];
  category?: string | null;
  projectId?: string | null;
  checklist?: boolean;
  hideNextStep?: boolean;
}

export interface CategorySettingsPatch {
  emoji?: string | null;
  hideOnVacation?: boolean;
  excludeFromSuggestions?: boolean;
  excludeFromNewTasksBanner?: boolean;
  defaultTimeSegments?: TimeOfDay[];
  /** Days (0 = Sunday) and "HH:MM" bounds the category is active; null removes the schedule. */
  schedule?: { days: number[]; start: string; end: string } | null;
}

export interface PlannedRow {
  name: string;
  quantity: string | null;
  aisle: string | null;
  sourceRecipeId?: string | null;
  sourceRecipeTitle?: string | null;
  choiceGroup?: string | null;
}

export interface PlannedIngredientRow {
  name: string;
  nameKey: string;
  quantity: string;
  aisle: string | null;
  category: 'needToBuy' | 'alreadyOnList' | 'inCart' | 'probablyHave' | 'staple';
  reason: string | null;
  sources: string[];
  optional: boolean;
  choiceGroup: string | null;
  sourceRecipeId: string | null;
  sourceRecipeTitle: string | null;
}

export interface PlannedAddResult {
  added: GroceryItem[];
  alreadyOnList: GroceryItem[];
  toppedUp: GroceryItem[];
  skippedInCart: GroceryItem[];
}

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
type ProduceModule = typeof import('../../src/utils/produceServings');
type RecipeProduceModule = typeof import('../../src/utils/recipeProduce');
type StandingSwapsModule = typeof import('../../src/utils/standingSwaps');
type MoodHistoryModule = typeof import('../../src/utils/moodHistory');
type MedicationModule = typeof import('../../src/utils/medicationLog');
type MedicationSettingsModule = typeof import('../../src/utils/medicationSettings');
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
  /** Weekly reward spend in minor units, which with the earning rate sets the coin-to-dollar rate. Null when unset. */
  rewardWeeklyBudgetMinor: number | null;
  /** How many coin bounties may be live at once. */
  bountyLimit: number;
  /** Days completed tasks are kept, or null for for ever. */
  completedRetentionDays: number | null;
  /**
   * Whether some device is set to write the calendar events an agent asks for
   * (`calendarRequestDeviceId`). Without one, a request would wait for ever.
   */
  calendarRequestsOn: boolean;
  /** How amounts show (asWritten, metric or us); a rain threshold reads millimetres only on metric. */
  unitSystem: 'asWritten' | 'metric' | 'us';
  /** The weather switch. Off, nothing reads a forecast, so a rain skip never fires. */
  weatherTasks: boolean;
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
  /**
   * The method. On an edit the whole list is replaced, but a step whose text
   * is unchanged keeps its identity (and so its timer, its note and the cook
   * questions filed under it).
   */
  steps?: { text: string; section?: string | null; timerSeconds?: number | null; note?: string | null }[];
  servings?: number | null;
  /** The top of a range ("serves 4-6"); null for a plain count. */
  servingsMax?: number | null;
  /** What it makes when a person-count does not fit: "3 cups", "2 dozen". */
  recipeYield?: string | null;
  estimatedMinutes?: number | null;
  prepMinutes?: number | null;
  mealType?: string | null;
  tags?: string[];
  sourceUrl?: string | null;
  /** The page in its cookbook, as printed ("142"). */
  sourcePage?: string | null;
  /** Who wrote it. Refused on a recipe in a cookbook, whose author is the book's. */
  author?: string | null;
  notes?: string;
  vote?: RecipeVote | null;
  upNext?: boolean;
  /** How many days its leftovers keep; null for the app's default. */
  leftoverKeepDays?: number | null;
  /** Other recipes used inside this one, replacing the list. Sharing a choiceGroup makes them alternatives. */
  components?: { recipeId: string; choiceGroup?: string | null }[];
  /** Tasks written ahead of a planned meal of it ("soak the beans"), replacing the list. */
  prepTasks?: { title: string; offsetDays?: number; reminderOffsetMinutes?: number | null }[];
}

/** `cookbook` on an edit moves the recipe: a title (created when new), or null to take it out of its book. */
export type RecipePatch = Partial<RecipeInput>;

/** A change to a planned meal. Only what is given changes. */
export interface MealPatch {
  date?: string;
  slot?: MealSlot;
  title?: string;
  scale?: number;
  /** A different recipe for the meal, or null for a typed meal named by `title`. */
  recipeId?: string | null;
  /** Answers to its either/or questions, by the group's label and the option's name. */
  choices?: { group: string; option: string }[];
  /** Whether it gets a "Shop for X" task, a thaw task, or the offer to log it; null hands it back to the setting. */
  shopTask?: boolean | null;
  thawTask?: boolean | null;
  logMeal?: boolean | null;
}

export interface MealChoice {
  group: string;
  options: string[];
  /** The option in force: the one picked, else one on hand, else the first. */
  chosen: string;
}

export interface MealCooking {
  entry: MealPlanEntry;
  /** Names of the packets the cooking opened. */
  opened: string[];
  /** Titles of the tasks the cooking completed. */
  tasksCompleted: string[];
}

export interface MealUncooking {
  entry: MealPlanEntry;
  tasksReopened: string[];
}

/** One line of a cookbook's index: new with `cookbookId`, or an edit with `id`. */
export interface IndexEntryInput {
  id?: string;
  cookbookId?: string;
  title: string;
  page?: string | null;
  ingredients?: string[];
}

/** A cookbook on the shelf, with how much of it the app holds. */
export interface CookbookSummary {
  id: string;
  title: string;
  author: string | null;
  recipes: number;
  indexEntries: number;
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
  /** Create the run's project in Planning. Only a run that creates a project reads it. */
  planning?: boolean;
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
  faxNumber?: string | null;
  email?: string | null;
  linkUrl?: string | null;
  /** Free text, like the app's own field; null clears it. */
  location?: string | null;
  /** The group they are listed under (a person group's id), or null for none. */
  groupId?: string | null;
  /** Filed away: kept, out of the list. */
  archived?: boolean;
  /** Never write a birthday task, or a birthday gift task, for this person. */
  birthdayTaskOptOut?: boolean;
  birthdayGiftTaskOptOut?: boolean;
}

export interface FoodPatch {
  label?: string;
  quantity?: string;
  /** Replaces every figure. Only an estimated entry has figures an agent may restate. */
  amounts?: Record<string, number>;
  slot?: MealSlot | null;
  /**
   * A new weight for an entry measured against a food record. The figures are
   * re-measured from that record (`remeasureEntry`), not scaled off the old ones.
   * On a measured entry `quantity` is re-measured the same way ("2 servings").
   */
  grams?: number;
}

/** A new amount for a copy of a measured entry. One of the two. */
export interface FoodAmount {
  grams?: number;
  quantity?: string;
}

export type MoodPatch = Partial<Pick<MoodInput, 'mood' | 'symptoms' | 'contextTags' | 'note'>>;

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
  /** "Settings › Day & time › When the day turns over › Day starts". */
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
  /** What the container is called. Two containers of one dish may share a name. */
  title?: string;
  /** When it was put away; the keep-for window moves with it. */
  storedAt?: Date;
  /** What it holds, in grams, or null for unweighed. */
  weightG?: number | null;
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
  /** The "How did it turn out?" look-back, where the answer asked for one. */
  reviewTask: Task | null;
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
  /** Start in Planning: its tasks are held off every list until it is marked ready. */
  planning?: boolean;
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
  /** Priority (0 to 4, 0 meaning deliberately none), difficulty and estimate bucket (0 to 6, 0 meaning deliberately none) new tasks start with; null clears. */
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
  /** The day (YYYY-MM-DD) a paused project comes back; its tasks are held until then. null resumes it. */
  pausedUntil?: string | null;
  /** In Planning (a pause with no day, ended by marking it ready). false marks it ready. Not with pausedUntil. */
  planning?: boolean;
  /** Work the steps in page order: Pull and auto-schedule offer only the first open one. */
  inOrder?: boolean;
  /** Never finished on its own: the last task being done doesn't offer to complete it. */
  ongoing?: boolean;
  /** People the project is with or for (list_people ids). Checked here. */
  personIds?: string[];
  /** Links kept with the project, in order. Replaces the list. */
  links?: { label?: string; url: string }[];
  /** Days of quiet before it offers its next task; 0 never offers. */
  nudgeCadenceDays?: number;
  /** Date its next task automatically when it runs dry, instead of offering it. */
  autoSchedule?: boolean;
  /** False keeps it out of every nudge, the Pull sheet included. */
  nudgeOptIn?: boolean;
  /** Somewhere the weekend nudge looks when a weekend is bare. */
  weekendSource?: boolean;
  /** On a list: checked items stay on the page instead of folding away. */
  showChecked?: boolean;
  /** Leave the "Next:" line off its card on the Projects screen. */
  hideNextStep?: boolean;
  /** Today gathers its tasks for the day under its name, at the top. */
  groupOnToday?: boolean;
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

/** What deleting a category changed, for the tool to report. */
export interface DeletedCategory {
  name: string;
  movedTo: string | null;
  tasksMoved: number;
  stacksMoved: number;
  /** The automations that filed under it and now file under `movedTo` (or nowhere). */
  automationsRepointed: string[];
  /** Whether Today's calendar-events section was filed under it. */
  calendarEventsRepointed: boolean;
}

/** One medication's limit and supply as `list_medication_logs` reports them. */
export interface MedicationSettingsView {
  name: string;
  /** "At least 6 hours apart, at most 3 in 24 hours", the person's own limit. */
  limit?: string;
  dosesInLast24h?: number;
  /** When the next dose is within the limit, if it isn't now. */
  withinLimitAgainAt?: string;
  /** "9 doses left". */
  supplyLeft?: string;
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
  /**
   * The tasks this one still waits on: the blockers that can still hold it
   * (`liveBlockersOf`), so a finished, archived or deleted one is not named.
   * The answer-gate question that read also lists is left out, since the
   * tools report it on its own (`onlyIfAnswer`).
   */
  liveBlockers(task: Task): Task[];
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
  /**
   * A task's window as clock times today, with a bound that follows the sun
   * resolved for today (see Task.windowStartSun). The stored clock fields hold
   * only the time an anchor resolved to when it was set.
   */
  windowToday(task: Task): { start: string | null; end: string | null };
  /**
   * The "HH:MM" a sun anchor comes to on a task's day (its due date, else
   * today), at the trip's destination on a trip day and home otherwise; null
   * with no location saved, or on a day the sun doesn't rise or set.
   */
  sunAnchorClock(anchor: string, dueDate: string | null): string | null;
  /** Shifts a day key by whole days. Used to default a range to "the last N days". */
  shiftDayKey(key: string, days: number): string;

  /** Food log entries between two day keys, inclusive. */
  foodLogEntries(fromDayKey: string, toDayKey: string): FoodLogEntry[];
  /** Summed nutrients over a set of entries. A nutrient nobody stated is absent, never 0. */
  foodTotals(entries: readonly FoodLogEntry[]): FoodLogTotals;
  /**
   * Vegetable and fruit servings per day over a set of entries (`dayProduce`),
   * oldest day first, one row per day that has an entry. Here
   * rather than in `tools.ts` because weighing a recipe entry walks the recipe
   * and the catalog, which reaches the app's settings store and so the
   * database. The person's standing swaps are applied to a recipe's lines, as
   * the app's own screens do.
   */
  foodProduce(entries: readonly FoodLogEntry[]): ({ dayKey: string } & DayProduce)[];

  /** Mood check-ins between two day keys, inclusive. */
  moodLogs(fromDayKey: string, toDayKey: string): MoodLog[];

  /** Doses between two day keys, inclusive. */
  medicationLogs(fromDayKey: string, toDayKey: string): MedicationLog[];
  /** "Ibuprofen · 400 mg · as needed", the app's own one-line rendering of a dose. */
  medicationSummary(log: MedicationLog): string;
  /**
   * The limit and supply the person set per medication, read the app's way:
   * where each one stands against its limit now, and what's left of its
   * supply (derived from the doses, never stored as a running number).
   */
  medicationSettings(): MedicationSettingsView[];

  /** Every stored template, for listing and for resolving a nested reference. */
  templates(): TaskTemplate[];

  /** See `ReplicaSettings`. Read fresh from the settings store, so it follows a sync. */
  settings(): ReplicaSettings;
  /** Every setting `SETTINGS_SPEC` names, as stored now. */
  settingValues(): Record<string, unknown>;
  /** Change settings through `SETTINGS_SPEC`'s checks and the store's setters. All are checked before any is written. */
  applySettings(changes: Record<string, unknown>): { key: string; before: unknown; after: unknown }[];
  /**
   * The app's own look-ahead (`buildLookAhead`) from the start of the logical
   * today across `days` days: per-day rows, projected recurring occurrences,
   * each day's load, what is carried over, and deadlines that will not fit.
   */
  lookAhead(days: number): LookAhead;
  /** The logical day an instant falls on, under the user's `dayResetTime`. */
  logicalDayKeyOf(iso: string): string;
  /**
   * The calendar day an instant falls on, for a date the app anchors to a
   * day's own start (`dueDate`, `deadline`, `deferUntil`): the app's own
   * `dayKeyOf`, so a date at local midnight is neither the day before under a
   * late `dayResetTime` nor the UTC date cut off the string.
   */
  dayKeyOf(iso: string): string;
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
  /** Every meter reading, oldest first. See src/utils/meters.ts. */
  meterReadings(): MeterReading[];
  /**
   * Through `useMeterReadingStore`'s own action, so a blank name or a reading
   * that isn't a number is refused as the app refuses it. The tasks on that
   * meter are held or released by the phone's own pass on its next sync.
   */
  logMeterReading(name: string, value: number, readAt: Date): MeterReading;
  deleteMeterReading(id: string): MeterReading;
  /** Journal and dream entries between two day keys, inclusive, newest first. */
  journalEntries(fromDayKey: string, toDayKey: string, kind?: JournalKind): JournalEntry[];
  /**
   * Journal and dream entries through `useJournalStore`'s own actions: blank
   * text is refused as the sheet refuses it, and an entry's day is fixed once
   * written, as in the app.
   */
  addJournalEntry(kind: JournalKind, text: string, at?: Date): JournalEntry;
  updateJournalEntry(id: string, text: string): JournalEntry;
  deleteJournalEntry(id: string): JournalEntry;
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
  /** Change a view's name, icon or clauses (already checked), and optionally move it to a place in the list (0 is first). */
  updateSavedView(id: string, patch: { name?: string; icon?: string; clauses?: SavedViewClause[] }, position?: number): SavedView;
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
  /** Every cookbook, with how many recipes and index lines it holds. */
  cookbookSummaries(): CookbookSummary[];
  /** One cookbook's index lines. */
  cookbookIndex(cookbookId: string): CookbookIndexEntry[];
  /**
   * Rename a cookbook, or change its author, through the store's
   * `renameCookbook`: every recipe in it takes the new title and author.
   * Refused when another book already has that title and author.
   */
  renameCookbook(id: string, title: string, author?: string | null): Cookbook;
  /** Two copies of one book made one, through `mergeCookbooks`: the loser's recipes and index move to the survivor. */
  mergeCookbooks(survivorId: string, loserId: string): { survivor: Cookbook; merged: Cookbook; recipesMoved: number };
  /**
   * Delete a cookbook through the store's `deleteCookbook`: its recipes are
   * unlinked rather than deleted, keeping the title and author mirrored onto
   * them, and its index lines go with it.
   */
  deleteCookbook(id: string): { cookbook: Cookbook; recipesUnlinked: number; indexEntries: number };
  /** Add or change a cookbook index line. Refused when that book's index already lists the dish. */
  saveIndexEntry(input: IndexEntryInput): CookbookIndexEntry;
  deleteIndexEntry(id: string): CookbookIndexEntry;
  /** The recipe for an index line: the one already in that book under that name, or a new one with the book and page. */
  recipeFromIndexEntry(id: string): { recipe: Recipe; created: boolean };
  /** Put the Up next shelf in this order. Recipes left out follow, in their order. */
  reorderUpNext(ids: string[]): Recipe[];
  /** A cook time timed on the person's own clock, logged as the cook timer's stop logs one. */
  logCookTime(id: string, minutes: number): Recipe;
  /**
   * A food entry with an estimated panel, through `readNutritionEstimate`,
   * `estimateToPanel` and `buildFoodLogEntry`. Marked estimated for good, and
   * flagged `healthWritePending`: this process has no HealthKit, so the phone
   * writes it to Apple Health on its next foreground.
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
  /**
   * Move a food entry to another moment, as the app's `moveEntry`: the old row
   * goes and a new one is written at the new instant (the day it counts on is
   * stamped from the instant, so it is never patched in place). Refused once
   * the entry is in Apple Health, whose sample only the phone can retract, and
   * for a water entry, which `logWater` steps a day at a time.
   */
  moveFoodEntry(id: string, at: Date): { from: FoodLogEntry; to: FoodLogEntry };
  /** Log a copy of an entry at another moment, as `duplicateEntry`: a new meal, not tied to a planned one. */
  duplicateFoodEntry(id: string, at: Date, amount?: FoodAmount): FoodLogEntry;
  /** Saved meals: several foods logged together under a name, newest first. */
  savedMeals(): SavedMeal[];
  /** A saved meal from logged entries, as the bulk bar's "Save as meal". */
  saveMealFromEntries(name: string, entryIds: string[]): SavedMeal;
  /** Log every food in a saved meal at one moment and meal, as tapping it in the food log does. */
  logSavedMeal(id: string, slot: MealSlot | null, at: Date): FoodLogEntry[];
  deleteSavedMeal(id: string): SavedMeal;
  /** The daily figures the food log's totals are read against, as the person set them. */
  nutritionTargets(): Partial<Record<NutrientKey, number>>;
  /** The nutrients whose target is a Stay under limit. */
  nutritionLimits(): NutrientKey[];
  /** Set or clear (null) targets, through the settings store's own setter. Each is checked against the Settings stepper's range. */
  setNutritionTargets(changes: Partial<Record<NutrientKey, number | null>>): Partial<Record<NutrientKey, number>>;
  updateMoodLog(id: string, patch: MoodPatch): MoodLog;
  deleteMoodLog(id: string): MoodLog;
  updateMedicationLog(id: string, patch: DosePatch): MedicationLog;
  /** Move a medicine out of "what you take", or back. Deletes no doses. Returns the name as the log spells it. */
  setMedicationArchived(name: string, archived: boolean): string;
  /** Correct a mood context tag's text on every check-in that has it, as the app's rename does. Returns how many changed. */
  renameMoodTag(from: string, to: string): number;
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
  /**
   * Ask the phone to change, or delete, an event an earlier request of this
   * server's wrote (`CalendarRequest.action`). Only that event: a request names
   * the one it changes, and nothing else on the calendar is reachable.
   */
  requestCalendarChange(targetId: string, change: { delete: true } | { changes: CalendarRequestChanges }): CalendarRequest;
  /** Every automation rule list, as the settings store holds it. */
  ruleLists(): RuleLists;
  /** Replace one rule list through the settings store's own setter. The list must already be normalized. */
  setRuleList<T extends RuleListType>(type: T, rules: RuleLists[T]): void;
  /** Whether an automation is on, by its settings key (`GeneratedKindSpec.enabledKey`). */
  generatorEnabled(key: string): boolean;
  setGeneratorEnabled(key: string, on: boolean): void;
  /** The category a generator files its tasks under, by name, or null for none (`GeneratedKindSpec.kind`). */
  generatorCategory(kind: GeneratedKind): string | null;
  /**
   * Point a generator's "File them under" setting at a category, or at none.
   * The same stored answer the Settings row writes, so startup leaves it alone.
   * The name is not checked here; the tool refuses one that isn't a category.
   */
  setGeneratorCategory(kind: GeneratedKind, category: string | null): void;
  /**
   * Delete a category: its tasks and stacks move to `moveTo` (or become
   * uncategorized), every setting that filed something under it is re-pointed
   * there too, and the row goes. The app's own delete, minus its shake-to-undo,
   * and covering every generator's category setting rather than four of them.
   */
  deleteCategory(name: string, moveTo: string | null): DeletedCategory;
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
   * `archiveTask` / `unarchiveTask` do. `deleteTask` is the other way off every
   * list; an archive is the one that keeps the row.
   *
   * Archiving unpins. Restoring breaks the streak (the gap is real) and folds
   * the run into `priorBestStreak`, as the app's resume does. A subtask is
   * refused: it goes with its parent.
   */
  setTaskArchived(id: string, archived: boolean): Task;
  /**
   * Delete a task with its checklist, or one checklist item, as the app's
   * delete does. What was deleted comes back, so the ledger can keep it for a
   * restore from Activity. A task the app generated is refused: deleting one in
   * the app also tells its source not to make it again, which writes to rows
   * this server cannot reach, and without that the phone would just recreate
   * it. Deleting a timed stretch re-totals its parent's countdown.
   */
  deleteTask(id: string): DeletedTask;
  /** Roll a repeating task onto its next occurrence with no completion: the app's "Skip" (`skipPatch`). */
  skipOccurrence(id: string): Task;
  /**
   * Hand-order one list: a project's open steps (their slots in the one
   * sortOrder space, `slotUpdates`), a task's checklist, or the Pinned block.
   * The named rows go first in the order given and the rest keep their order
   * after them. Returns the rows whose position changed, before and after.
   */
  reorderTasks(scope: ReorderScope, ids: string[]): { before: Task; after: Task }[];
  /**
   * Give a task a set of dates, or take it back to one, through the rules the
   * editor's dates row uses (`taskDates.ts`). A set never repeats by rule, so
   * forming one drops the task's repeat. `monthly` makes the set come round
   * again each month on the same days.
   */
  setTaskDates(id: string, dates: Date[], monthly: boolean): { task: Task; added: Task[]; removed: Task[] };
  /** A copy of a task and its checklist, as the app's Duplicate makes one (`duplicateRows`). */
  duplicateTask(id: string): Task;
  /** Take a tag off every task and out of the tag list. Returns each task it changed, before and after. */
  deleteTag(tag: string): { before: Task; after: Task }[];
  /** Correct when a completed task was done, as the Logbook's date edit does. */
  setCompletedAt(id: string, at: Date): Task;
  /** The tag list as the app keeps it: every tag in use and every one registered. */
  tagList(): string[];

  /**
   * A recipe's ingredients (scaled), or every planned meal's in a day range,
   * classified against a list the way the app's two add-to-list sheets
   * classify them (`classifyPlanned`): need to buy, already on the list, in
   * the cart, probably have, staple.
   */
  plannedIngredients(source: { recipeId: string; scale?: number } | { from: string; to: string }, listId: string | null): PlannedIngredientRow[];
  /** Put planned rows on a list, as the app's `addFromPlan`: in the cart is skipped, on the list is topped up. */
  addPlannedToList(rows: PlannedRow[], listId: string | null): PlannedAddResult;
  /** Put an either/or on a list: each option is a row, and ticking one takes the rest off. */
  addChoiceToList(options: { name: string; quantity?: string | null }[], listId: string | null): GroceryItem[];
  /** Decide an either/or for the option given (`resolveChoice`), or end the choice and keep every option (`clearChoice`). */
  settleChoice(itemId: string, listId: string | null, keepAll: boolean): { kept: GroceryItem[]; removed: GroceryItem[] };
  /** Swap a row on a list for one of its substitutes, as the app's swap does. */
  swapForSubstitute(itemId: string, subItemId: string, listId: string | null): { removed: GroceryItem; added: GroceryItem };
  /** Empty a list, as the app's Clear list: rows with nothing worth keeping are deleted, the rest stay in the catalog. Ends the trip. */
  clearGroceryList(listId: string | null): { cleared: number; deleted: string[] };
  /** Start a shopping trip at a store (optionally with a budget in minor units), change its budget, or end it. */
  setTrip(change: { shopId: string; budgetMinor?: number | null } | { budgetMinor: number | null } | { end: true }): { shop: Shop | null; startedAt: string | null; budgetMinor: number | null };
  /** Mark an item (or just its preferred brand) unavailable at a store, or the brand available again. */
  setItemUnavailable(itemId: string, shopId: string, unavailable: boolean, brandOnly: boolean): void;
  /** An item's nutrition panel, or a box's. null removes it. */
  setNutritionPanel(itemId: string, boxId: string | null, panel: FoodNutrition | null): void;
  /** Add, rename or delete an aisle, or mark it non-food, as the aisle editor does. */
  saveAisle(name: string, change: { newName?: string; delete?: boolean; nonFood?: boolean }): { aisle: string | null; itemsMoved: number };
  /** The aisles in walk order: the named first, the rest after, Other last. */
  reorderAisles(names: string[]): string[];
  /** Delete a store, with its links and receipt names. Ends the trip if it was there. */
  deleteShop(id: string): Shop;
  /** A store's own settings: left out of suggestions, which aisles it has, and its own walk order. */
  updateShopSettings(id: string, patch: { excludeFromSuggestions?: boolean; aisles?: string[] | null; aisleOrder?: string[] | null }): Shop;
  reorderShops(ids: string[]): void;
  reorderGroceryLists(ids: string[]): void;
  /** Merge one item into another, as the app's merge (`planMergeItems`). */
  mergeGroceryItems(fromId: string, intoId: string): { merged: GroceryItem; from: GroceryItem };

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
  /**
   * Half a container moved across the freezer line, as the leftover sheet's
   * Split: a second container of the same dish, put away when the first was,
   * on the other side. The original is untouched. Refused for a finished one.
   */
  splitLeftover(id: string): { original: Leftover; split: Leftover };
  /**
   * Delete a leftover outright (one logged by mistake; finishing it is the
   * ordinary way out). Planned meals eating from it keep their title. Its
   * use-up task goes when the phone next reconciles them.
   */
  deleteLeftover(id: string): Leftover;
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
  /** Aisles marked non-food. */
  nonFoodAisles(): string[];
  /** The shopping trip in progress, while it is live (`resolveActiveTrip`), or null. */
  activeTrip(): { shop: Shop; startedAt: string; budgetMinor: number | null } | null;
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
  createStack(title: string, category: string | null, projectId?: string | null): TaskGroup;
  /** Rename a stack. Its category and members are untouched. */
  renameStack(id: string, title: string): TaskGroup;
  /**
   * Change a stack as its editor does. A new category re-files every live
   * member with it, as the editor's save does (`applyGroupCategory`): the stack
   * owns its members' category. `projectId` is only which project page shows
   * it as a section; members keep their own projects.
   */
  updateStack(id: string, patch: StackPatch): { stack: TaskGroup; moved: { before: Task; after: Task }[] };
  /**
   * Delete a stack, as the app's `deleteGroup`: its live members are taken out
   * of it, or with `cascade` deleted (a dated set's other dates with them), and
   * its finished occurrences are only taken out, since they are history. A
   * member the app generated is taken out rather than deleted, for the reason
   * `deleteTask` gives.
   */
  deleteStack(id: string, cascade: boolean): DeletedStackSnapshot;
  /** Rename a task category everywhere it is named, as the app's rename does. */
  renameCategory(name: string, newName: string): { from: string; to: string };
  /** A task category's own settings: emoji, schedule, vacation, suggestions, default time of day. */
  updateCategorySettings(name: string, patch: CategorySettingsPatch): Category;
  /** Put the categories (Today's sections) in this order: the named first, the rest after in their order. */
  reorderCategories(names: string[]): string[];
  /**
   * Delete a project, as the app's `deleteProject`: its tasks are unfiled, or
   * with `cascade` deleted (a task the app generated is unfiled instead), and
   * the stacks homed on it are unfiled. What it took comes back for the ledger.
   */
  deleteProject(id: string, cascade: boolean): DeletedProjectSnapshot;
  /** The project categories (sections of the Projects screen), in order. */
  projectCategories(): { id: string; name: string; sortOrder: number }[];
  /** Add, rename or delete a project category. Deleting leaves its projects with none. */
  saveProjectCategory(name: string, change: { newName?: string; delete?: boolean }): { name: string | null; projectsAffected: number };
  /** Projects in this order (the named first), and optionally the project categories too. */
  reorderProjects(ids: string[], categories?: string[]): void;
  /** A new project with this one's tasks and sections, every date cleared and every task open: the app's Start fresh. */
  startFreshProject(id: string): { project: Project; tasks: Task[] };
  /** A template that recreates this project, as the app's Save as template (`templateFromProject`). */
  saveProjectAsTemplate(id: string, name?: string): TaskTemplate;
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
  addReward(title: string, cost: number, details: { linkUrl?: string | null; note?: string | null; oneTime?: boolean; priceMinor?: number | null }): Reward;
  /** Change a reward's cost, or its title, link, note or one-time flag. A wish-list reward is refused: its title, note and link live on the list item. */
  updateReward(id: string, patch: { title?: string; cost?: number; linkUrl?: string | null; note?: string | null; oneTime?: boolean; priceMinor?: number | null }): Reward;
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
   * Close a task as done by somebody else: `completeTask` with `byOther: true`.
   * The occurrence is completed and any next one created, but it earns no coins,
   * the streak neither advances nor breaks, and no dose is logged. Works on a
   * one-off too. `reopenTask` undoes it. No answer is asked for: nobody here did
   * the thing the question is about.
   */
  markDoneByOther(id: string): CompletedResult;
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
  planMeal(draft: { date: string; slot: MealSlot; title?: string; recipeId?: string | null; leftoverId?: string | null }): MealPlanEntry;
  /**
   * Move a planned meal to another day or slot, rename a free-text one, or set a
   * recipe's scale. A recipe- or leftover-backed meal's title says what backs it
   * and is not renamed, as in the app. Marking a meal cooked is not here: that
   * also opens pantry items and ticks the cook task, which the phone does.
   * The slot's task and calendar event catch up on the phone, as for `planMeal`.
   */
  updateMeal(id: string, patch: MealPatch): MealPlanEntry;
  /** Remove a planned meal. A cooked meal is refused: it is history and feeds the cooking stats. */
  removeMeal(id: string): MealPlanEntry;
  /**
   * Mark a planned meal cooked, or not, as the plan's checkbox does: see
   * `cookMeal` and `uncookMeal`. Refused when it is already that way.
   */
  setMealCooked(id: string, cooked: boolean): MealCooking | MealUncooking;
  /**
   * A typed meal saved as a recipe, as the meal sheet's "Save as recipe": the
   * recipe already called that, or a new empty one, and the meal pointed at it.
   */
  saveMealAsRecipe(id: string): { recipe: Recipe; created: boolean; entry: MealPlanEntry };
  /**
   * The meal plan's three copies, through `weekCopyDrafts`, `slotCopyDrafts`
   * and `mealCopyDraft`: what a copy carries is theirs to say (a leftover night
   * never copies). A week copies only into a week with nothing planned, and a
   * slot only into a week with nothing in that slot, the rule the app's offers
   * keep (`slotsToCopy`), so a copy never has to ask how to merge. Weeks are
   * named by any day in them.
   */
  copyMealWeek(fromDay: string, toDay: string, slot?: MealSlot): MealPlanEntry[];
  /** One meal on other days too, in its slot. A day already holding it is skipped and named. */
  copyMealTo(id: string, dates: string[]): { copied: MealPlanEntry[]; skipped: string[] };
  /** A planned meal's either/or questions ("Side": mash or roast), and which option is in force. */
  mealChoices(entry: MealPlanEntry): MealChoice[];

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
  /**
   * Delete a person, as the app's delete: the notes written about them go with
   * them (they are about somebody and mean nothing without them), and tasks
   * naming them are kept. What it took comes back for the ledger.
   */
  deletePerson(id: string): { person: Person; notes: PersonNote[] };
  /** Put people in this order: the named first, the rest after in their order. */
  reorderPeople(ids: string[]): void;
  /** Add, rename or delete a person group, or set whether its members are caught up with one at a time. */
  savePersonGroup(name: string, change: { newName?: string; delete?: boolean; catchUpSeparately?: boolean }): { group: PersonGroup | null; members: number };
  /** A note, a gift idea or a food note about someone, through `usePersonNoteStore.addNote`. */
  addPersonNote(personId: string, kind: PersonNote['kind'], text: string, relevantOn?: string | null): PersonNote;
  updatePersonNote(id: string, patch: { text?: string; kind?: PersonNote['kind']; relevantOn?: string | null; archived?: boolean }): PersonNote;
  deletePersonNote(id: string): PersonNote;

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
  const produce = require('../../src/utils/produceServings') as ProduceModule;
  const recipeProduce = require('../../src/utils/recipeProduce') as RecipeProduceModule;
  const standingSwaps = require('../../src/utils/standingSwaps') as StandingSwapsModule;
  const moodHistory = require('../../src/utils/moodHistory') as MoodHistoryModule;
  const medication = require('../../src/utils/medicationLog') as MedicationModule;
  const medicationSettings = require('../../src/utils/medicationSettings') as MedicationSettingsModule;
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
  const taskSkip = require('../../src/utils/taskSkip') as typeof import('../../src/utils/taskSkip');
  const taskDates = require('../../src/utils/taskDates') as typeof import('../../src/utils/taskDates');
  const taskDuplicate = require('../../src/utils/taskDuplicate') as typeof import('../../src/utils/taskDuplicate');
  const timerSegments = require('../../src/utils/timerSegments') as typeof import('../../src/utils/timerSegments');
  const projectOrder = require('../../src/utils/projectOrder') as typeof import('../../src/utils/projectOrder');
  const projectPause = require('../../src/utils/projectPause') as typeof import('../../src/utils/projectPause');
  const { generateId } = require('../../src/utils/id') as IdModule;
  const { reopenedTask } = require('../../src/utils/taskReopen') as typeof import('../../src/utils/taskReopen');
  const { generatedSourceOf, liveGeneratedTask } = require('../../src/utils/generatedTasks') as typeof import('../../src/utils/generatedTasks');
  const { completesMealSlot, mealSlotSourceId, parseMealSlotSource } = require('../../src/utils/mealSlotTasks') as typeof import('../../src/utils/mealSlotTasks');
  const mealPlanGroceries = require('../../src/utils/mealPlanGroceries') as typeof import('../../src/utils/mealPlanGroceries');

  /** See Replica.sunAnchorClock. One copy, for the patch and the quick-add reader both. */
  const sunAnchorClock = (anchor: string, dueDate: string | null): string | null => {
    const dayStart = dueDate ? dates.getTaskDayStart(new Date(dueDate)) : dates.getCurrentDayStart();
    return sunAnchorHHMM(anchor, dayStart, visibility.sunLocationOn(dayStart));
  };

  // ---- recipes ------------------------------------------------------------

  // ---- the food log -------------------------------------------------------

  /**
   * A food entry built by `buildFoodLogEntry`, the app's own row and refusals,
   * and inserted flagged `healthWritePending`: this process has no HealthKit,
   * so the phone writes it to Apple Health on its next foreground, if Health
   * writing is on there.
   */
  function buildFood(draft: Parameters<typeof import('../../src/utils/foodLogEntry').buildFoodLogEntry>[0]): FoodLogEntry | null {
    const builder = require('../../src/utils/foodLogEntry') as typeof import('../../src/utils/foodLogEntry'); // eslint-disable-line @typescript-eslint/no-require-imports
    const entry = builder.buildFoodLogEntry(draft, dayKey => db.dbGetFoodLogEntries(dayKey, dayKey), generateId);
    if (!entry) return null;
    const flagged = { ...entry, healthWritePending: true };
    db.dbInsertFoodLogEntry(flagged);
    return flagged;
  }

  /** The amount text a grams or quantity asks for, as the app's amount field would hold it. */
  function foodAmountText(a: { grams?: number; quantity?: string }): string {
    if (a.grams !== undefined && a.quantity !== undefined) throw new Error('Give a new amount as grams or as quantity, one of the two.');
    if (a.grams !== undefined) {
      if (!Number.isFinite(a.grams) || a.grams <= 0) throw new Error('grams is a positive number.');
      return `${a.grams} g`;
    }
    return a.quantity ?? '';
  }

  /**
   * The fields `entry` takes at a new amount, re-measured against its food
   * record by `remeasureEntry` (the arithmetic the app's Edit runs). The linked
   * row's panel is read here because the catalog is: a product's own panel when
   * the entry names one, else the item's.
   */
  function remeasuredFields(entry: FoodLogEntry, amount: string): Pick<FoodLogEntry, 'quantity' | 'grams' | 'nutrition' | 'sourcePanel'> {
    const { nutritionFor } = require('../../src/utils/foodNutrition') as typeof import('../../src/utils/foodNutrition'); // eslint-disable-line @typescript-eslint/no-require-imports
    let linkedPanel: import('../../src/types').FoodNutrition | null = null;
    if (entry.productId) linkedPanel = db.dbGetAllItemProducts().find(p => p.id === entry.productId)?.nutrition ?? null;
    else if (entry.itemId) linkedPanel = nutritionFor(db.dbGetAllGroceryItems().find(i => i.id === entry.itemId));
    const result = foodLog.remeasureEntry(entry, linkedPanel, amount);
    if (!result.ok) throw new Error(result.reason);
    return result.fields;
  }

  /** An entry that can be moved or copied: not water, which is one entry a day stepped up a glass at a time. */
  function foodEntryToCopy(id: string): FoodLogEntry {
    const water = require('../../src/utils/waterLog') as typeof import('../../src/utils/waterLog'); // eslint-disable-line @typescript-eslint/no-require-imports
    const entry = db.dbGetFoodLogEntry(id);
    if (!entry) throw new Error(`No food entry with id ${id}.`);
    if (water.isWaterEntry(entry)) throw new Error('Water is one entry a day, stepped up a glass at a time. Use log_water for the other day instead.');
    return entry;
  }

  /** The same food at another moment, the draft `moveEntry` and `duplicateEntry` build. */
  function insertFoodCopy(e: FoodLogEntry, at: Date, slot: MealSlot | null, mealPlanEntryId: string | null): FoodLogEntry {
    const entry = buildFood({
      label: e.label,
      quantity: e.quantity,
      grams: e.grams,
      nutrition: e.nutrition,
      sourcePanel: e.sourcePanel ?? null,
      slot,
      recipeId: e.recipeId,
      itemId: e.itemId,
      productId: e.productId,
      mealPlanEntryId,
      at,
    });
    if (!entry) throw new Error('That entry could not be logged again.');
    return entry;
  }

  /**
   * A generated task the app takes back, as `dropGeneratedTask` does on the
   * phone: the live row and its subtasks deleted, with no opt-out written,
   * since the reason it goes (a container finished) is not the person saying
   * never.
   */
  function dropGeneratedRow(kind: import('../../src/types').GeneratedKind, sourceId: string): void {
    const live = liveGeneratedTask(db.dbGetAllTasks(), kind, sourceId);
    if (!live) return;
    db.dbDeleteSubtasks(live.id);
    db.dbDeleteTask(live.id);
  }

  function mealLogUtils() {
    return require('../../src/utils/mealLog') as typeof import('../../src/utils/mealLog'); // eslint-disable-line @typescript-eslint/no-require-imports
  }

  /** The recipe tree's choice rules, loaded when a meal's choices are read or answered. */
  function components() {
    return require('../../src/utils/recipeComponents') as typeof import('../../src/utils/recipeComponents'); // eslint-disable-line @typescript-eslint/no-require-imports
  }

  /** A copied meal as the store's `copyRow` writes it: its own id, and never the source's calendar event. */
  function copiedMeal(draft: import('../../src/utils/mealPlan').MealCopyDraft): MealPlanEntry {
    return { ...draft, id: generateId(), createdAt: new Date().toISOString(), calendarEventId: null, calendarEventExternalId: null };
  }

  /** The recipe store, loaded and current. Loaded lazily: only the recipe writes read it. */
  function recipeStore() {
    const { useRecipeStore } = require('../../src/store/useRecipeStore') as typeof import('../../src/store/useRecipeStore'); // eslint-disable-line @typescript-eslint/no-require-imports
    useRecipeStore.getState().initialize();
    return useRecipeStore;
  }

  /**
   * A cookbook by title, ignoring case, whoever wrote it. The store's own
   * `ensureCookbook` keys on title and author together, so given only a title
   * it would make a second copy of a book that has an author.
   */
  function findCookbook(title: string): Cookbook | null {
    const wanted = title.trim().toLowerCase();
    return db.dbGetAllCookbooks().find(c => c.title.trim().toLowerCase() === wanted) ?? null;
  }

  /**
   * Every refusal a recipe write can make, before it makes any: so a bad
   * component or step timer refuses the call rather than leaving half of it
   * written. `recipe` is null for a new one; `inBook` is whether it will be in
   * a cookbook once the write lands.
   */
  function checkRecipeFields(recipe: Recipe | null, f: RecipePatch, inBook: boolean): void {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const lib = {
      stepTimers: require('../../src/utils/stepTimers') as typeof import('../../src/utils/stepTimers'),
      recipeUtils: require('../../src/utils/recipeUtils') as typeof import('../../src/utils/recipeUtils'),
      components: require('../../src/utils/recipeComponents') as typeof import('../../src/utils/recipeComponents'),
      types: require('../../src/types') as typeof import('../../src/types'),
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
    const whole = (name: string, v: number | null | undefined, lo: number, hi: number) => {
      if (v != null && (!Number.isInteger(v) || v < lo || v > hi)) throw new Error(`${name} must be a whole number from ${lo} to ${hi}, or null.`);
    };
    whole('servings', f.servings, 1, 99);
    whole('servingsMax', f.servingsMax, 1, 99);
    const servings = f.servings !== undefined ? f.servings : recipe?.servings ?? null;
    if (f.servingsMax != null && (servings == null || f.servingsMax <= servings)) {
      throw new Error('servingsMax is the top of a range, so it has to be more than servings.');
    }
    whole('leftoverKeepDays', f.leftoverKeepDays, lib.types.LEFTOVER_KEEP_DAYS_MIN, lib.types.LEFTOVER_KEEP_DAYS_MAX);
    if (f.sourcePage != null && f.sourcePage.trim().length > lib.types.RECIPE_PAGE_MAX_LENGTH) {
      throw new Error(`A page is at most ${lib.types.RECIPE_PAGE_MAX_LENGTH} characters, as printed ("142", "112-115").`);
    }
    if (f.author !== undefined && inBook) {
      throw new Error('A recipe in a cookbook takes its author from the book. rename_cookbook changes the book\'s author for every recipe in it.');
    }
    for (const step of f.steps ?? []) {
      const t = step.timerSeconds;
      if (t != null && (!Number.isInteger(t) || t < lib.stepTimers.MIN_STEP_TIMER_SECONDS || t > lib.stepTimers.MAX_STEP_TIMER_SECONDS)) {
        throw new Error(`A step timer is a whole number of seconds from ${lib.stepTimers.MIN_STEP_TIMER_SECONDS} to ${lib.stepTimers.MAX_STEP_TIMER_SECONDS}.`);
      }
      if (step.note != null && step.note.trim().length > lib.types.RECIPE_STEP_NOTE_MAX_LENGTH) {
        throw new Error(`A step note is at most ${lib.types.RECIPE_STEP_NOTE_MAX_LENGTH} characters.`);
      }
    }
    for (const p of f.prepTasks ?? []) {
      if (!p.title.trim()) throw new Error('A prep task needs a title.');
      whole('A prep task\'s offsetDays', p.offsetDays, lib.recipeUtils.PREP_OFFSET_MIN, lib.recipeUtils.PREP_OFFSET_MAX);
      whole('A prep task\'s reminderOffsetMinutes', p.reminderOffsetMinutes, 0, 1440);
    }
    if (f.components) {
      const recipes = db.dbGetAllRecipes();
      const byId = new Map(recipes.map(r => [r.id, r]));
      const seen = new Set<string>();
      for (const c of f.components) {
        if (!byId.has(c.recipeId)) throw new Error(`No recipe with id ${c.recipeId} to use inside this one.`);
        if (recipe && c.recipeId === recipe.id) throw new Error('A recipe cannot use itself.');
        if (seen.has(c.recipeId)) throw new Error(`${byId.get(c.recipeId)!.name} is named twice.`);
        seen.add(c.recipeId);
        if (recipe && lib.components.wouldCreateRecipeCycle(lib.components.recipeMap(recipes), recipe.id, c.recipeId)) {
          throw new Error(`${byId.get(c.recipeId)!.name} already uses ${recipe.name}, so it cannot also be used inside it.`);
        }
      }
    }
  }

  /**
   * The fields of a recipe write past its name and book, through the store's
   * own setters (already checked by `checkRecipeFields`). Runs inside the
   * caller's transaction.
   */
  function writeRecipeFields(id: string, f: RecipePatch): void {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { useRecipeStore } = require('../../src/store/useRecipeStore') as typeof import('../../src/store/useRecipeStore');
    const recipeUtils = require('../../src/utils/recipeUtils') as typeof import('../../src/utils/recipeUtils');
    const { generateId } = require('../../src/utils/id') as typeof import('../../src/utils/id');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const store = () => useRecipeStore.getState();
    const current = () => store().recipes.find(r => r.id === id)!;

    if (f.servings !== undefined || f.servingsMax !== undefined) {
      store().setServings(id, f.servings !== undefined ? f.servings : current().servings, f.servingsMax !== undefined ? f.servingsMax : current().servingsMax);
    }
    if (f.recipeYield !== undefined) store().setRecipeYield(id, f.recipeYield);
    if (f.estimatedMinutes !== undefined) store().setEstimatedMinutes(id, f.estimatedMinutes);
    if (f.prepMinutes !== undefined) store().setPrepMinutes(id, f.prepMinutes);
    if (f.mealType !== undefined) store().setMealType(id, (f.mealType ?? null) as Recipe['mealType']);
    if (f.tags !== undefined) store().setTags(id, f.tags);
    if (f.sourceUrl !== undefined) store().setSourceUrl(id, f.sourceUrl);
    // After any move, which clears a page that belonged to the old book.
    if (f.sourcePage !== undefined) store().setSourcePage(id, f.sourcePage);
    if (f.author !== undefined) store().setAuthor(id, f.author);
    if (f.notes !== undefined) store().setNotes(id, f.notes);
    if (f.vote !== undefined) store().setVote(id, f.vote);
    if (f.upNext !== undefined) store().setUpNext(id, f.upNext);
    if (f.leftoverKeepDays !== undefined) store().setLeftoverKeepDays(id, f.leftoverKeepDays);
    if (f.ingredients !== undefined) {
      const made = f.ingredients
        .map(line => {
          const m = recipeUtils.makeIngredient(line.text, line.section?.trim() || null);
          return m ? { ...m, choiceGroup: recipeUtils.cleanChoiceGroup(line.alternativeGroup) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      store().bulkRemoveIngredients(id, current().ingredients.map(i => i.id));
      if (made.length > 0) store().addStructuredIngredients(id, made);
    }
    if (f.steps !== undefined) {
      // A step whose text is unchanged keeps its id, so a cook question filed
      // under it (`CookQuestion.stepId`) and its timer and note survive an edit
      // that only touched the steps around it. The rest are new.
      const old = [...current().steps];
      const kept = f.steps.map(step => {
        const text = step.text.trim();
        const i = old.findIndex(o => o.text === text);
        return i >= 0 ? old.splice(i, 1)[0] : null;
      });
      const steps = f.steps.flatMap((step, i) => {
        const text = step.text.trim();
        if (!text) return [];
        const section = step.section?.trim() || null;
        const base = kept[i] ?? { id: generateId(), text };
        const { section: _section, ...rest } = base;
        return [section ? { ...rest, section } : rest];
      });
      db.dbUpdateRecipe({ ...current(), steps });
      store().initialize();
      f.steps.forEach((step, i) => {
        const stepId = steps[i]?.id;
        if (!stepId) return;
        if (step.timerSeconds !== undefined) store().setStepTimerSeconds(id, stepId, step.timerSeconds);
        if (step.note !== undefined) store().setStepNote(id, stepId, step.note);
      });
    }
    if (f.components !== undefined) {
      for (const c of current().components) store().removeComponent(id, c.id);
      for (const c of f.components) {
        if (!store().addComponent(id, c.recipeId, c.choiceGroup ?? null)) {
          throw new Error(`Could not use recipe ${c.recipeId} inside this one.`);
        }
      }
    }
    if (f.prepTasks !== undefined) {
      for (const p of current().prepTasks) store().removePrepTask(id, p.id);
      for (const p of f.prepTasks) {
        const made = store().addPrepTask(id, p.title);
        if (!made) continue;
        store().updatePrepTask(id, made.id, {
          offsetDays: p.offsetDays ?? -1,
          reminderOffsetMinutes: p.reminderOffsetMinutes ?? null,
        });
      }
    }
  }

  /**
   * The app's resolveChoice: an option checked off on a list takes the rest of
   * its either/or off that list. A no-op for a row that isn't an option.
   */
  const resolveChoiceOn = (itemId: string, listId: string | null): void => {
    const plan = itemWrite.chosenOptionRows(db.dbGetAllGroceryListEntries(), db.dbGetAllGroceryItems(), itemId, listId);
    if (!plan) return;
    for (const row of plan.parked) db.dbUpdateGroceryItem(row);
    for (const e of plan.remove) db.dbDeleteGroceryListEntry(e.itemId, e.listId);
    db.dbSetGroceryListEntry(plan.winner);
  };

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
      return 'That completion marked a meal on the plan cooked. set_meal_cooked with cooked: false un-cooks the meal and reopens this task with it.';
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
        // The medicines taken as of this run, for an item marked medicationChecklist.
        const medications = medication.medicationVocabulary(
          db.dbGetAllMedicationLogs(),
          medication.parseArchivedMedications(db.dbGetSetting(medication.ARCHIVED_MEDICATIONS_SETTING_KEY)),
        );
        created = templateApply.applyTemplateRun(template, byId, selected, anchors, { medications, ...options }, {
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
    if (f.faxNumber !== undefined) out.faxNumber = f.faxNumber?.trim() || null;
    if (f.email !== undefined) out.email = f.email?.trim() || null;
    if (f.linkUrl !== undefined) out.linkUrl = f.linkUrl?.trim() || null;
    if (f.location !== undefined) out.location = f.location?.trim() || null;
    if (f.groupId !== undefined) {
      if (f.groupId !== null && !db.dbGetAllPersonGroups().some(g => g.id === f.groupId)) throw new Error(`No group with id ${f.groupId}. save_person_group makes one.`);
      out.groupId = f.groupId;
    }
    if (f.archived !== undefined) {
      out.archived = f.archived;
      out.archivedAt = f.archived ? new Date().toISOString() : null;
    }
    if (f.birthdayTaskOptOut !== undefined) out.birthdayTaskOptOut = f.birthdayTaskOptOut;
    if (f.birthdayGiftTaskOptOut !== undefined) out.birthdayGiftTaskOptOut = f.birthdayGiftTaskOptOut;
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
          values: c.values ?? [],
          ...(c.min !== undefined ? { min: c.min } : {}),
          ...(c.max !== undefined ? { max: c.max } : {}),
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
  const categoryStore = require('../../src/store/useCategoryStore') as typeof import('../../src/store/useCategoryStore');
  const generatedKinds = require('../../src/utils/generatedTasks') as typeof import('../../src/utils/generatedTasks');
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
      // The clock time a sun anchor resolves to on the task's day, which is
      // what the task keeps as its fallback (see Task.windowStartSun). Null
      // with no location saved, which the patch refuses with the reason.
      sunClockFor: sunAnchorClock,
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
    if (patch.personIds !== undefined) {
      const known = new Set(people().map(p => p.id));
      const missing = patch.personIds.filter(id => !known.has(id));
      if (missing.length > 0) errors.push(`personIds: no person with id ${missing.join(', ')}. list_people names them.`);
    }
    if (errors.length === 0) settleDateRules(input, patch, current, errors);
    // A reminder is a wall-clock time by default (Task.reminderTimeAnchor), and
    // the phone re-anchors it after a time zone change against the offset it
    // was set under. Captured here as the editor captures it on save, or an
    // agent's reminder stays on the old zone's clock after a flight.
    if (patch.reminderTime !== undefined) patch.reminderUtcOffsetMinutes = patch.reminderTime ? new Date(patch.reminderTime).getTimezoneOffset() : null;
    if (errors.length > 0) throw new Error(errors.join(' '));
    return patch;
  };

  /**
   * The date a deadline or reminder rule lands on, worked out the way the
   * editor works it out on save: whenever the rule is written, or the date it
   * counts from moves. Against the task as it will be, so a rule written with
   * a new date in the same call counts from the new date.
   */
  const settleDateRules = (input: TaskFieldsInput, patch: Partial<Task>, current: Task | null, errors: string[]): void => {
    const merged: Task = current
      ? { ...current, ...patch }
      : taskDraft.newTaskFromDraft({ title: input.title ?? 'task', ...patch } as Partial<TaskDraft>, new Date().toISOString(), 0, false);
    const due = merged.dueDate ? new Date(merged.dueDate) : null;
    const dateMoved = patch.dueDate !== undefined;

    const deadlineRuled = merged.deadlineOffsetDays != null || merged.deadlineMonthDay != null;
    if (deadlineRuled && (input.deadlineRule || dateMoved) && input.deadline === undefined) {
      if (!due) errors.push('deadlineRule counts from the task\'s date, and it has none. Give dueDate too.');
      else {
        patch.deadline = (merged.deadlineOffsetDays != null
          ? dates.getDeadlineFromOffset(due, merged.deadlineOffsetDays)
          : dates.getDeadlineFromMonthDay(due, merged.deadlineMonthDay as number)).toISOString();
      }
    }

    if (merged.reminderOffsetDays != null && (input.reminderRule || dateMoved)) {
      const at = input.reminderRule?.at
        ?? (merged.reminderTime ? (() => { const d = new Date(merged.reminderTime); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; })() : null);
      if (!due) errors.push('reminderRule.daysBeforeDate counts from the task\'s date, and it has none. Give dueDate too.');
      else if (!at) errors.push('reminderRule.daysBeforeDate needs a time of day: give at, "HH:MM".');
      else {
        const when = dates.getReminderOffsetDate(due, merged.reminderOffsetDays);
        const [h, m] = at.split(':').map(Number);
        when.setHours(h, m, 0, 0);
        patch.reminderTime = when.toISOString();
      }
    }

    const surfacesFrom = patch.deferUntil !== undefined || patch.timeSegments !== undefined || dateMoved;
    if (merged.reminderTracksVisibility && (input.reminderRule?.whenItSurfaces || surfacesFrom)) {
      if (!merged.deferUntil && merged.timeSegments.length === 0) {
        errors.push('reminderRule.whenItSurfaces rings when the task comes back into view, so it needs a deferUntil or a time of day (timeSegments) to come back from.');
      } else patch.reminderTime = visibility.getVisibleAt(merged).toISOString();
    }
  };

  // ==== rewards ====
  // The Rewards screen is hidden while the setting is off, so a write that
  // would land on it (a reward, a goal, a bounty) is refused rather than
  // quietly filling a screen the person cannot open.
  const requireRewardsOn = (): void => {
    if (!useSettingsStore.getState().rewardsEnabled) {
      throw new Error('Rewards are switched off in the app. Turn them on with update_settings (rewardsEnabled: true) if the person wants them.');
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
  const finishCompletion = (task: Task, options: CompletionOptions | undefined, mode: 'completed' | 'missed' | 'neutral' | 'other'): CompletedResult => {
    const id = task.id;
    const missed = mode === 'missed';
    const settings = useSettingsStore.getState();
    const built = completion.buildCompletion(task, missed ? { missed: true } : mode === 'neutral' ? { ...options, neutral: true } : mode === 'other' ? { byOther: true } : options, {
      dayResetTime: settings.dayResetTime,
      vacationMode: settings.vacationMode,
      now: new Date(),
      allTasks: tasks(),
      subtasks: tasks().filter(t => t.parentId === id),
      meterReadings: db.dbGetAllMeterReadings(),
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
      ...(built.reviewTask ? [built.reviewTask] : []),
      ...built.rolledOver,
    ]) {
      db.dbInsertTask(row);
    }

    // The one cross-store write kept, because it is a record rather than a
    // device effect: a dose taken is a fact about the person, and dropping
    // it would make a medication task completed here invisible in the log
    // that exists to count exactly these. Read through `medicationFor` so a
    // chain step carrying its own medication records that one.
    const dose = missed || mode === 'other' ? null : medication.medicationFor(task);
    if (dose) useMedicationStore.getState().addLog({ ...dose, taskId: id, at: new Date() });

    // Coins, kept for the same reason: the ledger is a record, and a task
    // finished here should earn what it would have earned on the phone.
    // Through the app's own store and rules, keyed by the completed row, so
    // the device that later syncs this completion converges on one entry.
    // A no-op while rewards are off (the setting syncs, so this replica
    // reads the same answer the phone does).
    // A neutral completion is the app closing something on its own account, so
    // it moves no coins either way (a claimed wish-list item is the one use).
    if (mode !== 'neutral' && mode !== 'other' && rewards.taskEarnsCoins(task)) {
      const store = useRewardStore.getState();
      const title = visibility.displayTitleFor(task);
      const at = new Date().toISOString();
      if (missed) store.recordMiss(id, rewards.coinsForLoss(task), title, at);
      else store.recordEarn(id, rewards.coinsForCompletion(task, built.completed.streakCount), title, at);
    }

    // A meal's task finishing is that meal being cooked, as on the phone
    // (useTaskStore's cookedEntryId): a legacy cook task, or the step that ends
    // a meal slot's chain. Never on a miss. `cookMeal` stamps the meal before
    // it completes anything, so the tasks it finishes in turn find it cooked
    // and stop here.
    if (mode === 'completed') {
      const entryId = generatedSourceOf(task, 'mealCook') ?? (completesMealSlot(task) ? mealSlotEntryIdOf(task) : null);
      if (entryId) cookMeal(entryId);
    }

    refresh();
    return {
      completed: built.completed,
      nextTask: built.nextTask,
      followUpTask: built.followUpTask,
      reviewTask: built.reviewTask,
      rolledOver: built.rolledOver,
      loggedDose: dose !== null,
    };
  };

  /** The planned meal a meal slot task is about: the first in its slot, as the phone reads it. */
  const mealSlotEntryIdOf = (task: Task): string | null => {
    const source = parseMealSlotSource(generatedSourceOf(task, 'mealSlot'));
    if (!source) return null;
    const day = db.dbGetMealPlanEntries(source.dayKey, source.dayKey);
    return mealPlanUtils.entriesForSlot(day, source.dayKey, source.slot)[0]?.id ?? null;
  };

  /**
   * A planned meal marked cooked, as the app's `setCookedPaired` marks one:
   * the stamp, the recipe's own counters (`useRecipeStore.markCooked`), the
   * packets the cooking opened (`cookedConsumption`, the same restraint the
   * cook recap keeps: only lines the app already claims you have), and the
   * meal's tasks completed, every remaining step of its slot's chain. What the
   * phone raises after a cooking (the recap asking what was used up, the
   * leftovers question, the offer to log it) is a sheet on the phone, and is
   * not raised from here. Null when the meal is already cooked.
   */
  const cookMeal = (entryId: string): MealCooking | null => {
    const entry = db.dbGetMealPlanEntry(entryId);
    if (!entry || entry.cookedAt) return null;
    const now = new Date();
    const cooked: MealPlanEntry = { ...entry, cookedAt: now.toISOString() };
    db.dbUpdateMealPlanEntry(cooked);

    const recipes = db.dbGetAllRecipes();
    if (entry.recipeId && recipes.some(r => r.id === entry.recipeId)) recipeStore().getState().markCooked(entry.recipeId);

    const items = db.dbGetAllGroceryItems();
    const rows = mealPlanGroceries.cookedConsumption(entry, recipes, items, db.dbGetAllItemSubLinks(), now, db.dbGetAllItemProducts());
    const at = mealPlanGroceries.openedAtForCook(entry, dates.dayKeyOf(dates.getLogicalToday()), now);
    const opened: string[] = [];
    for (const id of mealPlanGroceries.cookOpenedIds(rows, items)) {
      const item = items.find(i => i.id === id)!;
      const row = pantryWrite.openedRow(item, true, at);
      if (row) {
        db.dbUpdateGroceryItem(row);
        opened.push(item.name);
      }
    }

    // The tasks, after the stamp: each completion lands back in cookMeal and
    // finds the meal cooked. A chain is walked a step at a time, since each
    // step completed spawns the next, bounded by its length so a step that
    // declines to complete cannot spin.
    const tasksCompleted: string[] = [];
    const finish = (t: Task | undefined): boolean => {
      if (!t || completion.completionRefusal(t)) return false;
      tasksCompleted.push(visibility.displayTitleFor(t));
      finishCompletion(t, undefined, 'completed');
      return true;
    };
    finish(liveGeneratedTask(tasks(), 'mealCook', entry.id));
    const sourceId = mealSlotSourceId(entry.date, entry.slot);
    let next = liveGeneratedTask(tasks(), 'mealSlot', sourceId);
    for (let i = 0; next && i <= (next.chainItems?.length || 1); i++) {
      if (!finish(next)) break;
      next = liveGeneratedTask(tasks(), 'mealSlot', sourceId);
    }
    refresh();
    return { entry: cooked, opened, tasksCompleted };
  };

  /**
   * The other direction, as the app's `setCooked(false)`: the stamp cleared
   * and the task that finished the meal reopened. The recipe's cook count is
   * not taken back (it only ever rises), and the packets the cooking opened
   * stay open, both for the app's reasons (see `markConsumedOpened`). Null
   * when the meal is not cooked.
   */
  const uncookMeal = (entryId: string): { entry: MealPlanEntry; tasksReopened: string[] } | null => {
    const entry = db.dbGetMealPlanEntry(entryId);
    if (!entry || !entry.cookedAt) return null;
    const uncooked: MealPlanEntry = { ...entry, cookedAt: null };
    db.dbUpdateMealPlanEntry(uncooked);
    const sourceId = mealSlotSourceId(entry.date, entry.slot);
    const done = tasks().filter(t =>
      t.completed && !t.archived && !visibility.isMissed(t) &&
      ((generatedSourceOf(t, 'mealSlot') === sourceId && completesMealSlot(t)) || generatedSourceOf(t, 'mealCook') === entry.id));
    const tasksReopened: string[] = [];
    for (const t of done) {
      reopenCore(t);
      tasksReopened.push(visibility.displayTitleFor(t));
    }
    refresh();
    return { entry: uncooked, tasksReopened };
  };

  /** Reopening once the refusals are past; see `reopenTask`. */
  const reopenCore = (task: Task): { task: Task; removed: Task[] } => {
    const id = task.id;
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
    liveBlockers: (task: Task) => {
      const own = new Set(blocking.blockerIdsOf(task));
      return blocking.liveBlockersOf(task, blocking.resolverFor(tasks())).filter(b => own.has(b.id));
    },
    isNotNeeded: (task: Task) => visibility.isTaskNotNeeded(task),
    visibleAt: (task: Task) => visibility.getVisibleAt(task),

    displayTitle: (task: Task) => visibility.displayTitleFor(task),
    estimatedMinutes: (task: Task) => effort.estimatedMinutesFor(task),
    deliverableKind: (task: Task) => deliverables.deliverableKindFor(task),
    deliverableOptions: (task: Task) => deliverables.deliverableOptionsFor(task),

    todayKey: () => dates.dayKeyOf(dates.getLogicalToday()),
    windowToday: (task: Task) => visibility.windowBoundsFor(task),
    sunAnchorClock,
    shiftDayKey: (key: string, days: number) =>
      dates.dayKeyOf(addDays(dates.dayKeyToDate(key), days)),

    // The only one of the three with a ranged db read of its own, because
    // food_logs is the table that grows fastest — several rows a day, for ever.
    // The other two are read whole and filtered, which is what the app does.
    foodLogEntries: (from: string, to: string) => db.dbGetFoodLogEntries(from, to),
    foodTotals: (entries: readonly FoodLogEntry[]) => foodLog.foodLogTotals(entries),
    foodProduce: (entries: readonly FoodLogEntry[]) => {
      // The catalog and recipes are read once for the whole range, not per day.
      const items = db.dbGetAllGroceryItems();
      const resolver = recipeProduce.recipeProduceResolver(
        db.dbGetAllRecipes(),
        items,
        db.dbGetAllItemProducts(),
        standingSwaps.standingSwapMap(db.dbGetAllItemSubLinks(), items),
      );
      const byDay = new Map<string, FoodLogEntry[]>();
      for (const e of entries) {
        const day = byDay.get(e.dayKey);
        if (day) day.push(e);
        else byDay.set(e.dayKey, [e]);
      }
      return [...byDay.keys()].sort().map(dayKey => ({
        dayKey,
        ...produce.dayProduce(byDay.get(dayKey) ?? [], resolver),
      }));
    },

    moodLogs: (from: string, to: string) =>
      moodHistory.logsInDayRange(db.dbGetAllMoodLogs(), from, to),

    medicationLogs: (from: string, to: string) =>
      db.dbGetAllMedicationLogs().filter(l => l.dayKey >= from && l.dayKey <= to),
    medicationSummary: (log: MedicationLog) => medication.medicationLogSummary(log),
    medicationSettings: () => {
      const logs = db.dbGetAllMedicationLogs();
      const map = medicationSettings.parseMedicationSettings(db.dbGetSetting(medicationSettings.MEDICATION_SETTINGS_KEY));
      const names = new Map(medication.medicationVocabulary(logs).map(n => [medication.medicationKey(n), n]));
      const now = new Date();
      return Object.entries(map).map(([key, prefs]) => {
        const name = names.get(key) ?? key;
        const status = medicationSettings.limitStatus(logs, name, prefs.limit, now);
        const left = medicationSettings.supplyRemaining(logs, name, prefs.supply);
        return {
          name,
          limit: medicationSettings.describeLimit(prefs.limit) ?? undefined,
          dosesInLast24h: prefs.limit ? status.inLast24h : undefined,
          withinLimitAgainAt: status.nextOkAt ? status.nextOkAt.toISOString() : undefined,
          supplyLeft: left === null || !prefs.supply ? undefined : medicationSettings.describeSupplyLeft(left, prefs.supply.unit),
        };
      });
    },

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

    settingValues(): Record<string, unknown> {
      const state = useSettingsStore.getState();
      return Object.fromEntries(Object.entries(SETTINGS_SPEC).map(([key, spec]) => [key, spec.read(state)]));
    },

    applySettings(changes: Record<string, unknown>): { key: string; before: unknown; after: unknown }[] {
      const unknown = Object.keys(changes).filter(k => !(k in SETTINGS_SPEC));
      if (unknown.length > 0) throw new Error(`Not a setting this can change: ${unknown.join(', ')}. get_settings lists them.`);
      const before = replica.settingValues();
      // Every check first, against the state with its setters stubbed out, so
      // one bad value refuses the call before any setting is stored.
      const state = useSettingsStore.getState();
      const dry = new Proxy(state, { get: (target, prop) => (typeof prop === 'string' && prop.startsWith('set') ? () => {} : Reflect.get(target, prop)) });
      for (const [key, value] of Object.entries(changes)) SETTINGS_SPEC[key].write(dry, value);
      db.dbTransaction(() => {
        // A readings category the person names that doesn't exist yet is made, as the app's own
        // "Show Health readings under" does; the dry run above must not, so it lives here.
        if (typeof changes.healthCategory === 'string') ensureCategory(changes.healthCategory.trim());
        for (const [key, value] of Object.entries(changes)) SETTINGS_SPEC[key].write(useSettingsStore.getState(), value);
      });
      refresh();
      const after = replica.settingValues();
      return Object.keys(changes).map(key => ({ key, before: before[key], after: after[key] }));
    },

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
        rewardWeeklyBudgetMinor: s.rewardWeeklyBudgetMinor,
        bountyLimit: s.bountyLimit,
        completedRetentionDays: s.completedRetentionDays,
        // Read off the table, as requestCalendarEvent does, so the two agree.
        calendarRequestsOn: !!db.dbGetSetting('calendarRequestDeviceId'),
        unitSystem: s.unitSystem,
        weatherTasks: s.weatherTasks,
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
    dayKeyOf: (iso: string) => dates.dayKeyOf(new Date(iso)),
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
          // A setting that lives on its own screen has no Settings row: its
          // section already says which screen and which button.
          path: r.entry.screen
            ? `${r.entry.section} › ${r.entry.label}`
            : `${where} › ${r.entry.section} › ${r.entry.label}`,
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
    meterReadings: () => db.dbGetAllMeterReadings(),
    logMeterReading(name: string, value: number, readAt: Date): MeterReading {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMeterReadingStore } = require('../../src/store/useMeterReadingStore') as typeof import('../../src/store/useMeterReadingStore');
      const store = useMeterReadingStore.getState();
      store.initialize();
      const reading = store.logReading(name, value, readAt);
      if (!reading) throw new Error('A reading needs a meter name and a number zero or above.');
      return reading;
    },
    deleteMeterReading(id: string): MeterReading {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMeterReadingStore } = require('../../src/store/useMeterReadingStore') as typeof import('../../src/store/useMeterReadingStore');
      const store = useMeterReadingStore.getState();
      store.initialize();
      const reading = store.readings.find(r => r.id === id);
      if (!reading) throw new Error(`No meter reading with id ${id}. list_meter_readings names them.`);
      store.removeReading(id);
      return reading;
    },
    journalEntries(fromDayKey: string, toDayKey: string, kind?: JournalKind): JournalEntry[] {
      return db.dbGetAllJournalEntries()
        .filter(e => e.dayKey >= fromDayKey && e.dayKey <= toDayKey && (!kind || e.kind === kind));
    },
    addJournalEntry(kind: JournalKind, text: string, at?: Date): JournalEntry {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useJournalStore } = require('../../src/store/useJournalStore') as typeof import('../../src/store/useJournalStore');
      const store = useJournalStore.getState();
      store.initialize();
      const entry = store.addEntry(kind, text, at);
      if (!entry) throw new Error('An entry needs some text.');
      return entry;
    },
    updateJournalEntry(id: string, text: string): JournalEntry {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useJournalStore } = require('../../src/store/useJournalStore') as typeof import('../../src/store/useJournalStore');
      const store = useJournalStore.getState();
      store.initialize();
      if (!store.entries.some(e => e.id === id)) throw new Error(`No journal or dream entry with id ${id}. list_journal_entries names them.`);
      if (!text.trim()) throw new Error('An entry needs some text. To remove it, delete it instead.');
      store.updateEntry(id, text);
      return useJournalStore.getState().entries.find(e => e.id === id)!;
    },
    deleteJournalEntry(id: string): JournalEntry {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useJournalStore } = require('../../src/store/useJournalStore') as typeof import('../../src/store/useJournalStore');
      const store = useJournalStore.getState();
      store.initialize();
      const entry = store.entries.find(e => e.id === id);
      if (!entry) throw new Error(`No journal or dream entry with id ${id}. list_journal_entries names them.`);
      store.removeEntry(id);
      return entry;
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
    updateSavedView(id: string, patch: { name?: string; icon?: string; clauses?: SavedViewClause[] }, position?: number): SavedView {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useSavedViewStore } = require('../../src/store/useSavedViewStore') as typeof import('../../src/store/useSavedViewStore');
      const store = useSavedViewStore.getState();
      store.initialize();
      if (!store.views.some(v => v.id === id)) throw new Error(`No saved view with id ${id}. list_saved_views names them.`);
      if (Object.keys(patch).length > 0) store.updateView(id, patch);
      if (position !== undefined) {
        const others = useSavedViewStore.getState().views.map(v => v.id).filter(v => v !== id);
        const at = Math.max(0, Math.min(others.length, Math.floor(position)));
        store.reorderViews([...others.slice(0, at), id, ...others.slice(at)]);
      }
      return useSavedViewStore.getState().views.find(v => v.id === id)!;
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
      const forgiven = streaks.forgiveVacationStreaks(tasks(), dates.getCurrentDayStart().toISOString(), visibility.isHiddenForVacation);
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
      const name = recipeUtils.cleanRecipeName(input.name);
      if (!name) throw new Error('A recipe needs a name.');
      const bookTitle = input.cookbook?.trim() || null;
      const existingBook = bookTitle ? findCookbook(bookTitle) : null;
      if (existingBook && recipeUtils.recipeInBook(useRecipeStore.getState().recipes, name, existingBook.id)) {
        throw new Error(`There is already a recipe called "${name}" in ${existingBook.title}.`);
      }
      // Everything else that can refuse is checked before the first write.
      checkRecipeFields(null, { ...input, cookbook: undefined }, bookTitle !== null);

      let id = '';
      try {
        db.dbTransaction(() => {
          const store = useRecipeStore.getState();
          const book = bookTitle ? existingBook ?? store.ensureCookbook(bookTitle) : null;
          const recipe = store.addRecipe(input.name, book?.id ?? null);
          if (!recipe) {
            throw new Error(`There is already a recipe called "${name}"${book ? ` in ${book.title}` : ''}.`);
          }
          id = recipe.id;
          writeRecipeFields(id, { ...input, name: undefined, cookbook: undefined });
        });
      } finally {
        // Rehydrated, which also puts the store back if the transaction rolled back.
        useRecipeStore.getState().initialize();
      }
      refresh();
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
      const others = useRecipeStore.getState().recipes.filter(r => r.id !== id);
      let renamed: { name: string; nameKey: string } | null = null;
      if (patch.name !== undefined) {
        const clean = recipeUtils.cleanRecipeName(patch.name);
        if (!clean) throw new Error('A recipe needs a name.');
        const key = recipeUtils.recipeNameKey(clean);
        if (key !== recipe.nameKey) renamed = { name: clean, nameKey: key };
      }
      // Where it will live once this edit lands: a move names the book (by
      // title, found or made), null takes it out of one.
      const bookTitle = patch.cookbook === undefined ? undefined : patch.cookbook?.trim() || null;
      const targetBook = bookTitle === undefined
        ? (recipe.cookbookId ? db.dbGetAllCookbooks().find(c => c.id === recipe.cookbookId) ?? null : null)
        : bookTitle === null ? null : findCookbook(bookTitle);
      const finalName = renamed?.name ?? recipe.name;
      const movingOrRenaming = renamed !== null || (bookTitle !== undefined && (targetBook?.id ?? null) !== recipe.cookbookId);
      // A book named by a title nobody has yet is made by this edit, so it is empty.
      const newBook = typeof bookTitle === 'string' && !targetBook;
      if (movingOrRenaming && !newBook && recipeUtils.recipeInBook(others, finalName, targetBook?.id ?? null)) {
        throw new Error(`There is already a recipe called "${finalName}"${targetBook ? ` in ${targetBook.title}` : ''}.`);
      }
      const inBook = bookTitle === undefined ? recipe.cookbookId !== null : bookTitle !== null;
      checkRecipeFields(recipe, patch, inBook);

      const store = () => useRecipeStore.getState();
      try {
        db.dbTransaction(() => {
          if (bookTitle !== undefined) {
            const book = bookTitle === null ? null : targetBook ?? store().ensureCookbook(bookTitle);
            if (bookTitle !== null && !book) throw new Error('A cookbook needs a title.');
            if ((book?.id ?? null) !== recipe.cookbookId) store().linkCookbook(id, book?.id ?? null);
          }
          writeRecipeFields(id, { ...patch, name: undefined, cookbook: undefined });
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
      } finally {
        // Rehydrated, which also puts the store back if the transaction rolled back.
        useRecipeStore.getState().initialize();
      }
      refresh();
      return useRecipeStore.getState().recipes.find(r => r.id === id)!;
    },

    cookbookSummaries(): CookbookSummary[] {
      const recipes = db.dbGetAllRecipes();
      const entries = db.dbGetAllCookbookIndexEntries();
      return db.dbGetAllCookbooks().map(c => ({
        id: c.id,
        title: c.title,
        author: c.author,
        recipes: recipes.filter(r => r.cookbookId === c.id).length,
        indexEntries: entries.filter(e => e.cookbookId === c.id).length,
      }));
    },

    cookbookIndex(cookbookId: string): CookbookIndexEntry[] {
      if (!db.dbGetAllCookbooks().some(c => c.id === cookbookId)) throw new Error(`No cookbook with id ${cookbookId}.`);
      return db.dbGetAllCookbookIndexEntries().filter(e => e.cookbookId === cookbookId);
    },

    renameCookbook(id: string, title: string, author?: string | null): Cookbook {
      const store = recipeStore();
      const book = store.getState().cookbooks.find(c => c.id === id);
      if (!book) throw new Error(`No cookbook with id ${id}.`);
      if (!title.trim()) throw new Error('A cookbook needs a title.');
      const ok = store.getState().renameCookbook(id, title, author === undefined ? book.author : author);
      if (!ok) throw new Error(`There is already a cookbook called "${title.trim()}"${author ? ` by ${author.trim()}` : ''}. merge_cookbooks joins two copies of one book.`);
      refresh();
      return store.getState().cookbooks.find(c => c.id === id)!;
    },

    mergeCookbooks(survivorId: string, loserId: string): { survivor: Cookbook; merged: Cookbook; recipesMoved: number } {
      const store = recipeStore();
      const survivor = store.getState().cookbooks.find(c => c.id === survivorId);
      const loser = store.getState().cookbooks.find(c => c.id === loserId);
      if (!survivor) throw new Error(`No cookbook with id ${survivorId}.`);
      if (!loser) throw new Error(`No cookbook with id ${loserId}.`);
      if (survivorId === loserId) throw new Error('Those are the same cookbook.');
      const recipesMoved = store.getState().recipes.filter(r => r.cookbookId === loserId).length;
      db.dbTransaction(() => {
        store.getState().mergeCookbooks(survivorId, loserId);
      });
      store.getState().initialize();
      refresh();
      return { survivor: store.getState().cookbooks.find(c => c.id === survivorId)!, merged: loser, recipesMoved };
    },

    deleteCookbook(id: string): { cookbook: Cookbook; recipesUnlinked: number; indexEntries: number } {
      const store = recipeStore();
      const cookbook = store.getState().cookbooks.find(c => c.id === id);
      if (!cookbook) throw new Error(`No cookbook with id ${id}.`);
      const recipesUnlinked = store.getState().recipes.filter(r => r.cookbookId === id).length;
      const indexEntries = store.getState().indexEntries.filter(e => e.cookbookId === id).length;
      // `dbDeleteCookbook` unlinks the recipes and takes the index with the book.
      store.getState().deleteCookbook(id);
      refresh();
      return { cookbook, recipesUnlinked, indexEntries };
    },

    saveIndexEntry(input: IndexEntryInput): CookbookIndexEntry {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const cookbookIndex = require('../../src/utils/cookbookIndex') as typeof import('../../src/utils/cookbookIndex');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const store = recipeStore();
      const fields = { title: input.title, page: input.page ?? null, ingredients: input.ingredients ?? [] };
      if (!cookbookIndex.cleanIndexEntryFields(fields)) throw new Error('An index line needs a dish name.');
      if (input.id) {
        const entry = store.getState().indexEntries.find(e => e.id === input.id);
        if (!entry) throw new Error(`No index line with id ${input.id}.`);
        const merged = {
          title: input.title,
          page: input.page !== undefined ? input.page : entry.page,
          ingredients: input.ingredients ?? entry.ingredients,
        };
        if (!store.getState().updateIndexEntry(input.id, merged)) {
          throw new Error(`That cookbook's index already lists "${input.title.trim()}".`);
        }
        refresh();
        return store.getState().indexEntries.find(e => e.id === input.id)!;
      }
      if (!input.cookbookId) throw new Error('Name the cookbook (cookbookId) a new index line belongs to.');
      if (!store.getState().cookbooks.some(c => c.id === input.cookbookId)) throw new Error(`No cookbook with id ${input.cookbookId}.`);
      const entry = store.getState().addIndexEntry(input.cookbookId, fields);
      if (!entry) throw new Error(`That cookbook's index already lists "${input.title.trim()}".`);
      refresh();
      return entry;
    },

    deleteIndexEntry(id: string): CookbookIndexEntry {
      const store = recipeStore();
      const entry = store.getState().indexEntries.find(e => e.id === id);
      if (!entry) throw new Error(`No index line with id ${id}.`);
      store.getState().deleteIndexEntry(id);
      refresh();
      return entry;
    },

    recipeFromIndexEntry(id: string): { recipe: Recipe; created: boolean } {
      const store = recipeStore();
      const entry = store.getState().indexEntries.find(e => e.id === id);
      if (!entry) throw new Error(`No index line with id ${id}.`);
      const before = new Set(store.getState().recipes.map(r => r.id));
      const recipe = store.getState().recipeFromIndexEntry(id);
      if (!recipe) throw new Error(`Could not make a recipe from "${entry.title}".`);
      refresh();
      return { recipe, created: !before.has(recipe.id) };
    },

    reorderUpNext(ids: string[]): Recipe[] {
      const store = recipeStore();
      const shelf = store.getState().upNextRecipes();
      const onShelf = new Set(shelf.map(r => r.id));
      const unknown = ids.filter(i => !onShelf.has(i));
      if (unknown.length > 0) throw new Error(`Not on the Up next shelf: ${unknown.join(', ')}. update_recipe with upNext: true adds one.`);
      if (new Set(ids).size !== ids.length) throw new Error('A recipe is named twice.');
      // Ones left out keep their order, after the ones named.
      const rest = shelf.map(r => r.id).filter(i => !ids.includes(i));
      store.getState().reorderUpNextRecipes([...ids, ...rest]);
      refresh();
      return store.getState().upNextRecipes();
    },

    logCookTime(id: string, minutes: number): Recipe {
      const store = recipeStore();
      if (!store.getState().recipes.some(r => r.id === id)) throw new Error(`No recipe with id ${id}.`);
      if (!(minutes > 0)) throw new Error('minutes must be more than 0.');
      store.getState().logManualCookTime(id, minutes);
      refresh();
      return store.getState().recipes.find(r => r.id === id)!;
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
      // The server has no HealthKit. Flagged so the phone writes it on its next
      // foreground (FoodLogEntry.healthWritePending).
      const flagged = { ...entry, healthWritePending: true };
      db.dbInsertFoodLogEntry(flagged);
      return flagged;
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
        entry = { ...existing, ...built, healthWritePending: true };
        db.dbUpdateFoodLogEntry(entry);
      } else {
        const row = builder.buildFoodLogEntry(
          { ...built, grams: null, slot: null, recipeId: null, itemId: null, productId: null, mealPlanEntryId: null, at },
          key => db.dbGetFoodLogEntries(key, key),
          generateId,
        );
        if (!row) throw new Error('That is not an amount of water the log can hold.');
        entry = { ...row, healthWritePending: true };
        db.dbInsertFoodLogEntry(entry);
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

    updateFoodEntry(id: string, patch: FoodPatch): FoodLogEntry {
      const entry = db.dbGetFoodLogEntry(id);
      if (!entry) throw new Error(`No food entry with id ${id}.`);
      const estimated = entry.nutrition.source === 'estimated';
      if (patch.grams !== undefined && estimated) {
        throw new Error('grams re-measures an entry against a food record, and an estimated entry has none. Restate its quantity and amounts instead.');
      }
      const remeasures = !estimated && (patch.grams !== undefined || patch.quantity !== undefined);
      if (remeasures && patch.amounts !== undefined) {
        throw new Error('A measured entry\'s figures come from its food record, so give a new amount (grams or quantity) or new amounts, not both.');
      }
      const touchesFigures = patch.amounts !== undefined || patch.quantity !== undefined;
      if (touchesFigures && !estimated && !remeasures) {
        throw new Error('Only an estimated entry has figures to restate. This one was measured against a food\'s own label or database record, so correct it in the app, which re-measures it.');
      }
      if ((touchesFigures || patch.grams !== undefined) && entry.healthSampleIds.length > 0) {
        throw new Error('That entry was written to Apple Health, which only the phone can correct. Edit it in the app.');
      }
      if (patch.label !== undefined && !patch.label.trim()) throw new Error('A food entry needs a name.');

      let nutrition = entry.nutrition;
      let measured: Partial<FoodLogEntry> = {};
      if (remeasures) {
        measured = remeasuredFields(entry, foodAmountText(patch));
        nutrition = measured.nutrition!;
      } else if (patch.amounts !== undefined) {
        const estimate = require('../../src/utils/nutritionEstimate') as typeof import('../../src/utils/nutritionEstimate'); // eslint-disable-line @typescript-eslint/no-require-imports
        const read = estimate.readNutritionEstimate({ label: patch.label ?? entry.label, quantity: patch.quantity ?? entry.quantity, amounts: patch.amounts, basis: 'typical', confidence: 'medium' });
        const panel = read && estimate.estimateToPanel(read);
        if (!panel) throw new Error('A food entry needs at least one nutrient amount.');
        nutrition = panel;
      }
      const updated: FoodLogEntry = {
        ...entry,
        ...measured,
        label: patch.label !== undefined ? patch.label.trim() : entry.label,
        quantity: remeasures ? measured.quantity! : patch.quantity !== undefined ? patch.quantity.trim() : entry.quantity,
        slot: patch.slot === undefined ? entry.slot : patch.slot,
        nutrition,
      };
      db.dbUpdateFoodLogEntry(updated);
      return updated;
    },

    moveFoodEntry(id: string, at: Date): { from: FoodLogEntry; to: FoodLogEntry } {
      const entry = foodEntryToCopy(id);
      if (entry.healthSampleIds.length > 0) {
        throw new Error('That entry is in Apple Health, and moving it means taking the old sample back out, which only the phone can do. Move it in the app.');
      }
      let moved: FoodLogEntry | null = null;
      db.dbTransaction(() => {
        db.dbDeleteFoodLogEntry(id);
        moved = insertFoodCopy(entry, at, entry.slot, entry.mealPlanEntryId);
      });
      return { from: entry, to: moved! };
    },

    duplicateFoodEntry(id: string, at: Date, amount?: FoodAmount): FoodLogEntry {
      const entry = foodEntryToCopy(id);
      // The copy is a new row, so Health and the original's samples are not in
      // play; only the figures change, re-measured as an edit would.
      const copy = amount ? { ...entry, ...remeasuredFields(entry, foodAmountText(amount)) } : entry;
      return insertFoodCopy(copy, at, entry.slot, null);
    },

    savedMeals(): SavedMeal[] {
      return db.dbGetSavedMeals();
    },

    saveMealFromEntries(name: string, entryIds: string[]): SavedMeal {
      if (!name.trim()) throw new Error('A saved meal needs a name.');
      if (entryIds.length === 0) throw new Error('Name the entries to save together.');
      const entries = entryIds.map(id => {
        const e = db.dbGetFoodLogEntry(id);
        if (!e) throw new Error(`No food entry with id ${id}.`);
        return e;
      });
      // The item shape `addFromEntries` writes, one per entry.
      const meal: SavedMeal = {
        id: generateId(),
        name: name.trim(),
        items: entries.map(e => ({
          label: e.label,
          recipeId: e.recipeId,
          itemId: e.itemId,
          productId: e.productId,
          quantity: e.quantity,
          grams: e.grams,
          nutrition: e.nutrition,
          ...(e.sourcePanel ? { sourcePanel: e.sourcePanel } : {}),
        })),
        createdAt: new Date().toISOString(),
      };
      db.dbInsertSavedMeal(meal);
      return meal;
    },

    logSavedMeal(id: string, slot: MealSlot | null, at: Date): FoodLogEntry[] {
      const meal = db.dbGetSavedMeals().find(m => m.id === id);
      if (!meal) throw new Error(`No saved meal with id ${id}.`);
      const written: FoodLogEntry[] = [];
      db.dbTransaction(() => {
        for (const item of meal.items) {
          const entry = buildFood({
            label: item.label,
            quantity: item.quantity,
            grams: item.grams,
            nutrition: item.nutrition,
            sourcePanel: item.sourcePanel ?? null,
            slot,
            recipeId: item.recipeId,
            itemId: item.itemId,
            productId: item.productId,
            at,
          });
          if (entry) written.push(entry);
        }
      });
      if (written.length === 0) throw new Error('Nothing in that saved meal could be logged.');
      return written;
    },

    deleteSavedMeal(id: string): SavedMeal {
      const meal = db.dbGetSavedMeals().find(m => m.id === id);
      if (!meal) throw new Error(`No saved meal with id ${id}.`);
      db.dbDeleteSavedMeal(id);
      return meal;
    },

    nutritionTargets(): Partial<Record<NutrientKey, number>> {
      return { ...useSettingsStore.getState().nutritionTargets };
    },

    nutritionLimits(): NutrientKey[] {
      return [...useSettingsStore.getState().nutritionLimits];
    },

    setNutritionTargets(changes: Partial<Record<NutrientKey, number | null>>): Partial<Record<NutrientKey, number>> {
      const { NUTRITION_TARGET_RANGES } = require('../../src/utils/nutritionTargets') as typeof import('../../src/utils/nutritionTargets'); // eslint-disable-line @typescript-eslint/no-require-imports
      const keys = Object.keys(changes) as NutrientKey[];
      if (keys.length === 0) throw new Error('Name at least one target.');
      for (const key of keys) {
        const range = NUTRITION_TARGET_RANGES[key];
        if (!range) throw new Error(`"${key}" is not a nutrient. Targets are keyed ${Object.keys(NUTRITION_TARGET_RANGES).join(', ')}.`);
        const v = changes[key];
        if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < range.min || v > range.max)) {
          throw new Error(`A ${key} target is from ${range.min} to ${range.max}, or null to clear it.`);
        }
      }
      const settings = useSettingsStore.getState();
      const set: Partial<Record<NutrientKey, number>> = {};
      for (const key of keys) {
        const v = changes[key];
        if (v === null) settings.setNutritionTarget(key, null);
        else set[key] = v as number;
      }
      if (Object.keys(set).length > 0) useSettingsStore.getState().setNutritionTargets(set);
      return { ...useSettingsStore.getState().nutritionTargets };
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
      // An edit may not empty the entry: a check-in recording nothing is a day
      // marked as logged with nothing on it. Delete it instead.
      const after = { ...existing, ...next };
      if (after.mood == null && after.symptoms.length === 0 && after.contextTags.length === 0 && !after.note?.trim()) {
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
          'No device is set to add events to the calendar. On the phone that should add them, pick a calendar in Settings › Calendar › Add Claude’s events to.'
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

    requestCalendarChange(targetId: string, change: { delete: true } | { changes: CalendarRequestChanges }): CalendarRequest {
      if (!db.dbGetSetting('calendarRequestDeviceId')) {
        throw new Error('No device is set to add events to the calendar, so none can change one either.');
      }
      const target = db.dbGetCalendarRequest(targetId);
      if (!target || (target.action ?? 'create') !== 'create') throw new Error(`No request for a new event with id ${targetId}. list_calendar_requests lists them.`);
      if (target.status === 'pending') throw new Error('That event has not been added yet. Cancel the request with cancel_calendar_request and ask again with what it should be.');
      if (target.status !== 'written') throw new Error(`That request was ${target.status}, so there is no event to change.`);
      if (!target.eventExternalId) throw new Error('The phone could not read that event\'s calendar id when it added it, so it cannot find it again. Change it in the calendar app.');
      const epoch = new Date(0).toISOString();
      const request: CalendarRequest = {
        id: generateId(),
        title: 'changes' in change && change.changes.title ? change.changes.title : target.title,
        // Already over, on purpose: an older build expires this rather than
        // creating an event from it (see CalendarRequest.action).
        startAt: epoch,
        endAt: epoch,
        allDay: target.allDay,
        location: null,
        notes: null,
        status: 'pending',
        failureReason: null,
        eventExternalId: null,
        resolvedAt: null,
        createdAt: new Date().toISOString(),
        action: 'delete' in change ? 'delete' : 'update',
        targetRequestId: target.id,
        changes: 'changes' in change ? change.changes : null,
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
            ? 'That event is already on the calendar. change_calendar_event with delete: true asks the phone to remove it.'
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

    setMedicationArchived(name: string, archived: boolean): string {
      const { useMedicationStore: meds } = require('../../src/store/useMedicationStore') as typeof import('../../src/store/useMedicationStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      meds.getState().initialize();
      const key = medication.medicationKey(name);
      const known = medication.medicationVocabulary(db.dbGetAllMedicationLogs(), []);
      const spelled = known.find(n => medication.medicationKey(n) === key) ?? meds.getState().archived.find(n => medication.medicationKey(n) === key);
      if (!spelled) throw new Error(`No medicine called "${name}" in the log. list_medication_logs shows them.`);
      if (archived) meds.getState().archiveMedication(spelled);
      else meds.getState().unarchiveMedication(spelled);
      return spelled;
    },

    renameMoodTag(from: string, to: string): number {
      const { useMoodStore } = require('../../src/store/useMoodStore') as typeof import('../../src/store/useMoodStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const store = useMoodStore.getState();
      store.initialize();
      const target = to.trim();
      if (!target) throw new Error('A tag needs a name.');
      const match = (t: string) => t.trim().toLowerCase() === from.trim().toLowerCase();
      const hit = store.logs.flatMap(l => l.contextTags).find(match);
      if (!hit) throw new Error(`No check-in has the tag "${from}".`);
      const count = store.logs.filter(l => l.contextTags.some(match)).length;
      store.renameContextTag(hit, target);
      return count;
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

    generatorCategory: (kind: GeneratedKind) => categoryStore.getGeneratedCategory(kind),

    setGeneratorCategory(kind: GeneratedKind, category: string | null) {
      categoryStore.setGeneratedCategory(kind, category);
      refresh();
    },

    deleteCategory(name: string, moveTo: string | null): DeletedCategory {
      if (!useCategoryStore.getState().getCategoryByName(name)) throw new Error(`No category called "${name}".`);
      if (moveTo !== null && moveTo === name) throw new Error('A category cannot be moved into itself.');
      const taskIds = tasks().filter(t => t.category === name).map(t => t.id);
      const groups = useTaskGroupStore.getState().groups.filter(g => g.category === name);
      db.dbBulkSetCategory(taskIds, moveTo);
      groups.forEach(g => useTaskGroupStore.getState().updateGroup(g.id, { category: moveTo }));

      const settings = useSettingsStore.getState();
      const calendarEventsRepointed = settings.calendarEventCategory === name;
      if (calendarEventsRepointed) settings.setCalendarEventCategory(moveTo);
      if (settings.collapsedCategories.includes(name)) {
        settings.setCollapsedCategories(settings.collapsedCategories.filter(c => c !== name));
      }
      const kinds = categoryStore.clearGeneratedCategorySettings(name, moveTo);
      useCategoryStore.getState().deleteCategory(name);
      refresh();

      const labelOf = new Map(generatedKinds.GENERATED_KIND_LIST.map(spec => [spec.kind, spec.label]));
      return {
        name,
        movedTo: moveTo,
        tasksMoved: taskIds.length,
        stacksMoved: groups.length,
        automationsRepointed: kinds.map(k => labelOf.get(k) ?? k),
        calendarEventsRepointed,
      };
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
        // A question that takes several answers gets them joined with commas,
        // unless an option itself holds a comma and the whole string is one.
        const spell = (text: string) => question.options.find(o => o.trim().toLowerCase() === text.trim().toLowerCase());
        let value = question.kind === 'choice' ? spell(raw) ?? raw : raw;
        if (question.kind === 'choice' && question.multiple && spell(raw) === undefined) {
          const parts = raw.split(',').map(part => spell(part) ?? part.trim()).filter(Boolean);
          const bad = parts.filter(part => !question.options.includes(part));
          if (bad.length > 0 || parts.length === 0) errors.push(`"${name}" must be some of ${question.options.join(', ')}.`);
          else value = templateQuestions.encodeAnswerValues(question.options.filter(o => parts.includes(o)));
        } else if (question.kind === 'choice' && !question.options.includes(value)) errors.push(`"${name}" must be one of ${question.options.join(', ')}.`);
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
        planning: run.planning === true,
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

    markDoneByOther(id: string): CompletedResult {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      const refusal = completion.completionRefusal(task);
      if (refusal) throw new Error(refusal);
      return finishCompletion(task, undefined, 'other');
    },

    reopenTask(id: string): { task: Task; removed: Task[] } {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (!task.completed) throw new Error('That task is not completed, so there is nothing to reopen.');
      const refusal = reopenRefusal(task);
      if (refusal) throw new Error(refusal);
      return reopenCore(task);
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

    deleteTask(id: string): DeletedTask {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (task.generatedKind) {
        throw new Error(`"${task.title}" was written by the app (${task.generatedKind}). Deleting one in the app also tells its source not to make it again, which this server cannot do, so the phone would just add it back. Delete it in the app, or archive it with archive_task.`);
      }
      const subtasks = tasks().filter(t => t.parentId === id);
      // A checklist item carrying a stretch of its parent's countdown is part
      // of that countdown's length (timerSegments.ts), so the parent is
      // re-totalled, as the app's deleteSubtask does. The last stretch going
      // leaves the total where it was rather than clearing it.
      const parent = task.parentId ? tasks().find(t => t.id === task.parentId) ?? null : null;
      const retotal = parent !== null && parent.timedMinutes != null && timerSegments.segmentMinutesOf(task) !== null;
      db.dbTransaction(() => {
        db.dbDeleteSubtasks(id);
        db.dbDeleteTask(id);
        if (retotal) {
          const total = timerSegments.apportionedMinutes(tasks().filter(t => t.parentId === parent!.id && t.id !== id));
          if (total !== null) db.dbUpdateTask({ ...parent!, timedMinutes: total });
        }
      });
      refresh();
      return { task, subtasks };
    },

    skipOccurrence(id: string): Task {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (task.completed || task.archived) throw new Error('Only an open task has an occurrence to skip.');
      if (task.recurrenceType === 'none') throw new Error(`"${task.title}" doesn't repeat, so there is no next occurrence to skip to. Use defer_task to move it, or archive_task to put it away.`);
      const patch = taskSkip.skipPatch(task, useSettingsStore.getState().dayResetTime);
      if (!patch) throw new Error(`"${task.title}" has no occurrence after this one: its repeat has ended. Complete it or archive it instead.`);
      const updated = taskUpdate.mergeTaskUpdate(task, patch, {
        scope: 'series',
        freshPinnedOrder: 0,
        dayResetTime: useSettingsStore.getState().dayResetTime,
      });
      db.dbUpdateTask(updated);
      refresh();
      return updated;
    },

    reorderTasks(scope: ReorderScope, ids: string[]): { before: Task; after: Task }[] {
      const all = tasks();
      const wanted = [...new Set(ids)];
      let members: Task[];
      let updates: { id: string; sortOrder?: number; pinnedOrder?: number }[];
      const fullOrder = (current: Task[]): string[] => {
        const unknown = wanted.filter(id => !current.some(t => t.id === id));
        if (unknown.length > 0) throw new Error(`Not in that list: ${unknown.join(', ')}.`);
        return [...wanted, ...current.map(t => t.id).filter(id => !wanted.includes(id))];
      };
      if ('projectId' in scope) {
        if (!projects().some(p => p.id === scope.projectId)) throw new Error(`No project with id ${scope.projectId}.`);
        // Slots, not 1..N: a project's tasks share the one sortOrder space with
        // every loose task on Today (see projectOrder.slotUpdates).
        members = projectOrder.liveProjectSteps(scope.projectId, all);
        const order = fullOrder(members);
        updates = projectOrder.slotUpdates(members, order);
      } else if ('parentId' in scope) {
        const parent = all.find(t => t.id === scope.parentId);
        if (!parent) throw new Error(`No task with id ${scope.parentId}.`);
        members = all.filter(t => t.parentId === scope.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
        updates = fullOrder(members).map((id, i) => ({ id, sortOrder: i + 1 }));
      } else if ('stackId' in scope) {
        if (!db.dbGetAllTaskGroups().some(g => g.id === scope.stackId)) throw new Error(`No stack with id ${scope.stackId}.`);
        // A stack's own 1..K space. Finished rows keep their slots
        // (reorderSubset), as the app's drag over the members on screen does.
        const children = all.filter(t => t.groupId === scope.stackId).sort((a, b) => a.sortOrder - b.sortOrder);
        members = children;
        const live = children.filter(t => !t.completed && !t.archived);
        const liveOrder = fullOrder(live);
        const { reorderSubset } = require('../../src/utils/reorder') as typeof import('../../src/utils/reorder'); // eslint-disable-line @typescript-eslint/no-require-imports
        updates = reorderSubset(children.map(t => t.id), liveOrder).map((id, i) => ({ id, sortOrder: i + 1 }));
      } else {
        // The Pinned block's own number space (Task.pinnedOrder); 0 is "never
        // ranked", which sorts by sortOrder, so the rest are ranked too.
        members = all.filter(t => t.pinned && !t.completed && !t.archived && !t.parentId)
          .sort((a, b) => (a.pinnedOrder || Infinity) - (b.pinnedOrder || Infinity) || a.sortOrder - b.sortOrder);
        updates = fullOrder(members).map((id, i) => ({ id, pinnedOrder: i + 1 }));
      }
      const byId = new Map(members.map(t => [t.id, t]));
      const changed = updates
        .map(u => ({ before: byId.get(u.id)!, after: { ...byId.get(u.id)!, ...u } as Task }))
        .filter(c => c.before.sortOrder !== c.after.sortOrder || c.before.pinnedOrder !== c.after.pinnedOrder);
      db.dbTransaction(() => {
        const sorts = changed.filter(c => c.before.sortOrder !== c.after.sortOrder).map(c => ({ id: c.after.id, sortOrder: c.after.sortOrder }));
        const pins = changed.filter(c => c.before.pinnedOrder !== c.after.pinnedOrder).map(c => ({ id: c.after.id, pinnedOrder: c.after.pinnedOrder }));
        if (sorts.length > 0) db.dbBatchUpdateSortOrders(sorts);
        if (pins.length > 0) db.dbBatchUpdatePinnedOrders(pins);
      });
      refresh();
      return changed.map(c => ({ before: c.before, after: tasks().find(t => t.id === c.after.id) ?? c.after }));
    },

    setTaskDates(id: string, wantedDates: Date[], monthly: boolean): { task: Task; added: Task[]; removed: Task[] } {
      const anchor = tasks().find(t => t.id === id);
      if (!anchor) throw new Error(`No task with id ${id}.`);
      if (anchor.completed || anchor.archived) throw new Error('Only an open task can be given dates.');
      if (anchor.parentId) throw new Error('A checklist item has no dates of its own.');
      if (anchor.chainEnabled && anchor.chainItems.length > 1) throw new Error('A chain moves through its steps one at a time, so it cannot sit on several dates. Remove the chain first.');
      const keys = new Set<string>();
      const unique = wantedDates.filter(d => {
        const key = taskDates.calendarDayKey(d);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      });
      const repeat = monthly && unique.length > 1 ? { monthDays: [...new Set(unique.map(d => d.getDate()))].sort((a, b) => a - b), repeatMonths: 1 } : undefined;
      const merge = (task: Task, patch: Partial<Task>): Task => taskUpdate.mergeTaskUpdate(task, patch, {
        scope: 'series',
        freshPinnedOrder: 0,
        dayResetTime: useSettingsStore.getState().dayResetTime,
      });
      const step = taskDates.datesAnchorStep(anchor, tasks(), unique, repeat, generateId);
      const added: Task[] = [];
      const removed: Task[] = [];
      db.dbTransaction(() => {
        if (step.kind === 'dissolve') {
          for (const t of step.dropped) { db.dbDeleteSubtasks(t.id); db.dbDeleteTask(t.id); }
          for (const t of step.unfiled) db.dbUpdateTask(t);
          removed.push(...step.dropped);
        }
        db.dbUpdateTask(merge(anchor, step.patch));
        if (step.kind !== 'series') return;
        const fresh = db.dbGetAllTasks();
        const plan = taskDates.datesReconcile(
          taskDates.seriesRows(fresh, step.seriesId), id, step, repeat,
          fresh.reduce((m, t) => Math.max(m, t.sortOrder), 0),
        );
        for (const t of plan.removed) { db.dbDeleteSubtasks(t.id); db.dbDeleteTask(t.id); }
        for (const t of plan.added) db.dbInsertTask(t);
        for (const t of plan.rewritten) db.dbUpdateTask(t);
        removed.push(...plan.removed);
        added.push(...plan.added);
      });
      refresh();
      return { task: tasks().find(t => t.id === id)!, added, removed };
    },

    duplicateTask(id: string): Task {
      const original = tasks().find(t => t.id === id);
      if (!original) throw new Error(`No task with id ${id}.`);
      if (original.parentId) throw new Error('A checklist item is copied with the task it belongs to. Duplicate that task, or add the item with create_task and parentId.');
      const { copy, subtaskCopies } = taskDuplicate.duplicateRows(original, tasks().filter(t => t.parentId === id), {
        now: new Date().toISOString(),
        sortOrder: tasks().reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1,
        newId: generateId,
      });
      db.dbTransaction(() => {
        db.dbInsertTask(copy);
        for (const sub of subtaskCopies) db.dbInsertTask(sub);
      });
      refresh();
      return copy;
    },

    deleteTag(tag: string): { before: Task; after: Task }[] {
      const name = tag.trim().toLowerCase();
      const known = replica.tagList();
      const match = known.find(t => t.toLowerCase() === name);
      if (!match) throw new Error(`No tag "${tag}". The tags are: ${known.join(', ') || 'none yet'}.`);
      const affected = tasks().filter(t => t.tags.includes(match));
      db.dbTransaction(() => {
        db.dbRemoveTagFromAllTasks(match);
        db.dbRemoveFromTagRegistry(match);
      });
      refresh();
      return affected.map(before => ({ before, after: tasks().find(t => t.id === before.id)! }));
    },

    setCompletedAt(id: string, at: Date): Task {
      const task = tasks().find(t => t.id === id);
      if (!task) throw new Error(`No task with id ${id}.`);
      if (!task.completed) throw new Error(`"${task.title}" isn't completed, so it has no completion date to change.`);
      if (Number.isNaN(at.getTime())) throw new Error('That is not a date I can read.');
      if (at.getTime() > Date.now()) throw new Error('A completion cannot be in the future.');
      const updated = taskUpdate.mergeTaskUpdate(task, { completedAt: at.toISOString() }, {
        scope: 'series',
        freshPinnedOrder: 0,
        dayResetTime: useSettingsStore.getState().dayResetTime,
      });
      db.dbUpdateTask(updated);
      refresh();
      return updated;
    },

    tagList(): string[] {
      return [...new Set([...db.dbGetTagRegistry(), ...tasks().flatMap(t => t.tags)])].sort((a, b) => a.localeCompare(b));
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
      // Already per list: planGroceryAdd reads the entry on the list it adds to.
      return { item: plan.item, isNew: plan.isNew, wasOnList: plan.wasOnList };
    },

    plannedIngredients(source: { recipeId: string; scale?: number } | { from: string; to: string }, listId: string | null): PlannedIngredientRow[] {
      const mpg = require('../../src/utils/mealPlanGroceries') as typeof import('../../src/utils/mealPlanGroceries'); // eslint-disable-line @typescript-eslint/no-require-imports
      const lists = require('../../src/utils/groceryLists') as typeof import('../../src/utils/groceryLists'); // eslint-disable-line @typescript-eslint/no-require-imports
      const items = db.dbGetAllGroceryItems();
      const products = db.dbGetAllItemProducts();
      const subs = db.dbGetAllItemSubLinks();
      const recipes = db.dbGetAllRecipes();
      const recipesById = new Map(recipes.map(r => [r.id, r]));
      const swaps = standingSwaps.standingSwapMap(subs, items);
      const onHand = grocerySuggest.onHandNameKeys(items, new Date(), products);
      let planned: ReturnType<typeof mpg.collectPlannedIngredients>;
      if ('recipeId' in source) {
        const recipe = recipesById.get(source.recipeId);
        if (!recipe) throw new Error(`No recipe with id ${source.recipeId}. list_recipes names them.`);
        planned = mpg.plannedIngredientsForRecipe(recipe, recipesById, { onHand }, source.scale ?? 1, swaps);
      } else {
        const entries = db.dbGetMealPlanEntries(source.from, source.to);
        planned = mpg.collectPlannedIngredients(entries, recipesById, { startKey: source.from, endKey: source.to }, swaps, onHand);
      }
      const classified = mpg.classifyPlanned(planned, items, new Date(), subs, lists.trolleyStateFor(db.dbGetAllGroceryListEntries(), listId), products);
      return classified.map(r => ({
        name: r.name, nameKey: r.nameKey, quantity: r.quantity, aisle: r.aisle, category: r.category, reason: r.reason ?? null,
        sources: r.sources, optional: !!r.optional, choiceGroup: r.choiceGroup ?? null,
        sourceRecipeId: r.sourceRecipeId ?? null, sourceRecipeTitle: r.sourceRecipeTitle ?? null,
      }));
    },

    addPlannedToList(rows: PlannedRow[], listId: string | null): PlannedAddResult {
      const mpg = require('../../src/utils/mealPlanGroceries') as typeof import('../../src/utils/mealPlanGroceries'); // eslint-disable-line @typescript-eslint/no-require-imports
      const lists = require('../../src/utils/groceryLists') as typeof import('../../src/utils/groceryLists'); // eslint-disable-line @typescript-eslint/no-require-imports
      const plural = require('../../src/utils/groceryPlural') as typeof import('../../src/utils/groceryPlural'); // eslint-disable-line @typescript-eslint/no-require-imports
      const result: PlannedAddResult = { added: [], alreadyOnList: [], toppedUp: [], skippedInCart: [] };
      // One opaque id per incoming either/or key, as addFromPlan mints them.
      const groupIds = new Map<string, string>();
      const groupIdFor = (key: string) => groupIds.get(key) ?? (groupIds.set(key, generateId()), groupIds.get(key)!);
      db.dbTransaction(() => {
        for (const row of rows) {
          const items = db.dbGetAllGroceryItems();
          const existing = plural.catalogItemForKey(parse.groceryNameKey(row.name), items) ?? undefined;
          const entry = existing ? lists.entryFor(db.dbGetAllGroceryListEntries(), existing.id, listId) : undefined;
          if (existing && entry?.checked) { result.skippedInCart.push(existing); continue; }
          if (existing && entry) {
            // mergeOnListRecipeNeed: a recipe amount tops up a recipe-owned
            // quantity, and a row wanted by two recipes credits neither.
            const patch = { ...existing };
            let changed = false;
            if (row.quantity && existing.quantityFromRecipe) {
              const merged = mpg.mergeQuantities([existing.quantity ?? '', row.quantity]);
              if (merged && merged !== existing.quantity) { patch.quantity = merged; changed = true; }
            }
            if (existing.sourceRecipeId && row.sourceRecipeId !== existing.sourceRecipeId) {
              patch.sourceRecipeId = null;
              patch.sourceRecipeTitle = null;
              changed = true;
            }
            if (changed) db.dbUpdateGroceryItem(patch);
            if (changed && patch.quantity !== existing.quantity) result.toppedUp.push(patch);
            result.alreadyOnList.push(changed ? patch : existing);
            continue;
          }
          const order = aisles.normalizeAisleOrder(db.dbGetGroceryAisleOrder(), items.map(i => i.aisle), db.dbGetGroceryHiddenAisles());
          const overrides = db.dbGetGroceryAisleOverrides();
          const plan = groceryAdd.planGroceryAdd(
            row.name,
            { items, itemProducts: db.dbGetAllItemProducts(), listEntries: db.dbGetAllGroceryListEntries(), aisleOverrides: overrides, aisleOrder: order, listId, now: new Date().toISOString() },
            row.choiceGroup ? { ...parse.parseGroceryInput(row.name), choiceGroup: groupIdFor(row.choiceGroup) } : undefined,
            row.sourceRecipeId ? { recipeId: row.sourceRecipeId, recipeTitle: row.sourceRecipeTitle ?? '' } : undefined,
          );
          let item = plan.item;
          // The recipe's aisle files the row unless the person already filed
          // that name somewhere (setAisle, which also remembers the filing).
          const key = parse.groceryNameKey(row.name);
          if (row.aisle && !overrides[key]) {
            item = { ...item, aisle: aisles.placeAisle(row.aisle, order) };
            const remembered = aisles.rememberAisles(overrides, [{ nameKey: item.nameKey, aisle: item.aisle }]);
            if (remembered) db.dbSetGroceryAisleOverrides(remembered);
          }
          // A cooking amount only fills an empty or recipe-owned quantity.
          if (row.quantity && (!item.quantity || item.quantityFromRecipe)) item = { ...item, quantity: row.quantity, quantityFromRecipe: true };
          if (plan.product) db.dbSetItemProduct(plan.product);
          if (plan.isNew) db.dbInsertGroceryItem(item);
          else db.dbUpdateGroceryItem(item);
          if (plan.entry) db.dbSetGroceryListEntry(plan.entry);
          result.added.push(item);
        }
      });
      refresh();
      return result;
    },

    addChoiceToList(options: { name: string; quantity?: string | null }[], listId: string | null): GroceryItem[] {
      const named = options.filter(o => o.name.trim());
      if (named.length < 2) throw new Error('An either/or needs at least two options.');
      const group = generateId();
      const added: GroceryItem[] = [];
      db.dbTransaction(() => {
        for (const option of named) {
          const items = db.dbGetAllGroceryItems();
          const parsed = parse.parseGroceryInput(option.name);
          const plan = groceryAdd.planGroceryAdd(option.name, {
            items, itemProducts: db.dbGetAllItemProducts(), listEntries: db.dbGetAllGroceryListEntries(),
            aisleOverrides: db.dbGetGroceryAisleOverrides(),
            aisleOrder: aisles.normalizeAisleOrder(db.dbGetGroceryAisleOrder(), items.map(i => i.aisle), db.dbGetGroceryHiddenAisles()),
            listId, now: new Date().toISOString(),
          }, { name: parsed.name, quantity: option.quantity ?? parsed.quantity, choiceGroup: group });
          if (plan.product) db.dbSetItemProduct(plan.product);
          if (plan.isNew) db.dbInsertGroceryItem(plan.item);
          else db.dbUpdateGroceryItem(plan.item);
          if (plan.entry) db.dbSetGroceryListEntry(plan.entry);
          added.push(plan.item);
        }
      });
      refresh();
      return added;
    },

    settleChoice(itemId: string, listId: string | null, keepAll: boolean): { kept: GroceryItem[]; removed: GroceryItem[] } {
      const items = db.dbGetAllGroceryItems();
      const item = items.find(i => i.id === itemId);
      if (!item) throw new Error(`No grocery item with id ${itemId}.`);
      const entries = db.dbGetAllGroceryListEntries().filter(e => e.listId === listId);
      const entry = entries.find(e => e.itemId === itemId);
      if (!entry?.choiceGroup) throw new Error(`"${item.name}" is not one of an either/or on that list.`);
      const group = entries.filter(e => e.choiceGroup === entry.choiceGroup);
      const byId = new Map(items.map(i => [i.id, i]));
      db.dbTransaction(() => {
        if (keepAll) {
          for (const e of group) db.dbSetGroceryListEntry({ ...e, choiceGroup: null });
          return;
        }
        // resolveChoice: the others are parked (a recipe's amount was for this
        // shop only) and taken off this list.
        for (const e of group) {
          if (e.itemId === itemId) { db.dbSetGroceryListEntry({ ...e, choiceGroup: null }); continue; }
          const loser = byId.get(e.itemId);
          if (loser) db.dbUpdateGroceryItem({ ...loser, quantity: loser.quantityFromRecipe ? null : loser.quantity, quantityFromRecipe: false });
          db.dbDeleteGroceryListEntry(e.itemId, listId);
        }
      });
      refresh();
      const fresh = new Map(db.dbGetAllGroceryItems().map(i => [i.id, i]));
      const others = group.filter(e => e.itemId !== itemId).map(e => fresh.get(e.itemId)!).filter(Boolean);
      return keepAll ? { kept: group.map(e => fresh.get(e.itemId)!).filter(Boolean), removed: [] } : { kept: [fresh.get(itemId)!], removed: others };
    },

    swapForSubstitute(itemId: string, subItemId: string, listId: string | null): { removed: GroceryItem; added: GroceryItem } {
      const items = db.dbGetAllGroceryItems();
      const item = items.find(i => i.id === itemId);
      const sub = items.find(i => i.id === subItemId);
      if (!item || !sub) throw new Error('Both the item and its substitute have to be in the catalog.');
      const entries = db.dbGetAllGroceryListEntries();
      const entry = entries.find(e => e.itemId === itemId && e.listId === listId);
      if (!entry) throw new Error(`"${item.name}" is not on that list, so there is nothing to swap.`);
      const link = db.dbGetAllItemSubLinks().find(l => l.itemId === itemId && l.subItemId === subItemId);
      if (!link) throw new Error(`"${sub.name}" isn't a substitute for "${item.name}". Link it first with update_grocery_item's addSubstitutes.`);
      const itemSubs = require('../../src/utils/itemSubs') as typeof import('../../src/utils/itemSubs'); // eslint-disable-line @typescript-eslint/no-require-imports
      const converted = item.quantity && link.ratioFrom && link.ratioTo ? itemSubs.substituteQuantity(item.quantity, link.ratioFrom, link.ratioTo) : null;
      const q = converted?.converted ? converted.text : null;
      const now = new Date().toISOString();
      db.dbTransaction(() => {
        if (!entries.some(e => e.itemId === subItemId && e.listId === listId)) {
          db.dbUpdateGroceryItem({ ...sub, quantity: q ?? sub.quantity, quantityFromRecipe: q ? item.quantityFromRecipe : sub.quantityFromRecipe, lastAddedAt: now });
          db.dbSetGroceryListEntry({ ...entry, itemId: subItemId, checked: false, addedAt: now });
        }
        db.dbUpdateGroceryItem({ ...item, quantity: item.quantityFromRecipe ? null : item.quantity, quantityFromRecipe: false });
        db.dbDeleteGroceryListEntry(itemId, listId);
      });
      refresh();
      const fresh = db.dbGetAllGroceryItems();
      return { removed: fresh.find(i => i.id === itemId)!, added: fresh.find(i => i.id === subItemId)! };
    },

    clearGroceryList(listId: string | null): { cleared: number; deleted: string[] } {
      const facts = require('../../src/utils/groceryFacts') as typeof import('../../src/utils/groceryFacts'); // eslint-disable-line @typescript-eslint/no-require-imports
      const deleted: string[] = [];
      let cleared = 0;
      db.dbTransaction(() => {
        const ids = db.dbClearGroceryList(listId);
        cleared = ids.length;
        if (ids.length === 0) return;
        const items = db.dbGetAllGroceryItems();
        const stillListed = new Set(db.dbGetAllGroceryListEntries().map(e => e.itemId));
        const linked = facts.linkCounts({ products: db.dbGetAllItemProducts(), subs: db.dbGetAllItemSubLinks(), shops: db.dbGetAllItemShopLinks(), aliases: db.dbGetAllStoreAliases() });
        for (const id of ids) {
          const item = items.find(i => i.id === id);
          if (!item || stillListed.has(id)) continue;
          // A row nobody wrote anything about goes; one with history stays in
          // the catalog with its recipe amount (for this shop only) dropped.
          if (!facts.hasUserFacts(item, linked)) { db.dbDeleteGroceryItem(id); deleted.push(item.name); continue; }
          if (item.quantityFromRecipe || item.sourceRecipeId) {
            db.dbUpdateGroceryItem({ ...item, quantity: item.quantityFromRecipe ? null : item.quantity, quantityFromRecipe: false, sourceRecipeId: null, sourceRecipeTitle: null });
          }
        }
        if (db.dbGetTripShopId()) db.dbSetTrip(null, null, null);
      });
      refresh();
      return { cleared, deleted };
    },

    setTrip(change: { shopId: string; budgetMinor?: number | null } | { budgetMinor: number | null } | { end: true }) {
      const shops = db.dbGetAllGroceryShops();
      const current = { shopId: db.dbGetTripShopId(), startedAt: db.dbGetTripStartedAt(), budget: db.dbGetTripBudgetMinor() };
      const checkBudget = (b: number | null | undefined) => {
        if (b != null && (!Number.isInteger(b) || b <= 0)) throw new Error('A budget is a positive whole number of cents (minor units).');
      };
      if ('end' in change) db.dbSetTrip(null, null, null);
      else if ('shopId' in change) {
        if (!shops.some(sh => sh.id === change.shopId)) throw new Error(`No store with id ${change.shopId}. grocery_setup lists them.`);
        checkBudget(change.budgetMinor);
        const activeTrip = require('../../src/utils/activeTrip') as typeof import('../../src/utils/activeTrip'); // eslint-disable-line @typescript-eslint/no-require-imports
        const live = activeTrip.resolveActiveTrip(current.shopId, current.startedAt, shops, new Date());
        const budget = change.budgetMinor !== undefined ? change.budgetMinor : (live ? current.budget : null);
        db.dbSetTrip(change.shopId, new Date().toISOString(), budget);
      } else {
        if (!current.shopId || !current.startedAt) throw new Error('No trip is going: start one with a store first.');
        checkBudget(change.budgetMinor);
        db.dbSetTrip(current.shopId, current.startedAt, change.budgetMinor);
      }
      const shopId = db.dbGetTripShopId();
      return { shop: shops.find(sh => sh.id === shopId) ?? null, startedAt: db.dbGetTripStartedAt(), budgetMinor: db.dbGetTripBudgetMinor() };
    },

    setItemUnavailable(itemId: string, shopId: string, unavailable: boolean, brandOnly: boolean): void {
      const item = db.dbGetAllGroceryItems().find(i => i.id === itemId);
      if (!item) throw new Error(`No grocery item with id ${itemId}.`);
      if (!db.dbGetAllGroceryShops().some(sh => sh.id === shopId)) throw new Error(`No store with id ${shopId}. grocery_setup lists them.`);
      const link = db.dbGetAllItemShopLinks().find(l => l.itemId === itemId && l.shopId === shopId);
      const now = new Date().toISOString();
      const base = {
        itemId, shopId, purchaseCount: link?.purchaseCount ?? 0, lastPurchasedAt: link?.lastPurchasedAt ?? null,
        unavailableAt: link?.unavailableAt ?? null, unavailableProductIds: { ...(link?.unavailableProductIds ?? {}) },
        productId: link?.productId ?? null, lastPriceMinor: link?.lastPriceMinor ?? null, lastPricedAt: link?.lastPricedAt ?? null,
        lastPriceQuantity: link?.lastPriceQuantity ?? null, priceHistory: link?.priceHistory ?? [],
      };
      if (!brandOnly) {
        // markItemsUnavailable stamps; a purchase is what clears it in the app,
        // and taking a claim back here clears the stamp the same way.
        if (unavailable && link?.unavailableAt) return;
        if (!unavailable && !link?.unavailableAt) return;
        db.dbSetItemShopLink({ ...base, unavailableAt: unavailable ? now : null });
      } else {
        const productId = item.preferredProductId;
        if (!productId || !db.dbGetAllItemProducts().some(p => p.id === productId && p.itemId === itemId)) {
          throw new Error(`"${item.name}" has no preferred brand to mark. Set one with update_grocery_item's preferredBoxId.`);
        }
        if (unavailable) base.unavailableProductIds[productId] = now;
        else delete base.unavailableProductIds[productId];
        if (!unavailable && Object.keys(base.unavailableProductIds).length === 0 && base.purchaseCount === 0 && !base.unavailableAt) {
          if (link) db.dbDeleteItemShopLink(itemId, shopId);
        } else db.dbSetItemShopLink(base);
      }
      refresh();
    },

    setNutritionPanel(itemId: string, boxId: string | null, panel: FoodNutrition | null): void {
      const item = db.dbGetAllGroceryItems().find(i => i.id === itemId);
      if (!item) throw new Error(`No grocery item with id ${itemId}.`);
      if (boxId) {
        const box = db.dbGetAllItemProducts().find(p => p.id === boxId && p.itemId === itemId);
        if (!box) throw new Error(`"${item.name}" has no box with id ${boxId}.`);
        db.dbSetItemProduct({ ...box, nutrition: panel });
      } else {
        db.dbUpdateGroceryItem({ ...item, nutrition: panel });
      }
      refresh();
    },

    saveAisle(name: string, change: { newName?: string; delete?: boolean; nonFood?: boolean }): { aisle: string | null; itemsMoved: number } {
      const items = db.dbGetAllGroceryItems();
      const order = aisles.normalizeAisleOrder(db.dbGetGroceryAisleOrder(), items.map(i => i.aisle), db.dbGetGroceryHiddenAisles());
      const found = order.find(a => a.toLowerCase() === name.trim().toLowerCase()) ?? null;
      const commit = (next: string[]) => {
        const used = db.dbGetAllGroceryItems().map(i => i.aisle);
        const hidden = aisles.hiddenDefaultAisles(next);
        db.dbSetGroceryAisleOrder(aisles.normalizeAisleOrder(next, used, hidden));
        db.dbSetGroceryHiddenAisles(hidden);
      };
      const settings = useSettingsStore.getState();
      let itemsMoved = 0;
      let result: string | null = found;
      db.dbTransaction(() => {
        if (change.delete) {
          if (!found) throw new Error(`No aisle called "${name}". grocery_setup lists them.`);
          if (found === aisles.OTHER_AISLE) throw new Error(`"${aisles.OTHER_AISLE}" is where everything unfiled goes, so it cannot be deleted.`);
          for (const item of items.filter(i => i.aisle === found)) { db.dbUpdateGroceryItem({ ...item, aisle: aisles.OTHER_AISLE }); itemsMoved += 1; }
          const forgotten = aisles.forgetRememberedAisle(db.dbGetGroceryAisleOverrides(), found);
          if (forgotten) db.dbSetGroceryAisleOverrides(forgotten);
          db.dbSetGroceryNonFoodAisles(db.dbGetGroceryNonFoodAisles().filter(a => a !== found));
          for (const shop of db.dbGetAllGroceryShops()) {
            if (shop.aisles?.includes(found)) { const next = shop.aisles.filter(a => a !== found); db.dbSetShopAisles(shop.id, next.length ? next : null); }
            if (shop.aisleOrder?.includes(found)) { const next = shop.aisleOrder.filter(a => a !== found); db.dbSetShopAisleOrder(shop.id, next.length ? next : null); }
          }
          commit(order.filter(a => a !== found && a !== aisles.OTHER_AISLE));
          if (settings.collapsedGroceryGroups.includes(`aisle:${found}`)) settings.setCollapsedGroceryGroups(settings.collapsedGroceryGroups.filter(g => g !== `aisle:${found}`));
          result = null;
          return;
        }
        if (!found) {
          if (change.newName !== undefined) throw new Error(`No aisle called "${name}". grocery_setup lists them.`);
          if (!name.trim()) throw new Error('An aisle needs a name.');
          result = name.trim();
          commit([...order.filter(a => a !== aisles.OTHER_AISLE), result]);
        }
        if (change.newName !== undefined && found) {
          const to = change.newName.trim();
          if (!to) throw new Error('An aisle needs a name.');
          if (found === aisles.OTHER_AISLE || to === aisles.OTHER_AISLE) throw new Error(`"${aisles.OTHER_AISLE}" cannot be renamed, or taken as a name.`);
          if (order.some(a => a !== found && a.toLowerCase() === to.toLowerCase())) throw new Error(`There is already an aisle called "${to}".`);
          if (to !== found) {
            for (const item of items.filter(i => i.aisle === found)) { db.dbUpdateGroceryItem({ ...item, aisle: to }); itemsMoved += 1; }
            const remapped = aisles.remapRememberedAisle(db.dbGetGroceryAisleOverrides(), found, to);
            if (remapped) db.dbSetGroceryAisleOverrides(remapped);
            db.dbSetGroceryNonFoodAisles(db.dbGetGroceryNonFoodAisles().map(a => (a === found ? to : a)));
            for (const shop of db.dbGetAllGroceryShops()) {
              if (shop.aisles?.includes(found)) db.dbSetShopAisles(shop.id, shop.aisles.map(a => (a === found ? to : a)));
              if (shop.aisleOrder?.includes(found)) db.dbSetShopAisleOrder(shop.id, shop.aisleOrder.map(a => (a === found ? to : a)));
            }
            commit(order.filter(a => a !== aisles.OTHER_AISLE).map(a => (a === found ? to : a)));
            if (settings.collapsedGroceryGroups.includes(`aisle:${found}`)) settings.setCollapsedGroceryGroups(settings.collapsedGroceryGroups.map(g => (g === `aisle:${found}` ? `aisle:${to}` : g)));
          }
          result = to;
        }
        if (change.nonFood !== undefined && result) {
          if (result === aisles.OTHER_AISLE) throw new Error(`"${aisles.OTHER_AISLE}" cannot be marked non-food.`);
          const current = db.dbGetGroceryNonFoodAisles();
          const next = change.nonFood ? [...new Set([...current, result])] : current.filter(a => a !== result);
          db.dbSetGroceryNonFoodAisles(next);
        }
      });
      refresh();
      return { aisle: result, itemsMoved };
    },

    reorderAisles(names: string[]): string[] {
      const items = db.dbGetAllGroceryItems();
      const order = aisles.normalizeAisleOrder(db.dbGetGroceryAisleOrder(), items.map(i => i.aisle), db.dbGetGroceryHiddenAisles());
      const named = names.map(n => {
        const hit = order.find(a => a.toLowerCase() === n.trim().toLowerCase());
        if (!hit) throw new Error(`No aisle called "${n}". grocery_setup lists them.`);
        return hit;
      });
      const next = [...new Set(named), ...order.filter(a => !named.includes(a))];
      const hidden = aisles.hiddenDefaultAisles(next);
      db.dbSetGroceryAisleOrder(aisles.normalizeAisleOrder(next, items.map(i => i.aisle), hidden));
      db.dbSetGroceryHiddenAisles(hidden);
      refresh();
      return aisles.normalizeAisleOrder(db.dbGetGroceryAisleOrder(), items.map(i => i.aisle), db.dbGetGroceryHiddenAisles());
    },

    deleteShop(id: string): Shop {
      const shop = db.dbGetAllGroceryShops().find(sh => sh.id === id);
      if (!shop) throw new Error(`No store with id ${id}. grocery_setup lists them.`);
      db.dbTransaction(() => {
        db.dbDeleteGroceryShop(id);
        if (db.dbGetAllGroceryShops().length === 0) db.dbSetLastShopId(null);
        if (db.dbGetTripShopId() === id) db.dbSetTrip(null, null, null);
      });
      refresh();
      return shop;
    },

    updateShopSettings(id: string, patch: { excludeFromSuggestions?: boolean; aisles?: string[] | null; aisleOrder?: string[] | null }): Shop {
      const shop = db.dbGetAllGroceryShops().find(sh => sh.id === id);
      if (!shop) throw new Error(`No store with id ${id}. grocery_setup lists them.`);
      const items = db.dbGetAllGroceryItems();
      const order = aisles.normalizeAisleOrder(db.dbGetGroceryAisleOrder(), items.map(i => i.aisle), db.dbGetGroceryHiddenAisles());
      const resolve = (names: string[]) => names.map(n => {
        const hit = order.find(a => a.toLowerCase() === n.trim().toLowerCase());
        if (!hit) throw new Error(`No aisle called "${n}". grocery_setup lists them.`);
        return hit;
      });
      const shopsUtil = require('../../src/utils/groceryShops') as typeof import('../../src/utils/groceryShops'); // eslint-disable-line @typescript-eslint/no-require-imports
      db.dbTransaction(() => {
        if (patch.excludeFromSuggestions !== undefined) db.dbSetShopExcludeFromSuggestions(id, patch.excludeFromSuggestions);
        if (patch.aisles !== undefined) {
          const list = patch.aisles === null ? null : [...new Set(resolve(patch.aisles))];
          db.dbSetShopAisles(id, list && list.length > 0 ? list : null);
        }
        if (patch.aisleOrder !== undefined) db.dbSetShopAisleOrder(id, patch.aisleOrder === null ? null : shopsUtil.shopAisleOrderToSave(resolve(patch.aisleOrder), order));
      });
      refresh();
      return db.dbGetAllGroceryShops().find(sh => sh.id === id)!;
    },

    reorderShops(ids: string[]): void {
      const shops = [...db.dbGetAllGroceryShops()].sort((a, b) => a.sortOrder - b.sortOrder);
      const unknown = ids.filter(sid => !shops.some(sh => sh.id === sid));
      if (unknown.length > 0) throw new Error(`No store with id ${unknown.join(', ')}.`);
      const order = [...new Set(ids), ...shops.map(sh => sh.id).filter(sid => !ids.includes(sid))];
      db.dbTransaction(() => order.forEach((sid, i) => db.dbUpdateGroceryShop({ ...shops.find(sh => sh.id === sid)!, sortOrder: i + 1 })));
      refresh();
    },

    reorderGroceryLists(ids: string[]): void {
      const lists = [...db.dbGetAllGroceryLists()].sort((a, b) => a.sortOrder - b.sortOrder);
      const unknown = ids.filter(lid => !lists.some(l => l.id === lid));
      if (unknown.length > 0) throw new Error(`No separate list with id ${unknown.join(', ')}.`);
      const order = [...new Set(ids), ...lists.map(l => l.id).filter(lid => !ids.includes(lid))];
      db.dbTransaction(() => order.forEach((lid, i) => db.dbUpdateGroceryList({ ...lists.find(l => l.id === lid)!, sortOrder: i + 1 })));
      refresh();
    },

    mergeGroceryItems(fromId: string, intoId: string): { merged: GroceryItem; from: GroceryItem } {
      const merge = require('../../src/utils/groceryMerge') as typeof import('../../src/utils/groceryMerge'); // eslint-disable-line @typescript-eslint/no-require-imports
      if (fromId === intoId) throw new Error('An item cannot be merged into itself.');
      const plan = merge.planMergeItems(fromId, intoId, {
        items: db.dbGetAllGroceryItems(), itemShops: db.dbGetAllItemShopLinks(), itemSubs: db.dbGetAllItemSubLinks(),
        itemProducts: db.dbGetAllItemProducts(), listEntries: db.dbGetAllGroceryListEntries(),
      });
      if (!plan) throw new Error('Both items have to be in the catalog. get_grocery_item names them.');
      db.dbTransaction(() => {
        db.dbUpdateGroceryItem(plan.merged);
        for (const other of plan.repointedVarieties.values()) db.dbUpdateGroceryItem(other);
        for (const product of plan.mergedProducts) db.dbSetItemProduct(product);
        for (const product of plan.mergedProducts) if (product.gtin) db.dbSetProductGtin(product.id, product.gtin);
        for (const link of plan.mergedShopLinks) db.dbSetItemShopLink(link);
        for (const link of plan.finalRetargetedSubs) db.dbSetItemSubLink(link);
        db.dbRepointStoreAliases(fromId, intoId);
        db.dbDeleteGroceryItem(fromId);
        const remembered = aisles.renameRememberedAisle(db.dbGetGroceryAisleOverrides(), plan.fromItem.nameKey, plan.intoItem.nameKey);
        if (remembered) db.dbSetGroceryAisleOverrides(remembered);
        // Recipe lines find the catalog by name, so they follow the survivor's.
        for (const recipe of recipeUtils.remapIngredientKeyIn(db.dbGetAllRecipes(), plan.fromItem.nameKey, plan.intoItem.nameKey)) db.dbUpdateRecipe(recipe);
        for (const entry of plan.movedEntries) db.dbSetGroceryListEntry(entry);
        for (const gone of plan.removedEntries) db.dbDeleteGroceryListEntry(gone.itemId, gone.listId);
        // A supply task that restocked the loser restocks the survivor.
        for (const t of db.dbGetAllTasks().filter(x => x.supplyGroceryItemId === fromId)) db.dbUpdateTask({ ...t, supplyGroceryItemId: intoId });
        db.dbRepointItemReferences(fromId, intoId, plan.productIdRemap);
      });
      refresh();
      return { merged: db.dbGetAllGroceryItems().find(i => i.id === intoId)!, from: plan.fromItem };
    },

    setGroceryChecked(id: string, checked: boolean, listId: string | null = null): GroceryItem {
      const item = db.dbGetAllGroceryItems().find(i => i.id === id);
      if (!item) throw new Error(`No grocery item with id ${id}.`);

      // Checked belongs to a trolley, so there has to be one holding this item.
      const entry = db.dbGetAllGroceryListEntries().find(e => e.itemId === id && e.listId === listId);
      if (!entry) throw new Error(`"${item.name}" is not on ${listId === null ? 'the home list' : 'that list'}, so there is nothing to check off.`);

      db.dbSetGroceryListEntry({ ...entry, checked });
      // Checking one option of an either/or takes the others off this list,
      // as the app's own tick does (resolveChoice).
      if (checked) resolveChoiceOn(id, listId);
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
    nonFoodAisles: () => db.dbGetGroceryNonFoodAisles(),
    activeTrip: () => {
      const activeTripUtil = require('../../src/utils/activeTrip') as typeof import('../../src/utils/activeTrip'); // eslint-disable-line @typescript-eslint/no-require-imports
      const startedAt = db.dbGetTripStartedAt();
      const shop = activeTripUtil.resolveActiveTrip(db.dbGetTripShopId(), startedAt, db.dbGetAllGroceryShops(), new Date());
      return shop && startedAt ? { shop, startedAt, budgetMinor: db.dbGetTripBudgetMinor() } : null;
    },
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
            resolveChoiceOn(item.id, input.listId);
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
            // Null is "the line has no price" (the tool's own schema), not
            // "clear the stored one", which is what pricedRows does with it.
            if (line.priceMinor !== undefined && line.priceMinor !== null) {
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
        if (change.title !== undefined) {
          const title = (require('../../src/utils/leftovers') as typeof import('../../src/utils/leftovers')).cleanLeftoverTitle(change.title); // eslint-disable-line @typescript-eslint/no-require-imports
          if (!title) throw new Error('A leftover needs a name.');
          save({ ...row, title });
        }
        if (change.storedAt !== undefined) {
          if (Number.isNaN(change.storedAt.getTime())) throw new Error('storedAt is not a date.');
          save(pantryWrite.leftoverStoredAtRow(row, change.storedAt.toISOString()));
        }
        if (change.weightG !== undefined) {
          if (change.weightG !== null && !(change.weightG > 0)) throw new Error('weightG is a weight in grams above zero, or null for unweighed.');
          save({ ...row, weightG: mealLogUtils().clampCookedWeight(change.weightG) });
        }
        if (change.frozen !== undefined) save(pantryWrite.leftoverFrozenRow(row, change.frozen, nowIso));
        if (change.finished === null) save(pantryWrite.leftoverReopenedRow(row));
        else if (change.finished) save(pantryWrite.leftoverFinishedRow(row, change.finished, nowIso));
        if (change.keepDays !== undefined) save(pantryWrite.leftoverKeepDaysRow(row, Math.max(1, Math.round(change.keepDays))));
        // A finished or frozen container has no use-up task, and the phone
        // drops it in the same step (`dropLeftoverTask`); its catch-up pass
        // skips a container that is not live, so nothing else would.
        const after = db.dbGetAllLeftovers().find(l => l.id === id)!;
        if (after.finishedAt || after.frozenAt) dropGeneratedRow('leftoverUseUp', id);
      });
      refresh();
      return db.dbGetAllLeftovers().find(l => l.id === id)!;
    },

    splitLeftover(id: string): { original: Leftover; split: Leftover } {
      const original = db.dbGetAllLeftovers().find(l => l.id === id);
      if (!original) throw new Error(`No leftover with id ${id}.`);
      const draft = pantryWrite.leftoverSplitDraft(original);
      if (!draft) throw new Error(`The ${original.title} is finished, so there is nothing to split.`);
      const split = pantryWrite.newLeftoverRow(draft, generateId(), new Date().toISOString())!;
      db.dbInsertLeftover(split);
      refresh();
      return { original, split };
    },

    deleteLeftover(id: string): Leftover {
      const leftover = db.dbGetAllLeftovers().find(l => l.id === id);
      if (!leftover) throw new Error(`No leftover with id ${id}.`);
      db.dbTransaction(() => {
        db.dbDeleteLeftover(id);
        dropGeneratedRow('leftoverUseUp', id);
      });
      refresh();
      return leftover;
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
            planning: plan.planning === true,
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
        if (taskDefaults !== null && content.taskDefaults === null) throw new Error('taskDefaults: nothing in it is a value I can use. Priority is 0 to 4, difficulty is easy, normal or hard, and effort is 0 to 6 (0 is no estimate).');
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
      const { personIds, links, pausedUntil, planning, nudgeCadenceDays, ...plain } = contentRest as typeof contentRest & Pick<ProjectPatch, 'personIds' | 'links' | 'pausedUntil' | 'planning' | 'nudgeCadenceDays'>;
      const extra: Partial<Pick<Project, 'personIds' | 'links' | 'pausedUntil' | 'nudgeCadenceDays'>> = {};
      if (personIds !== undefined) {
        const known = new Set(people().map(p => p.id));
        const missing = personIds.filter(pid => !known.has(pid));
        if (missing.length > 0) throw new Error(`personIds: no person with id ${missing.join(', ')}. list_people names them.`);
        extra.personIds = [...new Set(personIds)];
      }
      if (links !== undefined) {
        const bad = links.find(l => !l.url?.trim());
        if (bad) throw new Error('Each link needs a url.');
        extra.links = links.map(l => ({ id: generateId(), label: l.label?.trim() || l.url.trim(), url: l.url.trim() }));
      }
      if (planning !== undefined && pausedUntil !== undefined) {
        throw new Error('Pass planning or pausedUntil, not both: Planning is a pause with no day to come back on.');
      }
      if (planning === true) extra.pausedUntil = projectPause.PLANNING_PAUSE_KEY;
      // Marking ready ends Planning only; a dated pause is left to pausedUntil.
      else if (planning === false && projectPause.isPlanning(before)) extra.pausedUntil = null;
      if (pausedUntil !== undefined) {
        if (pausedUntil === null) extra.pausedUntil = null;
        else {
          const key = /^\d{4}-\d{2}-\d{2}$/.exec(pausedUntil.trim())?.[0];
          if (!key) throw new Error('pausedUntil is the day it comes back, YYYY-MM-DD.');
          if (key <= dates.getLogicalDayKey(new Date(), useSettingsStore.getState().dayResetTime)) throw new Error('pausedUntil has to be a day after today. To resume it now, pass null.');
          extra.pausedUntil = key;
        }
      }
      if (nudgeCadenceDays !== undefined) {
        if (!Number.isInteger(nudgeCadenceDays) || nudgeCadenceDays < 0 || nudgeCadenceDays > 365) throw new Error('nudgeCadenceDays is a whole number of days, 0 (never offer) to 365.');
        extra.nudgeCadenceDays = nudgeCadenceDays;
      }
      const fields = { ...plain, ...extra, ...away };
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

    createStack(title: string, category: string | null, projectId: string | null = null): TaskGroup {
      const name = title.trim();
      if (!name) throw new Error('A stack needs a title.');
      if (projectId && !projects().some(p => p.id === projectId)) throw new Error(`No project with id ${projectId}.`);
      let group: TaskGroup | undefined;
      db.dbTransaction(() => {
        ensureCategory(category);
        group = useTaskGroupStore.getState().createGroup(name, category, projectId);
      });
      refresh();
      return group!;
    },

    updateStack(id: string, patch: StackPatch): { stack: TaskGroup; moved: { before: Task; after: Task }[] } {
      const group = db.dbGetAllTaskGroups().find(g => g.id === id);
      if (!group) throw new Error(`No stack with id ${id}.`);
      if (patch.title !== undefined && !patch.title.trim()) throw new Error('A stack needs a title.');
      if (patch.projectId && !projects().some(p => p.id === patch.projectId)) throw new Error(`No project with id ${patch.projectId}.`);
      const errors: string[] = [];
      const category = typeof patch.category === 'string' ? categoryNamed(patch.category, false, errors) : patch.category;
      if (errors.length > 0) throw new Error(errors.join(' '));
      const { title, category: _c, tags, ...rest } = patch;
      const moved: { before: Task; after: Task }[] = [];
      db.dbTransaction(() => {
        useTaskGroupStore.getState().updateGroup(id, {
          ...rest,
          ...(title !== undefined ? { title: title.trim() } : {}),
          ...(tags !== undefined ? { tags: [...new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))] } : {}),
          ...(category !== undefined ? { category } : {}),
        });
        if (category !== undefined && category !== group.category) {
          // applyGroupCategory: the roster, widened to the live rows of any
          // dated set in it, and never a finished row (history keeps its category).
          const children = tasks().filter(t => t.groupId === id);
          const roster = visibility.groupRoster(children);
          const series = new Set(roster.map(t => t.seriesId).filter((x): x is string => x != null));
          const members = new Map(roster.map(t => [t.id, t]));
          for (const child of children) {
            if (child.seriesId && series.has(child.seriesId) && !child.completed && !child.archived) members.set(child.id, child);
          }
          for (const t of members.values()) {
            if (t.category === category || t.completed || t.archived) continue;
            const after = taskUpdate.mergeTaskUpdate(t, { category }, { scope: 'occurrence', freshPinnedOrder: 0, dayResetTime: useSettingsStore.getState().dayResetTime });
            db.dbUpdateTask(after);
            moved.push({ before: t, after });
          }
        }
      });
      refresh();
      return { stack: db.dbGetAllTaskGroups().find(g => g.id === id)!, moved };
    },

    deleteStack(id: string, cascade: boolean): DeletedStackSnapshot {
      const group = db.dbGetAllTaskGroups().find(g => g.id === id);
      if (!group) throw new Error(`No stack with id ${id}.`);
      const children = tasks().filter(t => t.groupId === id);
      const doomed = new Set<string>();
      if (cascade) {
        const series = new Set<string>();
        for (const member of visibility.groupRoster(children)) {
          if (member.completed || member.archived || member.generatedKind) continue;
          doomed.add(member.id);
          if (member.seriesId) series.add(member.seriesId);
        }
        for (const child of children) {
          if (child.seriesId && series.has(child.seriesId) && !child.completed && !child.archived && !child.generatedKind) doomed.add(child.id);
        }
      }
      const deleted = tasks().filter(t => doomed.has(t.id) || (t.parentId !== null && doomed.has(t.parentId)));
      const unfiled = children.filter(t => !doomed.has(t.id));
      db.dbTransaction(() => {
        for (const t of children) {
          if (doomed.has(t.id)) { db.dbDeleteSubtasks(t.id); db.dbDeleteTask(t.id); }
          else db.dbUpdateTask(taskUpdate.mergeTaskUpdate(t, { groupId: null }, { scope: 'occurrence', freshPinnedOrder: 0, dayResetTime: useSettingsStore.getState().dayResetTime }));
        }
        useTaskGroupStore.getState().removeGroupRow(id);
      });
      refresh();
      return { stack: group, deleted, unfiledTaskIds: unfiled.map(t => t.id) };
    },

    renameCategory(name: string, newName: string): { from: string; to: string } {
      const cats = useCategoryStore.getState();
      const category = cats.categories.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
      if (!category) throw new Error(`"${name}" isn't one of your categories. list_categories lists them.`);
      const from = category.name;
      const to = newName.trim();
      if (!to) throw new Error('A category needs a name.');
      if (to === from) throw new Error('That is already its name.');
      if (cats.categories.some(c => c.id !== category.id && c.name.toLowerCase() === to.toLowerCase())) {
        throw new Error(`There is already a category called "${to}". To merge the two, use delete_category with moveTo.`);
      }
      const rename = require('../../src/utils/categoryRename') as typeof import('../../src/utils/categoryRename'); // eslint-disable-line @typescript-eslint/no-require-imports
      const { renameInRuleCategories } = require('../../src/utils/ruleCategory') as typeof import('../../src/utils/ruleCategory'); // eslint-disable-line @typescript-eslint/no-require-imports
      db.dbTransaction(() => {
        // The category row, every task, stack and project default naming it
        // (dbRenameCategory), then everything else the app's rename reaches.
        if (!cats.renameCategory(from, to)) throw new Error(`Could not rename "${from}".`);
        for (const t of db.dbGetAllTasks()) {
          const seriesDefaults = rename.renameInSeriesDefaults(t.seriesDefaults, from, to);
          const followUpTaskDraft = rename.renameInFollowUpDraft(t.followUpTaskDraft, from, to);
          if (seriesDefaults !== t.seriesDefaults || followUpTaskDraft !== t.followUpTaskDraft) db.dbUpdateTask({ ...t, seriesDefaults, followUpTaskDraft });
        }
        const { useSavedViewStore } = require('../../src/store/useSavedViewStore') as typeof import('../../src/store/useSavedViewStore'); // eslint-disable-line @typescript-eslint/no-require-imports
        const views = useSavedViewStore.getState();
        views.initialize();
        for (const v of views.views) {
          const clauses = rename.renameInViewClauses(v.clauses, from, to);
          if (clauses !== v.clauses) views.updateView(v.id, { clauses });
        }
        for (const template of db.dbGetAllTemplates()) {
          if (!template.items.some(i => i.category === from)) continue;
          db.dbUpdateTemplate({ ...template, items: template.items.map(i => (i.category === from ? { ...i, category: to } : i)) });
        }
        categoryStore.renameGeneratedCategorySettings(from, to);
        const settings = useSettingsStore.getState();
        if (settings.calendarEventCategory === from) settings.setCalendarEventCategory(to);
        if (settings.healthCategory === from) settings.setHealthCategory(to);
        if (settings.newTaskDefaults.category === from) settings.setNewTaskDefaults({ category: to });
        const titleRules = rename.renameInTitleRules(settings.titleRules, from, to);
        if (titleRules !== settings.titleRules) settings.setTitleRules(titleRules);
        const weatherRules = renameInRuleCategories(settings.weatherRules, from, to);
        if (weatherRules !== settings.weatherRules) settings.setWeatherRules(weatherRules);
        const screenTimeRules = renameInRuleCategories(settings.screenTimeRules, from, to);
        if (screenTimeRules !== settings.screenTimeRules) settings.setScreenTimeRules(screenTimeRules);
        const healthRules = renameInRuleCategories(settings.healthRules, from, to);
        if (healthRules !== settings.healthRules) settings.setHealthRules(healthRules);
        const eventRules = renameInRuleCategories(settings.eventRules, from, to);
        if (eventRules !== settings.eventRules) settings.setEventRules(eventRules);
        const captures = rename.renameInReminderCaptures(settings.reminderCaptures, from, to);
        if (captures !== settings.reminderCaptures) settings.setReminderCaptures(captures);
        if (settings.collapsedCategories.includes(from)) settings.setCollapsedCategories(settings.collapsedCategories.map(c => (c === from ? to : c)));
      });
      refresh();
      return { from, to };
    },

    updateCategorySettings(name: string, patch: CategorySettingsPatch): Category {
      const cats = useCategoryStore.getState();
      const category = cats.categories.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
      if (!category) throw new Error(`"${name}" isn't one of your categories. list_categories lists them.`);
      const n = category.name;
      const errors: string[] = [];
      const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (patch.schedule) {
        const { days, start, end } = patch.schedule;
        if (days.length === 0 || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) errors.push('schedule.days are 0 (Sunday) to 6, at least one.');
        if (!hhmm.test(start) || !hhmm.test(end)) errors.push('schedule.start and end are "HH:MM", 24-hour.');
      }
      if (patch.defaultTimeSegments && patch.defaultTimeSegments.some(seg => !['morning', 'afternoon', 'evening', 'night'].includes(seg))) {
        errors.push('defaultTimeSegments are morning, afternoon, evening or night.');
      }
      if (errors.length > 0) throw new Error(errors.join(' '));
      db.dbTransaction(() => {
        if (patch.emoji !== undefined) cats.setCategoryEmoji(n, patch.emoji?.trim() || null);
        if (patch.hideOnVacation !== undefined) cats.setCategoryHideOnVacation(n, patch.hideOnVacation);
        if (patch.excludeFromSuggestions !== undefined) cats.setCategoryExcludeFromSuggestions(n, patch.excludeFromSuggestions);
        if (patch.excludeFromNewTasksBanner !== undefined) cats.setCategoryExcludeFromNewTasksBanner(n, patch.excludeFromNewTasksBanner);
        if (patch.defaultTimeSegments !== undefined) cats.setCategoryDefaultTimeSegments(n, patch.defaultTimeSegments);
        if (patch.schedule === null) cats.removeCategorySchedule(n);
        else if (patch.schedule) cats.setCategorySchedule(n, [...new Set(patch.schedule.days)].sort(), patch.schedule.start, patch.schedule.end);
      });
      refresh();
      return useCategoryStore.getState().categories.find(c => c.id === category.id)!;
    },

    reorderCategories(names: string[]): string[] {
      const cats = useCategoryStore.getState();
      const current = [...cats.categories].sort((a, b) => a.sortOrder - b.sortOrder).map(c => c.name);
      const resolved = names.map(name => {
        const hit = current.find(c => c.toLowerCase() === name.trim().toLowerCase());
        if (!hit) throw new Error(`"${name}" isn't one of your categories. list_categories lists them.`);
        return hit;
      });
      const order = [...new Set(resolved), ...current.filter(c => !resolved.includes(c))];
      cats.reorderCategories(order);
      refresh();
      return order;
    },

    deleteProject(id: string, cascade: boolean): DeletedProjectSnapshot {
      const project = projects().find(p => p.id === id);
      if (!project) throw new Error(`No project with id ${id}.`);
      const members = tasks().filter(t => t.projectId === id);
      const doomed = new Set(cascade ? members.filter(t => !t.generatedKind).map(t => t.id) : []);
      const deleted = tasks().filter(t => doomed.has(t.id) || (t.parentId !== null && doomed.has(t.parentId)));
      const unfiled = members.filter(t => !doomed.has(t.id) && !(t.parentId !== null && doomed.has(t.parentId)));
      const homed = useTaskGroupStore.getState().groups.filter(g => g.projectId === id);
      // The quiet-project review task names its project in generatedSourceId
      // and carries no projectId, so the loops above never reach it; with the
      // project gone there is nothing for it to be about (deleteProject's
      // dropGeneratedTask).
      const review = tasks().filter(t => t.generatedKind === 'projectReview' && t.generatedSourceId === id && !t.completed);
      db.dbTransaction(() => {
        for (const t of members) {
          if (doomed.has(t.id)) { db.dbDeleteSubtasks(t.id); db.dbDeleteTask(t.id); }
        }
        for (const t of unfiled) db.dbUpdateTask(taskUpdate.mergeTaskUpdate(t, { projectId: null }, { scope: 'occurrence', freshPinnedOrder: 0, dayResetTime: useSettingsStore.getState().dayResetTime }));
        for (const g of homed) useTaskGroupStore.getState().updateGroup(g.id, { projectId: null });
        for (const t of review) db.dbDeleteTask(t.id);
        useProjectStore.getState().removeProjectRow(id);
      });
      refresh();
      return { project, deleted, unfiledTaskIds: unfiled.filter(t => !t.parentId).map(t => t.id), unfiledStackIds: homed.map(g => g.id) };
    },

    projectCategories() {
      return db.dbGetAllProjectCategories();
    },

    saveProjectCategory(name: string, change: { newName?: string; delete?: boolean }): { name: string | null; projectsAffected: number } {
      const { useProjectCategoryStore } = require('../../src/store/useProjectCategoryStore') as typeof import('../../src/store/useProjectCategoryStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const store = useProjectCategoryStore.getState();
      store.initialize();
      const existing = store.getCategoryByName(name.trim());
      if (change.delete) {
        if (!existing) throw new Error(`No project category called "${name}".`);
        const filed = projects().filter(p => p.category === existing.name);
        db.dbTransaction(() => {
          store.removeCategoryRow(existing.name);
          for (const p of filed) useProjectStore.getState().updateProject(p.id, { category: null });
        });
        refresh();
        return { name: null, projectsAffected: filed.length };
      }
      if (change.newName !== undefined) {
        if (!existing) throw new Error(`No project category called "${name}".`);
        const to = change.newName.trim();
        if (!to) throw new Error('A project category needs a name.');
        const filed = projects().filter(p => p.category === existing.name).length;
        if (!store.renameCategory(existing.name, to)) throw new Error(`There is already a project category called "${to}".`);
        refresh();
        return { name: to, projectsAffected: filed };
      }
      if (!name.trim()) throw new Error('A project category needs a name.');
      if (existing) throw new Error(`There is already a project category called "${existing.name}".`);
      const made = store.addCategory(name.trim());
      refresh();
      return { name: made.name, projectsAffected: 0 };
    },

    reorderProjects(ids: string[], categories?: string[]): void {
      const all = projects();
      const unknown = ids.filter(pid => !all.some(p => p.id === pid));
      if (unknown.length > 0) throw new Error(`No project with id ${unknown.join(', ')}.`);
      let catOrder: string[] | null = null;
      if (categories) {
        const pool = db.dbGetAllProjectCategories();
        catOrder = categories.map(name => {
          const hit = pool.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
          if (!hit) throw new Error(`No project category called "${name}".`);
          return hit.name;
        });
        catOrder = [...new Set(catOrder), ...pool.map(c => c.name).filter(n => !catOrder!.includes(n))];
      }
      db.dbTransaction(() => {
        if (ids.length > 0) useProjectStore.getState().reorderProjects(ids);
        if (catOrder) {
          const { useProjectCategoryStore } = require('../../src/store/useProjectCategoryStore') as typeof import('../../src/store/useProjectCategoryStore'); // eslint-disable-line @typescript-eslint/no-require-imports
          useProjectCategoryStore.getState().initialize();
          useProjectCategoryStore.getState().reorderCategories(catOrder);
        }
      });
      refresh();
    },

    startFreshProject(id: string): { project: Project; tasks: Task[] } {
      const source = projects().find(p => p.id === id);
      if (!source) throw new Error(`No project with id ${id}.`);
      const projectTemplate = require('../../src/utils/projectTemplate') as typeof import('../../src/utils/projectTemplate'); // eslint-disable-line @typescript-eslint/no-require-imports
      const groupsNow = useTaskGroupStore.getState().groups;
      const blueprint = projectTemplate.projectBlueprint(id, tasks(), groupsNow);
      const checklistSections = new Set(groupsNow.filter(g => g.checklist).map(g => g.id));
      const made: Task[] = [];
      let created: Project | undefined;
      db.dbTransaction(() => {
        const store = useProjectStore.getState();
        created = store.createProject(source.title, { category: source.category, kind: source.kind });
        // The settings the person chose carry over; its dates and its
        // done-ness don't, since those were about the last time.
        store.updateProject(created.id, {
          notes: source.notes, defaultTaskCategory: source.defaultTaskCategory, taskDefaults: source.taskDefaults ?? null,
          ongoing: source.ongoing, nudgeOptIn: source.nudgeOptIn, nudgeCadenceDays: source.nudgeCadenceDays,
          autoSchedule: source.autoSchedule, weekendSource: source.weekendSource, destination: source.destination,
          personIds: source.personIds, links: source.links, inOrder: source.inOrder, showChecked: source.showChecked, hideNextStep: source.hideNextStep,
          groupOnToday: source.groupOnToday,
        });
        const sectionFor = new Map<string, string>();
        for (const section of blueprint.sections) {
          const copy = useTaskGroupStore.getState().createGroup(section.title, null, created.id);
          if (checklistSections.has(section.id)) useTaskGroupStore.getState().updateGroup(copy.id, { checklist: true });
          sectionFor.set(section.id, copy.id);
        }
        const copyOf = new Map<string, string>();
        const childOrder = new Map<string, number>();
        const pageOrder: string[] = [];
        const today = dates.getLogicalToday();
        let order = db.dbGetAllTasks().reduce((m, t) => Math.max(m, t.sortOrder), 0);
        for (const { task, sectionId, subtasks } of blueprint.entries) {
          const groupId = sectionId ? sectionFor.get(sectionId) ?? null : null;
          // Within a section the rows are numbered 1..n, as the app's
          // reorderGroupChildren leaves them; a loose row takes the next slot.
          const sortOrder = groupId ? (childOrder.set(groupId, (childOrder.get(groupId) ?? 0) + 1), childOrder.get(groupId)!) : ++order;
          const copy = taskDraft.newTaskFromDraft(projectTemplate.freshCopyDraft(task, created.id, groupId, today), new Date().toISOString(), sortOrder, false);
          db.dbInsertTask(copy);
          made.push(copy);
          copyOf.set(task.id, copy.id);
          const slot = groupId ?? copy.id;
          if (!pageOrder.includes(slot)) pageOrder.push(slot);
          subtasks.forEach((title, i) => {
            const sub = taskDraft.newTaskFromDraft({ title, parentId: copy.id }, new Date().toISOString(), i + 1, false);
            db.dbInsertTask(sub);
          });
        }
        // What each copy waits on, pointed at the copies; a blocker outside
        // the project isn't carried, since it was about then.
        for (const { task } of blueprint.entries) {
          const copyId = copyOf.get(task.id)!;
          const row = db.dbGetAllTasks().find(t => t.id === copyId)!;
          const mapped = blocking.blockerIdsOf(task).map(b => copyOf.get(b)).filter((x): x is string => !!x);
          const question = task.answerGate ? copyOf.get(task.answerGate.taskId) : undefined;
          if (mapped.length === 0 && !question) continue;
          db.dbUpdateTask({
            ...row,
            ...(mapped.length > 0 ? blocking.blockerFields(mapped) : {}),
            ...(question ? { answerGate: { taskId: question, answers: task.answerGate!.answers } } : {}),
          });
        }
        // The page order the source had, sections in place among the loose
        // tasks (empty ones at the end), as the app's reorderProjectItems lays
        // it: one slot space for tasks and stacks.
        for (const sectionId of sectionFor.values()) if (!pageOrder.includes(sectionId)) pageOrder.push(sectionId);
        const live = projectOrder.liveProjectSteps(created.id, db.dbGetAllTasks()).filter(t => !t.groupId);
        const homed = useTaskGroupStore.getState().groups.filter(g => g.projectId === created!.id);
        const updates = projectOrder.slotUpdates([...live, ...homed], pageOrder);
        const taskSlots = updates.filter(u => live.some(t => t.id === u.id));
        if (taskSlots.length > 0) db.dbBatchUpdateSortOrders(taskSlots);
        for (const u of updates) if (homed.some(g => g.id === u.id)) useTaskGroupStore.getState().updateGroup(u.id, { sortOrder: u.sortOrder });
      });
      refresh();
      return { project: projects().find(p => p.id === created!.id)!, tasks: made };
    },

    saveProjectAsTemplate(id: string, name?: string): TaskTemplate {
      const project = projects().find(p => p.id === id);
      if (!project) throw new Error(`No project with id ${id}.`);
      const projectTemplate = require('../../src/utils/projectTemplate') as typeof import('../../src/utils/projectTemplate'); // eslint-disable-line @typescript-eslint/no-require-imports
      const draft = projectTemplate.templateFromProject(project, tasks(), useTaskGroupStore.getState().groups, useSettingsStore.getState().dayResetTime);
      const existing = db.dbGetAllTemplates();
      const templateName = (name ?? draft.name).trim();
      if (!templateName) throw new Error('A template needs a name.');
      if (existing.some(t => t.name.toLowerCase() === templateName.toLowerCase())) throw new Error(`There is already a template called "${templateName}". Pass name to call this one something else.`);
      const template: TaskTemplate = {
        id: generateId(),
        name: templateName,
        items: draft.items,
        itemGroups: draft.itemGroups,
        questions: [],
        createdAt: new Date().toISOString(),
        sortOrder: existing.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1,
        category: draft.category,
        applyContainer: draft.applyContainer,
        schedule: null,
        scheduleLastFiredKey: null,
        anchorsAreAway: draft.anchorsAreAway,
      };
      db.dbInsertTemplate(template);
      return template;
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
      const dayStart = dates.getCurrentDayStart();
      const free = negativeHabits.nextSlipIsFree(task, dayStart);
      const updated = { ...task, ...negativeHabits.slipPatch(task, dayStart) };
      db.dbUpdateTask(updated);
      if (!free) useRewardStore.getState().recordSlip(id, rewards.coinsForLoss(updated), visibility.displayTitleFor(updated));
      refresh();
      return updated;
    },

    undoSlip(id): Task {
      const task = requireNegativeHabit(id);
      const dayStart = dates.getCurrentDayStart();
      const patch = negativeHabits.undoSlipPatch(task, dayStart);
      if (!patch) throw new Error('No slip has been logged against that habit today, so there is nothing to undo.');
      const free = negativeHabits.lastSlipWasFree(task, dayStart);
      const updated = { ...task, ...patch };
      db.dbUpdateTask(updated);
      if (!free) useRewardStore.getState().takeBackSlip(id);
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

    planMeal(draft: { date: string; slot: MealSlot; title?: string; recipeId?: string | null; leftoverId?: string | null }): MealPlanEntry {
      const recipe = draft.recipeId ? db.dbGetAllRecipes().find(r => r.id === draft.recipeId) : undefined;
      if (draft.recipeId && !recipe) throw new Error(`No recipe with id ${draft.recipeId}.`);
      // A leftover night is named by its container, as the fridge drag names it.
      let leftover: Leftover | undefined;
      if (draft.leftoverId) {
        if (draft.recipeId) throw new Error('A meal is a recipe or a leftover, not both.');
        leftover = db.dbGetAllLeftovers().find(l => l.id === draft.leftoverId);
        if (!leftover) throw new Error(`No leftover with id ${draft.leftoverId}.`);
        if (leftover.finishedAt) throw new Error(`The ${leftover.title} is finished, so there is none left to plan.`);
      }
      const title = mealPlanUtils.cleanMealTitle(leftover ? leftover.title : draft.title ?? recipe?.name ?? '');
      if (!title) throw new Error('A meal needs a title or a recipe.');
      const entry = mealPlanUtils.buildMealPlanEntry(
        { date: draft.date, slot: draft.slot, recipeId: draft.recipeId ?? null, leftoverId: leftover?.id ?? null, title },
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

    updateMeal(id: string, patch: MealPatch): MealPlanEntry {
      const entry = db.dbGetMealPlanEntry(id);
      if (!entry) throw new Error(`No planned meal with id ${id}.`);
      let next: MealPlanEntry = { ...entry };

      if (patch.recipeId !== undefined) {
        // A swap, through the row the app's "Replace" writes. Not for a
        // leftover night: its container's use-up task is reconciled by the
        // replace on the phone, so swap one there or plan a new meal.
        if (entry.leftoverId) throw new Error('That meal is a leftover night. Remove it and plan the new meal, or change it in the app.');
        const recipes = db.dbGetAllRecipes();
        const to = patch.recipeId ? recipes.find(r => r.id === patch.recipeId) : undefined;
        if (patch.recipeId && !to) throw new Error(`No recipe with id ${patch.recipeId}.`);
        const title = mealPlanUtils.cleanMealTitle(to ? to.name : patch.title ?? '');
        if (!title) throw new Error('A typed meal needs a title: give title with recipeId: null.');
        next = mealPlanUtils.replacedMealEntry(entry, { recipeId: to?.id ?? null, title }, new Map(recipes.map(r => [r.id, r])), useSettingsStore.getState().householdServings);
      } else if (patch.title !== undefined) {
        const gone = entry.recipeId ? !db.dbGetAllRecipes().some(r => r.id === entry.recipeId) : false;
        if (entry.leftoverId || (entry.recipeId && !gone)) {
          throw new Error('That meal\'s name comes from its recipe or leftover, so it is not renamed here. Move or remove it, or plan a new one.');
        }
        const cleaned = mealPlanUtils.cleanMealTitle(patch.title);
        if (!cleaned) throw new Error('A meal needs a title.');
        // A renamed meal whose recipe is gone is a different meal now, as in the app.
        next = gone ? { ...next, title: cleaned, recipeId: null, recipeChoices: [], recipeScale: 1 } : { ...next, title: cleaned };
      }

      if (patch.choices !== undefined) {
        if (!next.recipeId) throw new Error('Only a meal with a recipe has choices to make.');
        const recipes = db.dbGetAllRecipes();
        const recipe = recipes.find(r => r.id === next.recipeId);
        if (!recipe) throw new Error('That meal\'s recipe is gone, so it has no choices.');
        const byId = new Map(recipes.map(r => [r.id, r]));
        const onHand = grocerySuggest.onHandNameKeys(db.dbGetAllGroceryItems(), new Date(), db.dbGetAllItemProducts());
        let chosen = [...next.recipeChoices];
        // One at a time, since an answer can open or close a question: a
        // group on a component only exists while that component is cooked.
        for (const pick of patch.choices) {
          const groups = components().recipeChoiceGroups(recipe, byId, { chosen, onHand });
          const group = groups.find(g => g.label.trim().toLowerCase() === pick.group.trim().toLowerCase());
          if (!group) {
            throw new Error(`"${recipe.name}" has no choice called "${pick.group}"${groups.length ? ` (it asks: ${groups.map(g => g.label).join(', ')})` : ''}.`);
          }
          const option = group.options.find(o => o.name.trim().toLowerCase() === pick.option.trim().toLowerCase());
          if (!option) throw new Error(`"${group.label}" is one of ${group.options.map(o => o.name).join(', ')}.`);
          chosen = components().applyChoice(chosen, group, option.id);
        }
        next = { ...next, recipeChoices: chosen };
      }

      if (patch.shopTask !== undefined) next = { ...next, shopTask: patch.shopTask };
      if (patch.thawTask !== undefined) next = { ...next, thawTask: patch.thawTask };
      if (patch.logMeal !== undefined) next = { ...next, logMeal: patch.logMeal };

      if (patch.scale !== undefined) {
        if (!next.recipeId) throw new Error('Only a meal with a recipe has a scale.');
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

    setMealCooked(id: string, cooked: boolean): MealCooking | MealUncooking {
      const entry = db.dbGetMealPlanEntry(id);
      if (!entry) throw new Error(`No planned meal with id ${id}.`);
      if (!!entry.cookedAt === cooked) throw new Error(cooked ? 'That meal is already marked cooked.' : 'That meal is not marked cooked.');
      return cooked ? cookMeal(id)! : uncookMeal(id)!;
    },

    saveMealAsRecipe(id: string): { recipe: Recipe; created: boolean; entry: MealPlanEntry } {
      const entry = db.dbGetMealPlanEntry(id);
      if (!entry) throw new Error(`No planned meal with id ${id}.`);
      if (entry.leftoverId) throw new Error('A leftover night is the container\'s, not a dish to save.');
      const store = recipeStore();
      // A meal whose recipe still resolves has nothing to save.
      if (entry.recipeId && !mealPlanUtils.recipeIsGone(entry, store.getState())) throw new Error('That meal is already a saved recipe.');
      const existing = mealPlanUtils.recipeNamedLike(entry.title, store.getState().recipes);
      const recipe = existing ?? store.getState().addRecipe(entry.title);
      if (!recipe) throw new Error(`"${entry.title}" cannot be a recipe name.`);
      const recipes = store.getState().recipes;
      const next = mealPlanUtils.replacedMealEntry(entry, { recipeId: recipe.id, title: recipe.name }, new Map(recipes.map(r => [r.id, r])), useSettingsStore.getState().householdServings);
      db.dbUpdateMealPlanEntry(next);
      refresh();
      return { recipe, created: !existing, entry: next };
    },

    copyMealWeek(fromDay: string, toDay: string, slot?: MealSlot): MealPlanEntry[] {
      const weekStart = (day: string) => {
        const d = dates.dayKeyToDate(day);
        const back = (d.getDay() - useSettingsStore.getState().weekStartsOn + 7) % 7;
        return dates.dayKeyOf(addDays(d, -back));
      };
      const from = weekStart(fromDay);
      const to = weekStart(toDay);
      if (from === to) throw new Error('Those days are in the same week.');
      const source = db.dbGetMealPlanEntries(from, mealPlanUtils.shiftDayKey(from, 6));
      const target = db.dbGetMealPlanEntries(to, mealPlanUtils.shiftDayKey(to, 6));
      const shift = differenceInCalendarDays(dates.dayKeyToDate(to), dates.dayKeyToDate(from));
      let drafts;
      if (slot) {
        if (!mealPlanUtils.slotsToCopy(source, target).includes(slot)) {
          throw new Error(target.some(e => e.slot === slot)
            ? `The week of ${to} already has ${slot} planned, so there is nothing to copy into. Plan or move meals one at a time instead.`
            : `The week of ${from} has no ${slot} to copy.`);
        }
        drafts = mealPlanUtils.slotCopyDrafts(source, slot, shift);
      } else {
        if (target.length > 0) throw new Error(`The week of ${to} already has meals planned. Copy one slot (slot) into it, or meals one at a time.`);
        drafts = mealPlanUtils.weekCopyDrafts(source, shift);
        if (drafts.length === 0) throw new Error(`The week of ${from} has nothing to copy.`);
      }
      const created = drafts.map(copiedMeal);
      db.dbTransaction(() => created.forEach(e => db.dbInsertMealPlanEntry(e)));
      return created;
    },

    copyMealTo(id: string, days: string[]): { copied: MealPlanEntry[]; skipped: string[] } {
      const entry = db.dbGetMealPlanEntry(id);
      if (!entry) throw new Error(`No planned meal with id ${id}.`);
      if (entry.leftoverId) throw new Error('One container cannot supply several meals, so a leftover night is not copied.');
      const copied: MealPlanEntry[] = [];
      const skipped: string[] = [];
      for (const date of [...new Set(days)].filter(d => d !== entry.date).sort()) {
        const day = db.dbGetMealPlanEntries(date, date);
        const draft = mealPlanUtils.daysWithMeal(day, entry).has(date) ? null : mealPlanUtils.mealCopyDraft(entry, date);
        if (!draft) {
          skipped.push(date);
          continue;
        }
        const row = copiedMeal({ ...draft, sortOrder: mealPlanUtils.nextSortOrder(day, date, draft.slot) });
        db.dbInsertMealPlanEntry(row);
        copied.push(row);
      }
      return { copied, skipped };
    },

    mealChoices(entry: MealPlanEntry): MealChoice[] {
      if (!entry.recipeId) return [];
      const recipes = db.dbGetAllRecipes();
      const recipe = recipes.find(r => r.id === entry.recipeId);
      if (!recipe) return [];
      const onHand = grocerySuggest.onHandNameKeys(db.dbGetAllGroceryItems(), new Date(), db.dbGetAllItemProducts());
      return components()
        .recipeChoiceGroups(recipe, new Map(recipes.map(r => [r.id, r])), { chosen: entry.recipeChoices, onHand })
        .map(g => ({ group: g.label, options: g.options.map(o => o.name), chosen: g.active.name }));
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
      const patch = personPatch(fields);
      // Archiving again does not re-stamp the day it was filed away.
      if (fields.archived !== undefined && fields.archived === existing.archived) delete patch.archivedAt;
      const next = { ...existing, ...patch };
      db.dbUpdatePerson(next);
      refresh();
      return next;
    },

    deletePerson(id: string): { person: Person; notes: PersonNote[] } {
      const person = people().find(p => p.id === id);
      if (!person) throw new Error(`No person with id ${id}.`);
      const { usePersonStore } = require('../../src/store/usePersonStore') as typeof import('../../src/store/usePersonStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const { usePersonNoteStore } = require('../../src/store/usePersonNoteStore') as typeof import('../../src/store/usePersonNoteStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      usePersonStore.getState().initialize();
      usePersonNoteStore.getState().initialize();
      const notes = usePersonNoteStore.getState().notes.filter(n => n.personId === id);
      usePersonStore.getState().removePersonRow(id);
      refresh();
      return { person, notes };
    },

    reorderPeople(ids: string[]): void {
      const all = [...people()].sort((a, b) => a.sortOrder - b.sortOrder);
      const unknown = ids.filter(pid => !all.some(p => p.id === pid));
      if (unknown.length > 0) throw new Error(`No person with id ${unknown.join(', ')}.`);
      const order = [...new Set(ids), ...all.map(p => p.id).filter(pid => !ids.includes(pid))];
      db.dbBatchUpdatePersonSortOrders(order.map((pid, i) => ({ id: pid, sortOrder: i + 1 })));
      refresh();
    },

    savePersonGroup(name: string, change: { newName?: string; delete?: boolean; catchUpSeparately?: boolean }): { group: PersonGroup | null; members: number } {
      const { usePersonGroupStore } = require('../../src/store/usePersonGroupStore') as typeof import('../../src/store/usePersonGroupStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const { usePersonStore } = require('../../src/store/usePersonStore') as typeof import('../../src/store/usePersonStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      usePersonStore.getState().initialize();
      const store = usePersonGroupStore.getState();
      store.initialize();
      const existing = store.groups.find(g => g.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;
      const members = existing ? people().filter(p => p.groupId === existing.id).length : 0;
      if (change.delete) {
        if (!existing) throw new Error(`No group called "${name}".`);
        store.removeGroupRow(existing.id);
        refresh();
        return { group: null, members };
      }
      let group = existing;
      if (!group) {
        if (change.newName !== undefined) throw new Error(`No group called "${name}" to rename.`);
        if (!name.trim()) throw new Error('A group needs a name.');
        group = store.createGroup(name.trim());
      }
      if (change.newName !== undefined) {
        const to = change.newName.trim();
        if (!to) throw new Error('A group needs a name.');
        if (store.groups.some(g => g.id !== group!.id && g.name.trim().toLowerCase() === to.toLowerCase())) throw new Error(`There is already a group called "${to}".`);
        store.updateGroup(group.id, { name: to });
      }
      if (change.catchUpSeparately !== undefined) store.updateGroup(group.id, { catchUpSeparately: change.catchUpSeparately });
      refresh();
      return { group: usePersonGroupStore.getState().groups.find(g => g.id === group!.id) ?? group, members };
    },

    addPersonNote(personId: string, kind: PersonNote['kind'], text: string, relevantOn: string | null = null): PersonNote {
      if (!people().some(p => p.id === personId)) throw new Error(`No person with id ${personId}.`);
      if (!['note', 'gift', 'food'].includes(kind)) throw new Error('kind is note, gift or food.');
      const { usePersonNoteStore } = require('../../src/store/usePersonNoteStore') as typeof import('../../src/store/usePersonNoteStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      usePersonNoteStore.getState().initialize();
      const note = usePersonNoteStore.getState().addNote(personId, kind, text, relevantOn);
      if (!note) throw new Error('A note needs some text.');
      return note;
    },

    updatePersonNote(id: string, patch: { text?: string; kind?: PersonNote['kind']; relevantOn?: string | null; archived?: boolean }): PersonNote {
      const { usePersonNoteStore } = require('../../src/store/usePersonNoteStore') as typeof import('../../src/store/usePersonNoteStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const store = usePersonNoteStore.getState();
      store.initialize();
      const note = store.notes.find(n => n.id === id);
      if (!note) throw new Error(`No note with id ${id}. get_person lists them.`);
      if (patch.text !== undefined && !patch.text.trim()) throw new Error('A note needs some text. To remove it, use delete_person_note.');
      if (patch.kind !== undefined && !['note', 'gift', 'food'].includes(patch.kind)) throw new Error('kind is note, gift or food.');
      const { archived, ...rest } = patch;
      store.updateNote(id, {
        ...rest,
        ...(rest.text !== undefined ? { text: rest.text.trim() } : {}),
        ...(archived !== undefined ? { archivedAt: archived ? (note.archivedAt ?? new Date().toISOString()) : null } : {}),
      });
      return usePersonNoteStore.getState().notes.find(n => n.id === id)!;
    },

    deletePersonNote(id: string): PersonNote {
      const { usePersonNoteStore } = require('../../src/store/usePersonNoteStore') as typeof import('../../src/store/usePersonNoteStore'); // eslint-disable-line @typescript-eslint/no-require-imports
      const store = usePersonNoteStore.getState();
      store.initialize();
      const note = store.notes.find(n => n.id === id);
      if (!note) throw new Error(`No note with id ${id}. get_person lists them.`);
      store.removeNote(id);
      return note;
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
