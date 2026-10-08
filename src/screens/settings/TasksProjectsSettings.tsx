import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useCategoryStore } from '../../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../../theme/ThemeContext';
import { EXPIRED_TASK_GRACE_OPTIONS, expiredTaskGraceLabel, type ExpiredTaskGraceDays } from '../../utils/expiredTaskGrace';
import { CountStepper } from '../../components/CountStepper';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { PillGroup } from '../../components/PillGroup';
import { TitleRulesSheet } from '../../components/TitleRulesSheet';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';
import { categoryLabel } from '../../utils/categoryLabel';
import { effortTimeLabel } from '../../utils/effort';
import { EFFORT_LABELS, type Difficulty, type Effort, type TimeOfDay } from '../../types';
import { PRIORITY_SEGMENTS } from '../../utils/prioritySegments';
import { DIFFICULTY_SEGMENTS } from '../../utils/rewards';
import {
  CADENCE_UNITS, CADENCE_UNIT_MAX, cadenceUnitLabel,
  describeCadence, fromCadenceParts, toCadenceParts, withCadenceUnit,
} from '../../utils/nudgeCadence';
import {
  DEFAULT_POSTPONE_THRESHOLD, MIN_POSTPONE_THRESHOLD, MAX_POSTPONE_THRESHOLD,
} from '../../utils/postpone';

const EXPIRED_TASK_GRACE_SEGMENTS: SegmentOption<ExpiredTaskGraceDays>[] =
  EXPIRED_TASK_GRACE_OPTIONS.map(o => ({ value: o.value, label: o.label }));

// 0 already means "None"/"—" everywhere else a priority or effort is picked
// (TaskEditor, QuickAdd), so there's no separate null option here or in
// PRIORITY_SEGMENTS — leaving a new task's priority/effort default at 0 behaves
// identically to not configuring a default at all (newTaskFromDraft falls back
// to 0 either way).
const NEW_TASK_EFFORT_OPTIONS: SegmentOption<Effort>[] =
  EFFORT_LABELS.map((label, value) => ({ value: value as Effort, label: value === 0 ? 'None' : effortTimeLabel(value as Effort, label) }));
const NEW_TASK_DIFFICULTY_OPTIONS: SegmentOption<Difficulty | null>[] = [
  { value: null, label: 'None' },
  ...DIFFICULTY_SEGMENTS,
];
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
  const autoRemoveExpiredTasks = useSettingsStore(s => s.autoRemoveExpiredTasks);
  const setAutoRemoveExpiredTasks = useSettingsStore(s => s.setAutoRemoveExpiredTasks);
  const autoCompleteProjectsOnDone = useSettingsStore(s => s.autoCompleteProjectsOnDone);
  const setAutoCompleteProjectsOnDone = useSettingsStore(s => s.setAutoCompleteProjectsOnDone);
  const postponeCheckEnabled = useSettingsStore(s => s.postponeCheckEnabled);
  const setPostponeCheckEnabled = useSettingsStore(s => s.setPostponeCheckEnabled);
  const postponeCheckThreshold = useSettingsStore(s => s.postponeCheckThreshold);
  const setPostponeCheckThreshold = useSettingsStore(s => s.setPostponeCheckThreshold);
  const hideListPreviews = useSettingsStore(s => s.hideListPreviews);
  const setHideListPreviews = useSettingsStore(s => s.setHideListPreviews);
  const hideCategories = useSettingsStore(s => s.hideCategories);
  const setHideCategories = useSettingsStore(s => s.setHideCategories);
  const simpleTaskForm = useSettingsStore(s => s.simpleTaskForm);
  const setSimpleTaskForm = useSettingsStore(s => s.setSimpleTaskForm);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const defaultProjectNudgeCadenceDays = useSettingsStore(s => s.defaultProjectNudgeCadenceDays);
  const setDefaultProjectNudgeCadenceDays = useSettingsStore(s => s.setDefaultProjectNudgeCadenceDays);
  const newTaskDefaults = useSettingsStore(s => s.newTaskDefaults);
  const setNewTaskDefaults = useSettingsStore(s => s.setNewTaskDefaults);
  const titleRules = useSettingsStore(useShallow(s => s.titleRules));

  const categories = useCategoryStore(s => s.categories);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
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
      {/* Ordered by how often a person comes here for it, which is roughly the
          reverse of how this screen grew: what a new task starts with is the
          thing people actually look for, and it used to sit below vacation
          mode, focus tuning and a wall of grocery rows. The two master switches
          stay last — they change what the rest of Settings even contains, which
          is a reason to meet them after the rest, not before it. */}
      <SettingsSection
        label="New tasks"
        footer="What a fresh task starts with, and where quick add files it before you type anything. A project's own defaults come first, and none of these override a value you actually pick. The task editor shows the default on a row you haven't touched. Typing a date in quick add still wins over the destination below."
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
  entryId="newTaskDifficulty" icon="barbell-outline" label="Difficulty" hint="How hard a new task is to make yourself do. Only matters when rewards are on: hard tasks earn double coins and easy ones half." tight />
        <SettingsSegments
          attached
          options={NEW_TASK_DIFFICULTY_OPTIONS}
          selected={newTaskDefaults.difficulty}
          onSelect={difficulty => setNewTaskDefaults({ difficulty })}
          accessibilityLabelFor={o => `Default difficulty: ${o.label}`}
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
  entryId="newTaskDestination" icon="albums-outline" label="Where quick add lands" hint="Which list a quick-added task files into before you set a date." tight />
        <SettingsSegments
          attached
          options={NEW_TASK_DESTINATION_OPTIONS}
          selected={newTaskDefaults.destination}
          onSelect={destination => setNewTaskDefaults({ destination })}
          accessibilityLabelFor={o => `Quick add destination: ${o.label}`}
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
            ? 'A project marks itself complete once every task in it is done. You can still archive it afterward'
            : 'A finished project sits at 100% until you mark it complete'}
          toggle={autoCompleteProjectsOnDone}
          onPress={() => setAutoCompleteProjectsOnDone(!autoCompleteProjectsOnDone)}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="hideListPreviews"
          icon="eye-off-outline"
          iconColor={hideListPreviews ? colors.accent : undefined}
          label="Hide list items on cards"
          hint={hideListPreviews
            ? 'Lists on the Projects screen show only their name and count'
            : 'Lists on the Projects screen show their first few items'}
          toggle={hideListPreviews}
          onPress={() => setHideListPreviews(!hideListPreviews)}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="defaultProjectNudgeCadence"
          icon="notifications-outline"
          iconColor={defaultProjectNudgeCadenceDays > 0 ? colors.accent : undefined}
          label="Bring new projects up every"
          hint="What a new project's “Bring this up” starts at. By default a new project shows up in Pull from projects when you open it, and never brings itself up. Pick a length and new projects add a review task once they've gone that long with nothing scheduled. This doesn't touch projects you've already created, and each one can still be changed on its own."
          value={defaultProjectNudgeCadenceDays > 0 ? describeCadence(defaultProjectNudgeCadenceDays) : 'When I ask'}
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={defaultCadence.count}
            onChange={next => setDefaultProjectNudgeCadenceDays(fromCadenceParts({ ...defaultCadence, count: next }))}
            min={1}
            max={CADENCE_UNIT_MAX[defaultCadence.unit]}
            allowNull
            emptyLabel="When I ask"
            label="Bring new projects up every"
            describeValue={n => describeCadence(fromCadenceParts({ ...defaultCadence, count: n }))}
          />
          <View style={styles.cadenceUnitRow}>
            {CADENCE_UNITS.map(unit => {
              // When I ask has no unit — leaving all three unlit is what says so.
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
                  accessibilityLabel={`Bring new projects up every so many ${cadenceUnitLabel(unit).toLowerCase()}`}
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

      <TitleRulesSheet
        visible={titleRulesVisible}
        onClose={() => setTitleRulesVisible(false)}
      />
    </>
  );
}
