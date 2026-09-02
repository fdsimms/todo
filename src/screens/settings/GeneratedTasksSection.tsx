import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSettingsStore, type WeekStart } from '../../store/useSettingsStore';
import { useTaskStore } from '../../store/useTaskStore';
import { ensureGeneratedTaskCategory, useCategoryStore } from '../../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { categoryLabel } from '../../utils/categoryLabel';
import { haptics } from '../../utils/haptics';
import {
  listedGeneratedKinds,
  type GeneratedKind,
  type GeneratedKindSpec,
} from '../../utils/generatedTasks';
import {
  MEAL_SLOTS,
  MEAL_SLOT_ICONS,
  MEAL_SLOT_LABELS,
  GROCERY_USE_UP_LEAD_DAYS_DEFAULT,
  GROCERY_USE_UP_LEAD_DAYS_MAX,
  GROCERY_USE_UP_LEAD_DAYS_MIN,
  MEAL_SHORTFALL_LEAD_DAYS_DEFAULT,
  MEAL_SHORTFALL_LEAD_DAYS_MAX,
  MEAL_SHORTFALL_LEAD_DAYS_MIN,
  USE_UP_TASK_CAP_MAX,
  USE_UP_TASK_CAP_MIN,
  WEEKEND_NUDGE_LEAD_DAYS_DEFAULT,
  WEEKEND_NUDGE_LEAD_DAYS_MAX,
  WEEKEND_NUDGE_LEAD_DAYS_MIN,
  type TimeOfDay,
} from '../../types';
import { dateToHHMM, hhmmToDate } from '../../utils/clockTime';
import { formatHHMM } from '../../utils/dateUtils';
import { useColors } from '../../theme/ThemeContext';
import { spacing, type Colors } from '../../theme';
import { CountStepper } from '../../components/CountStepper';
import {
  DEFAULT_BIRTHDAY_LEAD_DAYS,
  DEFAULT_BIRTHDAY_GIFT_LEAD_DAYS,
  MAX_BIRTHDAY_LEAD_DAYS,
} from '../../utils/birthdayTasks';
import { describeWeekendNudgeLead } from '../../utils/weekendTasks';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { InlineTimePicker } from './InlineTimePicker';
import { WeatherRulesSheet } from '../../components/WeatherRulesSheet';
import { ScreenTimeRulesSheet } from '../../components/ScreenTimeRulesSheet';
import { HealthRulesSheet } from '../../components/HealthRulesSheet';
import { PillGroup, type PillGroupOption } from '../../components/PillGroup';
import { type SegmentOption } from '../../components/SegmentedControl';
import { makeSettingsStyles } from './settingsStyles';

/**
 * Every task the app writes without being asked, in one section.
 *
 * These used to be four unrelated rows in four places — "Meals on Today",
 * "Use-up reminders" and "Leftovers" in Tasks & projects, and "Meal planning"
 * over in Notifications — each with its own header, its own footer paragraph
 * and its own copy of the same on/off + "file them under" pair. Nowhere did the
 * app answer the one question a person actually has about them, which is *what
 * writes tasks into my list*. It does now, in the order `GENERATED_KIND_LIST`
 * declares (#1524).
 *
 * **The list is the registry, but the controls are still JSX**, which is the
 * same line `settingsIndex.ts` draws and for the same reason: a config able to
 * express a toggle, a category grid, a day-count stepper, a weekday pill row
 * and an inline time picker would be harder to read than the rows it replaced.
 * So the registry supplies what a *listing* needs — which generators exist,
 * what each is called, what its two hint states say — and `extrasFor` below
 * hand-writes the handful of controls that are genuinely one generator's own.
 * A fifth generator gets a row here by being added to the registry, and needs
 * an `extrasFor` case only if it has a knob nobody else has.
 *
 * The nudge is in the list despite having no source row to opt out of, because
 * from the user's side it is exactly the same kind of thing: a task that
 * appears in the list because the app put it there. So is the project review
 * task, which is the first entry here that has nothing to do with the kitchen —
 * and which arrived needing no `extrasFor` case at all, which is the claim
 * above being cashed.
 */

// Full names for the hint sentence and screen reader labels; single letters on
// the segments themselves, the same compression the calendar's own header uses
// to fit all seven across 390pt. Moved here with the nudge's controls.
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// The calendar review task's own "Time of day" choice — pinned "Any time"
// alongside the same four segments a task's own Time of day field offers, in
// the same order. Pills, not a SegmentedControl, matching the app's rule for
// time-of-day segments generally, even though only one is ever chosen here.
const timeSegmentChoices: { value: TimeOfDay | null; label: string }[] = [
  { value: null, label: 'Any time' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
];

/** Weekday segments rotated to start at weekStartsOn, matching the calendar's header order. */
function weekdayOptions(weekStartsOn: WeekStart): SegmentOption<number>[] {
  return Array.from({ length: 7 }, (_, i) => {
    const value = (weekStartsOn + i) % 7;
    return { value, label: WEEKDAY_LETTERS[value] };
  });
}

export function GeneratedTasksSection() {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const sectionStyles = useMemo(() => makeStyles(colors), [colors]);

  const s = useSettingsStore();
  const categories = useCategoryStore(useShallow(state => state.categories));

  // Built here rather than handed down, now that this is a screen of its own
  // rather than a section inside Tasks & projects. Not a segmented control: the
  // categories are the user's own and there can be fifteen, which is
  // `PillGroup`'s job (it caps and filters) and not a track's. `None` is
  // `pinned` — the option meaning "no choice" is never buried behind "N more".
  const categoryOptions: { value: string | null; label: string }[] = useMemo(() => [
    { value: null, label: 'None' },
    ...categories.map(c => ({ value: c.name, label: categoryLabel(c.name, categories) })),
  ], [categories]);

  const categoryPills = (
    selected: string | null,
    onSelect: (value: string | null) => void,
    describe: (label: string) => string,
  ): PillGroupOption[] => categoryOptions.map(o => ({
    key: String(o.value),
    label: o.label,
    selected: o.value === selected,
    pinned: o.value === null,
    accessibilityLabel: describe(o.label),
    onPress: () => { haptics.tap(); onSelect(o.value); },
  }));

  // The kitchen's generators go with the area, the way every other kitchen row
  // does — but the other six stay, which is the whole point of the flag living
  // on the registry. This section used to sit inside Tasks & projects' own
  // `{kitchenEnabled && …}` block, so switching the area off took all twelve
  // rows away while six of the generators behind them kept writing tasks.
  const listed = useMemo(() => listedGeneratedKinds(s.kitchenEnabled), [s.kitchenEnabled]);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(() => hhmmToDate(s.mealPlanNudgeTime));
  const [weatherRulesVisible, setWeatherRulesVisible] = useState(false);
  const activeWeatherRuleCount = useMemo(
    () => s.weatherRules.filter(r => r.enabled).length,
    [s.weatherRules],
  );

  const [screenTimeRulesVisible, setScreenTimeRulesVisible] = useState(false);
  const [healthRulesVisible, setHealthRulesVisible] = useState(false);
  const activeScreenTimeRuleCount = useMemo(
    () => s.screenTimeRules.filter(r => r.enabled).length,
    [s.screenTimeRules],
  );
  const activeHealthRuleCount = useMemo(
    () => s.healthRules.filter(r => r.enabled).length,
    [s.healthRules],
  );

  const weekdaySegmentOptions = useMemo(() => weekdayOptions(s.weekStartsOn), [s.weekStartsOn]);

  // Each generator's on/off answer and its category still live under their own
  // settings keys. Renaming them to a generic pair would be a migration over
  // preferences people have already set, for no gain a person can see — the
  // consolidation people asked for is the one in front of them, not in SQLite.
  // A switch per kind rather than a ternary chain ending in a default: with
  // four generators the last arm was the nudge's, and a fifth added to the
  // registry would silently have read and written the nudge's own setting
  // instead of its own. An exhaustive switch makes that a typecheck failure.
  const enabledOf = (kind: GeneratedKind): boolean => {
    switch (kind) {
      // One arm for both: mealSlot is what mealCook folded into, and it kept
      // the setting keys rather than migrating preferences people had already
      // set (see the note above). Legacy rows still read as mealCook, so the
      // kind stays answerable even though nothing lists it any more.
      case 'mealSlot':
      case 'mealCook': return s.mealCookTasks;
      case 'groceryUseUp': return s.groceryUseUpTasks;
      case 'leftoverUseUp': return s.leftoverUseUpTasks;
      case 'mealPlanNudge': return s.mealPlanNudgeEnabled;
      case 'projectReview': return s.projectReviewTasks;
      case 'pantryCheck': return s.pantryCheckTasks;
      case 'pantryReview': return s.pantryReviewTasks;
      case 'mealShortfall': return s.mealShortfallTasks;
      case 'supplyReorder': return s.supplyReorderTasks;
      case 'calendarReview': return s.calendarReviewTasks;
      case 'birthday': return s.birthdayTasks;
      case 'birthdayGift': return s.birthdayGiftTasks;
      case 'reachOut': return s.reachOutTasks;
      case 'weather': return s.weatherTasks;
      case 'screenTime': return s.screenTimeTasks;
      // Both switches, for the reason generatorEnabled gives: the pass
      // cannot run while the app is not allowed to read Health at all, so a
      // row reading "on" over a closed read would be lying about itself.
      case 'health': return s.healthTasks && s.healthReadEnabled;
      case 'moodLog': return s.moodLogTasks;
      case 'moodNudge': return s.moodNudgeTasks;
      case 'weekendNudge': return s.weekendNudgeTasks;
    }
  };

  const toggle = (kind: GeneratedKind): void => {
    const next = !enabledOf(kind);
    switch (kind) {
      case 'mealSlot':
      case 'mealCook': s.setMealCookTasks(next); break;
      case 'groceryUseUp': s.setGroceryUseUpTasks(next); break;
      case 'leftoverUseUp': s.setLeftoverUseUpTasks(next); break;
      case 'mealPlanNudge': s.setMealPlanNudgeEnabled(next); break;
      case 'projectReview': s.setProjectReviewTasks(next); break;
      case 'pantryCheck': s.setPantryCheckTasks(next); break;
      case 'pantryReview': s.setPantryReviewTasks(next); break;
      case 'mealShortfall': s.setMealShortfallTasks(next); break;
      case 'supplyReorder': s.setSupplyReorderTasks(next); break;
      case 'calendarReview': s.setCalendarReviewTasks(next); break;
      case 'birthday': s.setBirthdayTasks(next); break;
      case 'birthdayGift': s.setBirthdayGiftTasks(next); break;
      case 'reachOut': s.setReachOutTasks(next); break;
      case 'weather': s.setWeatherTasks(next); break;
      case 'screenTime': s.setScreenTimeTasks(next); break;
      case 'health': s.setHealthTasks(next); break;
      case 'moodLog': s.setMoodLogTasks(next); break;
      case 'moodNudge': s.setMoodNudgeTasks(next); break;
      case 'weekendNudge': s.setWeekendNudgeTasks(next); break;
    }
    // Switching one on gives it somewhere to file, so the "File them under"
    // row that appears directly below already has an answer in it rather than
    // reading "None" — which is the value that puts these tasks loose at the
    // top of Today. Only ever fills an unanswered setting; see
    // ensureGeneratedTaskCategory.
    if (next) ensureGeneratedTaskCategory(kind, { force: true });
  };

  // calendarReview's arm returns calendarEventCategory rather than a category
  // of its own, for anything that calls this out of habit — but categorized:
  // false means the "File them under" row is never rendered for it, so
  // that arm is never actually reached in practice. supplyReorder is
  // categorized: false for a different reason (it inherits the source task's
  // own category — see checkSupplyReorderTasks) and so has no arm here at all.
  const categoryOf = (kind: GeneratedKind): string | null => {
    switch (kind) {
      case 'mealSlot':
      case 'mealCook': return s.mealCookTaskCategory;
      case 'groceryUseUp': return s.groceryUseUpTaskCategory;
      case 'leftoverUseUp': return s.leftoverUseUpTaskCategory;
      case 'mealPlanNudge': return s.mealPlanNudgeTaskCategory;
      case 'projectReview': return s.projectReviewTaskCategory;
      case 'pantryCheck': return s.pantryCheckTaskCategory;
      case 'pantryReview': return s.pantryReviewTaskCategory;
      case 'mealShortfall': return s.mealShortfallTaskCategory;
      case 'calendarReview': return s.calendarEventCategory;
      case 'birthday': return s.birthdayTaskCategory;
      case 'birthdayGift': return s.birthdayGiftTaskCategory;
      case 'supplyReorder': return null;
      case 'reachOut': return s.reachOutTaskCategory;
      case 'weather': return s.weatherTaskCategory;
      case 'screenTime': return s.screenTimeTaskCategory;
      case 'health': return s.healthTaskCategory;
      case 'moodLog': return s.moodLogTaskCategory;
      case 'moodNudge': return s.moodNudgeTaskCategory;
      case 'weekendNudge': return s.weekendNudgeTaskCategory;
    }
  };

  // No haptic here: `categoryPills` fires one in its own onPress, and two for
  // one tap reads as a stutter.
  const setCategory = (kind: GeneratedKind, category: string | null): void => {
    switch (kind) {
      case 'mealSlot':
      case 'mealCook': s.setMealCookTaskCategory(category); break;
      case 'groceryUseUp': s.setGroceryUseUpTaskCategory(category); break;
      case 'leftoverUseUp': s.setLeftoverUseUpTaskCategory(category); break;
      case 'mealPlanNudge': s.setMealPlanNudgeTaskCategory(category); break;
      case 'projectReview': s.setProjectReviewTaskCategory(category); break;
      case 'pantryCheck': s.setPantryCheckTaskCategory(category); break;
      case 'pantryReview': s.setPantryReviewTaskCategory(category); break;
      case 'mealShortfall': s.setMealShortfallTaskCategory(category); break;
      case 'birthday': s.setBirthdayTaskCategory(category); break;
      case 'birthdayGift': s.setBirthdayGiftTaskCategory(category); break;
      // Unreached — see categoryOf above — but a real, honest answer rather
      // than a no-op: this is genuinely how calendarReview's category changes.
      case 'calendarReview': s.setCalendarEventCategory(category); break;
      case 'reachOut': s.setReachOutTaskCategory(category); break;
      case 'weather': s.setWeatherTaskCategory(category); break;
      case 'screenTime': s.setScreenTimeTaskCategory(category); break;
      case 'health': s.setHealthTaskCategory(category); break;
      case 'moodLog': s.setMoodLogTaskCategory(category); break;
      case 'moodNudge': s.setMoodNudgeTaskCategory(category); break;
      case 'weekendNudge': s.setWeekendNudgeTaskCategory(category); break;
      // Genuinely nothing to write: its task inherits the category of the task
      // whose supply it is about (see checkSupplyReorderTasks), so there is no
      // one global answer to store. categorized: false means the pills that
      // would call this are never rendered for it.
      case 'supplyReorder': break;
      // Exhaustive, unlike the switches above it, which are only exhaustive
      // because they return a value. This one returns void, so a missing arm is
      // not a typecheck failure but a silently dead category picker — which is
      // exactly how screenTime shipped: its pills rendered (categorized: true)
      // and tapping one did nothing at all. A default arm assigning to `never`
      // turns the next omission into a compile error.
      default: {
        const exhaustive: never = kind;
        void exhaustive;
      }
    }
  };

  const confirmTime = () => {
    s.setMealPlanNudgeTime(dateToHHMM(pickerDate));
    setTimePickerOpen(false);
  };

  /**
   * The line under a generator's name, which says what it currently does rather
   * than what it is. The nudge's on-state names the day and time it fires,
   * because those are two more rows down and the answer is the point.
   */
  const hintFor = (spec: GeneratedKindSpec): string => {
    if (!enabledOf(spec.kind)) return spec.offHint;
    if (spec.kind === 'mealPlanNudge') {
      return `A task appears ${WEEKDAY_NAMES[s.mealPlanNudgeWeekday]} at ${formatHHMM(s.mealPlanNudgeTime)} to plan that week`;
    }
    if (spec.kind === 'calendarReview' && s.calendarReviewTimeSegment) {
      return `Adds a task each day, held back until ${s.calendarReviewTimeSegment}, to review tomorrow's events`;
    }
    if (spec.kind === 'moodLog' && s.moodLogTimeSegment) {
      return `Adds one task a day, held back until ${s.moodLogTimeSegment}, to log how you're feeling`;
    }
    return spec.onHint;
  };

  /**
   * The "Show the task" row and its pills, for a generator that holds its task
   * back until a part of the day.
   *
   * Two generators want this and they want it identically, so it is written
   * once — the copy this replaced had drifted nowhere yet only because it had
   * just the one instance, and a second hand-rolled copy is how that starts.
   * It stays a local helper rather than a registry field for the reason the
   * header states: `extrasFor` is JSX precisely so the knobs one generator has
   * don't have to be expressible in config.
   */
  const timeSegmentExtra = (
    entryId: string,
    value: TimeOfDay | null,
    onChange: (segment: TimeOfDay | null) => void,
  ): React.ReactNode => (
    <>
      <View style={styles.sep} />
      <SettingsRow
        entryId={entryId}
        icon="time-outline"
        label="Show the task"
        hint="Held back until this part of the day arrives, same as a task's own Time of day field."
        value={timeSegmentChoices.find(o => o.value === value)?.label ?? 'Any time'}
        tight
      />
      <View style={styles.pillGroupRow}>
        <PillGroup
          noun="time of day"
          options={timeSegmentChoices.map(o => ({
            key: String(o.value),
            label: o.label,
            selected: o.value === value,
            pinned: o.value === null,
            accessibilityLabel: `Show the task ${o.value === null ? 'any time of day' : `in the ${o.label.toLowerCase()}`}`,
            onPress: () => { haptics.tap(); onChange(o.value); },
          }))}
        />
      </View>
    </>
  );

  /** The controls only one generator has. Everything else is the same two rows. */
  const extrasFor = (kind: GeneratedKind): React.ReactNode => {
    if (kind === 'groceryUseUp') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="groceryUseUpLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="How many days before the use-by date the task falls due."
            value={
              s.groceryUseUpLeadDays === 0
                ? 'On the day'
                : `${s.groceryUseUpLeadDays} ${s.groceryUseUpLeadDays === 1 ? 'day' : 'days'} before`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.groceryUseUpLeadDays}
              onChange={next => s.setGroceryUseUpLeadDays(next ?? GROCERY_USE_UP_LEAD_DAYS_DEFAULT)}
              min={GROCERY_USE_UP_LEAD_DAYS_MIN}
              max={GROCERY_USE_UP_LEAD_DAYS_MAX}
              format={n => (n === 0 ? 'Day of' : `${n}d`)}
              label="Days before the use-by date"
              describeValue={n =>
                n === 0 ? 'On the use-by day' : `${n} ${n === 1 ? 'day' : 'days'} before`
              }
            />
          </View>
        </>
      );
    }

    if (kind === 'mealShortfall') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="mealShortfallLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="How many days before the meal the shopping task falls due."
            value={
              s.mealShortfallLeadDays === 0
                ? 'On the day'
                : `${s.mealShortfallLeadDays} ${s.mealShortfallLeadDays === 1 ? 'day' : 'days'} before`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.mealShortfallLeadDays}
              onChange={next => s.setMealShortfallLeadDays(next ?? MEAL_SHORTFALL_LEAD_DAYS_DEFAULT)}
              min={MEAL_SHORTFALL_LEAD_DAYS_MIN}
              max={MEAL_SHORTFALL_LEAD_DAYS_MAX}
              format={n => (n === 0 ? 'Day of' : `${n}d`)}
              label="Days before the meal"
              describeValue={n =>
                n === 0 ? 'On the day of the meal' : `${n} ${n === 1 ? 'day' : 'days'} before`
              }
            />
          </View>
        </>
      );
    }

    if (kind === 'birthday') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="birthdayLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="How many days before the birthday the task falls due."
            value={
              s.birthdayLeadDays === 0
                ? 'On the day'
                : `${s.birthdayLeadDays} ${s.birthdayLeadDays === 1 ? 'day' : 'days'} before`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.birthdayLeadDays}
              onChange={next => s.setBirthdayLeadDays(next ?? DEFAULT_BIRTHDAY_LEAD_DAYS)}
              min={0}
              max={MAX_BIRTHDAY_LEAD_DAYS}
              format={n => (n === 0 ? 'Day of' : `${n}d`)}
              label="Days before the birthday"
              describeValue={n =>
                n === 0 ? 'On the birthday itself' : `${n} ${n === 1 ? 'day' : 'days'} before`
              }
            />
          </View>
          {/* Only ever moves when the row *surfaces*. The birthday itself rides
              the task's deadline, so changing this never moves anybody's
              birthday, and it deliberately doesn't re-date a row already on the
              list — see birthdayDrift. */}
        </>
      );
    }

    if (kind === 'weekendNudge') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="weekendNudgeLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="Which day the task appears on. It never appears once the weekend has started."
            value={describeWeekendNudgeLead(s.weekendNudgeLeadDays)}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.weekendNudgeLeadDays}
              onChange={next => s.setWeekendNudgeLeadDays(next ?? WEEKEND_NUDGE_LEAD_DAYS_DEFAULT)}
              min={WEEKEND_NUDGE_LEAD_DAYS_MIN}
              max={WEEKEND_NUDGE_LEAD_DAYS_MAX}
              format={n => `${n}d`}
              label="Days before Saturday"
              describeValue={n => describeWeekendNudgeLead(n ?? WEEKEND_NUDGE_LEAD_DAYS_DEFAULT)}
            />
          </View>
        </>
      );
    }

    if (kind === 'birthdayGift') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="birthdayGiftLeadDays"
            icon="calendar-outline"
            label="Show the task"
            hint="How many days before the birthday the gift task falls due."
            value={
              s.birthdayGiftLeadDays === 0
                ? 'On the day'
                : `${s.birthdayGiftLeadDays} ${s.birthdayGiftLeadDays === 1 ? 'day' : 'days'} before`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.birthdayGiftLeadDays}
              onChange={next => s.setBirthdayGiftLeadDays(next ?? DEFAULT_BIRTHDAY_GIFT_LEAD_DAYS)}
              min={0}
              max={MAX_BIRTHDAY_LEAD_DAYS}
              format={n => (n === 0 ? 'Day of' : `${n}d`)}
              label="Days before the birthday"
              describeValue={n =>
                n === 0 ? 'On the birthday itself' : `${n} ${n === 1 ? 'day' : 'days'} before`
              }
            />
          </View>
        </>
      );
    }

    if (kind === 'mealSlot') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="mealSlotsEnabled"
            icon="restaurant-outline"
            iconColor={s.mealSlotsEnabled.length > 0 ? colors.accent : undefined}
            label="Meals you eat"
            hint={
              s.mealSlotsEnabled.length === 0
                ? "No meals picked, so no tasks are added. A planned meal can still show as a plain row, with Show the day's meals under Groceries & meals"
                : "A task each day for each of these, whether or not a meal is planned. Any other planned meal can still show as a plain row, with Show the day's meals under Groceries & meals"
            }
            tight
          />
          {/* Four toggles rather than one row of pills: these are four
              independent yes/no answers, not one field with four values, and a
              row of toggles is what the rest of this card already is. The
              segmented control next door is single-choice by construction. */}
          {MEAL_SLOTS.map(slot => {
            const on = s.mealSlotsEnabled.includes(slot);
            return (
              <SettingsRow
                key={slot}
                icon={MEAL_SLOT_ICONS[slot]}
                iconColor={on ? colors.accent : undefined}
                label={MEAL_SLOT_LABELS[slot]}
                toggle={on}
                onPress={() => {
                  s.setMealSlotsEnabled(
                    on
                      ? s.mealSlotsEnabled.filter(x => x !== slot)
                      : [...s.mealSlotsEnabled, slot]
                  );
                  // Switching a meal *on* fills it into the days already
                  // written, so the answer takes effect now rather than when
                  // the horizon rolls forward a week from here. Scoped to this
                  // slot alone — rewinding the generator's mark instead would
                  // rewrite the whole window and resurrect rows the user has
                  // deleted. Switching one off writes nothing: the tasks
                  // already there stay, the same restraint setMealCookTasks
                  // keeps. Nothing to undo on the off path, hence no else.
                  if (!on) useTaskStore.getState().backfillMealSlotTasks([slot]);
                }}
                accessibilityLabel={`A task for ${MEAL_SLOT_LABELS[slot].toLowerCase()} each day`}
              />
            );
          })}
        </>
      );
    }

    if (kind === 'mealPlanNudge') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow entryId="mealPlanNudgeTime" icon="calendar-outline" iconColor={colors.accent} label="Nudge me on" tight />
          <SettingsSegments
            attached
            options={weekdaySegmentOptions}
            selected={s.mealPlanNudgeWeekday}
            onSelect={s.setMealPlanNudgeWeekday}
            accessibilityLabelFor={o => WEEKDAY_NAMES[o.value]}
          />
          <View style={styles.sep} />
          <SettingsRow
            icon="alarm-outline"
            iconColor={colors.accent}
            label="At"
            value={formatHHMM(s.mealPlanNudgeTime)}
            onPress={() => {
              if (timePickerOpen) { setTimePickerOpen(false); return; }
              setPickerDate(hhmmToDate(s.mealPlanNudgeTime));
              setTimePickerOpen(true);
            }}
          />
          {timePickerOpen && (
            <InlineTimePicker
              value={pickerDate}
              onChange={setPickerDate}
              onCancel={() => setTimePickerOpen(false)}
              onConfirm={confirmTime}
            />
          )}
        </>
      );
    }

    if (kind === 'calendarReview') {
      return timeSegmentExtra('calendarReviewTimeSegment', s.calendarReviewTimeSegment, s.setCalendarReviewTimeSegment);
    }

    if (kind === 'moodLog') {
      return timeSegmentExtra('moodLogTimeSegment', s.moodLogTimeSegment, s.setMoodLogTimeSegment);
    }

    if (kind === 'weather') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="weatherRules"
            icon="list-outline"
            iconColor={activeWeatherRuleCount > 0 ? colors.accent : undefined}
            label="Rules"
            hint="What weather adds which task, like sunscreen on a sunny day."
            value={
              activeWeatherRuleCount === 0
                ? 'None'
                : activeWeatherRuleCount === 1 ? '1 rule' : `${activeWeatherRuleCount} rules`
            }
            onPress={() => { haptics.tap(); setWeatherRulesVisible(true); }}
          />
        </>
      );
    }

    if (kind === 'screenTime') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="screenTimeRules"
            icon="list-outline"
            iconColor={activeScreenTimeRuleCount > 0 ? colors.accent : undefined}
            label="Rules"
            hint="How long on which apps adds which task. The apps are picked in here too."
            value={
              activeScreenTimeRuleCount === 0
                ? 'None'
                : activeScreenTimeRuleCount === 1 ? '1 rule' : `${activeScreenTimeRuleCount} rules`
            }
            onPress={() => { haptics.tap(); setScreenTimeRulesVisible(true); }}
          />
        </>
      );
    }

    if (kind === 'health') {
      return (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="healthRules"
            icon="list-outline"
            iconColor={activeHealthRuleCount > 0 ? colors.accent : undefined}
            label="Rules"
            hint="Which reading falling under which number adds which task."
            value={
              activeHealthRuleCount === 0
                ? 'None'
                : activeHealthRuleCount === 1 ? '1 rule' : `${activeHealthRuleCount} rules`
            }
            onPress={() => { haptics.tap(); setHealthRulesVisible(true); }}
          />
        </>
      );
    }

    return null;
  };

  return (
    <>
    <SettingsSection
      // No label: this is the whole of its group, so the screen's own header is
      // already saying "Automatic tasks" directly above it.
      footer="These are the only things that put a task in your list without you typing it. Each one can be turned off here, and deleting a task the app added tells it not to add that one again: the grocery item or the leftover it came from remembers your answer, and a meal task stays gone for the rest of the day."
    >
      {/* Above the generators rather than inside any one of them, because it
          applies to all of them at once: it changes when the whole list below
          gets a chance to run, not what any of them do. */}
      <SettingsRow
        entryId="backgroundRefreshEnabled"
        icon="moon-outline"
        iconColor={s.backgroundRefreshEnabled ? colors.accent : undefined}
        label="Add tasks while the app is closed"
        hint="Lets iOS wake the app in the background to add the tasks below, top up reminders and update the widget, so they're ready when you next open it. iOS decides when this happens and can skip it entirely. Everything below still runs when you open the app."
        toggle={s.backgroundRefreshEnabled}
        onPress={() => s.setBackgroundRefreshEnabled(!s.backgroundRefreshEnabled)}
      />
      <View style={sectionStyles.groupBreak} />
      {listed.map((spec, i) => {
        const on = enabledOf(spec.kind);
        return (
          <React.Fragment key={spec.kind}>
            {/* A band, not the hairline the rows inside a generator use. With
                two generators switched on, the card runs to four rows apiece and
                a hairline between "File them under" and the next generator's
                name reads exactly like the hairline above it — so the list
                stops saying where one generator ends. Four separate cards would
                say it too, but then the section header stops covering them all,
                which is the whole point of gathering them. */}
            {i > 0 && <View style={sectionStyles.groupBreak} />}
            <SettingsRow
              // Built the same way settingsIndex builds its ids, for the reason
              // the AI rows are: both sides map over the same registry, so
              // neither can name a row the other hasn't got.
              entryId={`gen:${spec.kind}`}
              icon={spec.icon}
              iconColor={on ? colors.accent : undefined}
              label={spec.label}
              hint={hintFor(spec)}
              toggle={on}
              onPress={() => toggle(spec.kind)}
            />
            {on && extrasFor(spec.kind)}
            {on && spec.categorized && (
              <>
                <View style={styles.sep} />
                <SettingsRow
                  entryId={`gen:${spec.kind}:category`}
                  icon="pricetag-outline"
                  label="File them under"
                  hint="With none, they sit loose at the top of Today above your categories."
                  value={categoryOptions.find(o => o.value === categoryOf(spec.kind))?.label ?? 'None'}
                  tight
                />
                <View style={styles.pillGroupRow}>
                  <PillGroup
                    noun="category"
                    options={categoryPills(
                      categoryOf(spec.kind),
                      category => setCategory(spec.kind, category),
                      label => `${spec.label} category: ${label}`,
                    )}
                  />
                </View>
              </>
            )}
          </React.Fragment>
        );
      })}
      {(s.groceryUseUpTasks || s.leftoverUseUpTasks) && (
        <>
          {/* Spans both use-up generators, so it sits below the loop rather
              than inside either generator's own extras — see useUpTaskCap. */}
          <View style={sectionStyles.groupBreak} />
          <SettingsRow
            entryId="useUpTaskCap"
            icon="layers-outline"
            label="Limit use-up tasks"
            hint={
              s.useUpTaskCap === null
                ? 'No limit: every qualifying item and leftover gets a task'
                : `At most ${s.useUpTaskCap} use-up ${s.useUpTaskCap === 1 ? 'task' : 'tasks'} at a time, closest date first`
            }
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.useUpTaskCap}
              onChange={s.setUseUpTaskCap}
              min={USE_UP_TASK_CAP_MIN}
              max={USE_UP_TASK_CAP_MAX}
              allowNull
              emptyLabel="No limit"
              label="Use-up task limit"
              describeValue={n => (n === null ? 'No limit' : `At most ${n}`)}
            />
          </View>
        </>
      )}
    </SettingsSection>
    <WeatherRulesSheet visible={weatherRulesVisible} onClose={() => setWeatherRulesVisible(false)} />
    <ScreenTimeRulesSheet visible={screenTimeRulesVisible} onClose={() => setScreenTimeRulesVisible(false)} />
    <HealthRulesSheet visible={healthRulesVisible} onClose={() => setHealthRulesVisible(false)} />
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // The screen's own ground showing through the card, which is what an inset
  // group already uses to separate one card from the next — borrowed here to
  // separate one generator from the next inside a single card.
  groupBreak: { height: spacing.sm, backgroundColor: colors.bg },
});
