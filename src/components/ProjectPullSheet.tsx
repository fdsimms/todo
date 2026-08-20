import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from './SafeBlurView';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  buildProjectPullPlan,
  describePullEmpty,
  projectPullUpdates,
  suggestPullDate,
  type ProjectPullProposal,
} from '../utils/projectPull';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { WhenPicker } from './WhenPicker';
import type { Task } from '../types';

interface Props {
  visible: boolean;
  /** Today's visible list — decides whether a pull lands today or on a lighter day. */
  todaysTasks: readonly Task[];
  /**
   * Restricts the plan to these project ids — set when opened from the
   * quiet-project nudge, which is already about a specific project or two,
   * not an invitation to browse every stalled project on the board.
   */
  scopeProjectIds?: readonly string[];
  onClose: () => void;
}

/**
 * "Pull from projects" — the mirror of DeloadSheet. Where that one proposes
 * somewhere for today's tasks to go, this proposes something to bring in from
 * a project that has gone quiet.
 *
 * One row per project, never more than three, so a board with twenty projects
 * asks exactly as calmly as a board with three (see MAX_PULLED_PROJECTS). Each
 * row offers that project's three best candidates — tap the title to cycle —
 * because the app's guess at "the next thing" is worth offering but not worth
 * insisting on.
 *
 * Gestures match DeloadSheet exactly: tap to include or skip, long press to
 * pick a different day. Cycling is the one thing this sheet does that that one
 * doesn't, so it gets its own visible affordance instead of a third gesture.
 */
export function ProjectPullSheet({ visible, todaysTasks, scopeProjectIds, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allTasks = useTaskStore(s => s.tasks);
  const projects = useProjectStore(s => s.projects);
  const pullProjectTasks = useTaskStore(s => s.pullProjectTasks);
  const forgivVacationStreaks = useTaskStore(s => s.forgivVacationStreaks);
  const setVacationMode = useSettingsStore(s => s.setVacationMode);

  // The plan is computed once per opening, not derived live: it's a snapshot
  // the user is deciding on, and re-running it as the store changes underneath
  // would reshuffle the rows mid-review.
  const [plan, setPlan] = useState<ReturnType<typeof buildProjectPullPlan> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [candidateIndex, setCandidateIndex] = useState<Record<string, number>>({});
  const [overrides, setOverrides] = useState<Record<string, Date>>({});
  const [pickerTarget, setPickerTarget] = useState<ProjectPullProposal | null>(null);

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const next = buildProjectPullPlan(projects, allTasks, todaysTasks, scopeProjectIds);
    setPlan(next);
    setSelectedIds(new Set(next.proposals.filter(p => p.selected).map(p => p.project.id)));
    setCandidateIndex({});
    setOverrides({});
    setPickerTarget(null);
    translateY.setValue(600);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // Keyed on `visible` alone — deliberately not on the store, same as DeloadSheet.
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 700, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(600);
      onClose();
    });
  };

  // Slide the sheet away before showing the date picker — rendering both at
  // once causes touch conflicts (same choreography as DeloadSheet).
  const openPicker = (proposal: ProjectPullProposal) => {
    haptics.tap();
    Animated.spring(translateY, {
      toValue: 700,
      ...animation.spring.sheetDismiss,
      useNativeDriver: true,
    }).start(() => setPickerTarget(proposal));
  };

  const restoreSheet = () => {
    setPickerTarget(null);
    Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) dismiss();
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      },
    })
  ).current;

  if (!plan) return null;

  /** The candidate actually in play for a row. */
  const candidateFor = (p: ProjectPullProposal): Task =>
    p.candidates[(candidateIndex[p.project.id] ?? 0) % p.candidates.length];

  /**
   * The destination in play — a hand-picked override wins, otherwise the
   * suggestion is recomputed for whichever candidate is showing, since a
   * different task can warrant a different day.
   */
  const destinationFor = (p: ProjectPullProposal) => {
    const override = overrides[p.project.id];
    if (override) return { date: override, dayLabel: null, reason: 'moved by hand' };
    const index = candidateIndex[p.project.id] ?? 0;
    if (index === 0) return p.suggestion;
    return suggestPullDate(candidateFor(p), allTasks, todaysTasks, p.quietDays);
  };

  const toggle = (p: ProjectPullProposal) => {
    haptics.tap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(p.project.id)) next.delete(p.project.id);
      else next.add(p.project.id);
      return next;
    });
  };

  const cycle = (p: ProjectPullProposal) => {
    if (p.candidates.length < 2) return;
    haptics.tap();
    setCandidateIndex(prev => ({
      ...prev,
      [p.project.id]: ((prev[p.project.id] ?? 0) + 1) % p.candidates.length,
    }));
    // Cycling replaces the task this row is about, so a day picked for the
    // previous one no longer applies.
    setOverrides(prev => {
      if (!(p.project.id in prev)) return prev;
      const next = { ...prev };
      delete next[p.project.id];
      return next;
    });
  };

  const selected = plan.proposals.filter(p => selectedIds.has(p.project.id));

  const handleApply = () => {
    if (selected.length === 0) return;
    haptics.success();
    const moves = selected.map(p => ({
      id: candidateFor(p).id,
      updates: projectPullUpdates(destinationFor(p).date),
    }));
    animateLayout();
    pullProjectTasks(moves);
    dismiss();
  };

  // Same sequence Settings uses to turn vacation mode off (protected streaks
  // are forgiven first, or a paused daily habit would read as broken the
  // moment the pause lifts). Rebuilds the plan in place rather than closing
  // the sheet, since the whole point is answering "what would I pull" right
  // where the question was asked.
  const handleTurnOffVacation = () => {
    haptics.tap();
    forgivVacationStreaks();
    setVacationMode(false);
    const next = buildProjectPullPlan(projects, allTasks, todaysTasks, scopeProjectIds);
    setPlan(next);
    setSelectedIds(new Set(next.proposals.filter(p => p.selected).map(p => p.project.id)));
  };

  const renderRow = (p: ProjectPullProposal) => {
    const task = candidateFor(p);
    const dest = destinationFor(p);
    const checked = selectedIds.has(p.project.id);
    const index = candidateIndex[p.project.id] ?? 0;
    const dayLabel =
      dest.dayLabel ??
      dest.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    return (
      <TouchableOpacity
        key={p.project.id}
        style={styles.row}
        onPress={() => toggle(p)}
        onLongPress={() => openPicker(p)}
        delayLongPress={interaction.delayLongPress}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`${task.title}, from ${p.project.title}, quiet ${p.quietDays} days, schedule for ${dayLabel}`}
        accessibilityHint="Long press to pick a different day"
      >
        <Ionicons
          name={checked ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={checked ? colors.accent : colors.textTertiary}
        />
        <View style={styles.rowContent}>
          <Text style={styles.rowProject} numberOfLines={1}>
            {p.project.title.toUpperCase()}
          </Text>
          <Text style={[styles.rowTitle, !checked && styles.rowTitleUnchecked]} numberOfLines={1}>
            {task.title}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            <Text style={styles.rowDest}>{dayLabel}</Text>
            {dest.reason ? ` · ${dest.reason}` : ''}
          </Text>
        </View>
        {p.candidates.length > 1 && (
          <TouchableOpacity
            style={styles.cycleBtn}
            onPress={() => cycle(p)}
            // The row's own tap target surrounds this one, so a near miss
            // would toggle the row instead of cycling it — worth the generous
            // slop even though the pill itself is already 44pt tall.
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Try a different task from ${p.project.title}, showing ${index + 1} of ${p.candidates.length}`}
          >
            <Ionicons name="swap-horizontal" size={iconSize.md} color={colors.accent} />
            <Text style={styles.cycleText}>{index + 1}/{p.candidates.length}</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.sheetTitle}>Pull from projects</Text>
            {plan.overflowCount > 0 && (
              <Text style={styles.overflow}>+{plan.overflowCount} more waiting</Text>
            )}
          </View>

          {plan.proposals.length === 0 ? (
            <>
              <Text style={styles.emptyHint}>
                {plan.empty ? describePullEmpty(plan.empty) : 'Nothing waiting.'}
              </Text>
              {plan.empty?.reason === 'vacation' && (
                <TouchableOpacity
                  style={styles.vacationOffBtn}
                  onPress={handleTurnOffVacation}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel="Turn off vacation mode"
                >
                  <Text style={styles.vacationOffText}>Turn off vacation mode</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={styles.hint}>Tap to include or skip. Long press to pick a different day.</Text>
          )}

          <ScrollView style={styles.list} bounces={false}>
            {plan.proposals.map((p, i) => (
              <React.Fragment key={p.project.id}>
                {i > 0 && <View style={styles.sep} />}
                {renderRow(p)}
              </React.Fragment>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[styles.applyBtn, selected.length === 0 && styles.applyBtnDisabled]}
            onPress={handleApply}
            disabled={selected.length === 0}
            activeOpacity={interaction.activeOpacity}
          >
            <Text style={[styles.applyBtnText, selected.length === 0 && styles.applyBtnTextDisabled]}>
              {selected.length === 0
                ? 'Nothing selected'
                : `Pull in ${selected.length} task${selected.length === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>

      <WhenPicker
        visible={pickerTarget !== null}
        value={pickerTarget ? destinationFor(pickerTarget).date : null}
        title="Schedule for"
        showTimeOfDay={false}
        taskId={pickerTarget ? candidateFor(pickerTarget).id : undefined}
        taskTitle={pickerTarget ? candidateFor(pickerTarget).title : undefined}
        taskNotes={pickerTarget ? candidateFor(pickerTarget).notes : undefined}
        taskTags={pickerTarget ? candidateFor(pickerTarget).tags : undefined}
        taskCategory={pickerTarget ? candidateFor(pickerTarget).category : undefined}
        taskPriority={pickerTarget ? candidateFor(pickerTarget).priority : undefined}
        taskEffort={pickerTarget ? candidateFor(pickerTarget).effort : undefined}
        taskEstimatedMinutes={pickerTarget ? candidateFor(pickerTarget).estimatedMinutes : undefined}
        onConfirm={date => {
          if (pickerTarget && date) {
            const noon = new Date(date);
            noon.setHours(12, 0, 0, 0);
            const id = pickerTarget.project.id;
            setOverrides(prev => ({ ...prev, [id]: noon }));
            // Picking a day by hand is an opt-in for a row that was skipped.
            setSelectedIds(prev => new Set(prev).add(id));
          }
          restoreSheet();
        }}
        onCancel={restoreSheet}
      />
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.bgQuaternary },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sheetTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  overflow: { color: colors.textTertiary, fontSize: font.xs },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  emptyHint: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  vacationOffBtn: {
    alignSelf: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.accentSubtle,
  },
  vacationOffText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.semibold },
  list: { maxHeight: 340 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  rowContent: { flex: 1, gap: 1 },
  rowProject: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
  },
  rowTitle: { color: colors.text, fontSize: font.md, lineHeight: lineHeight.md },
  rowTitleUnchecked: { color: colors.textSecondary },
  rowSub: { color: colors.textTertiary, fontSize: font.xs },
  rowDest: { color: colors.textSecondary, fontWeight: fontWeight.medium },
  // Cycling is the one thing this sheet does that DeloadSheet doesn't, so it
  // gets a tinted pill rather than a bare glyph: at textTertiary on a 16pt icon
  // it read as decoration, and it's the only way to see the other two picks.
  cycleBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    minWidth: 52,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accentSubtle,
  },
  cycleText: { color: colors.accent, fontSize: font.xs, fontWeight: fontWeight.semibold },
  sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
  applyBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    margin: spacing.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  applyBtnDisabled: { backgroundColor: colors.bgTertiary },
  applyBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  applyBtnTextDisabled: { color: colors.textTertiary },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
});
