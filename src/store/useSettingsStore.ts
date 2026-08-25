import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import type { ThemeMode } from '../theme';
import { DEFAULT_APP_FONT, isAppFont, pickRandomAppFont, type AppFont } from '../theme/fonts';
import type { SortOption, RecipeSortOption, Priority, Effort, MealSlot, TimeOfDay, TitleRule } from '../types';
import {
  DEFAULT_CURRENCY_SYMBOL,
  CURRENCY_SYMBOL_MAX_LENGTH,
  MEAL_SLOTS,
  GROCERY_USE_UP_LEAD_DAYS_DEFAULT,
  GROCERY_USE_UP_LEAD_DAYS_MAX,
  GROCERY_USE_UP_LEAD_DAYS_MIN,
  USE_UP_TASK_CAP_MAX,
  USE_UP_TASK_CAP_MIN,
} from '../types';
import { DEFAULT_MEAL_SLOTS_ENABLED } from '../utils/mealSlotTasks';
import { parseRetentionDays, type RetentionDays } from '../utils/retention';
import { parseExpiredTaskGrace, serializeExpiredTaskGrace, type ExpiredTaskGraceDays } from '../utils/expiredTaskGrace';
import { DEFAULT_APP_LOCK_GRACE_SECONDS, parseGraceSeconds } from '../utils/appLock';
import { FDC_KEY_SECURE_KEY, GO_UPC_KEY_SECURE_KEY, loadAnthropicApiKey, loadSecureKey, saveAnthropicApiKey, saveSecureKey } from '../utils/secureApiKey';
import {
  AI_FEATURE_IDS, defaultAiFeatureConfig, isAiModelId,
  type AiFeatureConfig, type AiFeatureConfigMap, type AiFeatureId,
} from '../utils/aiFeatures';
import { DEFAULT_MEAL_PLAN_NUDGE_TIME, DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY } from '../utils/mealPlanNudge';
import { DEFAULT_POSTPONE_THRESHOLD, parsePostponeThreshold } from '../utils/postpone';
import {
  FOCUS_DEFAULTS,
  parseFocusDefaultWorkMinutes,
  parseFocusLongRestEvery,
  parseFocusLongRestMinutes,
  parseFocusRestAfterMinutes,
  parseFocusRestAfterTasks,
  parseFocusRestMinutes,
  parseFocusWorkCapMinutes,
  serializeOptionalCount,
} from '../utils/focusSettings';
import { UNIT_SYSTEMS, type UnitSystem } from '../utils/unitConvert';
import { normalizeRecipeTags } from '../utils/recipeTags';
import { parseTitleRules } from '../utils/titleRules';
import type { LastTipShown } from '../utils/tips';

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
 * Whether Today shows the day's meals at all (#1402, #1571).
 *
 * Two shapes came before this. `block` was a bold caption over a tray of meal
 * rows above every task — it read as though meal planning were the point of the
 * Today screen. `strip` shrank that to one line of what was left to eat, which
 * fixed the height and kept the glance but was still a fixed row above the
 * list.
 *
 * `inline` is what's left, and it's the default: a meal with no cook task
 * behind it becomes a `ContextRow` *in* the list, filed under the same category
 * the cook tasks use, so the day's food sits together and the top of the screen
 * is a task. Only meals with nowhere else to appear are drawn — a leftover, a
 * takeaway, a dinner typed by hand — because a recipe-backed meal is already a
 * "Cook X" row further down.
 *
 * Both retired values read forward to `inline`. That's a shape someone may have
 * picked on purpose in `block`'s case, and taking it away is deliberate: the
 * block is a second answer to a question the list now answers, and keeping it
 * would mean maintaining a meal-planner panel on the task screen for the sake
 * of not changing an install's appearance once.
 *
 * `off` is for someone who plans meals and doesn't want them on Today at all;
 * with cook tasks on (see `mealCookTasks`) the meals that are *work* still
 * reach the list, so this isn't the same as turning the feature off.
 */
export type MealsOnToday = 'inline' | 'off';

const MEALS_ON_TODAY: MealsOnToday[] = ['inline', 'off'];

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
  // Pick a new appFont from appFontPool at random every cold start, instead of
  // keeping whatever was last selected. See pickRandomAppFont in
  // src/theme/fonts.ts and its call in initialize() below.
  appFontRandomize: boolean;
  // The fonts eligible for appFontRandomize's pick. Kept out of
  // DEFAULT_SETTINGS/resetToDefaults for the same mechanical reason
  // newTaskDefaults is (String(value) doesn't round-trip an array).
  appFontPool: AppFont[];
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
  // Whether a simple "delete this?" confirmation (recipe, template, tag,
  // category, leftover, grocery item/aisle/shop, clearing a list, …) shows an
  // Alert before firing — see src/utils/confirmDelete.ts, the one place that
  // reads this. On by default, like shakeToUndoEnabled. Deliberately doesn't
  // touch a dialog that's asking *which* delete to perform (a recurring
  // task's series-vs-occurrence, a non-empty stack/project's cascade) — those
  // are a choice, not confirmation friction, and stay unconditional.
  confirmBeforeDeleting: boolean;
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
  // Whether Today/Later/Unscheduled/Inbox are narrowed to tasks with a
  // reminder set — the "easy way to see all tasks with alarms" ask (#1739),
  // answered as a fourth SortFilterSheet filter rather than a new screen: the
  // four view-modes already cover every non-completed, non-archived task
  // between them, so flipping through them with this on is a real answer to
  // "which of my tasks have one", not a partial one. Same persisted-view-state
  // reasoning as filterPriorities/filterEfforts above.
  filterHasReminder: boolean;
  // Recipes' own sort & filter, same persisted-view-state reasoning as
  // sortOption/filterPriorities/filterEfforts above — RecipeSortFilterSheet is
  // the recipe box's counterpart to Today's SortFilterSheet. 'default' keeps
  // the box's original favorites-first order, and favoritesOnly off keeps
  // every recipe visible, so an install that predates this reads unchanged.
  recipeSortOption: RecipeSortOption;
  recipeFavoritesOnly: boolean;
  // A standing preference, not a browse filter — unlike recipeFavoritesOnly
  // above, this reaches every suggestion path (offline ranking, AI meal
  // ideas, the meal-plan recipe picker), not just the Recipes screen's own
  // list. Tag-based and nothing else: see excludeRecipesByTags in
  // recipeTags.ts for why this never infers from ingredients. Empty by
  // default, so an untagged box — or one that predates this — is filtered
  // exactly as before: not at all.
  excludedRecipeTags: string[];
  // One summary notification each morning. Off by default — an app that
  // starts notifying you daily because you installed it is the reason people
  // turn notifications off wholesale.
  dailyAgendaEnabled: boolean;
  dailyAgendaTime: string; // "HH:MM"
  // The backstop for a trip left running — one notification, two hours after
  // it started, in case the persistent trip bar isn't enough because the app
  // isn't open to show it. Off by default, same reasoning as dailyAgendaEnabled.
  tripReminderEnabled: boolean;
  // Lives in the device keychain, not the settings table — see
  // src/utils/secureApiKey.ts. It's held here in memory like any other setting,
  // but it arrives a tick late: initialize() is synchronous and the keychain
  // isn't, so initializeSecrets() fills it in (and migrates the old plaintext
  // row) right after. Everything that reads it already treats '' as "AI is off".
  anthropicApiKey: string;
  /**
   * Keys for the two barcode sources that need one. Both optional, and both
   * simply drop their source out of the lookup chain when absent — which is the
   * state every install starts in, since Open Food Facts needs no key and is
   * what makes scanning work out of the box.
   *
   * FoodData Central is free but keyed, so it ranks first when present: a
   * government dataset of US branded foods is a better first answer than a
   * crowd-maintained one where both know a product. Go-UPC is paid and ranks
   * last, after both free sources have said they don't know.
   */
  fdcApiKey: string;
  goUpcApiKey: string;
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
  /**
   * Focus sessions — the run of work stretches and breaks a queue of tasks is
   * turned into (see src/utils/focusPlan.ts). Defaults are a classic pomodoro;
   * `focusSettings.ts` says why each one is what it is.
   */
  // Longest a single work stretch runs. A task estimated longer is split into
  // equal parts, so "2 hours" becomes several stretches with breaks between
  // them rather than one two-hour block wearing a countdown.
  focusWorkCapMinutes: number;
  // The stretch a task with no estimate at all gets.
  focusDefaultWorkMinutes: number;
  // Break after this many tasks are finished. null = don't count tasks.
  focusRestAfterTasks: number | null;
  // Break after this much work has accumulated. null = don't count minutes.
  // Both triggers run at once and whichever fires first inserts the break;
  // with both off the plan holds no breaks, which is a legitimate ask.
  focusRestAfterMinutes: number | null;
  focusRestMinutes: number;
  // Every Nth break is a long one. null = every break is a short one.
  focusLongRestEvery: number | null;
  focusLongRestMinutes: number;
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
  /**
   * Simplified mode — takes the app down to an ordinary todo/kitchen app by
   * hiding roughly thirty capabilities at once (chains, quotas, focus
   * sessions, barcode scanning, product variants, …). Rendering only, and a
   * feature already in use is never taken away; `src/utils/simpleMode.ts`
   * holds the list and both rules.
   *
   * Off by default, same call `simpleTaskForm` and `hideHelpText` make: an
   * install that upgrades into it sees the app it already had.
   *
   * Distinct from `simpleTaskForm`, which only *demotes* rows within the two
   * task forms and hides nothing. They compose — this one removes a row
   * outright, that one decides whether a surviving row starts on show.
   */
  simpleMode: boolean;
  /**
   * Hides the explanatory line under Settings rows/sections and the one-liner
   * inside an expanded editor field (CollapsibleField/EditorRow's `hint`) —
   * everywhere a control already says its own name and the text underneath is
   * only elaborating. Off by default: an install that upgrades into this sees
   * exactly the hints it already had.
   */
  hideHelpText: boolean;
  /**
   * Whether a tip may surface itself as a banner on a hub screen (`TipHost`).
   * Off means the app never volunteers one; the Tips screen still lists every
   * one of them, since turning off interruptions isn't the same as saying you
   * don't want the documentation.
   *
   * Deliberately not folded into `hideHelpText` above, which is about the line
   * *under a control you are already looking at*. Someone who finds those
   * redundant hasn't thereby said they know the app has a meal plan.
   */
  tipsEnabled: boolean;
  /**
   * Tip ids already dismissed or marked read. Progress rather than a
   * preference, so it stays out of DEFAULT_SETTINGS/resetToDefaults for the
   * same reason patchNotesQaStatus does: "reset settings" replaying sixty tips
   * at someone is not what they asked for. `resetTips` is the explicit way
   * back, and it lives on the Tips screen where its effect is visible.
   */
  seenTips: string[];
  /**
   * The tip last put on screen, and the logical day it happened on. This is
   * the whole of the once-a-day rate limit — see `chooseTip` in
   * src/utils/tips.ts for why the limit is app-wide rather than per screen.
   */
  lastTipShown: LastTipShown | null;
  // Live Activity (Lock Screen / Dynamic Island) for a running task timer or
  // recipe cook/prep timer — see src/utils/liveActivity.ts. iOS 17+ only, a
  // no-op everywhere else. Defaults on, like hapticsEnabled/shakeToUndoEnabled
  // above, so an install that predates the setting keeps the behavior it
  // already had once this ships.
  timerLiveActivity: boolean;
  // Same idea as timerLiveActivity, for an active shopping trip
  // (tripShopId/tripStartedAt in useGroceryStore.ts) — see
  // src/utils/tripLiveActivity.ts. iOS 17+ only, defaults on.
  tripLiveActivity: boolean;
  // Same idea again, for the focus session in flight (useFocusStore.ts) — see
  // src/utils/focusLiveActivity.ts. iOS 17+ only, defaults on.
  focusLiveActivity: boolean;
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
  // Whether Today says what's about to be wasted, as a context row filed with
  // the meals (#1689). On by default, and safely so: the row exists only while
  // something is actually down to its last day (see kitchenContextRows), it
  // writes nothing, and anything that already has a "Use up X" task is dropped
  // rather than said twice. So an install upgrading into this sees a row on the
  // days it has something to say and nothing on the rest.
  //
  // Separate from mealsOnToday because a warning and a plan are different
  // things to want on a list — plenty of people want to know the spinach is
  // going without wanting tonight's menu in among their tasks, and the reverse.
  // It shares mealCookTaskCategory rather than growing a category setting of
  // its own: that setting already means "where food goes on Today", and one
  // more "File them under" row for a feature that renders at most one line
  // would cost more to read than it buys.
  kitchenOnToday: boolean;
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
  // The meal-task generator's on/off, covering every meal of every day — see
  // mealSlotsEnabled below for which meals, and src/utils/mealSlotTasks.ts for
  // what each task says.
  //
  // Still named for the cook tasks it was introduced for (#1402): the key is
  // kept rather than migrated, because renaming it would rewrite a preference
  // people have already set for nothing a person can see. Same call the rest of
  // the generators' keys make.
  mealCookTasks: boolean;
  // Which category a meal task files itself under, by name, or null for none.
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
  /**
   * Which meals of the day get a task — the set `checkMealSlotTasks` lays down
   * one row each morning for. Empty is a valid answer and means "none".
   *
   * This is what turned cook tasks from a projection of the *meal plan* into a
   * projection of the *day*: a cook task could only exist where a meal already
   * did, so the slot you hadn't answered was the one the list said nothing
   * about. Naming the meals you actually eat is the only thing the app can't
   * work out for itself — it knows what you planned, never what you skip.
   *
   * Snack is off by default and the other three are on. A snack has no
   * time-of-day segment (see MEAL_SLOT_SEGMENTS), so its task would sit on
   * Today from the moment the day starts rather than surfacing when the meal
   * does, and a day isn't incomplete for want of one — the same call
   * MEAL_PLAN_NUDGE_SLOTS makes when it counts a day out of three.
   */
  mealSlotsEnabled: MealSlot[];
  /**
   * The last day `checkMealSlotTasks` has written meal tasks through, or null
   * for "never run".
   *
   * **A high-water mark, and it is this generator's entire opt-out.** Its source
   * id names a square on the calendar rather than a row, so there is nowhere to
   * write a per-source "no" the way a meal, a grocery item or a leftover carries
   * one — and a growing (kind, sourceId) suppression record is the shape
   * generatedTasks.ts forbids, because nothing prunes it.
   *
   * A mark solves it with one string. The pass only ever writes days *after*
   * the mark, so a day it has covered is never revisited: delete next
   * Thursday's lunch task and it stays deleted, because Thursday is behind the
   * mark. It also means each launch does one day's work rather than
   * re-deciding the whole window — the mark advances to the far end of the
   * horizon on the first run, then by a day at a time.
   *
   * **Deliberately never rewound.** Rewinding is the one thing that would
   * resurrect a row the user deleted, which is why turning a meal *on* backfills
   * only that meal's slots (`backfillMealSlotTasks`) instead of clearing this
   * and letting the pass rewrite the window.
   */
  mealSlotTasksWrittenThroughDayKey: string | null;
  /**
   * A remembered time estimate per meal-slot chain step type, keyed by the
   * step's own id (`${slot}-${key}`, e.g. `breakfast-choose`) — see
   * `activeMealSlotStepId` in `src/utils/mealSlotTasks.ts`. Choosing and
   * eating a given meal take about the same time every day, so once the
   * backfill wizard has been told how long "Choose breakfast" takes, every
   * later "Choose breakfast" is created already carrying that value instead
   * of asking again; only a recipe-backed "Cook X" step has its own evidence
   * (the recipe's time) and never reads this map.
   *
   * Learned data, not a preference — kept out of DEFAULT_SETTINGS/
   * resetToDefaults for the same reason as patchNotesQaStatus.
   */
  mealSlotStepEstimates: Record<string, number>;
  // Whether marking a meal cooked can offer to restock the ingredients it used
  // that aren't on the list — see OfferBanner and MealPlanScreen's
  // restockOffer. Defaults on: the offer is already gated on the app being
  // able to name known items missing from the list (see #1481), so this is a
  // toggle for someone who never shops from a recipe, not a fix for a bad
  // default.
  restockOfferEnabled: boolean;
  // Whether a scanned barcode may be looked up against Open Food Facts to find
  // out what it is — see src/services/productLookup.ts.
  //
  // **The one setting in the app that governs sending data to a service the
  // user has no account with.** Every other network feature here runs on an
  // Anthropic key they pasted themselves, so "no key, no traffic" has always
  // been the whole privacy answer; a barcode lookup needs no key, so it needs
  // a switch instead. What leaves the device is one barcode at a time, with no
  // identifier attached and nothing about the rest of the list, but a barcode
  // is still a thing you bought, and that's worth being able to decline.
  //
  // Defaults on, because a scanner that can't identify anything until someone
  // finds a switch is a scanner that reads as broken. Cached answers are still
  // used while it's off — those were already paid for, and re-asking is
  // exactly what the switch refuses.
  productLookupEnabled: boolean;
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
  // Whether a leftover about to go bad gets a "Use up X" task. On by default
  // — unlike groceryUseUpTasks, this one has no lead-time gap between logging
  // a leftover and it mattering, so it's meant to be automatic: the trigger
  // is needsAttention() itself (soon/due/over while still live), not a
  // separate lead-days setting. The per-leftover override and the rules for
  // which leftovers qualify live in src/utils/leftoverTasks.ts.
  leftoverUseUpTasks: boolean;
  // Which category a leftover's use-up task files itself under, by name, or
  // null for none — same setting as groceryUseUpTaskCategory, for the same
  // reason: loose tasks render above every category section on Today.
  leftoverUseUpTaskCategory: string | null;
  // The shared ceiling grocery and leftover use-up tasks draw from together
  // (#1675) — null (the default) is unlimited. The two generators are
  // independent producers of the same kind of row, so a well-stocked kitchen
  // with both on can put an unbounded pile of "Use up X" tasks on the list at
  // once; this caps the pile without turning either generator off. A source
  // that's declined a slot isn't suppressed — see reconcileGeneratedTask's
  // useUpCap.
  useUpTaskCap: number | null;
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
  // Whether that grocery list is a two-way mirror rather than an inbox: rows
  // added here are written back as reminders, checking off either side checks
  // off the other, and a delete on either side removes the other. Off by
  // default, and it *replaces* the one-way drain for that list rather than
  // running alongside it — see drainTargets in remindersImportSync.ts.
  //
  // Mutually exclusive with groceryImportDelete, which the setter enforces
  // rather than leaving to the UI: the reminder is the mirror, so deleting it
  // the moment it's read leaves nothing to mirror and every row would be
  // written back out on the next pass, for ever.
  groceryImportTwoWay: boolean;
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
  // Which category the day's events file under on Today, by name — the fourth
  // instance of the "File them under" setting the three generated-task kinds
  // already have (see mealCookTaskCategory), and the whole of how events reach
  // the list (#1571). Events used to be a fixed strip above it; as rows in a
  // category they inherit that section's position, its collapse and its focus,
  // so none of that had to be built for them.
  //
  // Stored by name like every other category reference here. It is *not*
  // nullable-means-off: null means the category hasn't been chosen yet, and
  // `ensureCalendarEventCategory` fills it in with a real, renameable category
  // the first time the read is turned on. Nothing shows events when it's null,
  // which is also what happens if the user deletes the category — a section
  // that doesn't exist has nowhere to put them, and picking another (or
  // re-creating it by name) brings them straight back.
  calendarEventCategory: string | null;
  // Which category sections on Today are folded shut, by name. Persisted, and
  // that's the change: this used to be a `useState` in TodayScreen alongside
  // the focus filter, so a category collapsed to get it out of the way was
  // back open on the next cold start. A collapse is a preference about the
  // shape of the list — unlike focus, which is a momentary "just this one for
  // a minute" and stays session-only.
  //
  // Names, so it needs what every other name reference here needs: a rename
  // carries the collapse with it and a delete drops it (see renameCategory /
  // deleteCategory in useTaskStore). Anything those two miss — a restored
  // backup naming categories this device never had — is inert rather than
  // wrong: a name with no category behind it has no header to fold, so it
  // costs a string until that name exists again, which is when the user would
  // want it honoured anyway.
  collapsedCategories: string[];
  // Which meal-type sections the recipe box's "Group" view has folded shut —
  // the recipe-box counterpart of `collapsedCategories` above, same reasoning
  // for persisting it (a collapse is a preference about the shape of the
  // list, not a momentary thing to forget on cold start). Keyed by
  // `recipeSectionKey()` (a RecipeMealType, or `'untagged'`) rather than a
  // display title, since — unlike a task category — that set is fixed by the
  // type and never renamed, so there's nothing to reconcile against on load
  // the way `collapsedCategories` has to be.
  collapsedRecipeSections: string[];
  // Whether a reminder landing inside a meeting gets pushed to the meeting's
  // end (#1491). A refinement of calendarReadEnabled, not a separate read —
  // it does nothing while that's off, and defaults on once it's turned on so
  // the behavior the issue asked for is what a fresh enable gets, with an
  // escape hatch for anyone who'd rather see the reminder fire where it was
  // set and dismiss it themselves.
  reminderMeetingNudgeEnabled: boolean;
  // Which calendar a task's deadline is mirrored onto as an all-day event
  // (#1493), separate from `calendarIds` — those are what's *read*, this is
  // the one place the app *writes*. Null means the write is off: there is no
  // separate "deadline calendar enabled" boolean, because a calendar to
  // write into is exactly what turns the feature on — the per-task "Add to
  // calendar" toggle in the editor has nothing to offer without one, the
  // same way `calendarReadEnabled` follows `calendarIds` in `CalendarSettings`.
  deadlineCalendarId: string | null;
  // Which calendar the week's planned meals are mirrored onto as all-day
  // events (#1494). Null means off, and off is the default — same shape as
  // `deadlineCalendarId` above and for the same reason: a calendar to write
  // into is exactly what turns the feature on, so a second "meal calendar
  // enabled" boolean would only ever be able to disagree with it.
  //
  // Separate from `deadlineCalendarId` rather than one "write to" calendar
  // for the whole app, because the two answer to different people: a
  // deadline is yours, while the point of this one is the household who
  // shares it. Writing both into one calendar would put your work deadlines
  // on the family fridge.
  mealCalendarId: string | null;
  // Whether a project that has gone quiet gets a "Review X" task (see
  // src/utils/projectReviewTasks.ts). Defaults ON, unlike the other opt-in
  // generators: this replaced the quiet-projects banner rather than adding a
  // surface, so an install upgrading into it would otherwise lose the feature
  // silently. The real gate is per-project and unchanged — Project.nudgeOptIn
  // and nudgeCadenceDays, both of which still default to "never ask" — so
  // nobody who hadn't opted a project in sees anything new either way.
  projectReviewTasks: boolean;
  // Which category a review task files itself under, by name, or null for
  // none — same setting as the other generators' for the same reason: loose
  // tasks render above every category section on Today, which is the position
  // this change exists to give back to real work.
  projectReviewTaskCategory: string | null;
  // Whether an item the app has stopped being sure about gets a "Check if you
  // still have X" task (see src/utils/pantryCheckTasks.ts). Defaults OFF,
  // unlike projectReviewTasks above: that one replaced a banner that was
  // already on screen, whereas this adds a surface that wasn't there before,
  // and a generator writing rows nobody asked for has to be asked for. Nothing
  // about an existing install changes until it's switched on.
  pantryCheckTasks: boolean;
  // Which category a pantry check files itself under, by name, or null for
  // none — same setting as the other generators' for the same reason.
  pantryCheckTaskCategory: string | null;
  // Whether a recurring task running low on its supply gets an "Order more X"
  // task (see src/utils/supply.ts). Defaults ON, unlike pantryCheckTasks above,
  // and the difference is who asked: a pantry check is projected from a catalog
  // of hundreds nobody opted in row by row, where a supply exists only because
  // somebody typed a count into the editor. Turning the count on *is* the
  // opt-in, so a second switch defaulting off would mean filling in the feature
  // and then being told nothing. An install with no supplies sees nothing
  // either way.
  supplyReorderTasks: boolean;
  // Which category a reorder task files itself under, by name, or null for
  // none — same setting as the other generators' for the same reason.
  supplyReorderTaskCategory: string | null;
  // Whether a task appears once a day to review tomorrow's calendar (see
  // src/utils/calendarReviewTasks.ts). Defaults OFF, the pantryCheckTasks
  // reading rather than projectReviewTasks': this adds a surface nobody had
  // before, so a generator writing rows unasked has to be asked for.
  //
  // No category setting of its own — see GeneratedKindSpec.categorized. It
  // files under calendarEventCategory instead, the setting the day's own
  // calendar events already render under.
  calendarReviewTasks: boolean;
  // Idempotency state, not a preference — the day key (tomorrow's, as of the
  // most recent check) `checkCalendarReviewTasks` has already decided about,
  // whatever the outcome. Read only by that check, which compares it against
  // tomorrow's actual day key rather than testing it for existence, so it
  // "expires" the moment the day turns (same idiom as
  // mealPlanNudgeLastFiredWeekKey). Without this a task swiped away would come
  // straight back on the very next foreground sweep: calendarReview has no
  // source row to stamp a decline onto (see writeGeneratedOptOut), so this is
  // the only thing standing between a delete and an immediate recreate.
  calendarReviewLastDayKey: string | null;
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
  // TaskGroup.completedAt).
  mealPlanNudgeLastFiredWeekKey: string | null;
  // The stack the weekly nudge lays its seven day-tasks into — state, not a
  // preference, like the week key above it. One stack row is reused week after
  // week and retitled ("Plan meals for 17 – 23 Aug"), rather than a new one per
  // firing: a stack is a label, and a fresh one every Sunday would leave a
  // year's worth of empty stacks behind it, each of them a row in the Stacks
  // screen that nothing prunes. Resolve-or-shrug at the reader — a stack the
  // user deleted reads as null and the next firing makes another.
  mealPlanNudgeGroupId: string | null;
  // Which category the weekly "Plan meals for…" task files under, by name —
  // the fourth of these, added when the nudge stopped being the one generator
  // with nowhere to put its task. Same shape and same rules as
  // mealCookTaskCategory, and it shares that generator's default category
  // ("Meal Plan"), since planning the week and cooking what you planned are
  // one job to the person reading the list.
  mealPlanNudgeTaskCategory: string | null;
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
  // Conditional new-task defaults, keyed on a word in the title — "anything
  // starting with 'expense' goes to Work". Sits one step more specific than
  // newTaskDefaults above and obeys the same contract: it only ever fills a
  // field nobody answered. See TitleRule and utils/titleRules.ts. Kept out of
  // DEFAULT_SETTINGS/resetToDefaults for the mechanical reason newTaskDefaults
  // is (String(value) doesn't round-trip an array) and the same reason the app
  // lock is: "reset appearance and formatting" is not a request to throw away
  // rules somebody wrote.
  titleRules: TitleRule[];
  // The top-level screen (a bottom-tab or drawer route name — see
  // RESTORABLE_SCREENS in AppNavigator.tsx) the app was on when it last left
  // the foreground. State, not a preference — kept out of DEFAULT_SETTINGS/
  // resetToDefaults like vacationEnd — so it's read once, as
  // Tab.Navigator's initialRouteName, to reopen where the user left off
  // instead of always on Today. Null (fresh install, or a name AppNavigator
  // no longer recognizes) falls back to Today.
  lastVisitedScreen: string | null;
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
  setAppFontRandomize: (on: boolean) => void;
  setAppFontPool: (pool: AppFont[]) => void;
  setDailyAgendaEnabled: (on: boolean) => void;
  setDailyAgendaTime: (time: string) => void;
  setTripReminderEnabled: (on: boolean) => void;
  setUse24HourTime: (on: boolean) => void;
  setWeekStartsOn: (day: WeekStart) => void;
  setFabHand: (hand: FabHand) => void;
  setHapticsEnabled: (on: boolean) => void;
  setShakeToUndoEnabled: (on: boolean) => void;
  setConfirmBeforeDeleting: (on: boolean) => void;
  setMealsOnToday: (mode: MealsOnToday) => void;
  setKitchenOnToday: (on: boolean) => void;
  setUnitSystem: (system: UnitSystem) => void;
  setCurrencySymbol: (symbol: string) => void;
  setMealCookTasks: (on: boolean) => void;
  setMealCookTaskCategory: (category: string | null) => void;
  setMealSlotsEnabled: (slots: MealSlot[]) => void;
  setMealSlotTasksWrittenThroughDayKey: (dayKey: string | null) => void;
  setMealSlotStepEstimate: (stepId: string, minutes: number) => void;
  setRestockOfferEnabled: (on: boolean) => void;
  setProductLookupEnabled: (on: boolean) => void;
  setSortOption: (sort: SortOption) => void;
  setFilterPriorities: (priorities: Priority[]) => void;
  setFilterEfforts: (efforts: Effort[]) => void;
  setFilterHasReminder: (on: boolean) => void;
  setRecipeSortOption: (sort: RecipeSortOption) => void;
  setRecipeFavoritesOnly: (favoritesOnly: boolean) => void;
  setExcludedRecipeTags: (tags: string[]) => void;
  setAnthropicApiKey: (key: string) => void;
  setFdcApiKey: (key: string) => void;
  setGoUpcApiKey: (key: string) => void;
  setAiFeatureConfig: (id: AiFeatureId, patch: Partial<AiFeatureConfig>) => void;
  setPostponeCheckEnabled: (on: boolean) => void;
  setPostponeCheckThreshold: (count: number) => void;
  setAppLockEnabled: (on: boolean) => void;
  setAppLockGraceSeconds: (seconds: number) => void;
  setVacationMode: (on: boolean, endDate?: string | null) => void;
  setVacationEnd: (endDate: string | null) => void;
  setAutoRemoveExpiredTasks: (days: ExpiredTaskGraceDays) => void;
  setAutoArchiveProjectsOnComplete: (on: boolean) => void;
  setFocusWorkCapMinutes: (minutes: number) => void;
  setFocusDefaultWorkMinutes: (minutes: number) => void;
  setFocusRestAfterTasks: (count: number | null) => void;
  setFocusRestAfterMinutes: (minutes: number | null) => void;
  setFocusRestMinutes: (minutes: number) => void;
  setFocusLongRestEvery: (count: number | null) => void;
  setFocusLongRestMinutes: (minutes: number) => void;
  setCompletedRetentionDays: (days: RetentionDays) => void;
  setDefaultReminderLeadMinutes: (minutes: number | null) => void;
  setHideCategories: (on: boolean) => void;
  setSimpleTaskForm: (on: boolean) => void;
  setSimpleMode: (on: boolean) => void;
  setHideHelpText: (on: boolean) => void;
  setTipsEnabled: (on: boolean) => void;
  /**
   * Records a tip as promoted, which spends that logical day's one slot.
   *
   * Takes the day key rather than computing it: `getLogicalDayKey` lives in
   * dateUtils, which reads this store for `dayResetTime`, so importing it here
   * would close a cycle. The caller is a component and can reach it freely.
   */
  stampTipShown: (id: string, day: string) => void;
  markTipSeen: (id: string) => void;
  /** Silences every tip at once, without turning the banner off for good. */
  markAllTipsSeen: (ids: string[]) => void;
  resetTips: () => void;
  setTimerLiveActivity: (on: boolean) => void;
  setTripLiveActivity: (on: boolean) => void;
  setFocusLiveActivity: (on: boolean) => void;
  setKitchenEnabled: (on: boolean) => void;
  setRemindersImportEnabled: (on: boolean) => void;
  setRemindersImportListId: (id: string | null) => void;
  setRemindersImportConfirmedListId: (id: string | null) => void;
  setRemindersImportDelete: (on: boolean) => void;
  setGroceryImportEnabled: (on: boolean) => void;
  setGroceryImportListId: (id: string | null) => void;
  setGroceryImportConfirmedListId: (id: string | null) => void;
  setGroceryImportDelete: (on: boolean) => void;
  setGroceryImportTwoWay: (on: boolean) => void;
  setRemindersImportReview: (on: boolean) => void;
  setCalendarReadEnabled: (on: boolean) => void;
  setCalendarIds: (ids: string[]) => void;
  setCalendarEventCategory: (category: string | null) => void;
  setCollapsedCategories: (categories: string[]) => void;
  setCollapsedRecipeSections: (sections: string[]) => void;
  setReminderMeetingNudgeEnabled: (on: boolean) => void;
  setDeadlineCalendarId: (id: string | null) => void;
  setMealCalendarId: (id: string | null) => void;
  setProjectReviewTasks: (on: boolean) => void;
  setProjectReviewTaskCategory: (category: string | null) => void;
  setPantryCheckTasks: (on: boolean) => void;
  setPantryCheckTaskCategory: (category: string | null) => void;
  setSupplyReorderTasks: (on: boolean) => void;
  setSupplyReorderTaskCategory: (category: string | null) => void;
  setCalendarReviewTasks: (on: boolean) => void;
  setCalendarReviewLastDayKey: (dayKey: string | null) => void;
  setDefaultProjectNudgeCadenceDays: (days: number) => void;
  setMealPlanNudgeEnabled: (on: boolean) => void;
  setMealPlanNudgeWeekday: (weekday: number) => void;
  setMealPlanNudgeTime: (time: string) => void;
  setMealPlanNudgeLastFiredWeekKey: (weekKey: string | null) => void;
  setMealPlanNudgeGroupId: (groupId: string | null) => void;
  setMealPlanNudgeTaskCategory: (category: string | null) => void;
  setGroceryUseUpTasks: (on: boolean) => void;
  setGroceryUseUpLeadDays: (days: number) => void;
  setGroceryUseUpTaskCategory: (category: string | null) => void;
  setLeftoverUseUpTasks: (on: boolean) => void;
  setLeftoverUseUpTaskCategory: (category: string | null) => void;
  setUseUpTaskCap: (cap: number | null) => void;
  setPatchNoteQaStatus: (id: string, status: PatchNoteQaStatus | null) => void;
  setNewTaskDefaults: (patch: Partial<NewTaskDefaults>) => void;
  setTitleRules: (rules: TitleRule[]) => void;
  setLastVisitedScreen: (screen: string | null) => void;
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
  appFontRandomize: false,
  use24HourTime: false,
  weekStartsOn: 0 as WeekStart,
  fabHand: 'right' as FabHand,
  hapticsEnabled: true,
  shakeToUndoEnabled: true,
  confirmBeforeDeleting: true,
  dailyAgendaEnabled: false,
  dailyAgendaTime: '08:00',
  tripReminderEnabled: false,
  autoArchiveProjectsOnComplete: false,
  postponeCheckEnabled: true,
  postponeCheckThreshold: DEFAULT_POSTPONE_THRESHOLD,
  focusWorkCapMinutes: FOCUS_DEFAULTS.workCapMinutes,
  focusDefaultWorkMinutes: FOCUS_DEFAULTS.defaultWorkMinutes,
  focusRestAfterTasks: FOCUS_DEFAULTS.restAfterTasks,
  focusRestAfterMinutes: FOCUS_DEFAULTS.restAfterMinutes,
  focusRestMinutes: FOCUS_DEFAULTS.restMinutes,
  focusLongRestEvery: FOCUS_DEFAULTS.longRestEvery,
  focusLongRestMinutes: FOCUS_DEFAULTS.longRestMinutes,
  hideCategories: false,
  simpleTaskForm: false,
  simpleMode: false,
  hideHelpText: false,
  // Only the on/off switch is a default. seenTips and lastTipShown are
  // progress, and are cleared by resetTips rather than by a settings reset —
  // see their notes on the interface above.
  tipsEnabled: true,
  timerLiveActivity: true,
  tripLiveActivity: true,
  focusLiveActivity: true,
  collapsedCategories: [] as string[],
  collapsedRecipeSections: [] as string[],
  mealsOnToday: 'inline' as MealsOnToday,
  kitchenOnToday: true,
  unitSystem: 'asWritten' as UnitSystem,
  currencySymbol: DEFAULT_CURRENCY_SYMBOL,
  mealCookTasks: true,
  mealCookTaskCategory: null,
  mealSlotsEnabled: [...DEFAULT_MEAL_SLOTS_ENABLED],
  mealSlotTasksWrittenThroughDayKey: null,
  restockOfferEnabled: true,
  productLookupEnabled: true,
  groceryUseUpTasks: false,
  groceryUseUpLeadDays: GROCERY_USE_UP_LEAD_DAYS_DEFAULT,
  groceryUseUpTaskCategory: null,
  leftoverUseUpTasks: true,
  leftoverUseUpTaskCategory: null,
  useUpTaskCap: null,
  remindersImportEnabled: false,
  remindersImportDelete: true,
  groceryImportEnabled: false,
  groceryImportDelete: true,
  groceryImportTwoWay: false,
  remindersImportReview: true,
  calendarReadEnabled: false,
  reminderMeetingNudgeEnabled: true,
  defaultProjectNudgeCadenceDays: 0,
  mealPlanNudgeEnabled: false,
  mealPlanNudgeWeekday: DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY,
  mealPlanNudgeTime: DEFAULT_MEAL_PLAN_NUDGE_TIME,
  mealPlanNudgeTaskCategory: null,
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
const RECIPE_SORT_OPTIONS: RecipeSortOption[] =
  ['default', 'name', 'cooked-recent', 'cooked-oldest', 'ingredients-asc', 'ingredients-desc', 'voted'];

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
/**
 * A validated length stands in for the old closed allowlist (#1476) — the
 * property that matters is "can't render garbage", not "is one of four
 * symbols". Trimmed, non-empty, no internal whitespace (a price glued to a
 * multi-word string is unreadable the same way an over-long one is), and no
 * longer than CURRENCY_SYMBOL_MAX_LENGTH. Anything that fails falls back to
 * the default rather than being stored malformed.
 */
function parseCurrencySymbol(raw: string | null): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed || trimmed.length > CURRENCY_SYMBOL_MAX_LENGTH || /\s/.test(trimmed)) {
    return DEFAULT_CURRENCY_SYMBOL;
  }
  return trimmed;
}

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

/**
 * A stored list of category names — the collapsed sections on Today.
 *
 * Unvalidated against the live categories on purpose, the same call
 * `parseCalendarIds` makes: the categories load from their own table and this
 * is read before them, so dropping unknown names here would forget a collapse
 * every launch. `TodayScreen` prunes against what actually rendered.
 */
function parseCategoryNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((name): name is string => typeof name === 'string' && name.length > 0);
  } catch {
    return [];
  }
}

/**
 * A stored list of `recipeSectionKey()` values — the collapsed meal-type
 * sections in the recipe box. Same shape as `parseCategoryNames` (a bad or
 * missing row is just "nothing collapsed"), but with no live set to
 * reconcile against on load: unlike a task category, a recipe meal type is a
 * fixed enum plus `'untagged'`, so a stale key here is simply one that never
 * matches a rendered header again rather than one that needs pruning.
 */
function parseCollapsedRecipeSections(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key): key is string => typeof key === 'string' && key.length > 0);
  } catch {
    return [];
  }
}

/**
 * A stored list of excluded recipe tags. Run through normalizeRecipeTags —
 * not just filtered like parseCategoryNames above — so a tag renamed or
 * reformatted since this was set (recipeTags.ts's own cleanup rules) still
 * matches what's actually on a recipe, rather than silently going stale.
 */
function parseRecipeTagList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return normalizeRecipeTags(parsed);
  } catch {
    return [];
  }
}

/**
 * The stored set of meals that get a task.
 *
 * A missing row falls back to the shipped default (breakfast, lunch, dinner)
 * rather than to none — see the note where this is read. Anything stored is
 * filtered against MEAL_SLOTS and re-ordered by it, so a hand-edited or
 * partially-synced value can't put an unknown string in front of the pass, and
 * an explicit empty list survives as the real answer it is.
 */
function parseMealSlots(raw: string | null): MealSlot[] {
  if (raw === null || raw === '') return [...DEFAULT_MEAL_SLOTS_ENABLED];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_MEAL_SLOTS_ENABLED];
    return MEAL_SLOTS.filter(slot => parsed.includes(slot));
  } catch {
    return [...DEFAULT_MEAL_SLOTS_ENABLED];
  }
}

function parseAppFontPool(raw: string | null): AppFont[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAppFont);
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

export const useSettingsStore = create<SettingsStore>((set, get) => ({
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
  appFontRandomize: false,
  appFontPool: [],
  use24HourTime: false,
  weekStartsOn: 0,
  fabHand: 'right',
  hapticsEnabled: true,
  shakeToUndoEnabled: true,
  confirmBeforeDeleting: true,
  sortOption: 'default',
  filterPriorities: [],
  filterEfforts: [],
  filterHasReminder: false,
  recipeSortOption: 'default',
  recipeFavoritesOnly: false,
  excludedRecipeTags: [],
  titleRules: [],
  dailyAgendaEnabled: false,
  dailyAgendaTime: '08:00',
  tripReminderEnabled: false,
  anthropicApiKey: '',
  fdcApiKey: '',
  goUpcApiKey: '',
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
  focusWorkCapMinutes: FOCUS_DEFAULTS.workCapMinutes,
  focusDefaultWorkMinutes: FOCUS_DEFAULTS.defaultWorkMinutes,
  focusRestAfterTasks: FOCUS_DEFAULTS.restAfterTasks,
  focusRestAfterMinutes: FOCUS_DEFAULTS.restAfterMinutes,
  focusRestMinutes: FOCUS_DEFAULTS.restMinutes,
  focusLongRestEvery: FOCUS_DEFAULTS.longRestEvery,
  focusLongRestMinutes: FOCUS_DEFAULTS.longRestMinutes,
  completedRetentionDays: null,
  defaultReminderLeadMinutes: null,
  hideCategories: false,
  simpleTaskForm: false,
  simpleMode: false,
  hideHelpText: false,
  tipsEnabled: true,
  seenTips: [],
  lastTipShown: null,
  timerLiveActivity: true,
  tripLiveActivity: true,
  focusLiveActivity: true,
  collapsedCategories: [],
  collapsedRecipeSections: [],
  kitchenEnabled: true,
  mealsOnToday: 'inline',
  kitchenOnToday: true,
  unitSystem: 'asWritten',
  currencySymbol: DEFAULT_CURRENCY_SYMBOL,
  mealCookTasks: true,
  mealCookTaskCategory: null,
  mealSlotsEnabled: [...DEFAULT_MEAL_SLOTS_ENABLED],
  mealSlotTasksWrittenThroughDayKey: null,
  mealSlotStepEstimates: {},
  restockOfferEnabled: true,
  productLookupEnabled: true,
  groceryUseUpTasks: false,
  groceryUseUpLeadDays: GROCERY_USE_UP_LEAD_DAYS_DEFAULT,
  groceryUseUpTaskCategory: null,
  leftoverUseUpTasks: true,
  leftoverUseUpTaskCategory: null,
  useUpTaskCap: null,
  remindersImportEnabled: false,
  remindersImportListId: null,
  remindersImportConfirmedListId: null,
  remindersImportDelete: true,
  groceryImportEnabled: false,
  groceryImportListId: null,
  groceryImportConfirmedListId: null,
  groceryImportDelete: true,
  groceryImportTwoWay: false,
  remindersImportReview: true,
  calendarReadEnabled: false,
  calendarIds: [],
  calendarEventCategory: null,
  reminderMeetingNudgeEnabled: true,
  deadlineCalendarId: null,
  mealCalendarId: null,
  projectReviewTasks: true,
  projectReviewTaskCategory: null,
  pantryCheckTasks: false,
  pantryCheckTaskCategory: null,
  supplyReorderTasks: true,
  supplyReorderTaskCategory: null,
  calendarReviewTasks: false,
  calendarReviewLastDayKey: null,
  patchNotesQaStatus: {},
  defaultProjectNudgeCadenceDays: 0,
  mealPlanNudgeEnabled: false,
  mealPlanNudgeWeekday: DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY,
  mealPlanNudgeTime: DEFAULT_MEAL_PLAN_NUDGE_TIME,
  mealPlanNudgeTaskCategory: null,
  mealPlanNudgeLastFiredWeekKey: null,
  mealPlanNudgeGroupId: null,
  newTaskDefaults: DEFAULT_NEW_TASK_DEFAULTS,
  lastVisitedScreen: null,
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
    const appFontRandomize = dbGetSetting('appFontRandomize') === 'true';
    const appFontPool = parseAppFontPool(dbGetSetting('appFontPool'));
    let appFont = isAppFont(storedFont) ? storedFont : DEFAULT_APP_FONT;
    if (appFontRandomize) {
      // Written back to 'appFont' itself, not just held in memory — every
      // other reader (widget sync, sync tracking, the next preloadAppFont
      // call) reads that one key and must not need to know randomization
      // exists.
      const picked = pickRandomAppFont(appFontPool);
      if (picked) {
        appFont = picked;
        dbSetSetting('appFont', appFont);
      }
    }
    const use24HourTime = dbGetSetting('use24HourTime') === 'true';
    const weekStartsOn: WeekStart = dbGetSetting('weekStartsOn') === '1' ? 1 : 0;
    const fabHand: FabHand = dbGetSetting('fabHand') === 'left' ? 'left' : 'right';
    // Defaults on rather than off, so an install that predates the setting
    // keeps the haptics it already had.
    const hapticsEnabled = dbGetSetting('hapticsEnabled') !== 'false';
    // Same reasoning as hapticsEnabled above: defaults on so an install that
    // predates the setting keeps shake-to-undo working.
    const shakeToUndoEnabled = dbGetSetting('shakeToUndoEnabled') !== 'false';
    const confirmBeforeDeleting = dbGetSetting('confirmBeforeDeleting') !== 'false';
    const storedSort = dbGetSetting('sortOption') as SortOption | null;
    const sortOption: SortOption =
      storedSort && SORT_OPTIONS.includes(storedSort) ? storedSort : 'default';
    const filterPriorities = parseFilterArray<Priority>(dbGetSetting('filterPriorities'), 4);
    const filterEfforts = parseFilterArray<Effort>(dbGetSetting('filterEfforts'), 6);
    const filterHasReminder = dbGetSetting('filterHasReminder') === 'true';
    const storedRecipeSort = dbGetSetting('recipeSortOption') as RecipeSortOption | null;
    const recipeSortOption: RecipeSortOption =
      storedRecipeSort && RECIPE_SORT_OPTIONS.includes(storedRecipeSort) ? storedRecipeSort : 'default';
    const recipeFavoritesOnly = dbGetSetting('recipeFavoritesOnly') === 'true';
    const excludedRecipeTags = parseRecipeTagList(dbGetSetting('excludedRecipeTags'));
    const dailyAgendaEnabled = dbGetSetting('dailyAgendaEnabled') === 'true';
    const dailyAgendaTime = dbGetSetting('dailyAgendaTime') ?? '08:00';
    const tripReminderEnabled = dbGetSetting('tripReminderEnabled') === 'true';
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
    const focusWorkCapMinutes = parseFocusWorkCapMinutes(dbGetSetting('focusWorkCapMinutes'));
    const focusDefaultWorkMinutes = parseFocusDefaultWorkMinutes(dbGetSetting('focusDefaultWorkMinutes'));
    const focusRestAfterTasks = parseFocusRestAfterTasks(dbGetSetting('focusRestAfterTasks'));
    const focusRestAfterMinutes = parseFocusRestAfterMinutes(dbGetSetting('focusRestAfterMinutes'));
    const focusRestMinutes = parseFocusRestMinutes(dbGetSetting('focusRestMinutes'));
    const focusLongRestEvery = parseFocusLongRestEvery(dbGetSetting('focusLongRestEvery'));
    const focusLongRestMinutes = parseFocusLongRestMinutes(dbGetSetting('focusLongRestMinutes'));
    const completedRetentionDays = parseRetentionDays(dbGetSetting('completedRetentionDays'));
    const defaultReminderLeadMinutes = parseDefaultReminderLeadMinutes(dbGetSetting('defaultReminderLeadMinutes'));
    const hideCategories = dbGetSetting('hideCategories') === 'true';
    const collapsedCategories = parseCategoryNames(dbGetSetting('collapsedCategories'));
    const collapsedRecipeSections = parseCollapsedRecipeSections(dbGetSetting('collapsedRecipeSections'));
    const simpleTaskForm = dbGetSetting('simpleTaskForm') === 'true';
    const simpleMode = dbGetSetting('simpleMode') === 'true';
    const hideHelpText = dbGetSetting('hideHelpText') === 'true';
    // `!== 'false'`, not `=== 'true'` — defaults on, same reasoning as
    // hapticsEnabled/shakeToUndoEnabled above.
    const timerLiveActivity = dbGetSetting('timerLiveActivity') !== 'false';
    // Same `!== 'false'` reasoning, for the shopping-trip Live Activity.
    const tripLiveActivity = dbGetSetting('tripLiveActivity') !== 'false';
    // And again for the focus session's.
    const focusLiveActivity = dbGetSetting('focusLiveActivity') !== 'false';
    // Same `!== 'false'`: the groceries/recipes/meal plan area is on unless
    // someone has turned it off, so no existing install loses it.
    const kitchenEnabled = dbGetSetting('kitchenEnabled') !== 'false';
    const storedMealsOnToday = dbGetSetting('mealsOnToday');
    // Defaults on, read `!== 'false'` like kitchenEnabled above it.
    const kitchenOnToday = dbGetSetting('kitchenOnToday') !== 'false';
    // 'strip' and 'block' are the retired values (see MealsOnToday). Anything
    // that isn't 'off' means "show me the day's meals", which is now one shape
    // — so they read forward rather than falling through to a default that
    // happens to agree. Read-time only: nothing rewrites the stored row, the
    // same call normalizeAisleOrder makes.
    const mealsOnToday: MealsOnToday = storedMealsOnToday === 'off' ? 'off' : 'inline';
    const storedUnitSystem = dbGetSetting('unitSystem') as UnitSystem | null;
    const unitSystem: UnitSystem =
      storedUnitSystem && UNIT_SYSTEMS.includes(storedUnitSystem) ? storedUnitSystem : 'asWritten';
    const currencySymbol = parseCurrencySymbol(dbGetSetting('currencySymbol'));
    // Defaults on, like hapticsEnabled — but unlike it, "on" here is a change
    // for an existing install rather than a preservation of what it had. It's
    // safe to default on anyway because nothing is backfilled: no cook task
    // exists for any meal already on the calendar, only for ones planned after
    // the update.
    const mealCookTasks = dbGetSetting('mealCookTasks') !== 'false';
    // '' persists as "no category", matching how newTaskDefaults.category reads.
    const storedCookCategory = dbGetSetting('mealCookTaskCategory');
    const mealCookTaskCategory = storedCookCategory ? storedCookCategory : null;
    // Absent (an install upgrading into this) reads as the default set rather
    // than as none, so the meal tasks are live on arrival for the three meals
    // a day is counted out of — the fold replaces cook tasks, which were on by
    // default too, and a silent "none" would read as the feature having gone.
    // An explicit "[]" is a real answer and stays one; only a missing row falls
    // back.
    const storedMealSlots = dbGetSetting('mealSlotsEnabled');
    const mealSlotsEnabled = parseMealSlots(storedMealSlots);
    const mealSlotTasksWrittenThroughDayKey = dbGetSetting('mealSlotTasksWrittenThroughDayKey') || null;
    const storedMealSlotStepEstimates = dbGetSetting('mealSlotStepEstimates');
    let mealSlotStepEstimates: Record<string, number> = {};
    if (storedMealSlotStepEstimates) {
      try {
        mealSlotStepEstimates = JSON.parse(storedMealSlotStepEstimates);
      } catch {
        mealSlotStepEstimates = {};
      }
    }
    // Defaults on, same reading as mealCookTasks above.
    const restockOfferEnabled = dbGetSetting('restockOfferEnabled') !== 'false';
    // Reads `!== 'false'` like the booleans above it, so an install that
    // predates this setting gets the default without a migration.
    const productLookupEnabled = dbGetSetting('productLookupEnabled') !== 'false';
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
    // `!== 'false'`: this one defaults ON, unlike groceryUseUpTasks — an
    // install that predates it has no row, and the missing-row reading has to
    // land on the default the feature ships with.
    const leftoverUseUpTasks = dbGetSetting('leftoverUseUpTasks') !== 'false';
    const storedLeftoverCategory = dbGetSetting('leftoverUseUpTaskCategory');
    const leftoverUseUpTaskCategory = storedLeftoverCategory ? storedLeftoverCategory : null;
    // '' persists as "no cap", same reading as vacationEnd/groceryUseUpTaskCategory.
    const storedUseUpTaskCap = dbGetSetting('useUpTaskCap');
    const parsedUseUpTaskCap = storedUseUpTaskCap ? Number(storedUseUpTaskCap) : Number.NaN;
    const useUpTaskCap =
      Number.isFinite(parsedUseUpTaskCap)
      && parsedUseUpTaskCap >= USE_UP_TASK_CAP_MIN
      && parsedUseUpTaskCap <= USE_UP_TASK_CAP_MAX
        ? Math.round(parsedUseUpTaskCap)
        : null;
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
    const groceryImportTwoWay = dbGetSetting('groceryImportTwoWay') === 'true';
    const calendarReadEnabled = dbGetSetting('calendarReadEnabled') === 'true';
    const calendarIds = parseCalendarIds(dbGetSetting('calendarIds'));
    // '' persists as "not chosen", matching mealCookTaskCategory. Nothing
    // creates the category from here — see ensureCalendarEventCategory, which
    // runs once the categories themselves have loaded.
    const calendarEventCategory = dbGetSetting('calendarEventCategory') || null;
    // Missing row (fresh install, or one that predates this setting) reads as
    // on — same "absent means the default behavior" rule remindersImportDelete
    // uses, so an existing calendar-read user doesn't lose the nudge silently.
    const reminderMeetingNudgeEnabled = dbGetSetting('reminderMeetingNudgeEnabled') !== 'false';
    const deadlineCalendarId = dbGetSetting('deadlineCalendarId') || null;
    const mealCalendarId = dbGetSetting('mealCalendarId') || null;
    // `!== 'false'`: defaults on, the same reading mealCookTasks takes — see
    // the field note for why this one isn't opt-in like the nudge beside it.
    const projectReviewTasks = dbGetSetting('projectReviewTasks') !== 'false';
    const projectReviewTaskCategory = dbGetSetting('projectReviewTaskCategory') || null;
    // `=== 'true'`, the opt-in reading the nudge takes rather than the one
    // above it: this generator adds a surface rather than replacing one, so an
    // install that has never been asked stays silent. See the field note.
    const pantryCheckTasks = dbGetSetting('pantryCheckTasks') === 'true';
    const pantryCheckTaskCategory = dbGetSetting('pantryCheckTaskCategory') || null;
    // Defaults ON, so an unset key reads as true rather than as false — the
    // `!== 'false'` test rather than `=== 'true'`, same shape every other
    // on-by-default setting here uses.
    const supplyReorderTasks = dbGetSetting('supplyReorderTasks') !== 'false';
    const supplyReorderTaskCategory = dbGetSetting('supplyReorderTaskCategory') || null;
    // `=== 'true'`, the same opt-in reading pantryCheckTasks takes and for the
    // same reason: this adds a surface rather than replacing one.
    const calendarReviewTasks = dbGetSetting('calendarReviewTasks') === 'true';
    const calendarReviewLastDayKey = dbGetSetting('calendarReviewLastDayKey') || null;
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
    const mealPlanNudgeGroupId = dbGetSetting('mealPlanNudgeGroupId') || null;
    // '' persists as "no category", matching mealCookTaskCategory.
    const mealPlanNudgeTaskCategory = dbGetSetting('mealPlanNudgeTaskCategory') || null;
    // `!== 'false'`, same as postponeCheckEnabled above: defaults on, so an
    // install that predates the setting gets tips rather than silence.
    const tipsEnabled = dbGetSetting('tipsEnabled') !== 'false';
    // Both stored as JSON, and both fall back to "nothing seen yet" on a parse
    // failure rather than throwing. The cost of getting this wrong is one
    // extra tip, which is the right way round to fail.
    let seenTips: string[] = [];
    const storedSeenTips = dbGetSetting('seenTips');
    if (storedSeenTips) {
      try {
        const parsed = JSON.parse(storedSeenTips);
        if (Array.isArray(parsed)) seenTips = parsed.filter((id): id is string => typeof id === 'string');
      } catch {
        seenTips = [];
      }
    }
    let lastTipShown: LastTipShown | null = null;
    const storedLastTip = dbGetSetting('lastTipShown');
    if (storedLastTip) {
      try {
        const parsed = JSON.parse(storedLastTip);
        if (parsed && typeof parsed.id === 'string' && typeof parsed.day === 'string') {
          lastTipShown = { id: parsed.id, day: parsed.day };
        }
      } catch {
        lastTipShown = null;
      }
    }
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
    const titleRules = parseTitleRules(dbGetSetting('titleRules'));
    const lastVisitedScreen = dbGetSetting('lastVisitedScreen') || null;
    set({ dayResetTime: resetTime, morningStart, afternoonStart, eveningStart, nightStart, activeHoursStart, activeHoursEnd, quietHoursStart, quietHoursEnd, themeMode, appFont, appFontRandomize, appFontPool, dailyAgendaEnabled, dailyAgendaTime, tripReminderEnabled, use24HourTime, weekStartsOn, fabHand, hapticsEnabled, shakeToUndoEnabled, confirmBeforeDeleting, sortOption, filterPriorities, filterEfforts, filterHasReminder, recipeSortOption, recipeFavoritesOnly, excludedRecipeTags, appLockEnabled, appLockGraceSeconds, vacationMode, vacationStart, vacationEnd, autoRemoveExpiredTasks, autoArchiveProjectsOnComplete, postponeCheckEnabled, postponeCheckThreshold, focusWorkCapMinutes, focusDefaultWorkMinutes, focusRestAfterTasks, focusRestAfterMinutes, focusRestMinutes, focusLongRestEvery, focusLongRestMinutes, completedRetentionDays, defaultReminderLeadMinutes, hideCategories, collapsedCategories, collapsedRecipeSections, simpleTaskForm, simpleMode, hideHelpText, tipsEnabled, seenTips, lastTipShown, timerLiveActivity, tripLiveActivity, focusLiveActivity, kitchenEnabled, mealsOnToday, kitchenOnToday, unitSystem, currencySymbol, mealCookTasks, mealCookTaskCategory, mealSlotsEnabled, mealSlotTasksWrittenThroughDayKey, mealSlotStepEstimates, restockOfferEnabled, productLookupEnabled, groceryUseUpTasks, groceryUseUpLeadDays, groceryUseUpTaskCategory, leftoverUseUpTasks, leftoverUseUpTaskCategory, useUpTaskCap, remindersImportEnabled, remindersImportListId, remindersImportConfirmedListId, remindersImportDelete, remindersImportReview, groceryImportEnabled, groceryImportListId, groceryImportConfirmedListId, groceryImportDelete, groceryImportTwoWay, calendarReadEnabled, calendarIds, calendarEventCategory, reminderMeetingNudgeEnabled, deadlineCalendarId, mealCalendarId, projectReviewTasks, projectReviewTaskCategory, pantryCheckTasks, pantryCheckTaskCategory, supplyReorderTasks, supplyReorderTaskCategory, calendarReviewTasks, calendarReviewLastDayKey, patchNotesQaStatus, aiFeatureConfig, defaultProjectNudgeCadenceDays, mealPlanNudgeEnabled, mealPlanNudgeWeekday, mealPlanNudgeTime, mealPlanNudgeLastFiredWeekKey, mealPlanNudgeGroupId, mealPlanNudgeTaskCategory, newTaskDefaults, titleRules, lastVisitedScreen, initialized: true });
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
    // Same don't-clobber-a-live-edit rule, per key: a paste that landed while
    // the read was in flight is the newer value.
    const fdcApiKey = await loadSecureKey(FDC_KEY_SECURE_KEY);
    set(state => (state.fdcApiKey ? {} : { fdcApiKey }));
    const goUpcApiKey = await loadSecureKey(GO_UPC_KEY_SECURE_KEY);
    set(state => (state.goUpcApiKey ? {} : { goUpcApiKey }));
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

  setAppFontRandomize(on: boolean) {
    dbSetSetting('appFontRandomize', on ? 'true' : 'false');
    set({ appFontRandomize: on });
  },

  setAppFontPool(pool: AppFont[]) {
    dbSetSetting('appFontPool', JSON.stringify(pool));
    set({ appFontPool: pool });
  },

  setDailyAgendaEnabled(on: boolean) {
    dbSetSetting('dailyAgendaEnabled', on ? 'true' : 'false');
    set({ dailyAgendaEnabled: on });
  },

  setDailyAgendaTime(time: string) {
    dbSetSetting('dailyAgendaTime', time);
    set({ dailyAgendaTime: time });
  },

  setTripReminderEnabled(on: boolean) {
    dbSetSetting('tripReminderEnabled', on ? 'true' : 'false');
    set({ tripReminderEnabled: on });
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

  setConfirmBeforeDeleting(on: boolean) {
    dbSetSetting('confirmBeforeDeleting', on ? 'true' : 'false');
    set({ confirmBeforeDeleting: on });
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

  setFilterHasReminder(on: boolean) {
    dbSetSetting('filterHasReminder', on ? 'true' : 'false');
    set({ filterHasReminder: on });
  },

  setRecipeSortOption(sort: RecipeSortOption) {
    dbSetSetting('recipeSortOption', sort);
    set({ recipeSortOption: sort });
  },

  setRecipeFavoritesOnly(favoritesOnly: boolean) {
    dbSetSetting('recipeFavoritesOnly', favoritesOnly ? 'true' : 'false');
    set({ recipeFavoritesOnly: favoritesOnly });
  },

  setExcludedRecipeTags(tags: string[]) {
    const normalized = normalizeRecipeTags(tags);
    dbSetSetting('excludedRecipeTags', JSON.stringify(normalized));
    set({ excludedRecipeTags: normalized });
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

  setFdcApiKey(key: string) {
    set({ fdcApiKey: key });
    saveSecureKey(FDC_KEY_SECURE_KEY, key);
  },

  setGoUpcApiKey(key: string) {
    set({ goUpcApiKey: key });
    saveSecureKey(GO_UPC_KEY_SECURE_KEY, key);
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

  setProjectReviewTasks(on: boolean) {
    dbSetSetting('projectReviewTasks', on ? 'true' : 'false');
    set({ projectReviewTasks: on });
  },

  setProjectReviewTaskCategory(category: string | null) {
    dbSetSetting('projectReviewTaskCategory', category ?? '');
    set({ projectReviewTaskCategory: category });
  },

  setPantryCheckTasks(on: boolean) {
    dbSetSetting('pantryCheckTasks', on ? 'true' : 'false');
    set({ pantryCheckTasks: on });
  },

  setPantryCheckTaskCategory(category: string | null) {
    dbSetSetting('pantryCheckTaskCategory', category ?? '');
    set({ pantryCheckTaskCategory: category });
  },

  setSupplyReorderTasks(on: boolean) {
    dbSetSetting('supplyReorderTasks', on ? 'true' : 'false');
    set({ supplyReorderTasks: on });
  },

  setSupplyReorderTaskCategory(category: string | null) {
    dbSetSetting('supplyReorderTaskCategory', category ?? '');
    set({ supplyReorderTaskCategory: category });
  },

  setCalendarReviewTasks(on: boolean) {
    dbSetSetting('calendarReviewTasks', on ? 'true' : 'false');
    set({ calendarReviewTasks: on });
  },

  // Stored as '' for "nothing decided yet", matching mealPlanNudgeLastFiredWeekKey —
  // an unrecognised or missing row reads back as null, never as some inherited day.
  setCalendarReviewLastDayKey(dayKey: string | null) {
    dbSetSetting('calendarReviewLastDayKey', dayKey ?? '');
    set({ calendarReviewLastDayKey: dayKey });
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

  // Every focus setting re-parses on the way in as well as on the way out, so
  // a value that somehow got past the stepper can't put the plan builder in a
  // state the UI has no way to show or undo.
  setFocusWorkCapMinutes(minutes: number) {
    const clamped = parseFocusWorkCapMinutes(String(minutes));
    dbSetSetting('focusWorkCapMinutes', String(clamped));
    set({ focusWorkCapMinutes: clamped });
  },

  setFocusDefaultWorkMinutes(minutes: number) {
    const clamped = parseFocusDefaultWorkMinutes(String(minutes));
    dbSetSetting('focusDefaultWorkMinutes', String(clamped));
    set({ focusDefaultWorkMinutes: clamped });
  },

  setFocusRestAfterTasks(count: number | null) {
    const clamped = parseFocusRestAfterTasks(serializeOptionalCount(count));
    dbSetSetting('focusRestAfterTasks', serializeOptionalCount(clamped));
    set({ focusRestAfterTasks: clamped });
  },

  setFocusRestAfterMinutes(minutes: number | null) {
    const clamped = parseFocusRestAfterMinutes(serializeOptionalCount(minutes));
    dbSetSetting('focusRestAfterMinutes', serializeOptionalCount(clamped));
    set({ focusRestAfterMinutes: clamped });
  },

  setFocusRestMinutes(minutes: number) {
    const clamped = parseFocusRestMinutes(String(minutes));
    dbSetSetting('focusRestMinutes', String(clamped));
    set({ focusRestMinutes: clamped });
  },

  setFocusLongRestEvery(count: number | null) {
    const clamped = parseFocusLongRestEvery(serializeOptionalCount(count));
    dbSetSetting('focusLongRestEvery', serializeOptionalCount(clamped));
    set({ focusLongRestEvery: clamped });
  },

  setFocusLongRestMinutes(minutes: number) {
    const clamped = parseFocusLongRestMinutes(String(minutes));
    dbSetSetting('focusLongRestMinutes', String(clamped));
    set({ focusLongRestMinutes: clamped });
  },

  // Stored as '' for forever, matching vacationEnd —
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

  setSimpleMode(on: boolean) {
    dbSetSetting('simpleMode', on ? 'true' : 'false');
    set({ simpleMode: on });
  },

  setHideHelpText(on: boolean) {
    dbSetSetting('hideHelpText', on ? 'true' : 'false');
    set({ hideHelpText: on });
  },

  setTipsEnabled(on: boolean) {
    dbSetSetting('tipsEnabled', on ? 'true' : 'false');
    set({ tipsEnabled: on });
  },

  // Separate from markTipSeen because they answer different questions: this
  // one records that today's single slot has been spent, and survives the tip
  // sitting unread for a week. Dismissing is what marks it seen.
  stampTipShown(id: string, day: string) {
    const stamp: LastTipShown = { id, day };
    dbSetSetting('lastTipShown', JSON.stringify(stamp));
    set({ lastTipShown: stamp });
  },

  markTipSeen(id: string) {
    set(state => {
      if (state.seenTips.includes(id)) return {};
      const next = [...state.seenTips, id];
      dbSetSetting('seenTips', JSON.stringify(next));
      return { seenTips: next };
    });
  },

  // Takes the ids rather than reading TIPS itself, so this module keeps not
  // importing the tip content — the caller is already rendering the list.
  markAllTipsSeen(ids: string[]) {
    set(state => {
      const next = Array.from(new Set([...state.seenTips, ...ids]));
      if (next.length === state.seenTips.length) return {};
      dbSetSetting('seenTips', JSON.stringify(next));
      return { seenTips: next };
    });
  },

  // Clears the day stamp too. Without that, asking for the tips back and then
  // getting nothing until tomorrow reads as the button having done nothing.
  resetTips() {
    dbSetSetting('seenTips', JSON.stringify([]));
    dbSetSetting('lastTipShown', '');
    set({ seenTips: [], lastTipShown: null });
  },

  setTimerLiveActivity(on: boolean) {
    dbSetSetting('timerLiveActivity', on ? 'true' : 'false');
    set({ timerLiveActivity: on });
  },

  setTripLiveActivity(on: boolean) {
    dbSetSetting('tripLiveActivity', on ? 'true' : 'false');
    set({ tripLiveActivity: on });
  },

  setFocusLiveActivity(on: boolean) {
    dbSetSetting('focusLiveActivity', on ? 'true' : 'false');
    set({ focusLiveActivity: on });
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

  setKitchenOnToday(on: boolean) {
    dbSetSetting('kitchenOnToday', on ? 'true' : 'false');
    set({ kitchenOnToday: on });
  },

  setUnitSystem(system: UnitSystem) {
    dbSetSetting('unitSystem', system);
    set({ unitSystem: system });
  },

  setCurrencySymbol(symbol: string) {
    // Validated rather than clamped to a known list (#1476) — the UI already
    // rejects a bad value with a message and keeps the field open, so this is
    // the defensive floor for any other caller: this string is concatenated
    // straight into every price the app renders, and an unbounded one is a
    // way to make every total unreadable with no way back from inside the
    // feature.
    const next = parseCurrencySymbol(symbol);
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

  // Kept in MEAL_SLOTS order rather than the order they were tapped, so the
  // pass lays a day's rows down breakfast-first however the pills were used.
  //
  // **It deliberately doesn't touch the written-through mark.** Rewinding that
  // would make the next pass rewrite the whole window, which is the one thing
  // that resurrects a row the user deleted — turn breakfast on and Thursday's
  // deleted dinner comes back with it. Turning a meal on instead backfills that
  // meal's slots alone, through useTaskStore.backfillMealSlotTasks, so the days
  // already written gain the new meal and nothing else changes.
  setMealSlotsEnabled(slots: MealSlot[]) {
    const next = MEAL_SLOTS.filter(slot => slots.includes(slot));
    dbSetSetting('mealSlotsEnabled', JSON.stringify(next));
    set({ mealSlotsEnabled: next });
  },

  // '' for "never run", the same reading mealPlanNudgeLastFiredWeekKey uses.
  setMealSlotTasksWrittenThroughDayKey(dayKey: string | null) {
    dbSetSetting('mealSlotTasksWrittenThroughDayKey', dayKey ?? '');
    set({ mealSlotTasksWrittenThroughDayKey: dayKey });
  },

  // Same shape as setPatchNoteQaStatus: one key of a learned-data map,
  // updated and persisted whole. Never removes a key — there's no "forget
  // this step's estimate" affordance, the same as there's no "un-answer a
  // custom field" one for newTaskDefaults.
  setMealSlotStepEstimate(stepId: string, minutes: number) {
    set(state => {
      const next = { ...state.mealSlotStepEstimates, [stepId]: minutes };
      dbSetSetting('mealSlotStepEstimates', JSON.stringify(next));
      return { mealSlotStepEstimates: next };
    });
  },

  // Leaves an offer already standing when this is switched off mid-flight
  // exactly where it is — see the note by setMealCookTasks. The flag is only
  // consulted when a meal is marked cooked, not retroactively.
  setRestockOfferEnabled(on: boolean) {
    dbSetSetting('restockOfferEnabled', on ? 'true' : 'false');
    set({ restockOfferEnabled: on });
  },

  // Switching this off leaves the gtin_lookups cache alone rather than clearing
  // it. Those answers are already on the device and cost nothing to reuse, and
  // a barcode's meaning isn't personal data — what the switch is about is
  // whether new codes go out over the network, not whether old answers are
  // remembered.
  setProductLookupEnabled(on: boolean) {
    dbSetSetting('productLookupEnabled', on ? 'true' : 'false');
    set({ productLookupEnabled: on });
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

  // Same restraint as setGroceryUseUpTasks: turning this off leaves the tasks
  // already spawned exactly where they are.
  setLeftoverUseUpTasks(on: boolean) {
    dbSetSetting('leftoverUseUpTasks', on ? 'true' : 'false');
    set({ leftoverUseUpTasks: on });
  },

  setLeftoverUseUpTaskCategory(category: string | null) {
    dbSetSetting('leftoverUseUpTaskCategory', category ?? '');
    set({ leftoverUseUpTaskCategory: category });
  },

  // Only read when a use-up task is created, same restraint as
  // setGroceryUseUpLeadDays: lowering the cap doesn't retroactively delete
  // tasks already on the list.
  setUseUpTaskCap(cap: number | null) {
    const clamped = cap === null
      ? null
      : Math.max(USE_UP_TASK_CAP_MIN, Math.min(USE_UP_TASK_CAP_MAX, Math.round(cap)));
    dbSetSetting('useUpTaskCap', clamped === null ? '' : String(clamped));
    set({ useUpTaskCap: clamped });
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
    // Deleting the reminder is what one-way capture is built on and what a
    // mirror cannot survive — see groceryImportTwoWay. Enforced on both setters
    // so the two can never be on together, whichever one was touched last.
    if (on && get().groceryImportTwoWay) {
      dbSetSetting('groceryImportTwoWay', 'false');
      set({ groceryImportTwoWay: false });
    }
  },

  setGroceryImportTwoWay(on: boolean) {
    dbSetSetting('groceryImportTwoWay', on ? 'true' : 'false');
    set({ groceryImportTwoWay: on });
    if (on && get().groceryImportDelete) {
      dbSetSetting('groceryImportDelete', 'false');
      set({ groceryImportDelete: false });
    }
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

  setMealPlanNudgeTaskCategory(category: string | null) {
    dbSetSetting('mealPlanNudgeTaskCategory', category ?? '');
    set({ mealPlanNudgeTaskCategory: category });
  },

  setCalendarEventCategory(category: string | null) {
    dbSetSetting('calendarEventCategory', category ?? '');
    set({ calendarEventCategory: category });
  },

  setCollapsedCategories(categories: string[]) {
    dbSetSetting('collapsedCategories', JSON.stringify(categories));
    set({ collapsedCategories: categories });
  },

  setCollapsedRecipeSections(sections: string[]) {
    dbSetSetting('collapsedRecipeSections', JSON.stringify(sections));
    set({ collapsedRecipeSections: sections });
  },

  setReminderMeetingNudgeEnabled(on: boolean) {
    dbSetSetting('reminderMeetingNudgeEnabled', on ? 'true' : 'false');
    set({ reminderMeetingNudgeEnabled: on });
  },

  setDeadlineCalendarId(id: string | null) {
    dbSetSetting('deadlineCalendarId', id ?? '');
    set({ deadlineCalendarId: id });
  },

  // Deliberately no backfill, the same call `mealCookTasks` makes: picking a
  // calendar mirrors the meals planned from here on, and leaves the ones
  // already in the plan alone. Turning it back off likewise leaves whatever
  // was already written — there is no sweep over the plan, and a shared
  // calendar silently losing a fortnight of dinners because someone changed
  // a setting is worse than a few stale ones they can delete.
  setMealCalendarId(id: string | null) {
    dbSetSetting('mealCalendarId', id ?? '');
    set({ mealCalendarId: id });
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

  // Stored as '' for "never fired", matching vacationEnd — an
  // unrecognised or missing row reads back as null, never as some inherited
  // week.
  setMealPlanNudgeLastFiredWeekKey(weekKey: string | null) {
    dbSetSetting('mealPlanNudgeLastFiredWeekKey', weekKey ?? '');
    set({ mealPlanNudgeLastFiredWeekKey: weekKey });
  },

  // '' for "no stack yet", same as the week key above.
  setMealPlanNudgeGroupId(groupId: string | null) {
    dbSetSetting('mealPlanNudgeGroupId', groupId ?? '');
    set({ mealPlanNudgeGroupId: groupId });
  },

  setNewTaskDefaults(patch: Partial<NewTaskDefaults>) {
    set(state => {
      const next = { ...state.newTaskDefaults, ...patch };
      dbSetSetting('newTaskDefaults', JSON.stringify(next));
      return { newTaskDefaults: next };
    });
  },

  /**
   * Written whole rather than patched, unlike setNewTaskDefaults above: the
   * list is what's being edited (added to, reordered by deletion, toggled),
   * and the sheet already holds it.
   */
  setTitleRules(rules: TitleRule[]) {
    dbSetSetting('titleRules', JSON.stringify(rules));
    set({ titleRules: rules });
  },

  setLastVisitedScreen(screen: string | null) {
    dbSetSetting('lastVisitedScreen', screen ?? '');
    set({ lastVisitedScreen: screen });
  },

  resetToDefaults() {
    // `value === null ? ''` rather than a bare String(value): DEFAULT_SETTINGS
    // holds several null category defaults (mealCookTaskCategory,
    // groceryUseUpTaskCategory, leftoverUseUpTaskCategory, …), and
    // String(null) is the literal text "null" — which every reader here
    // treats as a category *named* "null" rather than "no category", giving
    // Today a section header to match. '' is the stored form of "no category"
    // everywhere else in this file, and this is what keeps that true for any
    // future null default too.
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
    // And the mirror's link record, for the same reason: a link holds the state
    // its pair last agreed on, and reset has just switched the mirror off. Left
    // behind, everything done in either app meanwhile would be read against a
    // stale shadow the moment the same list was picked again — an edit made
    // while nothing was watching is not a change to mirror.
    dbSetSetting('groceryImportLinks', '');
    // Same reasoning as the two import list ids: reset stops the write
    // rather than leaving it pointed at a calendar reset didn't ask about.
    // Per-task deadlineOnCalendar flags aren't settings and aren't touched —
    // they just have nothing to write to until a calendar is picked again.
    dbSetSetting('deadlineCalendarId', '');
    dbSetSetting('mealCalendarId', '');
    set({
      ...DEFAULT_SETTINGS,
      remindersImportListId: null,
      remindersImportConfirmedListId: null,
      groceryImportListId: null,
      groceryImportConfirmedListId: null,
      deadlineCalendarId: null,
      mealCalendarId: null,
    });
  },
}));
