import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTaskStore } from '../../store/useTaskStore';
import { useCategoryStore } from '../../store/useCategoryStore';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { CalendarPicker } from '../../components/CalendarPicker';
import { EXPIRED_TASK_GRACE_OPTIONS, expiredTaskGraceLabel, type ExpiredTaskGraceDays } from '../../utils/expiredTaskGrace';
import { CountStepper } from '../../components/CountStepper';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsPills, type PillOption } from './SettingsPills';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';
import { categoryLabel } from '../../utils/categoryLabel';
import { PRIORITY_LABELS, EFFORT_LABELS, type Priority, type Effort, type TimeOfDay } from '../../types';
import {
  CADENCE_UNITS, CADENCE_UNIT_MAX, cadenceUnitLabel,
  describeCadence, fromCadenceParts, toCadenceParts, withCadenceUnit,
} from '../../utils/nudgeCadence';

const EXPIRED_TASK_GRACE_PILLS: PillOption<ExpiredTaskGraceDays>[] =
  EXPIRED_TASK_GRACE_OPTIONS.map(o => ({ value: o.value, label: o.label }));

// 0 already means "None"/"—" everywhere else a priority or effort is picked
// (TaskEditor, QuickAdd), so there's no separate null option here — leaving a
// new task's priority/effort default at 0 behaves identically to not
// configuring a default at all (newTaskFromDraft falls back to 0 either way).
const NEW_TASK_PRIORITY_PILLS: PillOption<Priority>[] =
  PRIORITY_LABELS.map((label, value) => ({ value: value as Priority, label }));
const NEW_TASK_EFFORT_PILLS: PillOption<Effort>[] =
  EFFORT_LABELS.map((label, value) => ({ value: value as Effort, label: value === 0 ? 'None' : label }));
const NEW_TASK_TIME_SEGMENT_PILLS: PillOption<TimeOfDay | null>[] = [
  { value: null, label: 'None' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
];
const NEW_TASK_DESTINATION_PILLS: PillOption<'today' | 'inbox' | 'unscheduled'>[] = [
  { value: 'today', label: 'Today' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'unscheduled', label: 'Unscheduled' },
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
  const hideCategories = useSettingsStore(s => s.hideCategories);
  const setHideCategories = useSettingsStore(s => s.setHideCategories);
  const timerLiveActivity = useSettingsStore(s => s.timerLiveActivity);
  const setTimerLiveActivity = useSettingsStore(s => s.setTimerLiveActivity);
  const defaultProjectNudgeCadenceDays = useSettingsStore(s => s.defaultProjectNudgeCadenceDays);
  const setDefaultProjectNudgeCadenceDays = useSettingsStore(s => s.setDefaultProjectNudgeCadenceDays);
  const newTaskDefaults = useSettingsStore(s => s.newTaskDefaults);
  const setNewTaskDefaults = useSettingsStore(s => s.setNewTaskDefaults);

  const forgivVacationStreaks = useTaskStore(s => s.forgivVacationStreaks);
  const categories = useCategoryStore(s => s.categories);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const [showVacationEndPicker, setShowVacationEndPicker] = useState(false);

  const newTaskCategoryPills: PillOption<string | null>[] = useMemo(() => [
    { value: null, label: 'None' },
    ...categories.map(c => ({ value: c.name, label: categoryLabel(c.name, categories) })),
  ], [categories]);

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
                : 'Optional — turn off manually if not set'}
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
        <SettingsPills
          attached
          options={EXPIRED_TASK_GRACE_PILLS}
          selected={autoRemoveExpiredTasks}
          onSelect={setAutoRemoveExpiredTasks}
          accessibilityLabelFor={o => `Auto-remove expired tasks: ${o.label}`}
        />
      </SettingsSection>

      {Platform.OS === 'ios' && (
        <SettingsSection
          label="Timers"
          footer="Requires iOS 17. Ends the moment you pause, stop, or (for a task) complete it — resuming starts a fresh one."
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
        label="New tasks"
        footer="What a fresh task starts with, and where quick-add files it before you type anything. None of these override a value you actually pick — typing a date in quick-add still wins over the destination below."
      >
        <SettingsRow icon="pricetag-outline" label="Category" hint="Applied to every new task that doesn't get one of its own" value={newTaskCategoryPills.find(o => o.value === newTaskDefaults.category)?.label ?? 'None'} tight />
        <SettingsPills
          attached
          options={newTaskCategoryPills}
          selected={newTaskDefaults.category}
          onSelect={category => { haptics.tap(); setNewTaskDefaults({ category }); }}
          accessibilityLabelFor={o => `Default category: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow icon="flag-outline" label="Priority" tight />
        <SettingsPills
          attached
          options={NEW_TASK_PRIORITY_PILLS}
          selected={newTaskDefaults.priority ?? 0}
          onSelect={priority => { haptics.tap(); setNewTaskDefaults({ priority }); }}
          accessibilityLabelFor={o => `Default priority: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow icon="speedometer-outline" label="Effort" tight />
        <SettingsPills
          attached
          options={NEW_TASK_EFFORT_PILLS}
          selected={newTaskDefaults.effort ?? 0}
          onSelect={effort => { haptics.tap(); setNewTaskDefaults({ effort }); }}
          accessibilityLabelFor={o => `Default effort: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow icon="partly-sunny-outline" label="Time of day" tight />
        <SettingsPills
          attached
          options={NEW_TASK_TIME_SEGMENT_PILLS}
          selected={newTaskDefaults.timeSegment}
          onSelect={timeSegment => { haptics.tap(); setNewTaskDefaults({ timeSegment }); }}
          accessibilityLabelFor={o => `Default time of day: ${o.label}`}
        />
        <View style={styles.sep} />
        <SettingsRow icon="albums-outline" label="Where quick-add lands" hint="Which list a quick-added task files into before you set a date" tight />
        <SettingsPills
          attached
          options={NEW_TASK_DESTINATION_PILLS}
          selected={newTaskDefaults.destination}
          onSelect={destination => { haptics.tap(); setNewTaskDefaults({ destination }); }}
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
          hint="What a new project starts with. Never by default — this doesn't touch projects you've already created, and each one can still override it."
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
          const endOfDay = new Date(date);
          endOfDay.setHours(23, 59, 59, 999);
          setVacationEnd(endOfDay.toISOString());
          setShowVacationEndPicker(false);
        }}
        onCancel={() => setShowVacationEndPicker(false)}
      />
    </>
  );
}
