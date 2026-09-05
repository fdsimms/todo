import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  PanResponder,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from './SafeBlurView';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { SheetScrim } from './SheetScrim';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { formatDeadlineDate } from '../utils/dateUtils';
import {
  awayShiftUpdates,
  buildAwayShiftPlan,
  describeAwayShift,
  hasAnchoredMember,
  type AwayShiftPlan,
} from '../utils/awayShift';
import type { Task } from '../types';

/**
 * "The trip moved. Do these move with it?"
 *
 * Offered when a project's departure date changes and it has dated members.
 * It proposes and never shifts, for the reason `deloadPlan` and `projectPull`
 * do: only the person who typed them knows that "Renew passport" is anchored
 * to the trip and "Buy a suitcase" is not. So every movable row is untickable.
 *
 * Blocked rows follow `buildPushPlan` exactly rather than inventing a third
 * reading. A **soft** blocker (a live streak, a task already started today,
 * high priority, someone else involved) still gets a destination and is merely
 * offered unticked. A **hard** one (pinned, a running timer, urgent, a daily
 * target, a mid-chain step) gets none and cannot be moved from here, and it is
 * still *listed* so the sheet can say why the trip's work did not all travel
 * with it.
 *
 * The rules live in `src/utils/awayShift.ts`; this owns only the choosing.
 */

interface Props {
  visible: boolean;
  /** The project's members, dated or not. Filtered by the plan. */
  tasks: readonly Task[];
  /** Where the departure was, and where it has just been moved to. */
  from: Date | null;
  to: Date | null;
  projectTitle: string;
  onClose: () => void;
}

export function AwayShiftSheet({ visible, tasks, from, to, projectTitle, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const shiftAwayTasks = useTaskStore(s => s.shiftAwayTasks);

  // Computed once per opening, not derived live: it is a snapshot the reader
  // is deciding on, the same rule ProjectPullSheet's plan follows.
  const [plan, setPlan] = useState<AwayShiftPlan | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const hiddenY = useSheetHiddenOffset();
  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible || !from || !to) return;
    const next = buildAwayShiftPlan(tasks, from, to, dayResetTime);
    setPlan(next);
    setSelectedIds(new Set(next.proposals.filter(p => p.selected && p.destination).map(p => p.task.id)));
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // Keyed on `visible` alone, same as the sheets beside it.
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
    });
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

  const toggle = (id: string) => {
    haptics.tap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    if (!plan) return;
    const moves = plan.proposals
      .filter(p => selectedIds.has(p.task.id))
      .map(p => ({ id: p.task.id, updates: awayShiftUpdates(p, dayResetTime) }))
      .filter((m): m is { id: string; updates: Partial<Task> } => m.updates !== null);
    if (moves.length > 0) {
      haptics.success();
      shiftAwayTasks(moves);
    }
    dismiss();
  };

  if (!plan) return null;
  const selectedCount = plan.proposals.filter(p => selectedIds.has(p.task.id)).length;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={dismiss} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <View style={styles.header}>
            {/* The project's own name, with the change stated in the hint
                below: "<title> moved" reads as the last word of the title
                being the verb. */}
            <Text style={styles.sheetTitle} numberOfLines={1}>{projectTitle}</Text>
          </View>
          <Text style={styles.hint}>
            {describeAwayShift(plan)}. Tap to include or skip anything that shouldn't move.
          </Text>
          {hasAnchoredMember(plan) && (
            <Text style={styles.hint}>
              A repeating task moves this one time. Its schedule stays where it is.
            </Text>
          )}

          <ScrollView style={styles.list} bounces={false}>
            {plan.proposals.map((p, i) => {
              const on = selectedIds.has(p.task.id);
              const movable = p.destination !== null;
              return (
                <React.Fragment key={p.task.id}>
                  {i > 0 && <View style={styles.sep} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => movable && toggle(p.task.id)}
                    disabled={!movable}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: !movable }}
                    accessibilityLabel={
                      movable
                        ? `${p.task.title}, moving to ${formatDeadlineDate(p.destination!.toISOString(), dayResetTime)}`
                        : `${p.task.title}, cannot move: ${p.blockerLabel ?? 'blocked'}`
                    }
                  >
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={iconSize.md}
                      color={on ? colors.accent : colors.textTertiary}
                    />
                    <View style={styles.rowContent}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{p.task.title}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {movable
                          ? `${formatDeadlineDate(p.from.toISOString(), dayResetTime)} → ${formatDeadlineDate(p.destination!.toISOString(), dayResetTime)}`
                          : p.blockerLabel}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={[styles.applyBtn, selectedCount === 0 && styles.applyBtnOff]}
            onPress={handleApply}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={selectedCount === 0 ? 'Nothing selected' : `Move ${selectedCount} tasks`}
          >
            <Text style={[styles.applyLabel, selectedCount === 0 && styles.applyLabelOff]}>
              {selectedCount === 0
                ? 'Nothing selected'
                : `Move ${selectedCount} task${selectedCount === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Leave them where they are</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  handleArea: { alignItems: 'center', paddingVertical: spacing.sm },
  handle: { width: 36, height: 5, borderRadius: 2.5, backgroundColor: colors.textTertiary },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, padding: spacing.md },
  header: { marginBottom: spacing.xs },
  sheetTitle: { fontSize: font.lg, fontWeight: fontWeight.semibold, color: colors.text },
  hint: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  list: { maxHeight: 320 },
  sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: font.md, color: colors.text },
  rowMeta: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2 },
  applyBtn: { marginTop: spacing.md, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' },
  applyBtnOff: { backgroundColor: colors.bgTertiary },
  applyLabel: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.onAccent },
  // onAccent is white in both themes, so it needs replacing rather than
  // riding on the muted fill.
  applyLabelOff: { color: colors.textSecondary },
  cancelCard: { marginTop: spacing.sm, backgroundColor: colors.bgSecondary, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' },
  cancelLabel: { fontSize: font.md, color: colors.accent },
});
