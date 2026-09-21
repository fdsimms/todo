import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SafeBlurView } from './SafeBlurView';
import { SheetScrim } from './SheetScrim';
import { SheetHeaderButton } from './SheetHeaderButton';
import { RotationChecklist } from './RotationChecklist';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { useColors, useTheme } from '../theme/ThemeContext';
import { displayTitleFor } from '../utils/visibilityUtils';
import { spacing, radius, font, fontWeight, animation, type Colors } from '../theme';
import type { Task } from '../types';

interface Props {
  visible: boolean;
  /** The completed rotation occurrence whose period is being read back. */
  task: Task;
  onClose: () => void;
}

/**
 * What a finished rotation week actually held — every member, ticked or not,
 * with the day it was done.
 *
 * It exists because a rotation is **one Logbook entry per week, not one per
 * pick**: the week is a single occurrence, so five podcasts collapse into one
 * row reading "Language podcast". The detail is all there — the ledger rides
 * the completed row, which is why `rolloverQuotas` leaves `progressCount`
 * alone and calls it the record — but nothing could see it.
 *
 * A sheet rather than an expansion because a Logbook row is exactly
 * `ROW_HEIGHT` tall and every branch of it is written to stay that way; see
 * that constant's note.
 *
 * Read against the entry's own `completedAt`, not against now. A week finished
 * a fortnight ago is still its own week, and reading it against the current
 * one would show an empty set — the same stale-period rule `activeRotationLog`
 * applies, used here in the direction that recovers history rather than
 * discarding it.
 */
export function RotationWeekSheet({ visible, task, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const hiddenY = useSheetHiddenOffset();
  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const asOf = task.completedAt ? new Date(task.completedAt) : undefined;

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
  }, [visible, task.id]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
    });
  };

  const covered = task.rotationItems.filter(
    item => task.rotationLog.some(entry => entry.itemId === item.id),
  ).length;
  const total = task.rotationItems.length;

  return (
    <SheetModal
      name="RotationWeekSheet"
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={dismiss} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerSide} />
            <Text style={styles.heading} numberOfLines={2}>{displayTitleFor(task)}</Text>
            <SheetHeaderButton label="Done" onPress={dismiss} minWidth={56} style={styles.headerRight} />
          </View>
          {/* Said in words as well as ticks, because a week finished short is
              a real and unremarkable outcome — a partial rotation closes out
              exactly as a partial quota does — and the list alone leaves you
              counting checkmarks to find out. */}
          <Text style={styles.summary}>
            {covered} of {total} done that week
          </Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <RotationChecklist task={task} label="That week" asOf={asOf} />
          </ScrollView>
        </View>
      </Animated.View>
    </SheetModal>
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
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  headerSide: { minWidth: 56 },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  summary: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.smd,
    paddingBottom: spacing.sm,
  },
  scroll: { maxHeight: 400, paddingHorizontal: spacing.md },
});
