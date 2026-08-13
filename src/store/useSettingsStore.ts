import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import type { ThemeMode } from '../theme';
import { DEFAULT_APP_FONT, isAppFont, type AppFont } from '../theme/fonts';
import type { SortOption, Priority, Effort, TimeOfDay } from '../types';
import {
  CURRENCY_SYMBOLS,
  DEFAULT_CURRENCY_SYMBOL,
  GROCERY_USE_UP_LEAD_DAYS_DEFAULT,
  GROCERY_USE_UP_LEAD_DAYS_MAX,
  GROCERY_USE_UP_LEAD_DAYS_MIN,
} from '../types';
import { parseRetentionDays, type RetentionDays } from '../utils/retention';
import { parseExpiredTaskGrace, serializeExpiredTaskGrace, type ExpiredTaskGraceDays } from '../utils/expiredTaskGrace';
import { DEFAULT_APP_LOCK_GRACE_SECONDS, parseGraceSeconds } from '../utils/appLock';
import { loadAnthropicApiKey, saveAnthropicApiKey } from '../utils/secureApiKey';
import {
  AI_FEATURE_IDS, defaultAiFeatureConfig, isAiModelId,
  type AiFeatureConfig, type AiFeatureConfigMap, type AiFeatureId,
} from '../utils/aiFeatures';
import { DEFAULT_MEAL_PLAN_NUDGE_TIME, DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY } from '../utils/mealPlanNudge';
import { DEFAULT_POSTPONE_THRESHOLD, parsePostponeThreshold } from '../utils/postpone';
import { UNIT_SYSTEMS, type UnitSystem } from '../utils/unitConvert';

export type PatchNoteQaStatus = 'pass' | 'fail';

// Which day a week starts on, in date-fns' numbering (0 = Sunday, 1 = Monday).
// Only these two are offered — the rest of date-fns' range exists for locales
// the app doesn't otherwise support, and a seven-way picker for a setting two
// answers cover is a worse row.
export type WeekStart = 0 | 1;

/**
 * Which bottom corner the add button rests in — a reach preference, not a
 * layout direction. Only the add affordances move: the app's other
 * left-anchored decisions (the drawer's edge swipe, a row's leading checkbox,
 * swipe directions) are deliberate and stay put, so this is not an RTL flag.
 *
 * Read by Fab.tsx (the screen button and its menu), MiniFabList.tsx — which
 * puts the in-card add button in the matching corner of the subtasks and stack
 * cards, so both buttons fall under the same thumb — and DemoBanner.tsx, which
 * parks itself in whichever corner the button isn't using.
 */
export type FabHand = 'right' | 'left';

/**
 * How much of the day's meal plan Today shows (#1402).
 *
 * `block` is what shipped first: a bold caption over a tray of full meal rows,
 * above every task. It turned out to read as though meal planning were the
 * point of the Today screen — it was the largest type on the page after the
 * word "Today", and it sat above the first task at any hour of the day.
 *
 * `strip` is one line of the meals still to come, and is the default: it keeps
 * the glance ("what am I eating today") that the block was wanted for, at
 * about a quarter of the height, and empties itself as the day is eaten. An
 * install upgrading into this changes appearance without being asked, which is
 * unusual here — but the block is the thing being fixed, so leaving it as the
 * default would ship the fix switched off.
 *
 * `off` is for someone who plans meals and doesn't want them on Today at all;
 * with cook tasks on (see `mealCookTasks`) the meals that are *work* still
 * reach the list, so this isn't the same as turning the feature off.
 */
export type MealsOnToday = 'block' | 'strip' | 'off';

const MEALS_ON_TODAY: MealsOnToday[] = ['block', 'strip', 'off'];

/**
 * What a *new* task starts with, applied by `newTaskFromDraft`
 * (`src/store/useTaskStore.ts`) — the one place a Task's defaults are
 * spelled out — so `addTask` and the dated-series builder (`addTaskSeries`/
 * `applyTaskDates`) both pick these up automatically rather than needing
 * their own copy. Every field here is a *fallback*: it only fills in a draft
 * that left the field unspecified (`null`/`undefined`), never one that named
 * a value explicitly — so typing "tmrw" in quick-add still wins over
 * `destination`, and an explicit priority pick still wins over `priority`.
 *
 * `destination` is the one field with no `Task` column behind it — it only
 * decides what quick-add pre-fills its due date to before the user types
 * anything (see QuickAddModal's `visible` effect), which is what actually
 * files the task into Today, Inbox, or Unscheduled.
 */
export interface NewTaskDefaults {
  category: string | null;
  priority: Priority | null;
  effort: Effort | null;
  timeSegment: TimeOfDay | null;
  destination: 'today' | 'inbox' | 'unscheduled';
  openEditorAfterQuickAdd: boolean;
}

// Preserves today's actual behavior exactly: newTaskFromDraft already
// defaulted category/priority/effort/timeSegments to null/0/0/[] on its own,
// and quick-add already pre-filled Today's due date and just filed the task
// without opening the editor. A fresh install must see no change until it
// opts into something different.
const DEFAULT_NEW_TASK_DEFAULTS: NewTaskDefaults = {
  category: null,
  priority: null,
  effort: null,
  timeSegment: null,
  destination: 'today',
  openEditorAfterQuickAdd: false,
};

interface SettingsStore {
  dayResetTime: string;   // "HH:MM" — when the logical day flips (default midnight "00:00")
  morningStart: string;   // "HH:MM" — when morning begins (default "06:00")
  afternoonStart: string; // "HH:MM" — when afternoon begins (default "12:00")
  eveningStart: string;   // "HH:MM" — when evening begins (default "18:00")
  nightStart: string;     // "HH:MM" — when night begins (default "21:00")
  // The hours you're actually awake and able to chip away at a quota task —
  // the span its expected-by-now pace ramps across (see quotaExpectedByNow).
  // Deliberately separate from morningStart, which is when morning-segment
  // tasks unhide and can legitimately sit hours before you get up, and from
  // dayResetTime, which decides which calendar day a task belongs to.
  activeHoursStart: string; // "HH:MM" (default "08:00")
  activeHoursEnd: string;   // "HH:MM" (default "22:00")
  // "Don't buzz me between X and Y" for scheduleTaskReminder/scheduleTimerAlarm
  // (src/utils/notifications.ts). Both null = off, which is the default — an
  // existing install keeps buzzing exactly as before until the user opts in.
  // Deliberately its own pair rather than reusing activeHoursStart/activeHoursEnd
  // above: those are the span daily-target pacing ramps across (see the comment
  // on them), an unrelated concept that happens to share the "HH:MM" shape —
  // someone awake at 2am doing something else entirely still doesn't want a
  // task reminder going off. Set together via setQuietHours so a half-set
  // window (a start with no end) is unrepresentable.
  quietHoursStart: string | null; // "HH:MM"
  quietHoursEnd: string | null;   // "HH:MM"
  themeMode: ThemeMode;
  appFont: AppFont; // typeface for the whole app — see src/theme/fonts.ts
  use24HourTime: boolean; // render clock times as "17:30" rather than "5:30 PM"
  weekStartsOn: WeekStart;
  fabHand: FabHand;
  hapticsEnabled: boolean;
  // The accelerometer-driven "shake to undo" gesture (src/utils/useShakeToUndo.ts).
  // On by default, like hapticsEnabled, so an existing install keeps the
  // behavior it already had. Off skips the Accelerometer subscription
  // entirely rather than gating at the callback, so turning it off actually
  // stops the sensor from running.
  shakeToUndoEnabled: boolean;
  // Today's sort & filter, persisted so they survive a cold launch. They're
  // view state rather than a preference — nothing in Settings shows them — but
  // they live here because losing your sort on every launch is the one thing
  // that made the sheet feel broken. Safe to persist the *filters* (which hide
  // tasks, unlike sort) only because TodayScreen always shows the active count
  // as a badge on the sort button and swaps in a "No tasks match these
  // filters" empty state; without both of those this would be a trap.
  sortOption: SortOption;
  filterPriorities: Priority[];
  filterEfforts: Effort[];
  // One summary notification each morning. Off by default — an app that
  // starts notifying you daily because you installed it is the reason people
  // turn notifications off wholesale.
  dailyAgendaEnabled: boolean;
  dailyAgendaTime: string; // "HH:MM"
  // Lives in the device keychain, not the settings table — see
  // src/utils/secureApiKey.ts. It's held here in memory like any other setting,
  // but it arrives a tick late: initialize() is synchronous and the keychain
  // isn't, so initializeSecrets() fills it in (and migrates the old plaintext
  // row) right after. Everything that reads it already treats '' as "AI is off".
  anthropicApiKey: string;
  // Per-feature on/off + model choice for every place the app calls out to
  // Anthropic (see src/utils/aiFeatures.ts and src/services/aiSuggestions.ts).
  // Kept out of DEFAULT_SETTINGS/resetToDefaults for the same reason as
  // patchNotesQaStatus: it's an object, and String(value) doesn't round-trip
  // one. "Reset settings" also has no business quietly re-enabling a feature
  // someone turned off or changing which model they pay for.
  aiFeatureConfig: AiFeatureConfigMap;
  // Face ID (or the device passcode) in front of the whole app. Both of these
  // stay out of DEFAULT_SETTINGS: "reset settings" must not be a way to turn
  // someone's lock off.
  appLockEnabled: boolean;
  appLockGraceSeconds: number; // how long backgrounded before it re-locks
  vacationMode: boolean;
  vacationStart: string | null;
  vacationEnd: string | null; // optional ISO date — vacation mode auto-turns-off once this passes
  // How long a task with a closed time window sits in the Expired section
  // before sweepExpiredTasks deletes it. null = Never (keep forever, the old
  // `false`), 0 = Immediately (delete on window close, the old `true`), or a
  // positive day count as a grace period. See src/utils/expiredTaskGrace.ts —
  // still persisted under the 'autoRemoveExpiredTasks' settings key, so the
  // legacy 'true'/'false' values migrate on read rather than needing a new one.
  autoRemoveExpiredTasks: ExpiredTaskGraceDays;
  autoArchiveProjectsOnComplete: boolean;
  /**
   * Whether the date picker speaks up when you go to push a task you've already
   * pushed postponeCheckThreshold times. See src/utils/postpone.ts.
   *
   * Defaults ON, unlike most opt-in features here, and the `!== 'false'` read
   * below is what makes an install that predates it start switched on. It earns
   * that: it can't say anything until the user has pushed the same task three
   * times, it only ever appears in a sheet they opened deliberately, and it
   * never blocks the reschedule. Defaulting it off would mean nobody met it.
   */
  postponeCheckEnabled: boolean;
  /** How many pushes before it says something. */
  postponeCheckThreshold: number;
  // How long completed tasks are kept before a startup purge deletes them.
  // null = forever, and forever is the default: nothing about an existing
  // install changes until the user picks a window in Settings. See
  // src/utils/retention.ts for what a purge may take.
  completedRetentionDays: RetentionDays;
  // Pre-fills the Remind Me field when a task is given a specific clock time
  // (its `windowStart`) — see TaskEditor's `applyDefaultReminderLead`. null =
  // off, the default, so an existing install gets no reminders it didn't ask
  // for. Deliberately doesn't engage for a bare due date or a time-of-day
  // segment (morning/afternoon/evening): neither pins down an actual clock
  // time, and "30 minutes before the day reset" is not a useful reminder.
  defaultReminderLeadMinutes: number | null;
  hideCategories: boolean; // Today's "Hide categories" display option, in Sort & Filter
  /**
   * Trims quick add's chip toolbar and the task editor's open-by-default rows
   * down to Date / Time of day / Repeat. Rendering only — see
   * `src/utils/simpleTaskForm.ts` for what it does and doesn't touch. Off by
   * default: it's a preference, not a fix, so an install that upgrades into it
   * sees exactly the form it had.
   */
  simpleTaskForm: boolean;
  // Live Activity (Lock Screen / Dynamic Island) for a running task timer or
  // recipe cook/prep timer — see src/utils/liveActivity.ts. iOS 17+ only, a
  // no-op everywhere else. Defaults on, like hapticsEnabled/shakeToUndoEnabled
  // above, so an install that predates the setting keeps the behavior it
  // already had once this ships.
  timerLiveActivity: boolean;
  // Whether the app shows the groceries / recipes / meal plan trio at all —
  // one switch for all three because they aren't separable: a meal plan entry
  // points at a recipe by id, and a recipe reaches the grocery catalog by
  // nameKey (RecipeToListSheet, scoreRecipeAgainstCatalog, classifyPlanned).
  // Two of the three switched off individually would leave the third half
  // working, which is the state this setting exists to prevent.
  //
  // It hides UI and suppresses background behaviour; it never deletes a row or
  // rewrites another setting. Everything downstream — mealsOnToday, the meal
  // plan nudge, the grocery leg of the Reminders import, the three kitchen AI
  // features — is gated by *reading* this alongside its own setting, so
  // turning the area back on restores exactly what was there. Writing those
  // settings off instead would quietly destroy the user's configuration of a
  // feature they only meant to put away.
  //
  // Defaults on, read `!== 'false'` like hapticsEnabled, so an existing
  // install is unchanged. Deliberately kept out of DEFAULT_SETTINGS — see the
  // note there.
  kitchenEnabled: boolean;
  mealsOnToday: MealsOnToday;
  // Which units recipe and grocery amounts are *shown* in — see
  // src/utils/unitConvert.ts. Display only: the quantity stored on the recipe
  // or the grocery row is never rewritten, and an editable field always shows
  // what's stored. Defaults to 'asWritten', so an install upgrading into this
  // reads exactly as it did.
  unitSystem: UnitSystem;
  // The symbol grocery prices are shown with. Cosmetic and nothing else: every
  // price is stored as minor units of whatever the user shops in, and there is
  // no second currency and no conversion — see src/utils/groceryPrice.ts. A
  // fixed short list rather than free text or a locale lookup, because the
  // point is to render a number correctly, not to know about money.
  currencySymbol: string;
  // Whether planning a meal also puts a "Cook X" task on the day it's planned
  // for. On by default, but deliberately with no backfill — only meals planned
  // from here on get one — so an install upgrading into this sees nothing
  // appear in a list it didn't ask to have changed. The per-meal override and
  // the rules for which meals qualify live in src/utils/mealTasks.ts.
  mealCookTasks: boolean;
  // Which category a cook task files itself under, by name, or null for none.
  //
  // Worth a setting rather than a constant because of where an uncategorized
  // task actually renders: makeCategoryGroups puts loose tasks in a
  // header-less block at the *top* of Today, above every category section. For
  // anyone who files their tasks, cook tasks left uncategorized would pile up
  // exactly where the old meals block used to sit — which is the thing this
  // whole change is undoing. Naming a category moves them into the day.
  //
  // Applied when the task is created and never re-applied: filing it somewhere
  // else afterwards is the user's call, and reconciling only ever rewrites the
  // three fields the meal owns. Stored by name, like Task.category and
  // newTaskDefaults.category; a name that no longer exists resolves to no
  // category, same as any other stale category reference here.
  mealCookTaskCategory: string | null;
  // Whether a grocery item with a use-by date gets a "Use up X" task a few days
  // before it. Off by default and deliberately so: this is the one feature here
  // that can put rows on a task list off the back of a shopping trip, and a
  // task list that fills itself with food is the one people would turn off
  // altogether. Nothing is backfilled when it goes on, either — only trips
  // finished and dates set from then on spawn anything. The per-item override
  // and the rules for which items qualify live in src/utils/groceryExpiry.ts.
  groceryUseUpTasks: boolean;
  // How many days before the use-by date the task falls due. See
  // GROCERY_USE_UP_LEAD_DAYS_DEFAULT for why one and not zero.
  groceryUseUpLeadDays: number;
  // Which category a use-up task files itself under, by name, or null for none
  // — the same setting mealCookTaskCategory is, for the same reason: loose
  // tasks render above every category section on Today, which is not where
  // food belongs. Applied when the task is created and never re-applied.
  groceryUseUpTaskCategory: string | null;
  // Pulling tasks out of the Reminders app and into the Inbox — the app's voice
  // capture story, since Siri needs no app name to add a reminder. Off by
  // default and never inferred: importing *deletes* the reminder, so it only
  // ever runs against a list the user picked and confirmed by name and count.
  // That's what the third field is for — it holds the list the confirmation was
  // given for, so changing list re-asks rather than swallowing a fresh backlog.
  remindersImportEnabled: boolean;
  remindersImportListId: string | null;
  remindersImportConfirmedListId: string | null;
  // Whether an imported reminder is deleted from the Reminders app. On by
  // default, and on is the mode the whole feature was built around: the delete
  // is what stops a capture being imported twice. Off turns it into a one-way
  // mirror — the list keeps its contents, and a name index over the existing
  // tasks stands in for the delete (see remindersImport.ts). Kept per
  // destination because the two lists are used differently: a dictation inbox
  // wants emptying, a shared grocery list usually doesn't.
  remindersImportDelete: boolean;
  // A second Reminders list, drained into the grocery list instead of the
  // Inbox — which is what makes "Hey Siri, add milk to my Groceries list"
  // land somewhere useful. Must never be the same list as the one above; the
  // picker enforces that (see reminderListOptions' excludeId).
  groceryImportEnabled: boolean;
  groceryImportListId: string | null;
  groceryImportConfirmedListId: string | null;
  /** remindersImportDelete's twin, for the grocery list. Same default, same rules. */
  groceryImportDelete: boolean;
  // Whether the schedule an import parses out of a reminder — its due date,
  // repeat, and alarm — waits on the Inbox row as a suggestion the user taps
  // to accept, or is simply applied. On by default: applying is what takes a
  // capture out of the Inbox and onto Today, and a voice note nobody has read
  // yet is exactly the thing that should not schedule itself.
  remindersImportReview: boolean;
  // Reading the device calendar, so the app knows what else is on a day. Off by
  // default and never inferred: turning it on prompts for calendar access,
  // which nothing else in the app has ever asked for.
  //
  // "Google Calendar" is what most people mean by this, and a Google account
  // added under iOS Settings › Calendar › Accounts is exactly what these ids
  // point at — but they're plain EventKit calendars and the app never checks
  // which service is behind one. See #1495.
  //
  // Read-only: nothing writes an event. The two fields are separate because
  // they fail differently — a calendar that's been deleted from the device
  // leaves its id here harmlessly, while the switch is the user's answer about
  // the feature as a whole and shouldn't be flipped by a calendar going away.
  calendarReadEnabled: boolean;
  calendarIds: string[];
  // Whether a reminder landing inside a meeting gets pushed to the meeting's
  // end (#1491). A refinement of calendarReadEnabled, not a separate read —
  // it does nothing while that's off, and defaults on once it's turned on so
  // the behavior the issue asked for is what a fresh enable gets, with an
  // escape hatch for anyone who'd rather see the reminder fire where it was
  // set and dismiss it themselves.
  reminderMeetingNudgeEnabled: boolean;
  // When the user last dismissed the quiet-projects banner. Read only through
  // isProjectNudgeDismissedToday, which compares it against today rather than
  // testing it for existence — so it expires at the day rollover on its own and
  // nothing ever has to clear it (same idiom as TaskGroup.completedAt).
  projectNudgeDismissedAt: string | null;
  // The opt-in "plan meals for the week" nudge (#1121) — a real Task,
  // auto-created once a week, off by default so an existing install sees no
  // new task until this is turned on. See src/utils/mealPlanNudge.ts for the
  // firing/suppression rules; weekday follows date-fns' Date.getDay()
  // convention (0 = Sunday).
  mealPlanNudgeEnabled: boolean;
  mealPlanNudgeWeekday: number;
  mealPlanNudgeTime: string; // "HH:MM"
  // Idempotency state, not a preference — the day-key of the week the nudge
  // last fired in. Read only by dueMealPlanNudge, which compares it against
  // the current week rather than testing it for existence, so it "expires"
  // at the next week boundary on its own (same idiom as
  // projectNudgeDismissedAt / TaskGroup.completedAt).
  mealPlanNudgeLastFiredWeekKey: string | null;
  patchNotesQaStatus: Record<string, PatchNoteQaStatus>; // patch note id -> QA result
  // What a *new* project's nudgeCadenceDays starts at (see DEFAULT_NUDGE_CADENCE_DAYS
  // in src/types/index.ts for why that constant itself stays 0). This is the
  // opt-in the other direction: someone who wants every new project chasing
  // them sets it once here instead of by hand on every project they create.
  // Changing it only affects projects created after the change — existing
  // projects keep whatever cadence they were given.
  defaultProjectNudgeCadenceDays: number;
  // What a new task starts with (category/priority/effort/time segment, which
  // list quick-add files it into, whether the editor opens after) — see
  // NewTaskDefaults above. Kept out of DEFAULT_SETTINGS/resetToDefaults for
  // the same mechanical reason as aiFeatureConfig: it's an object, and
  // String(value) doesn't round-trip one.
  newTaskDefaults: NewTaskDefaults;
  initialized: boolean;
  initialize: () => void;
  /** Loads the keychain-backed settings. Call after initialize(). */
  initializeSecrets: () => Promise<void>;
  setDayResetTime: (time: string) => void;
  setMorningStart: (time: string) => void;
  setAfternoonStart: (time: string) => void;
  setEveningStart: (time: string) => void;
  setNightStart: (time: string) => void;
  setActiveHoursStart: (time: string) => void;
  setActiveHoursEnd: (time: string) => void;
  /** Set both at once, or (null, null) to turn quiet hours off. */
  setQuietHours: (start: string | null, end: string | null) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAppFont: (fontId: AppFont) => void;
  setDailyAgendaEnabled: (on: boolean) => void;
  setDailyAgendaTime: (time: string) => void;
  setUse24HourTime: (on: boolean) => void;
  setWeekStartsOn: (day: WeekStart) => void;
  setFabHand: (hand: FabHand) => void;
  setHapticsEnabled: (on: boolean) => void;
  setShakeToUndoEnabled: (on: boolean) => void;
  setMealsOnToday: (mode: MealsOnToday) => void;
  setUnitSystem: (system: UnitSystem) => void;
  setCurrencySymbol: (symbol: string) => void;
  setMealCookTasks: (on: boolean) => void;
  setMealCookTaskCategory: (category: string | null) => void;
  setSortOption: (sort: SortOption) => void;
  setFilterPriorities: (priorities: Priority[]) => void;
  setFilterEfforts: (efforts: Effort[]) => void;
  setAnthropicApiKey: (key: string) => void;
  setAiFeatureConfig: (id: AiFeatureId, patch: Partial<AiFeatureConfig>) => void;
  setPostponeCheckEnabled: (on: boolean) => void;
  setPostponeCheckThreshold: (count: number) => void;
  setAppLockEnabled: (on: boolean) => void;
  setAppLockGraceSeconds: (seconds: number) => void;
  setVacationMode: (on: boolean, endDate?: string | null) => void;
  setVacationEnd: (endDate: string | null) => void;
  setAutoRemoveExpiredTasks: (days: ExpiredTaskGraceDays) => void;
  setAutoArchiveProjectsOnComplete: (on: boolean) => void;
  setCompletedRetentionDays: (days: RetentionDays) => void;
  setDefaultReminderLeadMinutes: (minutes: number | null) => void;
  setHideCategories: (on: boolean) => void;
  setSimpleTaskForm: (on: boolean) => void;
  setTimerLiveActivity: (on: boolean) => void;
  setKitchenEnabled: (on: boolean) => void;
  setRemindersImportEnabled: (on: boolean) => void;
  setRemindersImportListId: (id: string | null) => void;
  setRemindersImportConfirmedListId: (id: string | null) => void;
  setRemindersImportDelete: (on: boolean) => void;
  setGroceryImportEnabled: (on: boolean) => void;
  setGroceryImportListId: (id: string | null) => void;
  setGroceryImportConfirmedListId: (id: string | null) => void;
  setGroceryImportDelete: (on: boolean) => void;
  setRemindersImportReview: (on: boolean) => void;
  setCalendarReadEnabled: (on: boolean) => void;
  setCalendarIds: (ids: string[]) => void;
  setReminderMeetingNudgeEnabled: (on: boolean) => void;
  setProjectNudgeDismissedAt: (at: string | null) => void;
  setDefaultProjectNudgeCadenceDays: (days: number) => void;
  setMealPlanNudgeEnabled: (on: boolean) => void;
  setMealPlanNudgeWeekday: (weekday: number) => void;
  setMealPlanNudgeTime: (time: string) => void;
  setMealPlanNudgeLastFiredWeekKey: (weekKey: string | null) => void;
  setGroceryUseUpTasks: (on: boolean) => void;
  setGroceryUseUpLeadDays: (days: number) => void;
  setGroceryUseUpTaskCategory: (category: string | null) => void;
  setPatchNoteQaStatus: (id: string, status: PatchNoteQaStatus | null) => void;
  setNewTaskDefaults: (patch: Partial<NewTaskDefaults>) => void;
  resetToDefaults: () => void;
}

const DEFAULT_SETTINGS = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
  themeMode: 'dark' as ThemeMode,
  appFont: DEFAULT_APP_FONT,
  use24HourTime: false,
  weekStartsOn: 0 as WeekStart,
  fabHand: 'right' as FabHand,
  hapticsEnabled: true,
  shakeToUndoEnabled: true,
  dailyAgendaEnabled: false,
  dailyAgendaTime: '08:00',
  autoArchiveProjectsOnComplete: false,
  postponeCheckEnabled: true,
  postponeCheckThreshold: DEFAULT_POSTPONE_THRESHOLD,
  hideCategories: false,
  simpleTaskForm: false,
  timerLiveActivity: true,
  mealsOnToday: 'strip' as MealsOnToday,
  unitSystem: 'asWritten' as UnitSystem,
  currencySymbol: DEFAULT_CURRENCY_SYMBOL,
  mealCookTasks: true,
  mealCookTaskCategory: null,
  groceryUseUpTasks: false,
  groceryUseUpLeadDays: GROCERY_USE_UP_LEAD_DAYS_DEFAULT,
  groceryUseUpTaskCategory: null,
  remindersImportEnabled: false,
  remindersImportDelete: true,
  groceryImportEnabled: false,
  groceryImportDelete: true,
  remindersImportReview: true,
  calendarReadEnabled: false,
  reminderMeetingNudgeEnabled: true,
  defaultProjectNudgeCadenceDays: 0,
  mealPlanNudgeEnabled: false,
  mealPlanNudgeWeekday: DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY,
  mealPlanNudgeTime: DEFAULT_MEAL_PLAN_NUDGE_TIME,
};

// Every value in DEFAULT_SETTINGS goes back to the settings table through
// String(), so only scalars belong in it — an array would land as "" (or
// "1,2") and read back as garbage. The persisted sort & filter are kept out
// for that reason and because they aren't preferences anyone sets in Settings.
//
// Nothing nullable can go in either, for the same mechanical reason: null lands
// as the literal string "null", which reads back as a truthy value. But the two
// that hit this want opposite things from a reset, so they're handled
// separately rather than together:
//
// - completedRetentionDays stays out of resetToDefaults altogether. "Reset
//   settings" must not quietly re-arm — or disarm — a setting that deletes
//   history; like vacation mode, it only changes when the user changes it.
// - the app lock stays out for the same reason, though it would round-trip
//   fine: "reset appearance and formatting" is not a request to take the lock
//   off the app, and a security control that a nearby menu item silently
//   disables isn't one. Like vacation mode, it changes when the user changes it.
// - the two Reminders list ids are cleared by hand *inside* resetToDefaults,
//   because there the danger runs the other way: turning the import off while
//   leaving the confirmed-list id in place would let a later re-enable skip the
//   confirmation that is the whole safeguard.
// - calendarIds stays out on the mechanical rule (it's an array) and is *not*
//   cleared by hand the way the two Reminders ids are: there is no confirmation
//   to skip on the way back in, because reading a calendar destroys nothing.
//   Turning the read off and leaving the chosen calendars means switching it
//   back on picks up where it left off, which is what the Reminders import
//   does with its own list when the groceries area is toggled.
// - kitchenEnabled stays out, on the app lock's reasoning rather than a
//   mechanical one: it would round-trip fine as a boolean, but "reset
//   appearance and formatting" is not a request to put a whole feature area
//   back in the menu of someone who deliberately removed it.
// - autoRemoveExpiredTasks stays out too, for the same reason as
//   completedRetentionDays: it's a setting that deletes tasks unattended, so
//   "reset appearance and formatting" must not quietly change how aggressively
//   it does that. It used to round-trip through DEFAULT_SETTINGS as a boolean;
//   pulling it out here is a behavior change from before this setting became a
//   duration, but the safer one — a stray reset can no longer flip Never into
//   Immediately or back.

const SORT_OPTIONS: SortOption[] = ['default', 'priority', 'effort-asc', 'effort-desc', 'due-date', 'streak'];

/** The Settings row's preset pills for defaultReminderLeadMinutes. */
export const DEFAULT_REMINDER_LEAD_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Off' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
];

/**
 * Parses the stored settings value. Anything unrecognised reads as off, the
 * same failure mode as parseRetentionDays: a garbled value must not start
 * silently attaching reminders to tasks that never asked for one.
 */
function parseDefaultReminderLeadMinutes(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Reads back a JSON number array written by one of the filter setters,
 * dropping anything outside `max`. These come out of a TEXT column that a
 * previous build (or a hand-edited database) could have left in any shape, and
 * a bad value here silently filters every task out of Today — so an unparseable
 * or out-of-range entry is discarded rather than trusted.
 */
/**
 * The chosen calendars. Anything unreadable reads as none picked, which turns
 * the feature off rather than reading calendars the user didn't choose — the
 * same direction of failure `parseDefaultReminderLeadMinutes` takes.
 *
 * Ids are not validated against the device here: a calendar can be absent this
 * launch and back the next (an account still syncing, a phone that hasn't
 * signed in yet), so dropping it would quietly un-pick calendars on a slow
 * morning. `fetchEvents` validates against a live list at read time instead.
 */
function parseCalendarIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function parseFilterArray<T extends number>(raw: string | null, max: number): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is T => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max
    );
  } catch {
    return [];
  }
}

const NEW_TASK_DESTINATIONS: NewTaskDefaults['destination'][] = ['today', 'inbox', 'unscheduled'];
const NEW_TASK_TIME_SEGMENTS: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

/**
 * Reads back the JSON object written by setNewTaskDefaults, merged
 * field-by-field against DEFAULT_NEW_TASK_DEFAULTS rather than trusted
 * wholesale — same reasoning as aiFeatureConfig's parse below: a field added
 * after this setting first shipped, or a value a hand-edited database left in
 * a bad shape, falls back to the safe default instead of taking down the
 * whole object.
 */
function parseNewTaskDefaults(raw: string | null): NewTaskDefaults {
  const result = { ...DEFAULT_NEW_TASK_DEFAULTS };
  if (!raw) return result;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof NewTaskDefaults, unknown>>;
    if (typeof parsed.category === 'string' || parsed.category === null) {
      result.category = parsed.category as string | null;
    }
    if (parsed.priority === null || (typeof parsed.priority === 'number' && parsed.priority >= 0 && parsed.priority <= 4)) {
      result.priority = parsed.priority as Priority | null;
    }
    if (parsed.effort === null || (typeof parsed.effort === 'number' && parsed.effort >= 0 && parsed.effort <= 6)) {
      result.effort = parsed.effort as Effort | null;
    }
    if (parsed.timeSegment === null || NEW_TASK_TIME_SEGMENTS.includes(parsed.timeSegment as TimeOfDay)) {
      result.timeSegment = parsed.timeSegment as TimeOfDay | null;
    }
    if (NEW_TASK_DESTINATIONS.includes(parsed.destination as NewTaskDefaults['destination'])) {
      result.destination = parsed.destination as NewTaskDefaults['destination'];
    }
    if (typeof parsed.openEditorAfterQuickAdd === 'boolean') {
      result.openEditorAfterQuickAdd = parsed.openEditorAfterQuickAdd;
    }
  } catch {
    // keep defaults
  }
  return result;
}

export const useSettingsStore = create<SettingsStore>(set => ({
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
  quietHoursStart: null,
  quietHoursEnd: null,
  themeMode: 'dark',
  appFont: DEFAULT_APP_FONT,
  use24HourTime: false,
  weekStartsOn: 0,
  fabHand: 'right',
  hapticsEnabled: true,
  shakeToUndoEnabled: true,
  sortOption: 'default',
  filterPriorities: [],
  filterEfforts: [],
  dailyAgendaEnabled: false,
  dailyAgendaTime: '08:00',
  anthropicApiKey: '',
  aiFeatureConfig: defaultAiFeatureConfig(),
  appLockEnabled: false,
  appLockGraceSeconds: DEFAULT_APP_LOCK_GRACE_SECONDS,
  vacationMode: false,
  vacationStart: null,
  vacationEnd: null,
  autoRemoveExpiredTasks: null,
  autoArchiveProjectsOnComplete: false,
  postponeCheckEnabled: true,
  postponeCheckThreshold: DEFAULT_POSTPONE_THRESHOLD,
  completedRetentionDays: null,
  defaultReminderLeadMinutes: null,
  hideCategories: false,
  simpleTaskForm: false,
  timerLiveActivity: true,
  kitchenEnabled: true,
  mealsOnToday: 'strip',
  unitSystem: 'asWritten',
  currencySymbol: DEFAULT_CURRENCY_SYMBOL,
  mealCookTasks: true,
  mealCookTaskCategory: null,
  groceryUseUpTasks: false,
  groceryUseUpLeadDays: GROCERY_USE_UP_LEAD_DAYS_DEFAULT,
  groceryUseUpTaskCategory: null,
  remindersImportEnabled: false,
  remindersImportListId: null,
  remindersImportConfirmedListId: null,
  remindersImportDelete: true,
  groceryImportEnabled: false,
  groceryImportListId: null,
  groceryImportConfirmedListId: null,
  groceryImportDelete: true,
  remindersImportReview: true,
  calendarReadEnabled: false,
  calendarIds: [],
  reminderMeetingNudgeEnabled: true,
  projectNudgeDismissedAt: null,
  patchNotesQaStatus: {},
  defaultProjectNudgeCadenceDays: 0,
  mealPlanNudgeEnabled: false,
  mealPlanNudgeWeekday: DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY,
  mealPlanNudgeTime: DEFAULT_MEAL_PLAN_NUDGE_TIME,
  mealPlanNudgeLastFiredWeekKey: null,
  newTaskDefaults: DEFAULT_NEW_TASK_DEFAULTS,
  initialized: false,

  initialize() {
    const resetTime = dbGetSetting('dayResetTime') ?? '00:00';
    const morningStart = dbGetSetting('morningStart') ?? '06:00';
    const afternoonStart = dbGetSetting('afternoonStart') ?? '12:00';
    const eveningStart = dbGetSetting('eveningStart') ?? '18:00';
    const nightStart = dbGetSetting('nightStart') ?? '21:00';
    const activeHoursStart = dbGetSetting('activeHoursStart') ?? '08:00';
    const activeHoursEnd = dbGetSetting('activeHoursEnd') ?? '22:00';
    const quietHoursStart = dbGetSetting('quietHoursStart') || null;
    const quietHoursEnd = dbGetSetting('quietHoursEnd') || null;
    const themeMode = (dbGetSetting('themeMode') as ThemeMode | null) ?? 'dark';
    const storedFont = dbGetSetting('appFont');
    const appFont = isAppFont(storedFont) ? storedFont : DEFAULT_APP_FONT;
    const use24HourTime = dbGetSetting('use24HourTime') === 'true';
    const weekStartsOn: WeekStart = dbGetSetting('weekStartsOn') === '1' ? 1 : 0;
    const fabHand: FabHand = dbGetSetting('fabHand') === 'left' ? 'left' : 'right';
    // Defaults on rather than off, so an install that predates the setting
    // keeps the haptics it already had.
    const hapticsEnabled = dbGetSetting('hapticsEnabled') !== 'false';
    // Same reasoning as hapticsEnabled above: defaults on so an install that
    // predates the setting keeps shake-to-undo working.
    const shakeToUndoEnabled = dbGetSetting('shakeToUndoEnabled') !== 'false';
    const storedSort = dbGetSetting('sortOption') as SortOption | null;
    const sortOption: SortOption =
      storedSort && SORT_OPTIONS.includes(storedSort) ? storedSort : 'default';
    const filterPriorities = parseFilterArray<Priority>(dbGetSetting('filterPriorities'), 4);
    const filterEfforts = parseFilterArray<Effort>(dbGetSetting('filterEfforts'), 6);
    const dailyAgendaEnabled = dbGetSetting('dailyAgendaEnabled') === 'true';
    const dailyAgendaTime = dbGetSetting('dailyAgendaTime') ?? '08:00';
    const appLockEnabled = dbGetSetting('appLockEnabled') === 'true';
    const appLockGraceSeconds = parseGraceSeconds(dbGetSetting('appLockGraceSeconds'));
    // `!== 'false'` rather than `=== 'true'`: this defaults on, so an install
    // that predates the setting starts with it rather than without it.
    const postponeCheckEnabled = dbGetSetting('postponeCheckEnabled') !== 'false';
    const postponeCheckThreshold = parsePostponeThreshold(dbGetSetting('postponeCheckThreshold'));
    const vacationMode = dbGetSetting('vacationMode') === 'true';
    const vacationStart = dbGetSetting('vacationStart') ?? null;
    const vacationEnd = dbGetSetting('vacationEnd') || null;
    const autoRemoveExpiredTasks = parseExpiredTaskGrace(dbGetSetting('autoRemoveExpiredTasks'));
    const autoArchiveProjectsOnComplete = dbGetSetting('autoArchiveProjectsOnComplete') === 'true';
    const completedRetentionDays = parseRetentionDays(dbGetSetting('completedRetentionDays'));
    const defaultReminderLeadMinutes = parseDefaultReminderLeadMinutes(dbGetSetting('defaultReminderLeadMinutes'));
    const hideCategories = dbGetSetting('hideCategories') === 'true';
    const simpleTaskForm = dbGetSetting('simpleTaskForm') === 'true';
    // `!== 'false'`, not `=== 'true'` — defaults on, same reasoning as
    // hapticsEnabled/shakeToUndoEnabled above.
    const timerLiveActivity = dbGetSetting('timerLiveActivity') !== 'false';
    // Same `!== 'false'`: the groceries/recipes/meal plan area is on unless
    // someone has turned it off, so no existing install loses it.
    const kitchenEnabled = dbGetSetting('kitchenEnabled') !== 'false';
    const storedMealsOnToday = dbGetSetting('mealsOnToday') as MealsOnToday | null;
    const mealsOnToday: MealsOnToday =
      storedMealsOnToday && MEALS_ON_TODAY.includes(storedMealsOnToday) ? storedMealsOnToday : 'strip';
    const storedUnitSystem = dbGetSetting('unitSystem') as UnitSystem | null;
    const unitSystem: UnitSystem =
      storedUnitSystem && UNIT_SYSTEMS.includes(storedUnitSystem) ? storedUnitSystem : 'asWritten';
    const storedCurrency = dbGetSetting('currencySymbol');
    const currencySymbol =
      storedCurrency && CURRENCY_SYMBOLS.includes(storedCurrency)
        ? storedCurrency
        : DEFAULT_CURRENCY_SYMBOL;
    // Defaults on, like hapticsEnabled — but unlike it, "on" here is a change
    // for an existing install rather than a preservation of what it had. It's
    // safe to default on anyway because nothing is backfilled: no cook task
    // exists for any meal already on the calendar, only for ones planned after
    // the update.
    const mealCookTasks = dbGetSetting('mealCookTasks') !== 'false';
    // '' persists as "no category", matching how newTaskDefaults.category reads.
    const storedCookCategory = dbGetSetting('mealCookTaskCategory');
    const mealCookTaskCategory = storedCookCategory ? storedCookCategory : null;
    // `=== 'true'`, the safe reading of a missing row: this one defaults OFF,
    // and an install that predates it has a catalog full of items whose next
    // trip would otherwise start writing tasks nobody asked for.
    const groceryUseUpTasks = dbGetSetting('groceryUseUpTasks') === 'true';
    // The missing row is checked before the number, not through it: zero is a
    // real answer here ("on the use-by day"), and Number(null) is 0 — so
    // parsing first would read every install that predates this setting as
    // having deliberately chosen no lead time at all.
    const storedUseUpLead = dbGetSetting('groceryUseUpLeadDays');
    // `storedUseUpLead ?` rather than a null check alone: '' is the other way
    // a row can say nothing, and Number('') is 0 too. '0' is a non-empty
    // string, so a real zero still parses.
    const parsedUseUpLead = storedUseUpLead ? Number(storedUseUpLead) : Number.NaN;
    const groceryUseUpLeadDays =
      Number.isFinite(parsedUseUpLead)
      && parsedUseUpLead >= GROCERY_USE_UP_LEAD_DAYS_MIN
      && parsedUseUpLead <= GROCERY_USE_UP_LEAD_DAYS_MAX
        ? Math.round(parsedUseUpLead)
        : GROCERY_USE_UP_LEAD_DAYS_DEFAULT;
    // '' persists as "no category", matching mealCookTaskCategory above.
    const storedUseUpCategory = dbGetSetting('groceryUseUpTaskCategory');
    const groceryUseUpTaskCategory = storedUseUpCategory ? storedUseUpCategory : null;
    const remindersImportEnabled = dbGetSetting('remindersImportEnabled') === 'true';
    // `!== 'false'`, not `=== 'true'`, because this one defaults ON — an
    // install that predates the setting has no row, and the usual comparison
    // would read that absence as "apply without asking", which is the opposite
    // of the safe default. Same pattern as hapticsEnabled above.
    const remindersImportReview = dbGetSetting('remindersImportReview') !== 'false';
    const remindersImportListId = dbGetSetting('remindersImportListId') || null;
    const remindersImportConfirmedListId = dbGetSetting('remindersImportConfirmedListId') || null;
    // `!== 'false'` again, and here it's the more important of the two: an
    // install that predates the setting has already been deleting reminders,
    // and reading the missing row as "off" would silently switch it to leaving
    // them behind — duplicating every capture the name index didn't catch.
    const remindersImportDelete = dbGetSetting('remindersImportDelete') !== 'false';
    const groceryImportEnabled = dbGetSetting('groceryImportEnabled') === 'true';
    const groceryImportListId = dbGetSetting('groceryImportListId') || null;
    const groceryImportConfirmedListId = dbGetSetting('groceryImportConfirmedListId') || null;
    const groceryImportDelete = dbGetSetting('groceryImportDelete') !== 'false';
    const calendarReadEnabled = dbGetSetting('calendarReadEnabled') === 'true';
    const calendarIds = parseCalendarIds(dbGetSetting('calendarIds'));
    // Missing row (fresh install, or one that predates this setting) reads as
    // on — same "absent means the default behavior" rule remindersImportDelete
    // uses, so an existing calendar-read user doesn't lose the nudge silently.
    const reminderMeetingNudgeEnabled = dbGetSetting('reminderMeetingNudgeEnabled') !== 'false';
    const projectNudgeDismissedAt = dbGetSetting('projectNudgeDismissedAt') || null;
    // Same TEXT-column parse as every other numeric setting here: an
    // unparseable or missing row (a fresh install, or one that predates this
    // setting) reads back as 0 — never nudge — matching DEFAULT_NUDGE_CADENCE_DAYS.
    const storedDefaultCadence = Number(dbGetSetting('defaultProjectNudgeCadenceDays'));
    const defaultProjectNudgeCadenceDays =
      Number.isFinite(storedDefaultCadence) && storedDefaultCadence > 0 ? storedDefaultCadence : 0;
    const mealPlanNudgeEnabled = dbGetSetting('mealPlanNudgeEnabled') === 'true';
    const storedNudgeWeekday = Number(dbGetSetting('mealPlanNudgeWeekday'));
    const mealPlanNudgeWeekday =
      Number.isInteger(storedNudgeWeekday) && storedNudgeWeekday >= 0 && storedNudgeWeekday <= 6
        ? storedNudgeWeekday
        : DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY;
    const mealPlanNudgeTime = dbGetSetting('mealPlanNudgeTime') || DEFAULT_MEAL_PLAN_NUDGE_TIME;
    const mealPlanNudgeLastFiredWeekKey = dbGetSetting('mealPlanNudgeLastFiredWeekKey') || null;
    const storedQaStatus = dbGetSetting('patchNotesQaStatus');
    let patchNotesQaStatus: Record<string, PatchNoteQaStatus> = {};
    if (storedQaStatus) {
      try {
        patchNotesQaStatus = JSON.parse(storedQaStatus);
      } catch {
        patchNotesQaStatus = {};
      }
    }
    // Merged feature-by-feature against the defaults, rather than trusted
    // wholesale, so a feature added after this setting was first saved shows up
    // enabled with the default model instead of silently missing from the map.
    const aiFeatureConfig = defaultAiFeatureConfig();
    const storedAiFeatureConfig = dbGetSetting('aiFeatureConfig');
    if (storedAiFeatureConfig) {
      try {
        const parsed = JSON.parse(storedAiFeatureConfig) as Partial<
          Record<AiFeatureId, Partial<AiFeatureConfig>>
        >;
        for (const id of AI_FEATURE_IDS) {
          const stored = parsed[id];
          if (!stored) continue;
          aiFeatureConfig[id] = {
            enabled: typeof stored.enabled === 'boolean' ? stored.enabled : aiFeatureConfig[id].enabled,
            model: isAiModelId(stored.model) ? stored.model : aiFeatureConfig[id].model,
          };
        }
      } catch {
        // keep defaults
      }
    }
    const newTaskDefaults = parseNewTaskDefaults(dbGetSetting('newTaskDefaults'));
    set({ dayResetTime: resetTime, morningStart, afternoonStart, eveningStart, nightStart, activeHoursStart, activeHoursEnd, quietHoursStart, quietHoursEnd, themeMode, appFont, dailyAgendaEnabled, dailyAgendaTime, use24HourTime, weekStartsOn, fabHand, hapticsEnabled, shakeToUndoEnabled, sortOption, filterPriorities, filterEfforts, appLockEnabled, appLockGraceSeconds, vacationMode, vacationStart, vacationEnd, autoRemoveExpiredTasks, autoArchiveProjectsOnComplete, postponeCheckEnabled, postponeCheckThreshold, completedRetentionDays, defaultReminderLeadMinutes, hideCategories, simpleTaskForm, timerLiveActivity, kitchenEnabled, mealsOnToday, unitSystem, currencySymbol, mealCookTasks, mealCookTaskCategory, groceryUseUpTasks, groceryUseUpLeadDays, groceryUseUpTaskCategory, remindersImportEnabled, remindersImportListId, remindersImportConfirmedListId, remindersImportDelete, remindersImportReview, groceryImportEnabled, groceryImportListId, groceryImportConfirmedListId, groceryImportDelete, calendarReadEnabled, calendarIds, reminderMeetingNudgeEnabled, projectNudgeDismissedAt, patchNotesQaStatus, aiFeatureConfig, defaultProjectNudgeCadenceDays, mealPlanNudgeEnabled, mealPlanNudgeWeekday, mealPlanNudgeTime, mealPlanNudgeLastFiredWeekKey, newTaskDefaults, initialized: true });
  },

  /**
   * The keychain half of initialize(). Separate because SecureStore is async
   * and initialize() is called from an effect that also has to leave the DB
   * ready for everything downstream of it — awaiting a keychain round trip in
   * the middle of that would delay it for a value nothing needs at launch.
   *
   * A key the user typed while this was in flight wins: the write has already
   * gone to the keychain, and clobbering it with the value we set out to read
   * would silently undo it.
   */
  async initializeSecrets() {
    const anthropicApiKey = await loadAnthropicApiKey();
    set(state => (state.anthropicApiKey ? {} : { anthropicApiKey }));
  },

  setDayResetTime(time: string) {
    dbSetSetting('dayResetTime', time);
    dbSetSetting('morningStart', time);
    set({ dayResetTime: time, morningStart: time });
  },

  setMorningStart(time: string) {
    dbSetSetting('morningStart', time);
    set({ morningStart: time });
  },

  setAfternoonStart(time: string) {
    dbSetSetting('afternoonStart', time);
    set({ afternoonStart: time });
  },

  setEveningStart(time: string) {
    dbSetSetting('eveningStart', time);
    set({ eveningStart: time });
  },

  setNightStart(time: string) {
    dbSetSetting('nightStart', time);
    set({ nightStart: time });
  },

  setActiveHoursStart(time: string) {
    dbSetSetting('activeHoursStart', time);
    set({ activeHoursStart: time });
  },

  setActiveHoursEnd(time: string) {
    dbSetSetting('activeHoursEnd', time);
    set({ activeHoursEnd: time });
  },

  setQuietHours(start: string | null, end: string | null) {
    dbSetSetting('quietHoursStart', start ?? '');
    dbSetSetting('quietHoursEnd', end ?? '');
    set({ quietHoursStart: start, quietHoursEnd: end });
  },

  setThemeMode(mode: ThemeMode) {
    dbSetSetting('themeMode', mode);
    set({ themeMode: mode });
  },

  setAppFont(fontId: AppFont) {
    dbSetSetting('appFont', fontId);
    set({ appFont: fontId });
  },

  setDailyAgendaEnabled(on: boolean) {
    dbSetSetting('dailyAgendaEnabled', on ? 'true' : 'false');
    set({ dailyAgendaEnabled: on });
  },

  setDailyAgendaTime(time: string) {
    dbSetSetting('dailyAgendaTime', time);
    set({ dailyAgendaTime: time });
  },

  setUse24HourTime(on: boolean) {
    dbSetSetting('use24HourTime', on ? 'true' : 'false');
    set({ use24HourTime: on });
  },

  setWeekStartsOn(day: WeekStart) {
    dbSetSetting('weekStartsOn', String(day));
    set({ weekStartsOn: day });
  },

  setFabHand(hand: FabHand) {
    dbSetSetting('fabHand', hand);
    set({ fabHand: hand });
  },

  setHapticsEnabled(on: boolean) {
    dbSetSetting('hapticsEnabled', on ? 'true' : 'false');
    set({ hapticsEnabled: on });
  },

  setShakeToUndoEnabled(on: boolean) {
    dbSetSetting('shakeToUndoEnabled', on ? 'true' : 'false');
    set({ shakeToUndoEnabled: on });
  },

  setSortOption(sort: SortOption) {
    dbSetSetting('sortOption', sort);
    set({ sortOption: sort });
  },

  setFilterPriorities(priorities: Priority[]) {
    dbSetSetting('filterPriorities', JSON.stringify(priorities));
    set({ filterPriorities: priorities });
  },

  setFilterEfforts(efforts: Effort[]) {
    dbSetSetting('filterEfforts', JSON.stringify(efforts));
    set({ filterEfforts: efforts });
  },

  // State first, keychain second and unawaited: every reader of the key is
  // synchronous (aiSuggestions pulls it straight off getState()), and the
  // Settings field that calls this fires on blur, where an await would leave
  // the app briefly disagreeing with what's on screen. A write that fails
  // leaves the key working for this launch and gone at the next one, which is
  // the honest outcome when the keychain won't take it — see secureApiKey.ts
  // on why there is no plaintext fallback.
  setAnthropicApiKey(key: string) {
    set({ anthropicApiKey: key });
    saveAnthropicApiKey(key);
  },

  setAiFeatureConfig(id: AiFeatureId, patch: Partial<AiFeatureConfig>) {
    set(state => {
      const next = { ...state.aiFeatureConfig, [id]: { ...state.aiFeatureConfig[id], ...patch } };
      dbSetSetting('aiFeatureConfig', JSON.stringify(next));
      return { aiFeatureConfig: next };
    });
  },

  setAppLockEnabled(on: boolean) {
    dbSetSetting('appLockEnabled', on ? 'true' : 'false');
    set({ appLockEnabled: on });
  },

  setAppLockGraceSeconds(seconds: number) {
    dbSetSetting('appLockGraceSeconds', String(seconds));
    set({ appLockGraceSeconds: seconds });
  },

  setVacationMode(on: boolean, endDate?: string | null) {
    if (on) {
      const start = new Date().toISOString();
      const end = endDate ?? null;
      dbSetSetting('vacationMode', 'true');
      dbSetSetting('vacationStart', start);
      dbSetSetting('vacationEnd', end ?? '');
      set({ vacationMode: true, vacationStart: start, vacationEnd: end });
    } else {
      dbSetSetting('vacationMode', 'false');
      dbSetSetting('vacationEnd', '');
      set({ vacationMode: false, vacationStart: null, vacationEnd: null });
    }
  },

  setVacationEnd(endDate: string | null) {
    dbSetSetting('vacationEnd', endDate ?? '');
    set({ vacationEnd: endDate });
  },

  setProjectNudgeDismissedAt(at: string | null) {
    dbSetSetting('projectNudgeDismissedAt', at ?? '');
    set({ projectNudgeDismissedAt: at });
  },

  setAutoRemoveExpiredTasks(days: ExpiredTaskGraceDays) {
    dbSetSetting('autoRemoveExpiredTasks', serializeExpiredTaskGrace(days));
    set({ autoRemoveExpiredTasks: days });
  },

  setAutoArchiveProjectsOnComplete(on: boolean) {
    dbSetSetting('autoArchiveProjectsOnComplete', on ? 'true' : 'false');
    set({ autoArchiveProjectsOnComplete: on });
  },

  setPostponeCheckEnabled(on: boolean) {
    dbSetSetting('postponeCheckEnabled', on ? 'true' : 'false');
    set({ postponeCheckEnabled: on });
  },

  setPostponeCheckThreshold(count: number) {
    // Clamped on the way in as well as in the stepper, so a value that somehow
    // got past the UI can't leave the prompt permanently unreachable.
    const clamped = parsePostponeThreshold(String(count));
    dbSetSetting('postponeCheckThreshold', String(clamped));
    set({ postponeCheckThreshold: clamped });
  },

  // Stored as '' for forever, matching vacationEnd/projectNudgeDismissedAt —
  // the settings table is all TEXT, and parseRetentionDays reads anything it
  // doesn't recognise back as forever.
  setCompletedRetentionDays(days: RetentionDays) {
    dbSetSetting('completedRetentionDays', days === null ? '' : String(days));
    set({ completedRetentionDays: days });
  },

  // Stored as '' for off, matching completedRetentionDays — an unrecognised
  // value reads back as off, never as some inherited lead time.
  setDefaultReminderLeadMinutes(minutes: number | null) {
    dbSetSetting('defaultReminderLeadMinutes', minutes === null ? '' : String(minutes));
    set({ defaultReminderLeadMinutes: minutes });
  },

  setHideCategories(on: boolean) {
    dbSetSetting('hideCategories', on ? 'true' : 'false');
    set({ hideCategories: on });
  },

  setSimpleTaskForm(on: boolean) {
    dbSetSetting('simpleTaskForm', on ? 'true' : 'false');
    set({ simpleTaskForm: on });
  },

  setTimerLiveActivity(on: boolean) {
    dbSetSetting('timerLiveActivity', on ? 'true' : 'false');
    set({ timerLiveActivity: on });
  },

  // Nothing else is written here on purpose. Every kitchen setting downstream
  // of this one (mealsOnToday, mealCookTasks, mealPlanNudgeEnabled, the
  // grocery import, the three kitchen AI features) is read *alongside*
  // kitchenEnabled at the point of use rather than being switched off here, so
  // turning the area back on returns it exactly as it was left. And no row is
  // touched: the groceries, recipes, meals and leftovers stay in the database,
  // and the three stores stay initialized, so this is reversible in one tap.
  setKitchenEnabled(on: boolean) {
    dbSetSetting('kitchenEnabled', on ? 'true' : 'false');
    set({ kitchenEnabled: on });
  },

  setMealsOnToday(mode: MealsOnToday) {
    dbSetSetting('mealsOnToday', mode);
    set({ mealsOnToday: mode });
  },

  setUnitSystem(system: UnitSystem) {
    dbSetSetting('unitSystem', system);
    set({ unitSystem: system });
  },

  setCurrencySymbol(symbol: string) {
    // Clamped to the known list: this string is concatenated straight into
    // every price the app renders, so an arbitrary one is a way to make every
    // total unreadable with no way back from inside the feature.
    const next = CURRENCY_SYMBOLS.includes(symbol) ? symbol : DEFAULT_CURRENCY_SYMBOL;
    dbSetSetting('currencySymbol', next);
    set({ currencySymbol: next });
  },

  // Turning this off deliberately leaves the cook tasks already spawned where
  // they are. They're ordinary tasks by now — the user may have filed, dated or
  // half-finished them — and a setting that reached back and deleted rows on
  // being flipped would be doing something no other display or behaviour
  // setting in this app does.
  setMealCookTasks(on: boolean) {
    dbSetSetting('mealCookTasks', on ? 'true' : 'false');
    set({ mealCookTasks: on });
  },

  // Only ever read when a cook task is created, so changing it leaves the ones
  // already filed where they are — same restraint every other default here
  // keeps (newTaskDefaults.category doesn't re-file yesterday's tasks either).
  setMealCookTaskCategory(category: string | null) {
    dbSetSetting('mealCookTaskCategory', category ?? '');
    set({ mealCookTaskCategory: category });
  },

  // Turning this off deliberately leaves the use-up tasks already spawned
  // where they are — the same restraint setMealCookTasks keeps, and the same
  // reason: they're ordinary tasks by now, and no other behaviour setting in
  // this app reaches back and deletes rows when it's flipped.
  //
  // Turning it *on* backfills nothing either. The catalog knows when things
  // were bought, so a backfill is computable — and it would greet the user
  // with a screenful of tasks about food, several days stale, as the first
  // thing the feature ever did. The next trip is soon enough.
  setGroceryUseUpTasks(on: boolean) {
    dbSetSetting('groceryUseUpTasks', on ? 'true' : 'false');
    set({ groceryUseUpTasks: on });
  },

  // Only read when a use-up task is created or its item's date changes, so
  // changing it leaves the tasks already on the list where the user has them.
  setGroceryUseUpLeadDays(days: number) {
    const clamped = Math.max(
      GROCERY_USE_UP_LEAD_DAYS_MIN,
      Math.min(GROCERY_USE_UP_LEAD_DAYS_MAX, Math.round(days))
    );
    dbSetSetting('groceryUseUpLeadDays', String(clamped));
    set({ groceryUseUpLeadDays: clamped });
  },

  setGroceryUseUpTaskCategory(category: string | null) {
    dbSetSetting('groceryUseUpTaskCategory', category ?? '');
    set({ groceryUseUpTaskCategory: category });
  },

  setRemindersImportEnabled(on: boolean) {
    dbSetSetting('remindersImportEnabled', on ? 'true' : 'false');
    set({ remindersImportEnabled: on });
  },

  setRemindersImportListId(id: string | null) {
    dbSetSetting('remindersImportListId', id ?? '');
    set({ remindersImportListId: id });
  },

  setRemindersImportConfirmedListId(id: string | null) {
    dbSetSetting('remindersImportConfirmedListId', id ?? '');
    set({ remindersImportConfirmedListId: id });
  },

  setRemindersImportDelete(on: boolean) {
    dbSetSetting('remindersImportDelete', on ? 'true' : 'false');
    set({ remindersImportDelete: on });
  },

  setGroceryImportEnabled(on: boolean) {
    dbSetSetting('groceryImportEnabled', on ? 'true' : 'false');
    set({ groceryImportEnabled: on });
  },

  setGroceryImportListId(id: string | null) {
    dbSetSetting('groceryImportListId', id ?? '');
    set({ groceryImportListId: id });
  },

  setGroceryImportConfirmedListId(id: string | null) {
    dbSetSetting('groceryImportConfirmedListId', id ?? '');
    set({ groceryImportConfirmedListId: id });
  },

  setGroceryImportDelete(on: boolean) {
    dbSetSetting('groceryImportDelete', on ? 'true' : 'false');
    set({ groceryImportDelete: on });
  },

  setRemindersImportReview(on: boolean) {
    dbSetSetting('remindersImportReview', on ? 'true' : 'false');
    set({ remindersImportReview: on });
  },

  setCalendarReadEnabled(on: boolean) {
    dbSetSetting('calendarReadEnabled', on ? 'true' : 'false');
    set({ calendarReadEnabled: on });
  },

  setCalendarIds(ids: string[]) {
    dbSetSetting('calendarIds', JSON.stringify(ids));
    set({ calendarIds: ids });
  },

  setReminderMeetingNudgeEnabled(on: boolean) {
    dbSetSetting('reminderMeetingNudgeEnabled', on ? 'true' : 'false');
    set({ reminderMeetingNudgeEnabled: on });
  },

  setPatchNoteQaStatus(id: string, status: PatchNoteQaStatus | null) {
    set(state => {
      const next = { ...state.patchNotesQaStatus };
      if (status) {
        next[id] = status;
      } else {
        delete next[id];
      }
      dbSetSetting('patchNotesQaStatus', JSON.stringify(next));
      return { patchNotesQaStatus: next };
    });
  },

  setDefaultProjectNudgeCadenceDays(days: number) {
    dbSetSetting('defaultProjectNudgeCadenceDays', String(days));
    set({ defaultProjectNudgeCadenceDays: days });
  },

  setMealPlanNudgeEnabled(on: boolean) {
    dbSetSetting('mealPlanNudgeEnabled', on ? 'true' : 'false');
    set({ mealPlanNudgeEnabled: on });
  },

  setMealPlanNudgeWeekday(weekday: number) {
    dbSetSetting('mealPlanNudgeWeekday', String(weekday));
    set({ mealPlanNudgeWeekday: weekday });
  },

  setMealPlanNudgeTime(time: string) {
    dbSetSetting('mealPlanNudgeTime', time);
    set({ mealPlanNudgeTime: time });
  },

  // Stored as '' for "never fired", matching projectNudgeDismissedAt — an
  // unrecognised or missing row reads back as null, never as some inherited
  // week.
  setMealPlanNudgeLastFiredWeekKey(weekKey: string | null) {
    dbSetSetting('mealPlanNudgeLastFiredWeekKey', weekKey ?? '');
    set({ mealPlanNudgeLastFiredWeekKey: weekKey });
  },

  setNewTaskDefaults(patch: Partial<NewTaskDefaults>) {
    set(state => {
      const next = { ...state.newTaskDefaults, ...patch };
      dbSetSetting('newTaskDefaults', JSON.stringify(next));
      return { newTaskDefaults: next };
    });
  },

  resetToDefaults() {
    // `value === null ? ''` rather than a bare String(value): DEFAULT_SETTINGS
    // holds two null category defaults (mealCookTaskCategory,
    // groceryUseUpTaskCategory), and String(null) is the literal text "null" —
    // which every reader here treats as a category *named* "null" rather than
    // "no category", giving Today a section header to match. '' is the stored
    // form of "no category" everywhere else in this file, and this is what
    // keeps that true for any future null default too, not just today's two.
    Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
      dbSetSetting(key, value === null ? '' : String(value));
    });
    // Not in DEFAULT_SETTINGS because these two aren't reset to a fixed value
    // at all — they're cleared. Clearing both matters: a reset that turned the
    // import off but left the confirmed-list id in place would let re-enabling
    // later skip the confirmation and swallow whatever had piled up meanwhile.
    dbSetSetting('remindersImportListId', '');
    dbSetSetting('remindersImportConfirmedListId', '');
    dbSetSetting('groceryImportListId', '');
    dbSetSetting('groceryImportConfirmedListId', '');
    set({
      ...DEFAULT_SETTINGS,
      remindersImportListId: null,
      remindersImportConfirmedListId: null,
      groceryImportListId: null,
      groceryImportConfirmedListId: null,
    });
  },
}));
