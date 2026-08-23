import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useSettingsStore, type MealsOnToday } from '../../store/useSettingsStore';
import type { UnitSystem } from '../../utils/unitConvert';
import { useTaskStore } from '../../store/useTaskStore';
import { useCategoryStore } from '../../store/useCategoryStore';
import { useRecipeStore } from '../../store/useRecipeStore';
import { useGroceryStore } from '../../store/useGroceryStore';
import { useShallow } from 'zustand/react/shallow';
import { allRecipeTags } from '../../utils/recipeTags';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { CalendarPicker } from '../../components/CalendarPicker';
import { getTaskDayStart } from '../../utils/dateUtils';
import { EXPIRED_TASK_GRACE_OPTIONS, expiredTaskGraceLabel, type ExpiredTaskGraceDays } from '../../utils/expiredTaskGrace';
import { CountStepper } from '../../components/CountStepper';
import { SettingsSection } from './SettingsSection';
import { GeneratedTasksSection } from './GeneratedTasksSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { PillGroup } from '../../components/PillGroup';
import { StandingSwapsSheet } from '../../components/StandingSwapsSheet';
import { TitleRulesSheet } from '../../components/TitleRulesSheet';
import { standingSwaps } from '../../utils/standingSwaps';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';
import { categoryLabel } from '../../utils/categoryLabel';
import { EFFORT_LABELS, type Effort, type TimeOfDay } from '../../types';
import { PRIORITY_SEGMENTS } from '../../utils/prioritySegments';
import {
  CADENCE_UNITS, CADENCE_UNIT_MAX, cadenceUnitLabel,
  describeCadence, fromCadenceParts, toCadenceParts, withCadenceUnit,
} from '../../utils/nudgeCadence';
import {
  DEFAULT_POSTPONE_THRESHOLD, MIN_POSTPONE_THRESHOLD, MAX_POSTPONE_THRESHOLD,
} from '../../utils/postpone';
import {
  FOCUS_DEFAULTS,
  FOCUS_LONG_REST_EVERY_MAX, FOCUS_LONG_REST_EVERY_MIN,
  FOCUS_REST_AFTER_MINUTES_MAX, FOCUS_REST_AFTER_MINUTES_MIN, FOCUS_REST_AFTER_TASKS_MAX,
  FOCUS_REST_MAX, FOCUS_REST_MIN, FOCUS_WORK_CAP_MAX, FOCUS_WORK_CAP_MIN,
  focusRestsDisabled,
} from '../../utils/focusSettings';
import { CURRENCY_SYMBOLS, CURRENCY_SYMBOL_MAX_LENGTH } from '../../types';

const EXPIRED_TASK_GRACE_SEGMENTS: SegmentOption<ExpiredTaskGraceDays>[] =
  EXPIRED_TASK_GRACE_OPTIONS.map(o => ({ value: o.value, label: o.label }));

// 0 already means "None"/"—" everywhere else a priority or effort is picked
// (TaskEditor, QuickAdd), so there's no separate null option here or in
// PRIORITY_SEGMENTS — leaving a new task's priority/effort default at 0 behaves
// identically to not configuring a default at all (newTaskFromDraft falls back
// to 0 either way).
const NEW_TASK_EFFORT_OPTIONS: SegmentOption<Effort>[] =
  EFFORT_LABELS.map((label, value) => ({ value: value as Effort, label: value === 0 ? 'None' : label }));
const NEW_TASK_TIME_OF_DAY_OPTIONS: SegmentOption<TimeOfDay | null>[] = [
  { value: null, label: 'None' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
];
const NEW_TASK_DESTINATION_OPTIONS: SegmentOption<'today' | 'inbox' | 'unscheduled'>[] = [
  { value: 'today', label: 'Today' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'unscheduled', label: 'Unscheduled' },
];
const UNIT_SYSTEM_OPTIONS: SegmentOption<UnitSystem>[] = [
  { value: 'asWritten', label: 'As written' },
  { value: 'metric', label: 'Metric' },
  { value: 'us', label: 'US' },
];
export function TasksProjectsSettings() {
  const vacationMode = useSettingsStore(s => s.vacationMode);
  const setVacationMode = useSettingsStore(s => s.setVacationMode);
  const vacationStart = useSettingsStore(s => s.vacationStart);
  const vacationEnd = useSettingsStore(s => s.vacationEnd);
  const setVacationEnd = useSettingsStore(s => s.setVacationEnd);
  const autoRemoveExpiredTasks = useSettingsStore(s => s.autoRemoveExpiredTasks);
  const setAutoRemoveExpiredTasks = useSettingsStore(s => s.setAutoRemoveExpiredTasks);
  const autoArchiveProjectsOnComplete = useSettingsStore(s => s.autoArchiveProjectsOnComplete);
  const setAutoArchiveProjectsOnComplete = useSettingsStore(s => s.setAutoArchiveProjectsOnComplete);
  const postponeCheckEnabled = useSettingsStore(s => s.postponeCheckEnabled);
  const setPostponeCheckEnabled = useSettingsStore(s => s.setPostponeCheckEnabled);
  const postponeCheckThreshold = useSettingsStore(s => s.postponeCheckThreshold);
  const focusWorkCapMinutes = useSettingsStore(s => s.focusWorkCapMinutes);
  const setFocusWorkCapMinutes = useSettingsStore(s => s.setFocusWorkCapMinutes);
  const focusDefaultWorkMinutes = useSettingsStore(s => s.focusDefaultWorkMinutes);
  const setFocusDefaultWorkMinutes = useSettingsStore(s => s.setFocusDefaultWorkMinutes);
  const focusRestAfterTasks = useSettingsStore(s => s.focusRestAfterTasks);
  const setFocusRestAfterTasks = useSettingsStore(s => s.setFocusRestAfterTasks);
  const focusRestAfterMinutes = useSettingsStore(s => s.focusRestAfterMinutes);
  const setFocusRestAfterMinutes = useSettingsStore(s => s.setFocusRestAfterMinutes);
  const focusRestMinutes = useSettingsStore(s => s.focusRestMinutes);
  const setFocusRestMinutes = useSettingsStore(s => s.setFocusRestMinutes);
  const focusLongRestEvery = useSettingsStore(s => s.focusLongRestEvery);
  const setFocusLongRestEvery = useSettingsStore(s => s.setFocusLongRestEvery);
  const focusLongRestMinutes = useSettingsStore(s => s.focusLongRestMinutes);
  const setFocusLongRestMinutes = useSettingsStore(s => s.setFocusLongRestMinutes);
  const noBreaks = focusRestsDisabled({ focusRestAfterTasks, focusRestAfterMinutes });
  const setPostponeCheckThreshold = useSettingsStore(s => s.setPostponeCheckThreshold);
  const hideCategories = useSettingsStore(s => s.hideCategories);
  const setHideCategories = useSettingsStore(s => s.setHideCategories);
  const simpleTaskForm = useSettingsStore(s => s.simpleTaskForm);
  const setSimpleTaskForm = useSettingsStore(s => s.setSimpleTaskForm);
  const timerLiveActivity = useSettingsStore(s => s.timerLiveActivity);
  const setTimerLiveActivity = useSettingsStore(s => s.setTimerLiveActivity);
  const tripLiveActivity = useSettingsStore(s => s.tripLiveActivity);
  const setTripLiveActivity = useSettingsStore(s => s.setTripLiveActivity);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const setKitchenEnabled = useSettingsStore(s => s.setKitchenEnabled);
  const mealsOnToday = useSettingsStore(s => s.mealsOnToday);
  const kitchenOnToday = useSettingsStore(s => s.kitchenOnToday);
  const setKitchenOnToday = useSettingsStore(s => s.setKitchenOnToday);
  const setMealsOnToday = useSettingsStore(s => s.setMealsOnToday);
  const restockOfferEnabled = useSettingsStore(s => s.restockOfferEnabled);
  const setRestockOfferEnabled = useSettingsStore(s => s.setRestockOfferEnabled);
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const setUnitSystem = useSettingsStore(s => s.setUnitSystem);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const setCurrencySymbol = useSettingsStore(s => s.setCurrencySymbol);
  const excludedRecipeTags = useSettingsStore(useShallow(s => s.excludedRecipeTags));
  const setExcludedRecipeTags = useSettingsStore(s => s.setExcludedRecipeTags);
  const defaultProjectNudgeCadenceDays = useSettingsStore(s => s.defaultProjectNudgeCadenceDays);
  const setDefaultProjectNudgeCadenceDays = useSettingsStore(s => s.setDefaultProjectNudgeCadenceDays);
  const newTaskDefaults = useSettingsStore(s => s.newTaskDefaults);
  const setNewTaskDefaults = useSettingsStore(s => s.setNewTaskDefaults);
  const titleRules = useSettingsStore(useShallow(s => s.titleRules));

  const forgivVacationStreaks = useTaskStore(s => s.forgivVacationStreaks);
  const categories = useCategoryStore(s => s.categories);
  const recipeTagVocabulary = useRecipeStore(useShallow(s => allRecipeTags(s.recipes)));

  // How many substitutes the app is currently applying on its own (#1571) —
  // the count on the Standing swaps row, and the reason it reads as active.
  // The resolved list, not a raw `standing` count: a rule whose other half has
  // gone isn't being applied to anything.
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const standingSwapCount = useMemo(
    () => standingSwaps(itemSubs, groceryItems).length,
    [itemSubs, groceryItems]
  );

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const [showVacationEndPicker, setShowVacationEndPicker] = useState(false);
  const [standingSwapsVisible, setStandingSwapsVisible] = useState(false);
  const [titleRulesVisible, setTitleRulesVisible] = useState(false);

  // What the row's value counts: rules that are actually filing things. A rule
  // switched off is kept and listed, but reporting it here would have the row
  // read as active when nothing is being applied — the same call
  // StandingSwapsSheet's count makes about a swap whose other half has gone.
  const activeTitleRuleCount = useMemo(
    () => titleRules.filter(r => r.enabled).length,
    [titleRules],
  );

  // Not a segmented control: the categories are the user's own and there can be
  // fifteen of them, which is `PillGroup`'s job (it caps and filters) and not a
  // track's. `None` is `pinned` — the option meaning "no choice" is never the
  // one buried behind "N more".
  const newTaskCategoryOptions: { value: string | null; label: string }[] = useMemo(() => [
    { value: null, label: 'None' },
    ...categories.map(c => ({ value: c.name, label: categoryLabel(c.name, categories) })),
  ], [categories]);

  const categoryPills = (
    selected: string | null,
    onSelect: (value: string | null) => void,
    describe: (label: string) => string,
  ) => newTaskCategoryOptions.map(o => ({
    key: String(o.value),
    label: o.label,
    selected: o.value === selected,
    pinned: o.value === null,
    accessibilityLabel: describe(o.label),
    onPress: () => { haptics.tap(); onSelect(o.value); },
  }));

  // The cadence is stored in days; the picker shows it as a count and a unit —
  // same conversion the per-project field in ProjectEditor uses.
  const defaultCadence = toCadenceParts(defaultProjectNudgeCadenceDays);

  return (
    <>
      <SettingsSection
        label="Vacation"
        footer={`${vacationMode && vacationStart ? `On since ${format(new Date(vacationStart), 'MMM d')}. ` : ''}While on, tasks with "vacation pause" enabled are hidden everywhere and their streaks are protected. You can also hide whole categories on vacation from the Categories screen. Turn it off when you return and streaks will be forgiven automatically, or set an end date to have it happen for you.`}
      >
        <SettingsRow
          icon="airplane-outline"
          iconColor={vacationMode ? colors.accent : undefined}
          label="Vacation mode"
          hint="Hides tasks marked for vacation pause"
          toggle={vacationMode}
          onPress={() => {
            if (vacationMode) {
              forgivVacationStreaks();
              setVacationMode(false);
            } else {
              setVacationMode(true);
            }
          }}
        />
        {vacationMode && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              icon="calendar-outline"
              label="End date"
              hint={vacationEnd
                ? 'Turns off automatically on this day'
                : 'Optional. Turn off manually if not set'}
              value={vacationEnd ? format(new Date(vacationEnd), 'MMM d, yyyy') : 'None'}
              onPress={() => setShowVacationEndPicker(true)}
              accessibilityLabel="Vacation end date"
              trailing={vacationEnd ? (
                <TouchableOpacity
                  onPress={() => setVacationEnd(null)}
                  hitSlop={8}
                  style={{ marginLeft: spacing.xs }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear vacation end date"
                >
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : undefined}
            />
          </>
        )}
      </SettingsSection>

      <SettingsSection
        label="Time-limited tasks"
        footer={'A task with a time window (like "farmers market, 8am–1pm") moves to Expired once its window closes, whether or not it repeats.'}
      >
        <SettingsRow
          icon="time-outline"
          iconColor={autoRemoveExpiredTasks === null ? undefined : colors.accent}
          label="Auto-remove expired tasks"
          hint={autoRemoveExpiredTasks === null
            ? 'Kept in an Expired section until you delete them'
            : autoRemoveExpiredTasks === 0
              ? 'Deleted the moment their time window closes'
              : `Deleted ${expiredTaskGraceLabel(autoRemoveExpiredTasks).toLowerCase()} after their time window closes`}
          tight
        />
        <SettingsSegments
          attached
          columns={3}
          options={EXPIRED_TASK_GRACE_SEGMENTS}
          selected={autoRemoveExpiredTasks}
          onSelect={setAutoRemoveExpiredTasks}
          accessibilityLabelFor={o => `Auto-remove expired tasks: ${o.label}`}
        />
      </SettingsSection>

      {Platform.OS === 'ios' && (
        <SettingsSection
          label="Timers"
          footer="Requires iOS 17. Ends the moment you pause, stop, or (for a task) complete it. Resuming starts a fresh one."
        >
          <SettingsRow
            icon="phone-portrait-outline"
            iconColor={timerLiveActivity ? colors.accent : undefined}
            label="Live Activity while timing"
            hint={timerLiveActivity
              ? 'A running task timer or recipe cook/prep timer shows on the Lock Screen and Dynamic Island'
              : 'Timers stay in the app only'}
            toggle={timerLiveActivity}
            onPress={() => setTimerLiveActivity(!timerLiveActivity)}
          />
        </SettingsSection>
      )}

      <SettingsSection
        label="Rescheduling"
        footer="Counted per task, and the count resets as soon as you pull one back to today. You can also silence the prompt for a single task from the reminder itself."
      >
        <SettingsRow
          icon="repeat-outline"
          iconColor={postponeCheckEnabled ? colors.accent : undefined}
          label="Suggest an action after repeated reschedules"
          hint={postponeCheckEnabled
            ? `Shows a suggestion once you've moved a task ${postponeCheckThreshold} times`
            : 'Off. Reschedule a task as many times as you like with no prompt'}
          toggle={postponeCheckEnabled}
          onPress={() => setPostponeCheckEnabled(!postponeCheckEnabled)}
        />
        {postponeCheckEnabled && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              icon="hand-left-outline"
              label="Reschedule threshold"
              hint="Number of times a task can be moved before the suggestion appears"
              tight
            />
            <View style={styles.cadenceRow}>
              <CountStepper
                value={postponeCheckThreshold}
                onChange={next => setPostponeCheckThreshold(next ?? DEFAULT_POSTPONE_THRESHOLD)}
                min={MIN_POSTPONE_THRESHOLD}
                max={MAX_POSTPONE_THRESHOLD}
                label="Reschedule threshold"
                describeValue={n => `${n} reschedules`}
              />
            </View>
          </>
        )}
      </SettingsSection>

      <SettingsSection
        label="Focus sessions"
        footer={noBreaks
          ? 'Both break triggers are off, so a session runs straight through with no breaks in it.'
          : 'Both triggers run at once and whichever comes first inserts the break. Start a session from Today’s … menu.'}
      >
        <SettingsRow
          icon="hourglass-outline"
          label="Work stretch length"
          hint="The longest a single stretch runs. A task estimated for longer is split into equal parts."
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={focusWorkCapMinutes}
            onChange={next => setFocusWorkCapMinutes(next ?? FOCUS_DEFAULTS.workCapMinutes)}
            min={FOCUS_WORK_CAP_MIN}
            max={FOCUS_WORK_CAP_MAX}
            format={n => `${n} min`}
            label="Work stretch length"
            describeValue={n => `${n} minutes`}
          />
        </View>

        <View style={styles.sep} />
        <SettingsRow
          icon="help-circle-outline"
          label="Length without an estimate"
          hint="How long a stretch runs for a task that has no time estimate."
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={focusDefaultWorkMinutes}
            onChange={next => setFocusDefaultWorkMinutes(next ?? FOCUS_DEFAULTS.defaultWorkMinutes)}
            min={FOCUS_WORK_CAP_MIN}
            max={FOCUS_WORK_CAP_MAX}
            format={n => `${n} min`}
            label="Length without an estimate"
            describeValue={n => `${n} minutes`}
          />
        </View>

        <View style={styles.sep} />
        <SettingsRow
          icon="time-outline"
          label="Break after this much work"
          hint="Minutes of work before a break is added. Set to off to never break on elapsed time."
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={focusRestAfterMinutes}
            onChange={setFocusRestAfterMinutes}
            min={FOCUS_REST_AFTER_MINUTES_MIN}
            max={FOCUS_REST_AFTER_MINUTES_MAX}
            allowNull
            emptyLabel="Off"
            format={n => `${n} min`}
            label="Break after this much work"
            describeValue={n => (n === null ? 'Off' : `${n} minutes`)}
          />
        </View>

        <View style={styles.sep} />
        <SettingsRow
          icon="list-outline"
          label="Break after this many tasks"
          hint="Tasks finished before a break is added. Set to off to never break on a task count."
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={focusRestAfterTasks}
            onChange={setFocusRestAfterTasks}
            min={1}
            max={FOCUS_REST_AFTER_TASKS_MAX}
            allowNull
            emptyLabel="Off"
            format={n => `${n} task${n === 1 ? '' : 's'}`}
            label="Break after this many tasks"
            describeValue={n => (n === null ? 'Off' : `${n} tasks`)}
          />
        </View>

        {!noBreaks && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              icon="cafe-outline"
              label="Break length"
              tight
            />
            <View style={styles.cadenceRow}>
              <CountStepper
                value={focusRestMinutes}
                onChange={next => setFocusRestMinutes(next ?? FOCUS_DEFAULTS.restMinutes)}
                min={FOCUS_REST_MIN}
                max={FOCUS_REST_MAX}
                format={n => `${n} min`}
                label="Break length"
                describeValue={n => `${n} minutes`}
              />
            </View>

            <View style={styles.sep} />
            <SettingsRow
              icon="bed-outline"
              label="Long break every"
              hint="Makes every nth break a longer one. Set to off to keep every break the same length."
              tight
            />
            <View style={styles.cadenceRow}>
              <CountStepper
                value={focusLongRestEvery}
                onChange={setFocusLongRestEvery}
                min={FOCUS_LONG_REST_EVERY_MIN}
                max={FOCUS_LONG_REST_EVERY_MAX}
                allowNull
                emptyLabel="Off"
                format={n => `${n} breaks`}
                label="Long break every"
                describeValue={n => (n === null ? 'Off' : `every ${n} breaks`)}
              />
            </View>

            {focusLongRestEvery !== null && (
              <>
                <View style={styles.sep} />
                <SettingsRow
                  icon="moon-outline"
                  label="Long break length"
                  tight
                />
                <View style={styles.cadenceRow}>
                  <CountStepper
                    value={focusLongRestMinutes}
                    onChange={next => setFocusLongRestMinutes(next ?? FOCUS_DEFAULTS.longRestMinutes)}
                    min={FOCUS_REST_MIN}
                    max={FOCUS_REST_MAX}
                    format={n => `${n} min`}
                    label="Long break length"
                    describeValue={n => `${n} minutes`}
                  />
                </View>
              </>
            )}
          </>
        )}
      </SettingsSection>

      <SettingsSection
        label="Today"
        footer="Also available from Today's … menu."
      >
        <SettingsRow
          icon="eye-off-outline"
          iconColor={hideCategories ? colors.accent : undefined}
          label="Hide categories"
          hint={hideCategories ? 'Showing one flat list of tasks' : 'Group tasks under category headers'}
          toggle={hideCategories}
          onPress={() => setHideCategories(!hideCategories)}
        />
      </SettingsSection>

      <SettingsSection
        label="Feature areas"
        footer="Turning this off hides the groceries, recipes and meal plan screens, the meal tasks and reminders that come with them, and their settings. Nothing is deleted. Your lists, recipes and planned meals are kept, and turning it back on returns everything as you left it."
      >
        <SettingsRow
          icon="cart-outline"
          iconColor={kitchenEnabled ? colors.accent : undefined}
          label="Groceries & meals"
          hint={kitchenEnabled ? 'Shown in the tab bar' : 'Hidden from the tab bar'}
          toggle={kitchenEnabled}
          onPress={() => setKitchenEnabled(!kitchenEnabled)}
        />
      </SettingsSection>

      {/* Everything below belongs to the groceries/meals area: what it puts on
          Today, what it adds to the task list, and how it states amounts. None
          of it has anything to configure once the area is hidden. */}
      {kitchenEnabled && (
      <>
      <SettingsSection
        label="Meals on Today"
        footer="A meal with no task behind it shows as a row in the list, filed under the same category as meal tasks — and so does anything in the pantry about to go off, above them. Neither can be checked off; tapping opens the meal plan or the pantry. Meal tasks themselves are under Tasks the app adds, below."
      >
        {/* A toggle rather than a track of two: one bounded choice with two
            answers is what a switch is for, and the two shapes this used to
            pick between (a tray above the tasks, a one-line strip) are both
            gone. */}
        <SettingsRow
          icon="restaurant-outline"
          iconColor={mealsOnToday === 'inline' ? colors.accent : undefined}
          label="Show the day's meals"
          hint={mealsOnToday === 'inline'
            ? 'As rows in the task list, with the meal tasks'
            : 'Nothing. Meals stay on the Meal plan tab'}
          toggle={mealsOnToday === 'inline'}
          onPress={() => setMealsOnToday(mealsOnToday === 'inline' ? 'off' : 'inline')}
          accessibilityLabel="Show the day's meals"
        />
        {/* Filed in this section rather than under Tasks the app adds, because
            it is not a task the app adds: nothing is written, and the row
            leaves when the food does. What it shares with the meals is where
            it lands — the same category, at the top of the same section. */}
        <SettingsRow
          icon="nutrition-outline"
          iconColor={kitchenOnToday ? colors.accent : undefined}
          label="Show what needs using up"
          hint="A row on the day something in the pantry is down to its last day, unless it already has a use-up task."
          toggle={kitchenOnToday}
          onPress={() => setKitchenOnToday(!kitchenOnToday)}
          accessibilityLabel="Show what needs using up"
        />
        <SettingsRow
          icon="basket-outline"
          iconColor={restockOfferEnabled ? colors.accent : undefined}
          label="Restock after cooking"
          hint="When you mark a meal cooked, offer to add its ingredients back to your list."
          toggle={restockOfferEnabled}
          onPress={() => setRestockOfferEnabled(!restockOfferEnabled)}
          accessibilityLabel="Restock after cooking"
        />
      </SettingsSection>

      {Platform.OS === 'ios' && (
        <SettingsSection
          label="Shopping trip"
          footer="Requires iOS 17. Ends when you clear or finish the trip, or automatically after about 6 hours."
        >
          <SettingsRow
            icon="phone-portrait-outline"
            iconColor={tripLiveActivity ? colors.accent : undefined}
            label="Live Activity while shopping"
            hint={tripLiveActivity
              ? 'The store you\'re at and how long you\'ve been there shows on the Lock Screen and Dynamic Island'
              : 'A trip stays in the app only'}
            toggle={tripLiveActivity}
            onPress={() => setTripLiveActivity(!tripLiveActivity)}
          />
        </SettingsSection>
      )}

      <SettingsSection
        label="Recipe suggestions"
        footer="Only your own recipe tags decide this — nothing is guessed from ingredients. Tag a dish (however you like: “vegetarian”, “eggy”, whatever the reason is) on its own recipe screen, then pick the tags to leave out here. A dish stays fully editable and plannable by hand; this only keeps it out of what the app proposes."
      >
        <SettingsRow
          icon="nutrition-outline"
          iconColor={excludedRecipeTags.length > 0 ? colors.accent : undefined}
          label="Tags to avoid"
          hint={recipeTagVocabulary.length === 0 ? 'Tag a recipe first to pick from here' : undefined}
          tight
        />
        {recipeTagVocabulary.length > 0 && (
          <View style={styles.pillGroupRow}>
            <PillGroup
              noun="tag"
              options={recipeTagVocabulary.map(tag => ({
                key: tag,
                label: tag,
                selected: excludedRecipeTags.includes(tag),
                accessibilityLabel: excludedRecipeTags.includes(tag)
                  ? `${tag}, left out of suggestions. Tap to allow it again.`
                  : `${tag}. Tap to leave it out of suggestions.`,
                onPress: () => {
                  haptics.tap();
                  setExcludedRecipeTags(
                    excludedRecipeTags.includes(tag)
                      ? excludedRecipeTags.filter(t => t !== tag)
                      : [...excludedRecipeTags, tag]
                  );
                },
              }))}
            />
          </View>
        )}
      </SettingsSection>

      <GeneratedTasksSection
        categoryOptions={newTaskCategoryOptions}
        categoryPills={categoryPills}
      />

      <SettingsSection
        label="Recipe & grocery amounts"
        footer="Only what's shown changes. Recipes and the grocery list keep the amounts that were typed, and editing one shows it as written. Converted amounts are rounded, and marked with ≈. Counts, container sizes like &quot;14 oz can&quot;, and amounts with no number are left alone."
      >
        <SettingsRow
          icon="swap-horizontal-outline"
          iconColor={unitSystem === 'asWritten' ? undefined : colors.accent}
          label="Units"
          hint={
            unitSystem === 'metric'
              ? 'Ounces, pounds, cups and spoons show in grams and millilitres'
              : unitSystem === 'us'
                ? 'Grams, kilograms and millilitres show in ounces, pounds and cups'
                : 'Amounts show exactly as they were typed'
          }
          tight
        />
        <SettingsSegments
          attached
          options={UNIT_SYSTEM_OPTIONS}
          selected={unitSystem}
          onSelect={setUnitSystem}
          accessibilityLabelFor={o => `Units: ${o.label}`}
        />
        <SettingsRow
          icon="pricetag-outline"
          label="Currency"
          hint="The symbol grocery prices are shown with"
          tight
        />
        <View style={styles.pillGroupRow}>
          <PillGroup
            noun="symbol"
            filterPlaceholder="Find or type a symbol…"
            createMaxLength={CURRENCY_SYMBOL_MAX_LENGTH}
            onCreate={raw => {
              const trimmed = raw.trim();
              if (!trimmed) return 'Enter a symbol.';
              if (/\s/.test(trimmed)) return 'No spaces in a symbol.';
              setCurrencySymbol(trimmed);
            }}
            options={[
              // A custom symbol already in use has no pill of its own among
              // the presets below, so it gets a pinned one — otherwise
              // setting it once would make it vanish from its own picker.
              ...(CURRENCY_SYMBOLS.includes(currencySymbol) ? [] : [{
                key: '__current__',
                label: currencySymbol,
                pinned: true,
                selected: true,
                onPress: () => {},
              }]),
              ...CURRENCY_SYMBOLS.map(symbol => ({
                key: symbol,
                label: symbol,
                selected: currencySymbol === symbol,
                accessibilityLabel: `Currency: ${symbol}`,
                onPress: () => { haptics.tap(); setCurrencySymbol(symbol); },
              })),
            ]}
          />
        </View>
      </SettingsSection>

      {/* The review surface for the one substitute setting that changes what
          lands in the trolley (#1571). The rule itself is written where the
          pair is, on the item's Substitutes field — this is the "what is the
          app currently rewriting for me" read, which is the thing a link-level
          bit on its own can't answer. */}
      <SettingsSection
        label="Substitutes"
        footer="A substitute normally just says what you could use instead. One marked &quot;always use this instead&quot; is applied for you: recipes calling for the original show and shop for the substitute, marked with what the recipe said. Nothing is written to the recipe, and a single line can opt out under &quot;Keep as written&quot;."
      >
        <SettingsRow
          icon="swap-horizontal-outline"
          iconColor={standingSwapCount > 0 ? colors.accent : undefined}
          label="Standing swaps"
          hint={standingSwapCount > 0
            ? 'Substitutes being applied to every recipe that calls for the original'
            : 'Nothing is being swapped for you'}
          value={standingSwapCount > 0 ? String(standingSwapCount) : undefined}
          chevron
          onPress={() => { haptics.tap(); setStandingSwapsVisible(true); }}
        />
      </SettingsSection>
      </>
      )}

      <SettingsSection
        label="Task form"
        footer="Nothing is removed. The other fields sit behind &quot;more&quot; in quick add and in the editor's sections, and the editor's field search still finds all of them. A task created either way is the same task."
      >
        <SettingsRow
          icon="remove-outline"
          iconColor={simpleTaskForm ? colors.accent : undefined}
          label="Show fewer fields"
          hint={simpleTaskForm
            ? 'Quick add shows Date, Time of day and Repeat, and names its buttons; the editor opens the same three'
            : 'Quick add and the editor show every field they have'}
          toggle={simpleTaskForm}
          onPress={() => setSimpleTaskForm(!simpleTaskForm)}
        />
      </SettingsSection>

      <SettingsSection
        label="New tasks"
        footer="What a fresh task starts with, and where quick-add files it before you type anything. None of these override a value you actually pick. Typing a date in quick-add still wins over the destination below."
      >
        <SettingsRow icon="pricetag-outline" label="Category" hint="Applied to every new task that doesn't get one of its own" value={newTaskCategoryOptions.find(o => o.value === newTaskDefaults.category)?.label ?? 'None'} tight />
        <View style={styles.pillGroupRow}>
          <PillGroup
            noun="category"
            options={categoryPills(
              newTaskDefaults.category,
              category => setNewTaskDefaults({ category }),
              label => `Default category: ${label}`,
            )}
          />
        </View>
        <View style={styles.sep} />
        <SettingsRow icon="flag-outline" label="Priority" tight />
        <SettingsSegments
          attached
          columns={3}
          options={PRIORITY_SEGMENTS}
          selected={newTaskDefaults.priority ?? 0}
          onSelect={priority => setNewTaskDefaults({ priority })}
          accessibilityLabelFor={o => `Default priority: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow icon="speedometer-outline" label="Effort" tight />
        <SettingsSegments
          attached
          options={NEW_TASK_EFFORT_OPTIONS}
          selected={newTaskDefaults.effort ?? 0}
          onSelect={effort => setNewTaskDefaults({ effort })}
          accessibilityLabelFor={o => `Default effort: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow icon="partly-sunny-outline" label="Time of day" tight />
        <SettingsSegments
          attached
          columns={3}
          options={NEW_TASK_TIME_OF_DAY_OPTIONS}
          selected={newTaskDefaults.timeSegment}
          onSelect={timeSegment => setNewTaskDefaults({ timeSegment })}
          accessibilityLabelFor={o => `Default time of day: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow icon="albums-outline" label="Where quick-add lands" hint="Which list a quick-added task files into before you set a date" tight />
        <SettingsSegments
          attached
          options={NEW_TASK_DESTINATION_OPTIONS}
          selected={newTaskDefaults.destination}
          onSelect={destination => setNewTaskDefaults({ destination })}
          accessibilityLabelFor={o => `Quick-add destination: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="create-outline"
          iconColor={newTaskDefaults.openEditorAfterQuickAdd ? colors.accent : undefined}
          label="Open editor after quick add"
          hint={newTaskDefaults.openEditorAfterQuickAdd
            ? 'The full editor opens on a task right after you create it'
            : 'A quick-added task just files itself and the sheet closes'}
          toggle={newTaskDefaults.openEditorAfterQuickAdd}
          onPress={() => setNewTaskDefaults({ openEditorAfterQuickAdd: !newTaskDefaults.openEditorAfterQuickAdd })}
        />
        <View style={styles.sep} />
        {/* In this section rather than its own: a title rule is the same
            question these rows answer, asked one step more specifically. It
            reads as the exception to the footer's "applied to every new task"
            because that is exactly what it is. */}
        <SettingsRow
          icon="funnel-outline"
          iconColor={activeTitleRuleCount > 0 ? colors.accent : undefined}
          label="Title rules"
          hint="File a task by a word in its name, so anything starting with “expense” goes to Work"
          value={activeTitleRuleCount === 0
            ? 'None'
            : activeTitleRuleCount === 1 ? '1 rule' : `${activeTitleRuleCount} rules`}
          onPress={() => { haptics.tap(); setTitleRulesVisible(true); }}
        />
      </SettingsSection>

      <SettingsSection label="Projects">
        <SettingsRow
          icon="briefcase-outline"
          iconColor={autoArchiveProjectsOnComplete ? colors.accent : undefined}
          label="Auto-archive projects"
          hint={autoArchiveProjectsOnComplete
            ? 'A project archives itself once every task in it is done'
            : 'A finished project sits at 100% until you archive it'}
          toggle={autoArchiveProjectsOnComplete}
          onPress={() => setAutoArchiveProjectsOnComplete(!autoArchiveProjectsOnComplete)}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="notifications-outline"
          iconColor={defaultProjectNudgeCadenceDays > 0 ? colors.accent : undefined}
          label="Default nudge cadence"
          hint="What a new project starts with. Never by default. This doesn't touch projects you've already created, and each one can still override it."
          value={describeCadence(defaultProjectNudgeCadenceDays)}
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={defaultCadence.count}
            onChange={next => setDefaultProjectNudgeCadenceDays(fromCadenceParts({ ...defaultCadence, count: next }))}
            min={1}
            max={CADENCE_UNIT_MAX[defaultCadence.unit]}
            allowNull
            emptyLabel="Never"
            label="Default nudge cadence"
            describeValue={n => describeCadence(fromCadenceParts({ ...defaultCadence, count: n }))}
          />
          <View style={styles.cadenceUnitRow}>
            {CADENCE_UNITS.map(unit => {
              // Never has no unit — leaving all three unlit is what says so.
              const active = defaultCadence.count !== null && defaultCadence.unit === unit;
              return (
                <TouchableOpacity
                  key={unit}
                  style={[styles.pill, { flex: 0 }, active && styles.pillActive]}
                  onPress={() => {
                    haptics.tap();
                    setDefaultProjectNudgeCadenceDays(fromCadenceParts(withCadenceUnit(defaultCadence, unit)));
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Default nudge cadence in ${cadenceUnitLabel(unit)}`}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>
                    {cadenceUnitLabel(unit)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </SettingsSection>

      <CalendarPicker
        visible={showVacationEndPicker}
        value={vacationEnd ? new Date(vacationEnd) : null}
        mode="date"
        title="Vacation End Date"
        onConfirm={date => {
          setVacationEnd(getTaskDayStart(date).toISOString());
          setShowVacationEndPicker(false);
        }}
        onCancel={() => setShowVacationEndPicker(false)}
      />

      <StandingSwapsSheet
        visible={standingSwapsVisible}
        onClose={() => setStandingSwapsVisible(false)}
      />

      <TitleRulesSheet
        visible={titleRulesVisible}
        onClose={() => setTitleRulesVisible(false)}
      />
    </>
  );
}
