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
import { TITLE_MAX_LENGTH } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { WhenPicker } from './WhenPicker';
import { CollapsibleField } from './CollapsibleField';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorRow } from './EditorRow';
import { awayNoonIso } from '../utils/awayDates';
import { EditorSheet } from './EditorSheet';
import { CountStepper } from './CountStepper';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { formatDeadlineDate } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  CADENCE_UNITS,
  CADENCE_UNIT_MAX,
  FALLBACK_CADENCE_DAYS,
  NUDGE_MODES,
  NUDGE_MODE_LABEL,
  cadenceUnitLabel,
  describeCadence,
  describeNudge,
  fromCadenceParts,
  nudgeFieldsFor,
  nudgeModeOf,
  toCadenceParts,
  withCadenceUnit,
  type NudgeMode,
} from '../utils/nudgeCadence';

const NUDGE_MODE_OPTIONS: SegmentOption<NudgeMode>[] = NUDGE_MODES.map(mode => ({
  value: mode,
  label: NUDGE_MODE_LABEL[mode],
}));

/**
 * One line per answer, under the track. These say what the app will *do*,
 * because the labels can't: "When I ask" and "Every…" are the difference
 * between a project that waits to be looked for and one that comes to you, and
 * neither three-word label carries that on its own.
 */
const NUDGE_MODE_HINT: Record<NudgeMode, string> = {
  never: 'Stays out of "Pull from projects" and never writes a review task. For a list you keep rather than work through, like gift ideas.',
  'on-ask': 'Shows up in "Pull from projects" when you open it, and never brings itself up.',
  scheduled: 'Adds a review task once it has gone this long with nothing scheduled.',
};

interface Props {
  visible: boolean;
  project: Project | null;
  /** Titles the sheet "New project" — set when arriving from quick add's "More details". */
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
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  // The away span (see Project.awayStart). Held as two dates rather than one
  // range because that is what the columns are, and because the end is
  // optional in a way the start is not.
  const [awayStart, setAwayStart] = useState<Date | null>(null);
  const [awayEnd, setAwayEnd] = useState<Date | null>(null);
  const [pickingAway, setPickingAway] = useState<'start' | 'end' | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  // Collapsed to the chosen category until tapped, like every other editor.
  const [categoryOpen, setCategoryOpen] = useState(false);
  // The merged nudge control: one chosen answer, plus the cadence the third of
  // them counts in. The cadence is held positive whatever the project stored,
  // so switching to "Every…" always lands on a real interval rather than on a
  // schedule that can never fire (see nudgeFieldsFor).
  const [nudgeMode, setNudgeMode] = useState<NudgeMode>('never');
  const [nudgeCadenceDays, setNudgeCadenceDays] = useState(FALLBACK_CADENCE_DAYS);
  const [autoSchedule, setAutoSchedule] = useState(false);
  const [ongoing, setOngoing] = useState(false);
  const [weekendSource, setWeekendSource] = useState(false);
  const [cadenceOpen, setCadenceOpen] = useState(false);

  useEffect(() => {
    if (!project) return;
    setTitle(project.title);
    setNotes(project.notes);
    setCategory(project.category);
    setDeadline(project.deadline ? new Date(project.deadline) : null);
    setAwayStart(project.awayStart ? new Date(project.awayStart) : null);
    setAwayEnd(project.awayEnd ? new Date(project.awayEnd) : null);
    setPickingAway(null);
    setNudgeMode(nudgeModeOf(project));
    setNudgeCadenceDays(project.nudgeCadenceDays > 0 ? project.nudgeCadenceDays : FALLBACK_CADENCE_DAYS);
    setAutoSchedule(project.autoSchedule);
    setOngoing(project.ongoing);
    setWeekendSource(project.weekendSource);
    setCategoryOpen(false);
    setCadenceOpen(false);
  }, [project]);

  const closeCategory = () => { animateLayout(); setCategoryOpen(false); };

  // The cadence is stored in days; the picker shows it as a count and a unit.
  const cadence = toCadenceParts(nudgeCadenceDays);

  // Done can fire before the new-category field's own blur or Enter has
  // committed it — same race TaskEditor's resolveLinkUrl guards against.
  // Read the live text box instead of trusting stale `category` state.
  const resolveCategory = () => {
    const c = newCategory.trim();
    if (addingCategory && c) {
      addCategory(c);
      return c;
    }
    return category;
  };

  const saveAndClose = () => {
    if (!project) { onClose(); return; }
    const trimmed = title.trim();
    updateProject(project.id, {
      // A blank name is refused, but it must not take the rest of the sheet
      // with it. The whole `updateProject` used to sit behind `if (trimmed)`,
      // so clearing the title on an existing project — a stray select-all, a
      // fumbled backspace — silently dropped the dates, category, notes and
      // every toggle changed in the same session, with no alert and nothing on
      // screen to say so (the stored title comes back on reopen, so the sheet
      // looked untouched). Falling back to the stored title keeps the refusal
      // and commits everything else.
      //
      // A project created from quick add's "More details" is stored with a
      // blank title until it's named, so this writes '' back for that one —
      // which is exactly what ProjectsScreen's handleEditorClose still reads to
      // discard a row that never got a name.
      title: trimmed || project.title,
      notes,
      category: resolveCategory(),
      deadline: deadline ? deadline.toISOString() : null,
      // Stored at midday so a flight cannot move either boundary by a calendar
      // day, and the end is dropped without a start because on its own it is
      // indistinguishable from the deadline above. See utils/awayDates.
      awayStart: awayStart ? awayNoonIso(awayStart) : null,
      awayEnd: awayStart && awayEnd ? awayNoonIso(awayEnd) : null,
      ...nudgeFieldsFor(nudgeMode, nudgeCadenceDays),
      // Anything but a scheduled cadence leaves nothing for auto-scheduling to
      // trigger on, so the two can't disagree about whether this project is
      // managed. The drip's own gate stays in 'nudge' mode for the same reason
      // (see dripCandidate) — this just means it is never asked.
      autoSchedule: nudgeMode === 'scheduled' && autoSchedule,
      ongoing,
      weekendSource,
    });
    onClose();
  };

  const handleDelete = () => {
    if (!project) return;
    Alert.alert(
      `Delete "${project.title}"?`,
      'Its tasks can stay in your list without a project, or be deleted with it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete project only', onPress: () => { deleteProject(project.id, { cascade: false }); onClose(); } },
        {
          text: 'Delete project and tasks',
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
      `Complete "${project.title}"?`,
      `It still has ${remaining.length} open ${remaining.length === 1 ? 'task' : 'tasks'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave remaining tasks', onPress: () => finish(false) },
        { text: 'Archive remaining tasks', onPress: () => finish(true) },
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
          <Text style={styles.headerTitle}>{isNew ? 'New project' : 'Edit project'}</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete project">
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </>
      }
      footer={
        <>
          <WhenPicker
            visible={showDeadlinePicker}
            value={deadline}
            title="Deadline"
            showTimeOfDay={false}
            showSuggest={false}
            onConfirm={(date) => { setDeadline(date); setShowDeadlinePicker(false); }}
            onClear={() => { setDeadline(null); setShowDeadlinePicker(false); }}
            onCancel={() => setShowDeadlinePicker(false)}
          />
          <WhenPicker
            visible={pickingAway !== null}
            value={pickingAway === 'end' ? awayEnd : awayStart}
            title={pickingAway === 'end' ? 'Coming back' : 'Leaving'}
            showTimeOfDay={false}
            showSuggest={false}
            onConfirm={(date) => {
              if (pickingAway === 'end') {
                // Only a return strictly after the departure is kept, matching
                // awaySpanOf's own refusal — an end on or before the start is
                // a typo, and a span that contains no days is not one anybody
                // entered on purpose. Backdating is still allowed for both:
                // recording a trip that has already happened is a real thing
                // to do, which is why allowPast is left at its default.
                setAwayEnd(date && awayStart && date > awayStart ? date : null);
              } else {
                setAwayStart(date);
                // A return before the new departure stops meaning anything, so
                // it goes rather than being left to be silently ignored.
                if (date && awayEnd && awayEnd <= date) setAwayEnd(null);
              }
              setPickingAway(null);
            }}
            onClear={() => {
              if (pickingAway === 'end') setAwayEnd(null);
              // Clearing the departure clears the return with it: an end with
              // no start is dropped on save anyway, and leaving it on screen
              // would show a value that no longer means anything.
              else { setAwayStart(null); setAwayEnd(null); }
              setPickingAway(null);
            }}
            onCancel={() => setPickingAway(null)}
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
                placeholder="Category name"
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
          icon="flag-outline"
          label="Deadline"
          value={deadline ? formatDeadlineDate(deadline.toISOString()) : undefined}
          onPress={() => setShowDeadlinePicker(true)}
          onClear={deadline ? () => setDeadline(null) : undefined}
        />
      </View>
      {/* Same flag icon and the same word a task's own deadline uses, because
          it is the same idea one container out. It replaced a "Start date" /
          "Target date" pair whose first half had one reader in its life (see
          Project.deadline) — #1740 had to add a paragraph here denying that
          either of them scheduled anything, and half of that paragraph went
          with the field it was denying. */}
      <Text style={styles.sectionFooter}>
        Optional. Shown on the project's card, with no effect on scheduling or when tasks appear. If it passes before the project's done, nothing happens automatically; it's just flagged so you can decide what to do.
      </Text>

      {/* The away span. Two rows rather than one range control because the end
          is genuinely optional: a trip you have booked a flight out for and
          not back from is a real state, and it is the one LookAheadWindow
          already calls "a boundary but not a trip". The return row only
          appears once there is a departure, so the asymmetry is visible
          instead of being enforced by silently dropping what you typed. */}
      <View style={[styles.card, { marginTop: spacing.lg }]}>
        <EditorRow
          icon="airplane-outline"
          label="Leaving"
          value={awayStart ? formatDeadlineDate(awayStart.toISOString()) : undefined}
          onPress={() => setPickingAway('start')}
          onClear={awayStart ? () => { setAwayStart(null); setAwayEnd(null); } : undefined}
        />
        {awayStart && (
          <EditorRow
            icon="home-outline"
            label="Coming back"
            value={awayEnd ? formatDeadlineDate(awayEnd.toISOString()) : undefined}
            onPress={() => setPickingAway('end')}
            onClear={awayEnd ? () => setAwayEnd(null) : undefined}
          />
        )}
      </View>
      <Text style={styles.sectionFooter}>
        The days you're away from home. Look ahead uses them to show what's due while you're gone, and the project's card counts down to the day you leave. The day you come back doesn't count as a day away.
      </Text>

      {/* One question, three answers. "Include in nudges" and "Review cadence"
          used to be a switch and a stepper nested inside it, which took two
          controls to say one thing and let them be set into combinations
          nobody chose — see NudgeMode in utils/nudgeCadence. */}
      <View style={[styles.sectionCard, { marginTop: spacing.lg }]}>
        <CollapsibleField
          label="Bring this up"
          summary={describeNudge(nudgeFieldsFor(nudgeMode, nudgeCadenceDays))}
          hint="A project's tasks only reach Today once they have a date, so a project with nothing scheduled goes quiet. This is what happens when it does."
          expanded={cadenceOpen}
          onToggle={() => setCadenceOpen(v => !v)}
        >
          <View style={styles.modeBlock}>
            <SegmentedControl
              label="Bring this up"
              options={NUDGE_MODE_OPTIONS}
              value={nudgeMode}
              onChange={next => { animateLayout(); setNudgeMode(next); }}
            />
            <Text style={styles.modeHint}>{NUDGE_MODE_HINT[nudgeMode]}</Text>
          </View>

          {nudgeMode === 'scheduled' && (
            <View style={styles.cadenceRow}>
              <CountStepper
                value={cadence.count}
                onChange={next => setNudgeCadenceDays(fromCadenceParts({ ...cadence, count: next }))}
                min={1}
                max={CADENCE_UNIT_MAX[cadence.unit]}
                label="Review cadence"
                describeValue={n => describeCadence(fromCadenceParts({ ...cadence, count: n }))}
              />
              {/* No allowNull on the stepper: the track above is where Never
                  lives now, and two controls clearing to the same state is the
                  ambiguity this merge removed. */}
              <View style={styles.pillRow}>
                {CADENCE_UNITS.map(unit => {
                  const active = cadence.unit === unit;
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
          )}
        </CollapsibleField>
      </View>

      {nudgeMode === 'scheduled' && (
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

      {/*
        Whether this project is a list lives on its own screen now — the
        list-outline toggle in ProjectDetailScreen's header, right where its
        effect shows — not here. See Project.kind.
      */}

      <View style={[styles.card, { marginTop: spacing.xl }]}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setOngoing(v => !v); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Ongoing"
          accessibilityState={{ checked: ongoing }}
        >
          <Ionicons name="infinite-outline" size={18} color={ongoing ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Ongoing</Text>
            <Text style={styles.optionHint}>
              {ongoing
                ? "Never offered as complete, however many tasks are done"
                : "Offers to mark complete once every task is done"}
            </Text>
          </View>
          <View style={[styles.toggle, ongoing && styles.toggleOn]}>
            <View style={[styles.toggleKnob, ongoing && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setWeekendSource(v => !v); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Suggest for a free weekend"
          accessibilityState={{ checked: weekendSource }}
        >
          <Ionicons name="sunny-outline" size={18} color={weekendSource ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Suggest for a free weekend</Text>
            <Text style={styles.optionHint}>
              {weekendSource
                ? 'The weekend task names this project when a weekend has nothing on it'
                : 'The weekend task does not name this project'}
            </Text>
          </View>
          <View style={[styles.toggle, weekendSource && styles.toggleOn]}>
            <View style={[styles.toggleKnob, weekendSource && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>

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
    // No lineHeight on a TextInput. RN maps it onto the iOS paragraph style's
    // minimum/maximum line height with no compensating baseline offset, so the
    // glyphs are drawn a full line height below the top of the line box rather
    // than one ascent below it: the notes sat low in the field while the caret
    // stayed centred, and the placeholder inherited the same attributes so an
    // empty field looked wrong too. The minHeight above is what keeps the box
    // the size the lineHeight used to imply.
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
  modeBlock: { marginTop: spacing.md, gap: spacing.sm },
  modeHint: { color: colors.textTertiary, fontSize: font.xs },
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
  pillText: { color: colors.text, fontSize: font.sm, fontWeight: '500' },
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
    backgroundColor: colors.bgQuaternary, padding: 2, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.bg,
  },
  toggleKnobOn: { alignSelf: 'flex-end' },
});
