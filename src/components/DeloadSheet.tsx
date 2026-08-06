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
import { spacing, radius, font, fontWeight, lineHeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatDuration } from '../utils/effort';
import { buildDeloadPlan, deloadUpdates, type DeloadProposal } from '../utils/deloadPlan';
import { useTaskStore } from '../store/useTaskStore';
import { WhenPicker } from './WhenPicker';
import type { Task } from '../types';

interface Props {
  visible: boolean;
  /** The tasks currently on the day being lightened (TodayScreen's visible list). */
  todaysTasks: readonly Task[];
  onClose: () => void;
}

/**
 * "Lighten this day" — proposes a destination for each task on today that can
 * move, and commits only what the user checks.
 *
 * Deliberately a proposal the user approves row by row rather than a one-tap
 * bulk action: the previous take on this (#356) picked tasks with an AI call
 * and moved them all to tomorrow, leaving nothing to inspect beforehand and
 * only a blanket undo afterward. Every row here shows where the task is going
 * and why, blocked rows show what's holding them, and tapping a row opens the
 * normal date picker to override the destination by hand.
 */
export function DeloadSheet({ visible, todaysTasks, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allTasks = useTaskStore(s => s.tasks);
  const deloadTasks = useTaskStore(s => s.deloadTasks);

  // The plan is computed once per opening, not derived live: it's a snapshot
  // the user is deciding on, and re-running it as the store changes underneath
  // would reshuffle destinations mid-review.
  const [plan, setPlan] = useState<ReturnType<typeof buildDeloadPlan> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Date>>({});
  const [pickerTarget, setPickerTarget] = useState<DeloadProposal | null>(null);

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const next = buildDeloadPlan(todaysTasks, allTasks);
    setPlan(next);
    setSelectedIds(new Set(next.proposals.filter(p => p.selected).map(p => p.task.id)));
    setOverrides({});
    setPickerTarget(null);
    translateY.setValue(600);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // Keyed on `visible` alone — deliberately not on todaysTasks/allTasks, so
    // the plan is a snapshot taken at open rather than a live derivation.
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
  // once causes touch conflicts (same choreography as ApplyTemplateSheet).
  const openPicker = (proposal: DeloadProposal) => {
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

  /** The destination actually in play for a row — a hand-picked override wins. */
  const destinationFor = (p: DeloadProposal): Date | null => overrides[p.task.id] ?? p.date;

  const toggle = (p: DeloadProposal) => {
    if (!destinationFor(p)) return;
    haptics.tap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(p.task.id)) next.delete(p.task.id);
      else next.add(p.task.id);
      return next;
    });
  };

  const selected = plan.proposals.filter(p => selectedIds.has(p.task.id) && destinationFor(p));
  const movedMinutes = selected.reduce((sum, p) => sum + p.minutes, 0);
  const projected = plan.currentMinutes - movedMinutes;

  const handleApply = () => {
    if (selected.length === 0) return;
    haptics.success();
    const moves = selected
      .map(p => {
        const updates = deloadUpdates({ ...p, date: destinationFor(p) });
        return updates ? { id: p.task.id, updates } : null;
      })
      .filter((m): m is { id: string; updates: Partial<Task> } => m !== null);
    animateLayout();
    deloadTasks(moves);
    dismiss();
  };

  const movable = plan.proposals.filter(p => destinationFor(p) !== null);
  const blocked = plan.proposals.filter(p => destinationFor(p) === null);

  const renderRow = (p: DeloadProposal) => {
    const dest = destinationFor(p);
    const checked = selectedIds.has(p.task.id);
    const isOverridden = overrides[p.task.id] !== undefined;

    if (!dest) {
      return (
        <View key={p.task.id} style={styles.row}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.textTertiary} />
          <View style={styles.rowContent}>
            <Text style={[styles.rowTitle, styles.rowTitleBlocked]} numberOfLines={1}>{p.task.title}</Text>
            <Text style={styles.rowSub} numberOfLines={1}>{p.blockerLabel}</Text>
          </View>
          <Text style={styles.rowMinutes}>{formatDuration(p.minutes)}</Text>
        </View>
      );
    }

    const dayLabel = isOverridden
      ? dest.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : p.dayLabel;
    // A soft blocker (a streak, a high priority) is why the row starts
    // unchecked, so it stays visible in place of the engine's reason — the
    // user needs to see what they'd be overriding, not why the day is nice.
    const detail = isOverridden ? 'moved by hand' : p.blockerLabel ?? p.reason;

    return (
      <TouchableOpacity
        key={p.task.id}
        style={styles.row}
        onPress={() => toggle(p)}
        onLongPress={() => openPicker(p)}
        delayLongPress={interaction.delayLongPress}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`${p.task.title}, move to ${dayLabel}${detail ? `, ${detail}` : ''}`}
        accessibilityHint="Long press to pick a different day"
      >
        <Ionicons
          name={checked ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={checked ? colors.accent : colors.textTertiary}
        />
        <View style={styles.rowContent}>
          <Text style={[styles.rowTitle, !checked && styles.rowTitleUnchecked]} numberOfLines={1}>
            {p.task.title}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            <Text style={styles.rowDest}>{dayLabel}</Text>
            {detail ? ` · ${detail}` : ''}
          </Text>
        </View>
        <Text style={styles.rowMinutes}>{formatDuration(p.minutes)}</Text>
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
            <Text style={styles.sheetTitle}>Lighten today</Text>
            <View style={styles.totalRow}>
              <Text style={styles.totalFrom}>{formatDuration(plan.currentMinutes)}</Text>
              <Ionicons name="arrow-forward" size={13} color={colors.textTertiary} />
              <Text style={styles.totalTo}>{formatDuration(projected)}</Text>
            </View>
          </View>

          {plan.proposals.length === 0 ? (
            <Text style={styles.emptyHint}>Nothing on today to move.</Text>
          ) : movable.length === 0 ? (
            <Text style={styles.emptyHint}>
              Nothing on today can move — everything here is pinned, urgent, or already underway.
            </Text>
          ) : (
            <Text style={styles.hint}>Tap to include or skip. Long press to pick a different day.</Text>
          )}

          <ScrollView style={styles.list} bounces={false}>
            {movable.map((p, i) => (
              <React.Fragment key={p.task.id}>
                {i > 0 && <View style={styles.sep} />}
                {renderRow(p)}
              </React.Fragment>
            ))}

            {blocked.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>STAYING PUT</Text>
                {blocked.map((p, i) => (
                  <React.Fragment key={p.task.id}>
                    {i > 0 && <View style={styles.sep} />}
                    {renderRow(p)}
                  </React.Fragment>
                ))}
              </>
            )}
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
                : `Move ${selected.length} task${selected.length === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>

      <WhenPicker
        visible={pickerTarget !== null}
        value={pickerTarget ? destinationFor(pickerTarget) : null}
        title="Move to"
        showTimeOfDay={false}
        taskId={pickerTarget?.task.id}
        taskTitle={pickerTarget?.task.title}
        taskNotes={pickerTarget?.task.notes}
        taskTags={pickerTarget?.task.tags}
        taskCategory={pickerTarget?.task.category}
        taskPriority={pickerTarget?.task.priority}
        taskEffort={pickerTarget?.task.effort}
        taskEstimatedMinutes={pickerTarget?.task.estimatedMinutes}
        onConfirm={date => {
          if (pickerTarget && date) {
            const noon = new Date(date);
            noon.setHours(12, 0, 0, 0);
            const id = pickerTarget.task.id;
            setOverrides(prev => ({ ...prev, [id]: noon }));
            // Picking a day by hand is an opt-in, including for a row that
            // started unchecked because of a streak.
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
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  totalFrom: { color: colors.textTertiary, fontSize: font.sm },
  totalTo: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.semibold },
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
  list: { maxHeight: 340 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  rowContent: { flex: 1, gap: 1 },
  rowTitle: { color: colors.text, fontSize: font.md, lineHeight: lineHeight.md },
  rowTitleUnchecked: { color: colors.textSecondary },
  rowTitleBlocked: { color: colors.textTertiary },
  rowSub: { color: colors.textTertiary, fontSize: font.xs },
  rowDest: { color: colors.textSecondary, fontWeight: fontWeight.medium },
  rowMinutes: { color: colors.textTertiary, fontSize: font.xs },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
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
