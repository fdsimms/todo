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
import { formatDuration, sumEstimatedMinutes } from '../utils/effort';
import {
  buildPinContext,
  nextPinSuggestion,
  pinReason,
  suggestPins,
  MAX_SUGGESTED_PINS,
} from '../utils/pinSuggest';
import { useTaskStore } from '../store/useTaskStore';
import { PinIcon } from './PinIcon';
import { SheetScrim } from './SheetScrim';
import type { Task } from '../types';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { activeChainStep } from '../utils/chain';

interface Props {
  visible: boolean;
  /** The tasks in play — TodayScreen's visible list. */
  tasks: readonly Task[];
  /** What's already pinned, which is both the gap to fill and scoring company. */
  pinnedTasks: readonly Task[];
  onClose: () => void;
  /** Called with the ids the user confirmed. Empty selections can't get here. */
  onConfirm: (ids: string[]) => void;
}

/**
 * The confirmation step for "suggest pins" — the shortlist the scorer picked,
 * each row with the reason it earned its place, a checkbox, and a swap that
 * pulls in the next-best candidate.
 *
 * The scorer is deterministic (see `pinSuggest.ts`), so the tap used to pin
 * three tasks outright with nothing to inspect and no recourse except
 * unpinning them one at a time. Swapping re-runs the same greedy step with the
 * rows being kept passed as company, so a replacement is scored against the
 * list the user is actually assembling rather than the one they rejected.
 */
export function SuggestedPinsSheet({ visible, tasks, pinnedTasks, onClose, onConfirm }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Snapshot at open, for the same reason DeloadSheet's plan is: this is a
  // proposal the user is deciding on, not a live derivation that should
  // reshuffle underneath them.
  const [pool, setPool] = useState<Task[]>([]);
  const [ctx, setCtx] = useState<ReturnType<typeof buildPinContext> | null>(null);
  const [slotIds, setSlotIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Swapped-away ids, never offered again while the sheet is open. */
  const [rejectedIds, setRejectedIds] = useState<string[]>([]);

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const snapshot = tasks.map(t => t);
    const nextCtx = buildPinContext(useTaskStore.getState().completedTasks());
    const picked = suggestPins(snapshot, [...pinnedTasks], nextCtx);
    setPool(snapshot);
    setCtx(nextCtx);
    setSlotIds(picked);
    setSelectedIds(new Set(picked));
    setRejectedIds([]);
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // Keyed on `visible` alone — the shortlist is taken once, at open.
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

  const byId = useMemo(() => new Map(pool.map(t => [t.id, t])), [pool]);
  const slots = useMemo(
    () => slotIds.map(id => byId.get(id)).filter((t): t is Task => t !== undefined),
    [slotIds, byId]
  );

  /**
   * The company a candidate is scored against: what's already pinned plus the
   * rows the user is keeping. A row they've unchecked isn't part of the list
   * they're building, so it doesn't get to pull its neighbours in.
   */
  const companyFor = (excludeId: string | null): Task[] => [
    ...pinnedTasks,
    ...slots.filter(t => t.id !== excludeId && selectedIds.has(t.id)),
  ];

  // Nothing left to offer once every eligible task is on screen or rejected.
  const canSwap = ctx !== null && nextPinSuggestion(pool, [], [...slotIds, ...rejectedIds], ctx) !== null;

  const swap = (task: Task) => {
    if (!ctx) return;
    const replacement = nextPinSuggestion(
      pool,
      companyFor(task.id),
      [...slotIds, ...rejectedIds],
      ctx
    );
    if (!replacement) {
      haptics.warning();
      return;
    }
    haptics.tap();
    const wasSelected = selectedIds.has(task.id);
    setSlotIds(prev => prev.map(id => (id === task.id ? replacement : id)));
    setRejectedIds(prev => [...prev, task.id]);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(task.id);
      // A swap is a request for this slot, so the replacement arrives checked
      // unless the user had deliberately switched the slot off.
      if (wasSelected) next.add(replacement);
      return next;
    });
  };

  const toggle = (task: Task) => {
    haptics.tap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  };

  const selected = slots.filter(t => selectedIds.has(t.id));

  const handleConfirm = () => {
    if (selected.length === 0) return;
    haptics.success();
    onConfirm(selected.map(t => t.id));
    dismiss();
  };

  const renderRow = (task: Task) => {
    const checked = selectedIds.has(task.id);
    const reason = ctx ? pinReason(task, companyFor(task.id), ctx) : null;
    const minutes = sumEstimatedMinutes([task]);
    const time = minutes > 0 ? formatDuration(minutes) : null;
    const detail = [reason, time].filter(Boolean).join(' · ');
    const currentStep = activeChainStep(task);
    const displayTitle = currentStep ? currentStep.title : task.title;

    return (
      <View key={task.id} style={styles.row}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => toggle(task)}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={`${displayTitle}${detail ? `, ${detail}` : ''}`}
        >
          <Ionicons
            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={checked ? colors.accent : colors.textTertiary}
          />
          <View style={styles.rowContent}>
            <Text style={[styles.rowTitle, !checked && styles.rowTitleUnchecked]} numberOfLines={1}>
              {displayTitle}
            </Text>
            {/* Two Texts rather than the joined string: the reason can run as
                long as a task title ("Goes with Draft the quarterly memo"), and
                on one line it's the estimate that gets ellipsized away — the
                one part of this line that's a fact rather than a gloss. The
                reason shrinks; the minutes don't. Same split the focus setup
                sheet's rows use. */}
            {detail !== '' && (
              <View style={styles.rowSubLine}>
                {reason !== null && (
                  <Text style={[styles.rowSub, styles.rowReason]} numberOfLines={1}>
                    {reason}
                  </Text>
                )}
                {time !== null && (
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {reason !== null ? ` · ${time}` : time}
                  </Text>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.swapBtn}
          onPress={() => swap(task)}
          disabled={!canSwap}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Swap out ${displayTitle}`}
          accessibilityHint="Replaces this suggestion with the next best task"
        >
          <Ionicons
            name="refresh"
            size={iconSize.sm}
            color={canSwap ? colors.textSecondary : colors.bgQuaternary}
          />
        </TouchableOpacity>
      </View>
    );
  };

  const total = pinnedTasks.length + selected.length;

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
            <Text style={styles.sheetTitle}>Suggested pins</Text>
            <View style={styles.countRow}>
              <PinIcon filled size={13} color={colors.textTertiary} />
              <Text style={styles.countText}>
                <Text style={styles.countValue}>{total}</Text>
                {` of ${MAX_SUGGESTED_PINS}`}
              </Text>
            </View>
          </View>

          {slots.length === 0 ? (
            <Text style={styles.emptyHint}>
              Nothing to suggest: everything on today is pinned already or sits in a category
              you've excluded.
            </Text>
          ) : (
            <Text style={styles.hint}>Tap to include or skip, or swap a row for the next best task.</Text>
          )}

          <ScrollView style={styles.list} bounces={false}>
            {slots.map((task, i) => (
              <React.Fragment key={task.id}>
                {i > 0 && <View style={styles.sep} />}
                {renderRow(task)}
              </React.Fragment>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[styles.confirmBtn, selected.length === 0 && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={selected.length === 0}
            activeOpacity={interaction.activeOpacity}
          >
            <Text style={[styles.confirmBtnText, selected.length === 0 && styles.confirmBtnTextDisabled]}>
              {selected.length === 0
                ? 'Nothing selected'
                : `Pin ${selected.length} task${selected.length === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
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
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  countText: { color: colors.textTertiary, fontSize: font.sm },
  countValue: { color: colors.accent, fontWeight: fontWeight.semibold },
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
  row: { flexDirection: 'row', alignItems: 'center' },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.md,
    paddingVertical: 12,
  },
  rowContent: { flex: 1, gap: 1 },
  rowTitle: { color: colors.text, fontSize: font.md, lineHeight: lineHeight.md },
  rowTitleUnchecked: { color: colors.textSecondary },
  rowSubLine: { flexDirection: 'row', alignItems: 'center' },
  rowSub: { color: colors.textTertiary, fontSize: font.xs },
  rowReason: { flexShrink: 1 },
  swapBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
  confirmBtn: {
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
    margin: spacing.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: colors.bgTertiary },
  confirmBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  confirmBtnTextDisabled: { color: colors.textTertiary },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
});
