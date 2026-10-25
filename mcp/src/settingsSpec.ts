/**
 * The settings an agent may read and change, and how each is checked.
 *
 * An allowlist, for the reason `SYNCED_SETTING_KEYS` is one: a setting only
 * reaches the phone if it syncs, and only a preference the person would set in
 * Settings belongs here. Nothing device-local (calendars, the app lock, the API
 * key, notification schedules) and nothing that is state rather than a choice.
 * Each write goes through the settings store's own setter, which clamps the way
 * the Settings screen's stepper does; the result reports what was stored, so a
 * clamped value is said rather than hidden.
 *
 * Type-only imports: this module is loaded by the replica, which hands it the
 * settings store's state once the SQLite shim is in place.
 */
import type { useSettingsStore } from '../../src/store/useSettingsStore';
import type { MealSlot, NutrientKey, TimeOfDay } from '../../src/types';
// A value import, unlike the rest: the nutrient list is plain data with no
// imports of its own, so loading it here needs nothing from the shim.
import { NUTRIENT_KEYS } from '../../src/types';
// The same for the subway lines, and the focus bounds the Settings rows use.
import { TRANSIT_LINES } from '../../src/utils/transitAlerts';
import {
  FOCUS_LONG_REST_EVERY_MAX, FOCUS_LONG_REST_EVERY_MIN, FOCUS_REST_AFTER_MINUTES_MAX, FOCUS_REST_AFTER_MINUTES_MIN,
  FOCUS_REST_AFTER_TASKS_MAX, FOCUS_REST_MAX, FOCUS_REST_MIN, FOCUS_WORK_CAP_MAX, FOCUS_WORK_CAP_MIN,
} from '../../src/utils/focusSettings';

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

export interface SettingSpec {
  /** Which part of Settings it is in, for the read. */
  group: 'day' | 'tasks' | 'features' | 'focus' | 'rewards' | 'kitchen' | 'automations';
  /** What it does, in the app's own plain words. */
  describe: string;
  read: (s: SettingsState) => unknown;
  /** Throws with the reason for a value it cannot take. */
  write: (s: SettingsState, value: unknown) => void;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SEGMENTS: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];
const SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function time(name: string, v: unknown): string {
  if (typeof v !== 'string' || !HHMM.test(v)) throw new Error(`${name} is "HH:MM", 24-hour.`);
  return v;
}
function bool(name: string, v: unknown): boolean {
  if (typeof v !== 'boolean') throw new Error(`${name} is true or false.`);
  return v;
}
function int(name: string, v: unknown, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`${name} is a whole number from ${lo} to ${hi}.`);
  return v;
}
function oneOf<T extends string | number | null>(name: string, v: unknown, options: readonly T[]): T {
  if (!options.includes(v as T)) throw new Error(`${name} is one of ${options.map(o => (o === null ? 'null' : String(o))).join(', ')}.`);
  return v as T;
}
function segments(name: string, v: unknown): TimeOfDay[] {
  if (!Array.isArray(v) || v.some(x => !SEGMENTS.includes(x))) throw new Error(`${name} is a list of ${SEGMENTS.join(', ')}.`);
  return [...new Set(v as TimeOfDay[])];
}
function nutrients(name: string, v: unknown): NutrientKey[] {
  const allowed = NUTRIENT_KEYS.filter(k => k !== 'waterMl');
  if (!Array.isArray(v) || v.some(x => !allowed.includes(x))) throw new Error(`${name} is a list of ${allowed.join(', ')}.`);
  return [...new Set(v as NutrientKey[])];
}
function optionalInt(name: string, v: unknown, lo: number, hi: number): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`${name} is a whole number from ${lo} to ${hi}, or null for off.`);
  return v;
}
function lines(name: string, v: unknown): string[] {
  const known = TRANSIT_LINES.map(l => l.key);
  if (!Array.isArray(v) || v.some(x => !known.includes(x))) throw new Error(`${name} is a list of ${known.join(', ')}.`);
  return [...new Set(v as string[])];
}
function slots(name: string, v: unknown): MealSlot[] {
  if (!Array.isArray(v) || v.some(x => !SLOTS.includes(x))) throw new Error(`${name} is a list of ${SLOTS.join(', ')}.`);
  return [...new Set(v as MealSlot[])];
}

export const SETTINGS_SPEC: Record<string, SettingSpec> = {
  // ---- the day ------------------------------------------------------------
  dayResetTime: { group: 'day', describe: 'When the day turns over ("HH:MM"). Before then it is still yesterday.', read: s => s.dayResetTime, write: (s, v) => s.setDayResetTime(time('dayResetTime', v)) },
  morningStart: { group: 'day', describe: 'When morning starts.', read: s => s.morningStart, write: (s, v) => s.setMorningStart(time('morningStart', v)) },
  afternoonStart: { group: 'day', describe: 'When afternoon starts.', read: s => s.afternoonStart, write: (s, v) => s.setAfternoonStart(time('afternoonStart', v)) },
  eveningStart: { group: 'day', describe: 'When evening starts.', read: s => s.eveningStart, write: (s, v) => s.setEveningStart(time('eveningStart', v)) },
  nightStart: { group: 'day', describe: 'When night starts.', read: s => s.nightStart, write: (s, v) => s.setNightStart(time('nightStart', v)) },
  activeHoursStart: { group: 'day', describe: 'The start of the hours they count as their day, for planning.', read: s => s.activeHoursStart, write: (s, v) => s.setActiveHoursStart(time('activeHoursStart', v)) },
  activeHoursEnd: { group: 'day', describe: 'The end of those hours.', read: s => s.activeHoursEnd, write: (s, v) => s.setActiveHoursEnd(time('activeHoursEnd', v)) },
  quietHours: {
    group: 'day',
    describe: 'Hours no reminder sounds, as { start, end } ("HH:MM"), or null for none.',
    read: s => (s.quietHoursStart && s.quietHoursEnd ? { start: s.quietHoursStart, end: s.quietHoursEnd } : null),
    write: (s, v) => {
      if (v === null) return s.setQuietHours(null, null);
      const q = v as { start?: unknown; end?: unknown };
      s.setQuietHours(time('quietHours.start', q?.start), time('quietHours.end', q?.end));
    },
  },
  weekStartsOn: { group: 'day', describe: 'The first day of the week: 0 Sunday, 1 Monday.', read: s => s.weekStartsOn, write: (s, v) => s.setWeekStartsOn(oneOf('weekStartsOn', v, [0, 1] as const)) },

  // ---- tasks --------------------------------------------------------------
  defaultReminderLeadMinutes: { group: 'tasks', describe: 'Minutes before a timed task its reminder rings by default, or null for none.', read: s => s.defaultReminderLeadMinutes, write: (s, v) => s.setDefaultReminderLeadMinutes(v === null ? null : int('defaultReminderLeadMinutes', v, 0, 1440)) },
  defaultProjectNudgeCadenceDays: { group: 'tasks', describe: 'Days of quiet before a new project offers its next task; 0 never.', read: s => s.defaultProjectNudgeCadenceDays, write: (s, v) => s.setDefaultProjectNudgeCadenceDays(int('defaultProjectNudgeCadenceDays', v, 0, 365)) },
  autoCompleteProjectsOnDone: { group: 'tasks', describe: 'Mark a project complete when its last task is done.', read: s => s.autoCompleteProjectsOnDone, write: (s, v) => s.setAutoCompleteProjectsOnDone(bool('autoCompleteProjectsOnDone', v)) },
  autoRemoveExpiredTasks: { group: 'tasks', describe: 'Delete a task that expired this many days ago (0 at once, 1, 7, 30), or null never.', read: s => s.autoRemoveExpiredTasks, write: (s, v) => s.setAutoRemoveExpiredTasks(oneOf('autoRemoveExpiredTasks', v, [null, 0, 1, 7, 30] as const)) },
  completedRetentionDays: { group: 'tasks', describe: 'Delete completed tasks older than this many days (90 or 365), or null keep forever.', read: s => s.completedRetentionDays, write: (s, v) => s.setCompletedRetentionDays(oneOf('completedRetentionDays', v, [null, 90, 365] as const)) },
  postponeCheckEnabled: { group: 'tasks', describe: 'Ask about a task that keeps being pushed to another day.', read: s => s.postponeCheckEnabled, write: (s, v) => s.setPostponeCheckEnabled(bool('postponeCheckEnabled', v)) },
  postponeCheckThreshold: { group: 'tasks', describe: 'Ask after a task has been pushed this many times.', read: s => s.postponeCheckThreshold, write: (s, v) => s.setPostponeCheckThreshold(int('postponeCheckThreshold', v, 1, 100)) },
  slotInMaxWaitDays: { group: 'tasks', describe: 'Days a task set to wait for a lighter day may wait before it shows up however full the day is (1 to 14, default 3).', read: s => s.slotInMaxWaitDays, write: (s, v) => s.setSlotInMaxWaitDays(int('slotInMaxWaitDays', v, 1, 14)) },
  newTaskDefaults: {
    group: 'tasks',
    describe: 'What a new task starts with: { category, priority (0-4), effort (0-6), difficulty, timeSegment, destination (today, inbox or unscheduled) }. Fields left out stay.',
    read: s => {
      const d = s.newTaskDefaults;
      return { category: d.category, priority: d.priority, effort: d.effort, difficulty: d.difficulty, timeSegment: d.timeSegment, destination: d.destination };
    },
    write: (s, v) => {
      const d = (v ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if ('category' in d) patch.category = d.category === null ? null : String(d.category);
      if ('priority' in d) patch.priority = d.priority === null ? null : int('newTaskDefaults.priority', d.priority, 0, 4);
      if ('effort' in d) patch.effort = d.effort === null ? null : int('newTaskDefaults.effort', d.effort, 0, 6);
      if ('difficulty' in d) patch.difficulty = oneOf('newTaskDefaults.difficulty', d.difficulty, [null, 'trivial', 'easy', 'normal', 'hard'] as const);
      if ('timeSegment' in d) patch.timeSegment = oneOf('newTaskDefaults.timeSegment', d.timeSegment, [null, ...SEGMENTS] as const);
      if ('destination' in d) patch.destination = oneOf('newTaskDefaults.destination', d.destination, ['today', 'inbox', 'unscheduled'] as const);
      if (Object.keys(patch).length === 0) throw new Error('newTaskDefaults: name at least one field.');
      s.setNewTaskDefaults(patch);
    },
  },

  // ---- what is switched on ------------------------------------------------
  kitchenEnabled: { group: 'features', describe: 'Groceries, recipes and the meal plan. Off hides that whole area.', read: s => s.kitchenEnabled, write: (s, v) => s.setKitchenEnabled(bool('kitchenEnabled', v)) },
  simpleMode: { group: 'features', describe: 'Simplified mode: hides the advanced half of the app.', read: s => s.simpleMode, write: (s, v) => s.setSimpleMode(bool('simpleMode', v)) },
  simpleTaskForm: { group: 'features', describe: 'A shorter task editor.', read: s => s.simpleTaskForm, write: (s, v) => s.setSimpleTaskForm(bool('simpleTaskForm', v)) },
  hideCategories: { group: 'features', describe: 'Today shows one list instead of a section per category.', read: s => s.hideCategories, write: (s, v) => s.setHideCategories(bool('hideCategories', v)) },
  healthCategory: {
    group: 'features',
    describe: 'The category Apple Health readings (steps, active calories) show as rows under on Today, or null to hide them. A category that does not exist yet is created. Readings only appear once Health access is on, which is set on the phone.',
    read: s => s.healthCategory,
    write: (s, v) => {
      if (v === null) return s.setHealthCategory(null);
      if (typeof v !== 'string' || !v.trim() || v.trim().length > 40) throw new Error('healthCategory is a category name, or null for none.');
      s.setHealthCategory(v.trim());
    },
  },
  mealsOnToday: { group: 'features', describe: 'Show the day\'s planned meals on Today (inline) or not (off).', read: s => s.mealsOnToday, write: (s, v) => s.setMealsOnToday(oneOf('mealsOnToday', v, ['inline', 'off'] as const)) },
  mealSlotsEnabled: { group: 'features', describe: 'The meals of the day the meal plan has rows for.', read: s => s.mealSlotsEnabled, write: (s, v) => s.setMealSlotsEnabled(slots('mealSlotsEnabled', v)) },

  // ---- focus sessions -----------------------------------------------------
  focusWorkCapMinutes: { group: 'focus', describe: `The longest a single work stretch runs, in minutes (${FOCUS_WORK_CAP_MIN}-${FOCUS_WORK_CAP_MAX}). A task estimated for longer is split into equal parts.`, read: s => s.focusWorkCapMinutes, write: (s, v) => s.setFocusWorkCapMinutes(int('focusWorkCapMinutes', v, FOCUS_WORK_CAP_MIN, FOCUS_WORK_CAP_MAX)) },
  focusDefaultWorkMinutes: { group: 'focus', describe: `The stretch, in minutes, a task with no estimate gets (${FOCUS_WORK_CAP_MIN}-${FOCUS_WORK_CAP_MAX}).`, read: s => s.focusDefaultWorkMinutes, write: (s, v) => s.setFocusDefaultWorkMinutes(int('focusDefaultWorkMinutes', v, FOCUS_WORK_CAP_MIN, FOCUS_WORK_CAP_MAX)) },
  focusBreaksEnabled: { group: 'focus', describe: 'Breaks in a focus session. Off plans none and keeps the break settings below for when it is turned back on.', read: s => s.focusBreaksEnabled, write: (s, v) => s.setFocusBreaksEnabled(bool('focusBreaksEnabled', v)) },
  focusRestAfterMinutes: { group: 'focus', describe: `A break after this many minutes of work (${FOCUS_REST_AFTER_MINUTES_MIN}-${FOCUS_REST_AFTER_MINUTES_MAX}), or null for no time-based breaks.`, read: s => s.focusRestAfterMinutes, write: (s, v) => s.setFocusRestAfterMinutes(optionalInt('focusRestAfterMinutes', v, FOCUS_REST_AFTER_MINUTES_MIN, FOCUS_REST_AFTER_MINUTES_MAX)) },
  focusRestAfterTasks: { group: 'focus', describe: `A break after this many tasks (1-${FOCUS_REST_AFTER_TASKS_MAX}), or null for no task-based breaks.`, read: s => s.focusRestAfterTasks, write: (s, v) => s.setFocusRestAfterTasks(optionalInt('focusRestAfterTasks', v, 1, FOCUS_REST_AFTER_TASKS_MAX)) },
  focusRestMinutes: { group: 'focus', describe: `How long a break is, in minutes (${FOCUS_REST_MIN}-${FOCUS_REST_MAX}).`, read: s => s.focusRestMinutes, write: (s, v) => s.setFocusRestMinutes(int('focusRestMinutes', v, FOCUS_REST_MIN, FOCUS_REST_MAX)) },
  focusLongRestEvery: { group: 'focus', describe: `Every nth break is a long one (${FOCUS_LONG_REST_EVERY_MIN}-${FOCUS_LONG_REST_EVERY_MAX}), or null to keep every break the same length.`, read: s => s.focusLongRestEvery, write: (s, v) => s.setFocusLongRestEvery(optionalInt('focusLongRestEvery', v, FOCUS_LONG_REST_EVERY_MIN, FOCUS_LONG_REST_EVERY_MAX)) },
  focusLongRestMinutes: { group: 'focus', describe: `How long a long break is, in minutes (${FOCUS_REST_MIN}-${FOCUS_REST_MAX}).`, read: s => s.focusLongRestMinutes, write: (s, v) => s.setFocusLongRestMinutes(int('focusLongRestMinutes', v, FOCUS_REST_MIN, FOCUS_REST_MAX)) },
  focusHideTimers: { group: 'focus', describe: 'Hide the countdowns while a session runs.', read: s => s.focusHideTimers, write: (s, v) => s.setFocusHideTimers(bool('focusHideTimers', v)) },

  // ---- rewards ------------------------------------------------------------
  rewardsEnabled: { group: 'rewards', describe: 'Coins for completing tasks, and rewards to spend them on. Off hides the Rewards screen.', read: s => s.rewardsEnabled, write: (s, v) => s.setRewardsEnabled(bool('rewardsEnabled', v)) },
  rewardListProjectId: { group: 'rewards', describe: 'A list (project) whose items can be bought with coins, as a wish list, or null.', read: s => s.rewardListProjectId, write: (s, v) => s.setRewardListProjectId(v === null ? null : String(v)) },
  bountyLimit: { group: 'rewards', describe: 'How many bounties can be posted at once.', read: s => s.bountyLimit, write: (s, v) => s.setBountyLimit(int('bountyLimit', v, 1, 20)) },

  // ---- kitchen ------------------------------------------------------------
  unitSystem: { group: 'kitchen', describe: 'How recipe amounts show: asWritten, metric or us.', read: s => s.unitSystem, write: (s, v) => s.setUnitSystem(oneOf('unitSystem', v, ['asWritten', 'metric', 'us'] as const)) },
  householdServings: { group: 'kitchen', describe: 'How many the meal plan cooks for; 0 uses each recipe\'s own servings.', read: s => s.householdServings, write: (s, v) => s.setHouseholdServings(int('householdServings', v, 0, 99)) },
  currencySymbol: { group: 'kitchen', describe: 'The currency prices are shown in, as a symbol.', read: s => s.currencySymbol, write: (s, v) => { if (typeof v !== 'string' || !v.trim() || v.length > 4) throw new Error('currencySymbol is a short symbol like $ or €.'); s.setCurrencySymbol(v.trim()); } },
  mealProduceCheck: { group: 'kitchen', describe: 'Show a line on the meal plan for lunches and dinners whose recipes list no vegetables or fruit.', read: s => s.mealProduceCheck, write: (s, v) => s.setMealProduceCheck(bool('mealProduceCheck', v)) },
  standardDrinkGrams: { group: 'kitchen', describe: 'Grams of alcohol counted as one drink: 14 (US), 10 (Australia) or 8 (UK).', read: s => s.standardDrinkGrams, write: (s, v) => s.setStandardDrinkGrams(oneOf('standardDrinkGrams', v, [14, 10, 8] as const)) },
  waterUnit: { group: 'kitchen', describe: 'The unit water is counted in: ml or flOz.', read: s => s.waterUnit, write: (s, v) => s.setWaterUnit(oneOf('waterUnit', v, ['ml', 'flOz'] as const)) },
  nutritionLimits: { group: 'kitchen', describe: 'The nutrients whose food log target is a limit to stay under rather than a figure to reach (keys as in set_nutrition_targets). The Food log then says what is left and turns red past it. Only mark one the person said is a limit.', read: s => s.nutritionLimits, write: (s, v) => s.setNutritionLimits(nutrients('nutritionLimits', v)) },
  limitWarnPercent: { group: 'kitchen', describe: 'The share of a limit, as a percent (50-100), at which a day counts as close to it: the Food log bar and the Today row turn orange.', read: s => s.limitWarnPercent, write: (s, v) => s.setLimitWarnPercent(int('limitWarnPercent', v, 50, 100)) },
  limitsTodayCategory: { group: 'kitchen', describe: 'The category Today shows a row per limit under ("Sat fat 9 of 16g, 7g left"), or null for none. It must already exist.', read: s => s.limitsTodayCategory, write: (s, v) => s.setLimitsTodayCategory(v === null ? null : String(v)) },

  cookTextSize: { group: 'kitchen', describe: 'How big cook mode draws the step being read: small, medium, large (the default) or xlarge.', read: s => s.cookTextSize, write: (s, v) => s.setCookTextSize(oneOf('cookTextSize', v, ['small', 'medium', 'large', 'xlarge'] as const)) },
  cookRecapEnabled: { group: 'kitchen', describe: 'When a meal is marked cooked, ask how it was, whether there are leftovers, and what it used up.', read: s => s.cookRecapEnabled, write: (s, v) => s.setCookRecapEnabled(bool('cookRecapEnabled', v)) },
  restockOfferEnabled: { group: 'kitchen', describe: 'After cooking, list what the meal used that is not on the grocery list, with a button to add it.', read: s => s.restockOfferEnabled, write: (s, v) => s.setRestockOfferEnabled(bool('restockOfferEnabled', v)) },
  runningLowAddsToList: { group: 'kitchen', describe: 'Marking an item as running low adds it to the grocery list. Off keeps it as a note in the pantry.', read: s => s.runningLowAddsToList, write: (s, v) => s.setRunningLowAddsToList(bool('runningLowAddsToList', v)) },

  // ---- automations' own settings -----------------------------------------
  birthdayLeadDays: { group: 'automations', describe: 'Days before a birthday its task appears.', read: s => s.birthdayLeadDays, write: (s, v) => s.setBirthdayLeadDays(int('birthdayLeadDays', v, 0, 60)) },
  birthdayGiftLeadDays: { group: 'automations', describe: 'Days before a birthday its gift task appears.', read: s => s.birthdayGiftLeadDays, write: (s, v) => s.setBirthdayGiftLeadDays(int('birthdayGiftLeadDays', v, 0, 90)) },
  moodLogTimeSegments: { group: 'automations', describe: 'The parts of the day the mood check-in task appears in.', read: s => s.moodLogTimeSegments, write: (s, v) => s.setMoodLogTimeSegments(segments('moodLogTimeSegments', v)) },
  journalLogTimeSegments: { group: 'automations', describe: 'The parts of the day the journal task appears in.', read: s => s.journalLogTimeSegments, write: (s, v) => s.setJournalLogTimeSegments(segments('journalLogTimeSegments', v)) },
  moodNudgeAfterDays: { group: 'automations', describe: 'Days of low mood before the app suggests planning something enjoyable.', read: s => s.moodNudgeAfterDays, write: (s, v) => s.setMoodNudgeAfterDays(int('moodNudgeAfterDays', v, 1, 60)) },
  weekendNudgeLeadDays: { group: 'automations', describe: 'Days before a bare weekend the planning nudge appears.', read: s => s.weekendNudgeLeadDays, write: (s, v) => s.setWeekendNudgeLeadDays(int('weekendNudgeLeadDays', v, 0, 14)) },
  weekendNudgePlanThreshold: { group: 'automations', describe: 'A weekend with fewer than this many plans counts as bare.', read: s => s.weekendNudgePlanThreshold, write: (s, v) => s.setWeekendNudgePlanThreshold(int('weekendNudgePlanThreshold', v, 0, 20)) },
  weighInEveryDays: { group: 'automations', describe: 'Days between weigh-in tasks.', read: s => s.weighInEveryDays, write: (s, v) => s.setWeighInEveryDays(int('weighInEveryDays', v, 1, 30)) },
  bloodPressureEveryDays: { group: 'automations', describe: 'Days between blood pressure tasks.', read: s => s.bloodPressureEveryDays, write: (s, v) => s.setBloodPressureEveryDays(int('bloodPressureEveryDays', v, 1, 30)) },
  snackNudgeFromHour: { group: 'automations', describe: 'The hour (0-23) from which the snack nudge can appear.', read: s => s.snackNudgeFromHour, write: (s, v) => s.setSnackNudgeFromHour(int('snackNudgeFromHour', v, 0, 23)) },
  snackNudgeSharePercent: { group: 'automations', describe: 'The share of the day\'s calories still unlogged that triggers the snack nudge.', read: s => s.snackNudgeSharePercent, write: (s, v) => s.setSnackNudgeSharePercent(int('snackNudgeSharePercent', v, 0, 100)) },
  produceFloorCount: { group: 'automations', describe: 'Vegetable and fruit items (1-20) the pantry should list before the weekly restock task appears.', read: s => s.produceFloorCount, write: (s, v) => s.setProduceFloorCount(int('produceFloorCount', v, 1, 20)) },
  produceNudgeFromHour: { group: 'automations', describe: 'The hour (12-21) from which the produce nudge can appear.', read: s => s.produceNudgeFromHour, write: (s, v) => s.setProduceNudgeFromHour(int('produceNudgeFromHour', v, 12, 21)) },
  produceNudgeGoal: { group: 'automations', describe: 'Vegetable and fruit servings (1-10) below which the produce nudge appears.', read: s => s.produceNudgeGoal, write: (s, v) => s.setProduceNudgeGoal(int('produceNudgeGoal', v, 1, 10)) },
  mealShortfallLeadDays: { group: 'automations', describe: 'Days before a planned meal the "missing ingredients" task appears.', read: s => s.mealShortfallLeadDays, write: (s, v) => s.setMealShortfallLeadDays(int('mealShortfallLeadDays', v, 0, 14)) },
  groceryUseUpLeadDays: { group: 'automations', describe: 'Days before something\'s use-by day its "use up" task appears.', read: s => s.groceryUseUpLeadDays, write: (s, v) => s.setGroceryUseUpLeadDays(int('groceryUseUpLeadDays', v, 0, 14)) },
  useUpTaskCap: { group: 'automations', describe: 'At most this many "use up" tasks at once, or null for no limit.', read: s => s.useUpTaskCap, write: (s, v) => s.setUseUpTaskCap(v === null ? null : int('useUpTaskCap', v, 1, 50)) },
  calendarReviewTimeSegment: { group: 'automations', describe: 'The part of the day the calendar review task appears in, or null.', read: s => s.calendarReviewTimeSegment, write: (s, v) => s.setCalendarReviewTimeSegment(oneOf('calendarReviewTimeSegment', v, [null, ...SEGMENTS] as const)) },
  travelLeadMinutes: { group: 'automations', describe: 'Minutes of travel assumed before an event, where none is set on it.', read: s => s.travelLeadMinutes, write: (s, v) => s.setTravelLeadMinutes(int('travelLeadMinutes', v, 5, 180)) },
  travelArriveEarlyMinutes: { group: 'automations', describe: 'Minutes to arrive before an event starts, added to the travel time, where none is set on the event. Negative arrives late.', read: s => s.travelArriveEarlyMinutes, write: (s, v) => s.setTravelArriveEarlyMinutes(int('travelArriveEarlyMinutes', v, -30, 60)) },
  wakeUpUsualMinutes: { group: 'automations', describe: 'The usual wake-up time, in minutes after midnight (240-720, steps of 15). The wake-up task is added only when an event tomorrow needs them up before this.', read: s => s.wakeUpUsualMinutes, write: (s, v) => s.setWakeUpUsualMinutes(int('wakeUpUsualMinutes', v, 240, 720)) },
  wakeUpGetReadyMinutes: { group: 'automations', describe: 'Minutes (0-180) getting ready takes, taken off the time to get up on top of the trip and the arrive-early time.', read: s => s.wakeUpGetReadyMinutes, write: (s, v) => s.setWakeUpGetReadyMinutes(int('wakeUpGetReadyMinutes', v, 0, 180)) },
  travelWalkUnderMinutes: { group: 'automations', describe: 'Walk instead of using travelMode when the walk is this many minutes or fewer (0 is off, steps of 5, up to 60). Needs Apple Maps estimates on.', read: s => s.travelWalkUnderMinutes, write: (s, v) => s.setTravelWalkUnderMinutes(int('travelWalkUnderMinutes', v, 0, 60)) },
  transitLines: { group: 'automations', describe: 'The subway lines whose service alerts are added to a travel task. Alerts on other lines are left out.', read: s => s.transitLines, write: (s, v) => s.setTransitLines(lines('transitLines', v)) },
  travelMode: { group: 'automations', describe: 'How they get to events: driving, transit or walking.', read: s => s.travelMode, write: (s, v) => s.setTravelMode(oneOf('travelMode', v, ['driving', 'transit', 'walking'] as const)) },
  wanikaniReviewThreshold: { group: 'automations', describe: 'How many WaniKani reviews (1-500) have to be waiting before the WaniKani task appears. Fewer waiting now holds the task until the hour WaniKani expects that many.', read: s => s.wanikaniReviewThreshold, write: (s, v) => s.setWanikaniReviewThreshold(int('wanikaniReviewThreshold', v, 1, 500)) },
  wanikaniLessonsPerDay: { group: 'automations', describe: 'Lessons a day (1-100) the daily WaniKani lessons task asks for, or null for no lessons task.', read: s => s.wanikaniLessonsPerDay, write: (s, v) => s.setWanikaniLessonsPerDay(v === null ? null : int('wanikaniLessonsPerDay', v, 1, 100)) },
  wanikaniApprenticeCap: { group: 'automations', describe: 'No WaniKani lessons task on a day this many items (10-500, steps of 10) or more are in Apprentice, or null for no cap.', read: s => s.wanikaniApprenticeCap, write: (s, v) => s.setWanikaniApprenticeCap(v === null ? null : int('wanikaniApprenticeCap', v, 10, 500)) },
  wanikaniNotify: { group: 'automations', describe: 'Whether a WaniKani reviews task held until a later hour notifies when that hour comes.', read: s => s.wanikaniNotify, write: (s, v) => s.setWanikaniNotify(bool('wanikaniNotify', v)) },
  wanikaniClientLink: { group: 'automations', describe: 'The link the WaniKani tasks open, for a third-party client (a web address or an app link like "tsurukame://"). Blank opens wanikani.com.', read: s => s.wanikaniClientLink, write: (s, v) => { if (typeof v !== 'string') throw new Error('wanikaniClientLink is a link as text, or "" for wanikani.com.'); s.setWanikaniClientLink(v); } },
  mealPlanNudgeTime: { group: 'automations', describe: 'The time ("HH:MM") the plan-your-meals nudge appears.', read: s => s.mealPlanNudgeTime, write: (s, v) => s.setMealPlanNudgeTime(time('mealPlanNudgeTime', v)) },
  mealPlanNudgeWeekday: { group: 'automations', describe: 'The weekday (0 Sunday to 6) of that nudge.', read: s => s.mealPlanNudgeWeekday, write: (s, v) => s.setMealPlanNudgeWeekday(int('mealPlanNudgeWeekday', v, 0, 6)) },
  mealPlanNudgeSlots: { group: 'automations', describe: 'The meals that nudge asks to have planned.', read: s => s.mealPlanNudgeSlots, write: (s, v) => s.setMealPlanNudgeSlots(slots('mealPlanNudgeSlots', v)) },
  mealPlanNudgeIgnoresVacation: { group: 'automations', describe: 'Keep the meal plan nudge on during vacation mode.', read: s => s.mealPlanNudgeIgnoresVacation, write: (s, v) => s.setMealPlanNudgeIgnoresVacation(bool('mealPlanNudgeIgnoresVacation', v)) },
};

