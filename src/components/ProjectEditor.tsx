import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Project } from '../types';
import { TITLE_MAX_LENGTH, DEFAULT_NUDGE_CADENCE_DAYS } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { WhenPicker } from './WhenPicker';
import { CollapsibleField } from './CollapsibleField';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorRow } from './EditorRow';
import { EditorSheet } from './EditorSheet';
import { CountStepper } from './CountStepper';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { formatDeadlineDate, formatStartDate } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  CADENCE_UNITS,
  CADENCE_UNIT_MAX,
  cadenceUnitLabel,
  describeCadence,
  fromCadenceParts,
  toCadenceParts,
  withCadenceUnit,
} from '../utils/nudgeCadence';

interface Props {
  visible: boolean;
  project: Project | null;
  /** Titles the sheet "New Project" — set when arriving from quick add's "More details". */
  isNew?: boolean;
  onClose: () => void;
}

export function ProjectEditor({ visible, project, isNew, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const updateProject = useProjectStore(s => s.updateProject);
  const archiveProject = useTaskStore(s => s.archiveProject);
  const unarchiveProject = useTaskStore(s => s.unarchiveProject);
  const completeProject = useTaskStore(s => s.completeProject);
  const uncompleteProject = useTaskStore(s => s.uncompleteProject);
  const deleteProject = useTaskStore(s => s.deleteProject);
  const allTasks = useTaskStore(s => s.tasks);
  // `project` is a snapshot handed down when the sheet was opened, so it never
  // sees its own archived flag flip back — read that one field live instead,
  // or unarchiving here leaves the toggle showing "archived" until the sheet
  // is reopened even though the store already changed.
  const liveArchived = useProjectStore(s => project ? s.projects.find(p => p.id === project.id)?.archived : undefined);
  const liveCompleted = useProjectStore(s => project ? s.projects.find(p => p.id === project.id)?.completed : undefined);
  const categories = useProjectCategoryStore(useShallow(s => s.categories));
  const addCategory = useProjectCategoryStore(s => s.addCategory);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [targetStartDate, setTargetStartDate] = useState<Date | null>(null);
  const [targetEndDate, setTargetEndDate] = useState<Date | null>(null);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  // Collapsed to the chosen category until tapped, like every other editor.
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [nudgeCadenceDays, setNudgeCadenceDays] = useState(DEFAULT_NUDGE_CADENCE_DAYS);
  const [autoSchedule, setAutoSchedule] = useState(false);
  const [sequential, setSequential] = useState(false);
  const [nudgeOptIn, setNudgeOptIn] = useState(false);
  const [cadenceOpen, setCadenceOpen] = useState(false);

  useEffect(() => {
    if (!project) return;
    setTitle(project.title);
    setNotes(project.notes);
    setCategory(project.category);
    setTargetStartDate(project.targetStartDate ? new Date(project.targetStartDate) : null);
    setTargetEndDate(project.targetEndDate ? new Date(project.targetEndDate) : null);
    setNudgeCadenceDays(project.nudgeCadenceDays);
    setAutoSchedule(project.autoSchedule);
    setSequential(project.sequential);
    setNudgeOptIn(project.nudgeOptIn);
    setCategoryOpen(false);
    setCadenceOpen(false);
  }, [project]);

  const closeCategory = () => { animateLayout(); setCategoryOpen(false); };

  // The cadence is stored in days; the picker shows it as a count and a unit.
  const cadence = toCadenceParts(nudgeCadenceDays);

  const saveAndClose = () => {
    if (!project) { onClose(); return; }
    const trimmed = title.trim();
    if (trimmed) {
      updateProject(project.id, {
        title: trimmed,
        notes,
        category,
        targetStartDate: targetStartDate ? targetStartDate.toISOString() : null,
        targetEndDate: targetEndDate ? targetEndDate.toISOString() : null,
        nudgeCadenceDays,
        // A cadence of "never", or being excluded outright, leaves nothing for
        // auto-scheduling to trigger on, so the three can't disagree about
        // whether this project is managed.
        autoSchedule: nudgeOptIn && nudgeCadenceDays > 0 && autoSchedule,
        sequential,
        nudgeOptIn,
      });
    }
    onClose();
  };

  const handleDelete = () => {
    if (!project) return;
    Alert.alert(
      'Delete Project',
      `Delete "${project.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete This Project', onPress: () => { deleteProject(project.id, { cascade: false }); onClose(); } },
        {
          text: 'Delete Project and All Its Tasks',
          style: 'destructive',
          onPress: () => { deleteProject(project.id, { cascade: true }); onClose(); },
        },
      ],
    );
  };

  const handleComplete = () => {
    if (!project) return;
    const remaining = allTasks.filter(
      t => t.projectId === project.id && t.parentId === null && !t.completed && !t.archived
    );
    const finish = (archiveRemaining: boolean) => {
      haptics.success();
      completeProject(project.id, { archiveRemaining });
      onClose();
    };
    if (remaining.length === 0) {
      finish(false);
      return;
    }
    Alert.alert(
      'Mark Complete',
      `"${project.title}" still has ${remaining.length} open ${remaining.length === 1 ? 'task' : 'tasks'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave Remaining Tasks', onPress: () => finish(false) },
        { text: 'Archive Remaining Tasks', onPress: () => finish(true) },
      ],
    );
  };

  if (!project) return null;
  const archived = liveArchived ?? project.archived;
  const completed = liveCompleted ?? project.completed;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} />
          <Text style={styles.headerTitle}>{isNew ? 'New Project' : 'Edit Project'}</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete project">
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </>
      }
      footer={
        <>
          <WhenPicker
            visible={showStartDatePicker}
            value={targetStartDate}
            title="Start date"
            showTimeOfDay={false}
            showSuggest={false}
            onConfirm={(date) => { setTargetStartDate(date); setShowStartDatePicker(false); }}
            onClear={() => { setTargetStartDate(null); setShowStartDatePicker(false); }}
            onCancel={() => setShowStartDatePicker(false)}
          />
          <WhenPicker
            visible={showEndDatePicker}
            value={targetEndDate}
            title="Target date"
            showTimeOfDay={false}
            showSuggest={false}
            onConfirm={(date) => { setTargetEndDate(date); setShowEndDatePicker(false); }}
            onClear={() => { setTargetEndDate(null); setShowEndDatePicker(false); }}
            onCancel={() => setShowEndDatePicker(false)}
          />
        </>
      }
    >
      <TextInput
        style={styles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="Project name"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={TITLE_MAX_LENGTH}
      />
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes"
        placeholderTextColor={colors.textTertiary}
        multiline
      />

      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Category"
          summary={category ?? undefined}
          hint="Groups this project with others of the same kind."
          expanded={categoryOpen}
          onToggle={() => setCategoryOpen(v => !v)}
        >
          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[styles.pill, !category && styles.pillActiveNeutral]}
              onPress={() => { haptics.tap(); setCategory(null); closeCategory(); }}
            >
              <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
            </TouchableOpacity>
            {categories.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.pill, category === cat.name && styles.pillActiveNeutral]}
                onPress={() => { haptics.tap(); setCategory(cat.name); closeCategory(); }}
              >
                <Text style={[styles.pillText, category === cat.name && styles.pillTextActive]}>{cat.name}</Text>
              </TouchableOpacity>
            ))}
            {addingCategory ? (
              <TextInput
                autoFocus
                style={styles.tagInput}
                value={newCategory}
                onChangeText={setNewCategory}
                onSubmitEditing={() => {
                  const c = newCategory.trim();
                  if (c) { addCategory(c); setCategory(c); closeCategory(); }
                  setNewCategory(''); setAddingCategory(false);
                }}
                onBlur={() => {
                  const c = newCategory.trim();
                  if (c) { addCategory(c); setCategory(c); closeCategory(); }
                  setNewCategory(''); setAddingCategory(false);
                }}
                placeholder="category name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="words"
              />
            ) : (
              <InlineAction icon="add" label="New" accessibilityLabel="New category" onPress={() => setAddingCategory(true)} />
            )}
          </View>
        </CollapsibleField>
      </View>

      <View style={[styles.card, { marginTop: spacing.lg }]}>
        <EditorRow
          icon="play-outline"
          label="Start date"
          value={targetStartDate ? formatStartDate(targetStartDate.toISOString()) : undefined}
          onPress={() => setShowStartDatePicker(true)}
          onClear={targetStartDate ? () => setTargetStartDate(null) : undefined}
        />
        <View style={styles.sep} />
        <EditorRow
          icon="flag-outline"
          label="Target date"
          value={targetEndDate ? formatDeadlineDate(targetEndDate.toISOString()) : undefined}
          onPress={() => setShowEndDatePicker(true)}
          onClear={targetEndDate ? () => setTargetEndDate(null) : undefined}
        />
      </View>
      {/* #1740: this used to only explain the target date, leaving "Start
          date" to sit unexplained next to a card full of scheduling toggles
          — reasonably read as gating something. Neither date does; both are
          purely informational (see Project.targetStartDate/targetEndDate). */}
      <Text style={styles.sectionFooter}>
        Optional, just for reference — shown on the project's card, doesn't affect scheduling or when tasks appear. If the target date passes before the project's done, nothing happens automatically; it's just flagged so you can decide what to do.
      </Text>

      <View style={[styles.card, { marginTop: spacing.lg }]}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); animateLayout(); setNudgeOptIn(v => !v); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Include in nudges"
          accessibilityState={{ checked: nudgeOptIn }}
        >
          <Ionicons name="notifications-outline" size={18} color={nudgeOptIn ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Include in nudges</Text>
            <Text style={styles.optionHint}>
              {nudgeOptIn
                ? 'Can appear in the gone-quiet nudge and "Pull from projects"'
                : 'Never appears in the gone-quiet nudge or "Pull from projects", off by default for a list you\'re not scheduling from'}
            </Text>
          </View>
          <View style={[styles.toggle, nudgeOptIn && styles.toggleOn]}>
            <View style={[styles.toggleKnob, nudgeOptIn && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>
      <Text style={styles.sectionFooter}>
        A project's tasks only show up on Today once they have a date, so a project with nothing
        scheduled goes quiet. This decides whether that gets your attention or stays quiet on
        purpose, like a running list of gift ideas.
      </Text>

      {nudgeOptIn && (
        <>
          <View style={[styles.sectionCard, { marginTop: spacing.lg }]}>
            <CollapsibleField
              label="Nudge me"
              summary={describeCadence(nudgeCadenceDays)}
              hint="How long a project can sit with nothing scheduled before the gone-quiet nudge picks it up. Take it to zero for Never."
              expanded={cadenceOpen}
              onToggle={() => setCadenceOpen(v => !v)}
            >
              <View style={styles.cadenceRow}>
                <CountStepper
                  value={cadence.count}
                  onChange={next => setNudgeCadenceDays(fromCadenceParts({ ...cadence, count: next }))}
                  min={1}
                  max={CADENCE_UNIT_MAX[cadence.unit]}
                  allowNull
                  emptyLabel="Never"
                  label="Nudge cadence"
                  describeValue={n => describeCadence(fromCadenceParts({ ...cadence, count: n }))}
                />
                <View style={styles.pillRow}>
                  {CADENCE_UNITS.map(unit => {
                    // Never has no unit — leaving all three unlit is what says so.
                    const active = cadence.count !== null && cadence.unit === unit;
                    return (
                      <TouchableOpacity
                        key={unit}
                        style={[styles.pill, active && styles.pillActiveNeutral]}
                        onPress={() => {
                          haptics.tap();
                          setNudgeCadenceDays(fromCadenceParts(withCadenceUnit(cadence, unit)));
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.pillText, active && styles.pillTextActive]}>
                          {cadenceUnitLabel(unit)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </CollapsibleField>
          </View>

          {nudgeCadenceDays > 0 && (
            <View style={[styles.card, { marginTop: spacing.lg }]}>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => { haptics.tap(); setAutoSchedule(v => !v); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityLabel="Keep it moving"
                accessibilityState={{ checked: autoSchedule }}
              >
                <Ionicons name="play-forward-outline" size={18} color={autoSchedule ? colors.accent : colors.textSecondary} />
                <View style={styles.optionContent}>
                  <Text style={styles.optionLabel}>Keep it moving</Text>
                  <Text style={styles.optionHint}>
                    {autoSchedule
                      ? 'Dates the next task for you instead of asking'
                      : 'Ask before scheduling anything from this project'}
                  </Text>
                </View>
                <View style={[styles.toggle, autoSchedule && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, autoSchedule && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      <View style={[styles.card, { marginTop: spacing.xl }]}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setSequential(v => !v); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Do these in order"
          accessibilityState={{ checked: sequential }}
        >
          <Ionicons name="list-outline" size={18} color={sequential ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Do these in order</Text>
            <Text style={styles.optionHint}>
              {sequential
                ? 'Only the top task is open. The rest unlock as you finish'
                : 'Any task in this project can be done whenever'}
            </Text>
          </View>
          <View style={[styles.toggle, sequential && styles.toggleOn]}>
            <View style={[styles.toggleKnob, sequential && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>
      <Text style={styles.sectionFooter}>
        Drag the tasks on the project's own screen to set the order. A step that isn't open yet
        stays off Today and Later until the one above it is done.
      </Text>

      <View style={[styles.card, { marginTop: spacing.xl }]}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => {
            if (completed) {
              uncompleteProject(project.id);
            } else {
              handleComplete();
            }
          }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Mark complete"
          accessibilityState={{ checked: completed }}
        >
          <Ionicons name={completed ? 'checkmark-circle' : 'checkmark-circle-outline'} size={18} color={completed ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Mark complete</Text>
            <Text style={styles.optionHint}>
              {completed ? 'Off the active list, listed under Completed' : 'Move to the completed list'}
            </Text>
          </View>
          <View style={[styles.toggle, completed && styles.toggleOn]}>
            <View style={[styles.toggleKnob, completed && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { marginTop: spacing.xl }]}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => {
            if (archived) {
              unarchiveProject(project.id);
            } else {
              haptics.success();
              archiveProject(project.id);
              onClose();
            }
          }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Archive"
          accessibilityState={{ checked: archived }}
        >
          <Ionicons name="archive-outline" size={18} color={archived ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Archive</Text>
            <Text style={styles.optionHint}>
              {archived ? 'Hidden from the active list' : 'Move to the archived list'}
            </Text>
          </View>
          <View style={[styles.toggle, archived && styles.toggleOn]}>
            <View style={[styles.toggleKnob, archived && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>
    </EditorSheet>
  );
}


const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: fontWeight.medium,
    paddingVertical: spacing.sm, minHeight: 44,
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingBottom: spacing.lg, minHeight: 44,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  // The unit pills stay one group: at a narrow width the whole set drops to a
  // second line rather than splitting "Months" off on its own.
  cadenceRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: spacing.sm, marginTop: spacing.md,
  },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  pillActiveNeutral: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
  tagInput: {
    color: colors.text, fontSize: font.sm,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 4, paddingHorizontal: 4, minWidth: 80,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  sectionFooter: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  toggle: {
    width: 44, height: 26, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, padding: 2, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.bg,
  },
  toggleKnobOn: { alignSelf: 'flex-end' },
});
