import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useSettingsStore, type MealsOnToday } from '../../store/useSettingsStore';
import { useTaskStore } from '../../store/useTaskStore';
import { useCalendarStore } from '../../store/useCalendarStore';
import { useCategoryStore } from '../../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { WhenPicker } from '../../components/WhenPicker';
import { getTaskDayStart } from '../../utils/dateUtils';
import { EXPIRED_TASK_GRACE_OPTIONS, expiredTaskGraceLabel, type ExpiredTaskGraceDays } from '../../utils/expiredTaskGrace';
import { CountStepper } from '../../components/CountStepper';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { PillGroup } from '../../components/PillGroup';
import { TitleRulesSheet } from '../../components/TitleRulesSheet';
import { makeSettingsStyles } from './settingsStyles';
import {
  SIMPLE_AREAS, SIMPLE_AREA_LABELS, SIMPLE_FEATURES, simpleFeaturesIn,
} from '../../utils/simpleMode';
import { haptics } from '../../utils/haptics';
import { isScreenTimeSupported, screenTimeBridge } from '../../utils/screenTimeBridge';
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
export function TasksProjectsSettings() {
  const vacationMode = useSettingsStore(s => s.vacationMode);
  const setVacationMode = useSettingsStore(s => s.setVacationMode);
  const vacationStart = useSettingsStore(s => s.vacationStart);
  const vacationEnd = useSettingsStore(s => s.vacationEnd);
  const destinationForecastEnabled = useSettingsStore(s => s.destinationForecastEnabled);
  const setDestinationForecastEnabled = useSettingsStore(s => s.setDestinationForecastEnabled);
  const setVacationEnd = useSettingsStore(s => s.setVacationEnd);
  const autoRemoveExpiredTasks = useSettingsStore(s => s.autoRemoveExpiredTasks);
  const setAutoRemoveExpiredTasks = useSettingsStore(s => s.setAutoRemoveExpiredTasks);
  const autoCompleteProjectsOnDone = useSettingsStore(s => s.autoCompleteProjectsOnDone);
  const setAutoCompleteProjectsOnDone = useSettingsStore(s => s.setAutoCompleteProjectsOnDone);
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
  const focusLiveActivity = useSettingsStore(s => s.focusLiveActivity);
  const setFocusLiveActivity = useSettingsStore(s => s.setFocusLiveActivity);
  const noBreaks = focusRestsDisabled({ focusRestAfterTasks, focusRestAfterMinutes });
  const setPostponeCheckThreshold = useSettingsStore(s => s.setPostponeCheckThreshold);
  const hideCategories = useSettingsStore(s => s.hideCategories);
  const setHideCategories = useSettingsStore(s => s.setHideCategories);
  const simpleTaskForm = useSettingsStore(s => s.simpleTaskForm);
  const setSimpleTaskForm = useSettingsStore(s => s.setSimpleTaskForm);
  const timerLiveActivity = useSettingsStore(s => s.timerLiveActivity);
  const setTimerLiveActivity = useSettingsStore(s => s.setTimerLiveActivity);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const setKitchenEnabled = useSettingsStore(s => s.setKitchenEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const setSimpleMode = useSettingsStore(s => s.setSimpleMode);
  const defaultProjectNudgeCadenceDays = useSettingsStore(s => s.defaultProjectNudgeCadenceDays);
  const setDefaultProjectNudgeCadenceDays = useSettingsStore(s => s.setDefaultProjectNudgeCadenceDays);
  const newTaskDefaults = useSettingsStore(s => s.newTaskDefaults);
  const setNewTaskDefaults = useSettingsStore(s => s.setNewTaskDefaults);
  const titleRules = useSettingsStore(useShallow(s => s.titleRules));

  const forgivVacationStreaks = useTaskStore(s => s.forgivVacationStreaks);
  const categories = useCategoryStore(s => s.categories);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const [showVacationEndPicker, setShowVacationEndPicker] = useState(false);
  const [titleRulesVisible, setTitleRulesVisible] = useState(false);

  // --- Screen Time -----------------------------------------------------
  // Asked once on mount rather than subscribed to: whether this build has the
  // native half, on a device new enough, cannot change while the screen is up.
  const [screenTimeSupported] = useState(isScreenTimeSupported);
  const focusShieldEnabled = useSettingsStore(s => s.focusShieldEnabled);
  const setFocusShieldEnabled = useSettingsStore(s => s.setFocusShieldEnabled);
  // Counts, not names. iOS hands the app opaque tokens for the apps somebody
  // picked and only SwiftUI can render them, so this is the most the row can
  // say — see modules/todo-screentime-bridge.
  const [shieldCount, setShieldCount] = useState(
    () => screenTimeBridge()?.screenTimeSelectionCount() ?? { applications: 0, categories: 0 },
  );
  const shieldTotal = shieldCount.applications + shieldCount.categories;
  const shieldSelectionLabel = shieldTotal === 0
    ? 'None'
    : [
      shieldCount.applications > 0
        ? `${shieldCount.applications} ${shieldCount.applications === 1 ? 'app' : 'apps'}`
        : null,
      shieldCount.categories > 0
        ? `${shieldCount.categories} ${shieldCount.categories === 1 ? 'category' : 'categories'}`
        : null,
    ].filter(Boolean).join(', ');

  const handleChooseApps = async () => {
    haptics.tap();
    const bridge = screenTimeBridge();
    if (!bridge) return;
    const picked = await bridge.presentAppPicker();
    if (picked) setShieldCount(bridge.screenTimeSelectionCount());
  };

  const handleToggleShield = async () => {
    haptics.tap();
    if (focusShieldEnabled) {
      setFocusShieldEnabled(false);
      return;
    }
    const bridge = screenTimeBridge();
    if (!bridge) return;
    // Asking is a Settings action and never something the app does on its own
    // — the same rule the weather rules sheet follows for location.
    const status = await bridge.requestScreenTimeAuthorization();
    if (status !== 'approved') {
      Alert.alert(
        'Screen Time access needed',
        'Blocking apps during a focus session needs Screen Time access. You can grant it in Settings, under Screen Time.',
      );
      return;
    }
    setFocusShieldEnabled(true);
    // Straight into the picker the first time: the setting does nothing at all
    // until some apps are chosen, and a toggle that visibly changes nothing is
    // how somebody concludes the feature is broken.
    if (shieldTotal === 0) await handleChooseApps();
  };

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
      {/* Ordered by how often a person comes here for it, which is roughly the
          reverse of how this screen grew: what a new task starts with is the
          thing people actually look for, and it used to sit below vacation
          mode, focus tuning and a wall of grocery rows. The two master switches
          stay last — they change what the rest of Settings even contains, which
          is a reason to meet them after the rest, not before it. */}
      <SettingsSection
        label="New tasks"
        footer="What a fresh task starts with, and where quick-add files it before you type anything. None of these override a value you actually pick. Typing a date in quick-add still wins over the destination below."
      >
        <SettingsRow
  entryId="newTaskCategory" icon="pricetag-outline" label="Category" hint="Applied to every new task that doesn't get one of its own." value={newTaskCategoryOptions.find(o => o.value === newTaskDefaults.category)?.label ?? 'None'} tight />
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
        <SettingsRow
  entryId="newTaskPriority" icon="flag-outline" label="Priority" tight />
        <SettingsSegments
          attached
          columns={3}
          options={PRIORITY_SEGMENTS}
          selected={newTaskDefaults.priority ?? 0}
          onSelect={priority => setNewTaskDefaults({ priority })}
          accessibilityLabelFor={o => `Default priority: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow
  entryId="newTaskEffort" icon="speedometer-outline" label="Effort" tight />
        <SettingsSegments
          attached
          options={NEW_TASK_EFFORT_OPTIONS}
          selected={newTaskDefaults.effort ?? 0}
          onSelect={effort => setNewTaskDefaults({ effort })}
          accessibilityLabelFor={o => `Default effort: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow
  entryId="newTaskTimeOfDay" icon="partly-sunny-outline" label="Time of day" tight />
        <SettingsSegments
          attached
          columns={3}
          options={NEW_TASK_TIME_OF_DAY_OPTIONS}
          selected={newTaskDefaults.timeSegment}
          onSelect={timeSegment => setNewTaskDefaults({ timeSegment })}
          accessibilityLabelFor={o => `Default time of day: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow
  entryId="newTaskDestination" icon="albums-outline" label="Where quick-add lands" hint="Which list a quick-added task files into before you set a date." tight />
        <SettingsSegments
          attached
          options={NEW_TASK_DESTINATION_OPTIONS}
          selected={newTaskDefaults.destination}
          onSelect={destination => setNewTaskDefaults({ destination })}
          accessibilityLabelFor={o => `Quick-add destination: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="openEditorAfterQuickAdd"
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
          entryId="titleRules"
          icon="funnel-outline"
          iconColor={activeTitleRuleCount > 0 ? colors.accent : undefined}
          label="Title rules"
          hint="File a task by a word in its name, so anything starting with “expense” goes to Work."
          value={activeTitleRuleCount === 0
            ? 'None'
            : activeTitleRuleCount === 1 ? '1 rule' : `${activeTitleRuleCount} rules`}
          onPress={() => { haptics.tap(); setTitleRulesVisible(true); }}
        />
      </SettingsSection>

      <SettingsSection
        label="Task form"
        footer="Nothing is removed. The other fields sit behind “more” in quick add and in the editor's sections, and the editor's field search still finds all of them. A task created either way is the same task."
      >
        <SettingsRow
          entryId="simpleTaskForm"
          icon="remove-outline"
          iconColor={simpleTaskForm ? colors.accent : undefined}
          label="Show fewer fields"
          hint={simpleTaskForm
            ? 'Quick add shows Date, Time of day and Repeat, and names its buttons'
            : 'Quick add shows every field it has'}
          toggle={simpleTaskForm}
          onPress={() => setSimpleTaskForm(!simpleTaskForm)}
        />
      </SettingsSection>

      <SettingsSection
        label="Today"
        footer="Also available from Today's … menu."
      >
        <SettingsRow
          entryId="hideCategories"
          icon="eye-off-outline"
          iconColor={hideCategories ? colors.accent : undefined}
          label="Hide categories"
          hint={hideCategories ? 'Showing one flat list of tasks' : 'Group tasks under category headers'}
          toggle={hideCategories}
          onPress={() => setHideCategories(!hideCategories)}
        />
      </SettingsSection>

      <SettingsSection label="Projects">
        <SettingsRow
          entryId="autoCompleteProjects"
          icon="briefcase-outline"
          iconColor={autoCompleteProjectsOnDone ? colors.accent : undefined}
          label="Auto-complete projects"
          hint={autoCompleteProjectsOnDone
            ? 'A project marks itself complete once every task in it is done. You can still archive it afterwards'
            : 'A finished project sits at 100% until you mark it complete'}
          toggle={autoCompleteProjectsOnDone}
          onPress={() => setAutoCompleteProjectsOnDone(!autoCompleteProjectsOnDone)}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="defaultProjectNudgeCadence"
          icon="notifications-outline"
          iconColor={defaultProjectNudgeCadenceDays > 0 ? colors.accent : undefined}
          label="Default review cadence"
          hint="What a new project's “Bring this up” starts at. Never by default, which keeps a new project out of nudges entirely; anything else opts it in at that cadence. This doesn't touch projects you've already created, and each one can still override it."
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
            label="Default review cadence"
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

      <SettingsSection
        label="Rescheduling"
        footer="Counted per task, and the count resets as soon as you pull one back to today. You can also silence the prompt for a single task from the reminder itself."
      >
        <SettingsRow
          entryId="postponeCheck"
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
              entryId="postponeCheckThreshold"
              icon="hand-left-outline"
              label="Reschedule threshold"
              hint="Number of times a task can be moved before the suggestion appears."
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

      {!simpleMode && (
      <SettingsSection
        label="Focus sessions"
        footer={`${noBreaks
          ? 'Both break triggers are off, so a session runs straight through with no breaks in it.'
          : 'Both triggers run at once and whichever comes first inserts the break. Start a session from Today’s … menu.'}${
          Platform.OS === 'ios' ? ' The Lock Screen activity requires iOS 17.' : ''}`}
      >
        <SettingsRow
          entryId="focusWorkCapMinutes"
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
          entryId="focusDefaultWorkMinutes"
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
          entryId="focusRestAfterMinutes"
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
          entryId="focusRestAfterTasks"
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
              entryId="focusRestMinutes"
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
              entryId="focusLongRestEvery"
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
                  entryId="focusLongRestMinutes"
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

        {Platform.OS === 'ios' && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              entryId="focusLiveActivity"
              icon="phone-portrait-outline"
              iconColor={focusLiveActivity ? colors.accent : undefined}
              label="Live Activity while focusing"
              hint={focusLiveActivity
                ? 'The step you’re on shows on the Lock Screen and Dynamic Island, with a button to pause it or move to the next one'
                : 'Sessions stay in the app only'}
              toggle={focusLiveActivity}
              onPress={() => setFocusLiveActivity(!focusLiveActivity)}
            />
          </>
        )}

        {/*
          Screen Time. Hidden outright rather than shown disabled when the
          device or build can't do it — the authorization it wants is one an
          iOS 15 phone can never grant, so offering the row would be asking a
          question with no answer. Same call the Live Activity row above makes
          about a non-iOS device.
        */}
        {screenTimeSupported && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              entryId="focusShield"
              icon="lock-closed-outline"
              iconColor={focusShieldEnabled ? colors.accent : undefined}
              label="Block apps while focusing"
              hint={focusShieldEnabled
                ? 'The apps you choose are blocked while a session is running, and unblocked when you pause or finish it'
                : 'Apps stay available during a session'}
              toggle={focusShieldEnabled}
              onPress={handleToggleShield}
            />
            {focusShieldEnabled && (
              <>
                <View style={styles.sep} />
                <SettingsRow
                  entryId="focusShieldApps"
                  icon="apps-outline"
                  label="Apps to block"
                  hint="Chosen in the system picker. iOS doesn’t tell the app which ones you picked, so only the count shows here."
                  value={shieldSelectionLabel}
                  onPress={handleChooseApps}
                />
              </>
            )}
          </>
        )}
      </SettingsSection>
      )}

      {Platform.OS === 'ios' && (
        <SettingsSection
          label="Timers"
          footer="Requires iOS 17. Ends the moment you pause, stop, or (for a task) complete it. Resuming starts a fresh one."
        >
          <SettingsRow
            entryId="timerLiveActivity"
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

      {/* Expiry needs a time window, and simplified mode takes the window row
          off the editor — but only for *new* tasks. Simplified mode is a
          display setting (see simpleMode.ts): it clears nothing, so a task that
          already carries a window still expires, and sweepExpiredTasks still
          reads this setting and still deletes. So the section stays while a
          grace period is set, the same way the switch itself is never hidden by
          the mode it turns on. Hiding the only control over a delete that keeps
          happening is the one thing this mode must not do. */}
      {(!simpleMode || autoRemoveExpiredTasks !== null) && (
      <SettingsSection
        label="Time-limited tasks"
        footer={'A task with a time window (like "farmers market, 8am–1pm") moves to Expired once its window closes, whether or not it repeats.'}
      >
        <SettingsRow
          entryId="autoRemoveExpired"
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
      )}

      {/* Nothing to configure in simplified mode: it removes the per-task
          "vacation pause" row, so vacation mode has nothing new to hide.
          Nothing *new* is the whole of it, though — the mode changes what is
          rendered and never what is stored, so tasks already marked for
          vacation pause, and whole categories set to hide on vacation, stay
          hidden exactly as they were. Switching simplified mode on with
          vacation mode already on therefore used to take the off-switch away
          from a state that was still hiding the user's tasks, with no way back
          to it. So the section survives as long as it is on. */}
      {(!simpleMode || vacationMode) && (
      <SettingsSection
        label="Vacation"
        footer={`${vacationMode && vacationStart ? `On since ${format(new Date(vacationStart), 'MMM d')}. ` : ''}While on, tasks with "vacation pause" enabled are hidden everywhere and their streaks are protected. You can also hide whole categories on vacation from the Categories screen. Turn it off when you return and streaks will be forgiven automatically, or set an end date to have it happen for you.`}
      >
        <SettingsRow
          entryId="vacationMode"
          icon="airplane-outline"
          iconColor={vacationMode ? colors.accent : undefined}
          label="Vacation mode"
          hint="Hides tasks marked for vacation pause."
          toggle={vacationMode}
          onPress={() => {
            if (vacationMode) {
              forgivVacationStreaks();
              setVacationMode(false);
            } else {
              setVacationMode(true);
            }
            // Any calendar in vacationHiddenCalendarIds joins or leaves the
            // read right on the toggle, rather than waiting on the next
            // focus of a screen that happens to call refresh() itself.
            void useCalendarStore.getState().refresh();
          }}
        />
        {vacationMode && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              entryId="vacationEnd"
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
      )}

      <SettingsSection
        label="Trips"
        footer="A project with away dates can carry where you're going. With this on, that place is sent to Open-Meteo to look up its coordinates and the forecast for your dates, and the project shows a line with the temperature range and whether rain or snow is expected. Nothing is stored, and it's only ever asked about a project that has both a destination and a departure date. Off means nothing leaves the app."
      >
        <SettingsRow
          entryId="destinationForecastEnabled"
          icon="partly-sunny-outline"
          iconColor={destinationForecastEnabled ? colors.accent : undefined}
          label="Destination forecast"
          hint="Looks up the weather where you're going."
          toggle={destinationForecastEnabled}
          onPress={() => setDestinationForecastEnabled(!destinationForecastEnabled)}
        />
      </SettingsSection>

      <SettingsSection
        label="Feature areas"
        footer="Neither switch deletes anything. Your tasks, lists, recipes and planned meals are kept exactly as they are, and turning either back on returns every feature as you left it. A task or item that already uses a hidden feature keeps showing it, so nothing you have set can go missing."
      >
        <SettingsRow
          entryId="kitchenEnabled"
          icon="cart-outline"
          iconColor={kitchenEnabled ? colors.accent : undefined}
          label="Groceries & meals"
          hint={kitchenEnabled ? 'Shown in the tab bar' : 'Hidden from the tab bar'}
          toggle={kitchenEnabled}
          onPress={() => setKitchenEnabled(!kitchenEnabled)}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="simpleMode"
          icon="contract-outline"
          iconColor={simpleMode ? colors.accent : undefined}
          label="Simplified mode"
          hint={simpleMode
            ? `${SIMPLE_FEATURES.length} advanced features are hidden`
            : 'Every feature is available'}
          toggle={simpleMode}
          onPress={() => setSimpleMode(!simpleMode)}
        />
        <View style={styles.sep} />
        {/* The list is the setting's only honest description: "hides advanced
            features" is not something anyone can act on without knowing which. */}
        <SettingsRow icon="list-outline" label="What simplified mode hides" />
        <View style={styles.simpleList}>
          {SIMPLE_AREAS.map(area => (
            <View key={area} style={styles.simpleArea}>
              <Text style={styles.simpleAreaLabel}>{SIMPLE_AREA_LABELS[area]}</Text>
              <Text style={styles.simpleAreaFeatures}>
                {simpleFeaturesIn(area).map(f => f.label).join(', ')}
              </Text>
            </View>
          ))}
        </View>
      </SettingsSection>

      {/*
        A plain day, so WhenPicker — the CalendarPicker this used to be is only
        for a completion timestamp or a set of dates. Time of day and Suggest
        are off: this is a range bound, not a task's own schedule.
      */}
      <WhenPicker
        visible={showVacationEndPicker}
        value={vacationEnd ? new Date(vacationEnd) : null}
        title="Vacation end date"
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={date => {
          setVacationEnd(date ? getTaskDayStart(date).toISOString() : null);
          setShowVacationEndPicker(false);
        }}
        onClear={() => {
          setVacationEnd(null);
          setShowVacationEndPicker(false);
        }}
        onCancel={() => setShowVacationEndPicker(false)}
      />

      <TitleRulesSheet
        visible={titleRulesVisible}
        onClose={() => setTitleRulesVisible(false)}
      />
    </>
  );
}
