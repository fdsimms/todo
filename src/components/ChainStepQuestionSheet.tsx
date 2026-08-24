import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ChainItem, DeliverableKind } from '../types';
import { deliverableMeta } from '../utils/deliverables';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { DeliverableKindPicker } from './DeliverableKindPicker';
import { SafeBlurView } from './SafeBlurView';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  /** The step being edited; its title is the sheet's subject. */
  step: ChainItem | null;
  /**
   * The step that follows this one, or null when there isn't one. Only its
   * title is used, and only to name what a date answer would move — a last
   * step has nothing to offer, so the switch doesn't appear at all.
   */
  nextStepTitle: string | null;
  /** Applies the step's new settings. `onClose` follows it — the host hides the sheet. */
  onSave: (patch: Pick<ChainItem, 'deliverableKind' | 'deliverableDatesNextStep'>) => void;
  onClose: () => void;
}

/**
 * What one chain step asks for when it's completed — the per-step half of
 * "Ask on completion" (see `ChainItem.deliverableKind`), plus the one thing
 * only a chain can do with the answer: hand a date to the next step.
 *
 * A sheet rather than another control unfolding on the step row, for the
 * reason `StepMinutes` gives for staying a fixed-height field: the row lives
 * inside a `SortableList`, and a control that expands in place changes the
 * row's height mid-drag, which is the one thing that list's displacement math
 * can't absorb. The row keeps a fixed-size button; everything that needs room
 * happens here.
 *
 * Shared by the task editor and the template item editor, like
 * `DeliverableKindPicker` inside it — both declare the same question about the
 * same step shape, so neither can end up offering the other's options.
 */
export function ChainStepQuestionSheet({ visible, step, nextStepTitle, onSave, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const hiddenY = useSheetHiddenOffset();
  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const [kind, setKind] = useState<DeliverableKind | null>(null);
  const [datesNextStep, setDatesNextStep] = useState(false);

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    setKind(step?.deliverableKind ?? null);
    setDatesNextStep(step?.deliverableDatesNextStep ?? false);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
  }, [visible, step?.id]);

  const dismiss = (after: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      after();
    });
  };

  // The switch is only meaningful for a date step with somewhere to send the
  // answer, and the stored flag is cleared alongside it rather than left set
  // and inert: a step switched from Date to Text and back would otherwise come
  // back with a setting the user never re-chose.
  const canDateNextStep = kind === 'date' && nextStepTitle !== null;

  const save = () => {
    haptics.success();
    const patch = {
      deliverableKind: kind,
      deliverableDatesNextStep: canDateNextStep && datesNextStep,
    };
    dismiss(() => { onSave(patch); onClose(); });
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss(onClose)}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss(onClose)} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
            <Text style={styles.heading} numberOfLines={2}>{step?.title ?? 'Step'}</Text>
            <SheetHeaderButton label="Done" onPress={save} minWidth={56} style={styles.headerRight} />
          </View>

          <Text style={styles.label}>Ask on completion</Text>
          <View style={styles.pickerWrap}>
            <DeliverableKindPicker
              value={kind}
              onChange={next => {
                animateLayout();
                setKind(next);
              }}
            />
            <Text style={styles.hint}>
              {kind
                ? deliverableMeta(kind).hint
                : 'Completing this step is the whole answer. Pick a kind to be asked for one.'}
            </Text>
          </View>

          {canDateNextStep && (
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); setDatesNextStep(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityLabel="Schedule the next step for this date"
              accessibilityState={{ checked: datesNextStep }}
            >
              <Ionicons
                name="arrow-forward-circle-outline"
                size={18}
                color={datesNextStep ? colors.accent : colors.textSecondary}
              />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Schedule the next step for this date</Text>
                <Text style={styles.optionHint}>
                  {`“${nextStepTitle}” gets the date you answer with, instead of the day you finish this step.`}
                </Text>
              </View>
              <View style={[styles.toggle, datesNextStep && styles.toggleOn]}>
                <View style={[styles.toggleKnob, datesNextStep && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          )}
        </View>
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
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  pickerWrap: { paddingHorizontal: spacing.md, gap: spacing.sm },
  hint: { color: colors.textSecondary, fontSize: font.sm },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
  },
  optionContent: { flex: 1, gap: 2 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
  toggle: {
    width: 46, height: 27, borderRadius: 14,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: colors.orange },
  toggleKnob: {
    width: 21, height: 21, borderRadius: 11,
    backgroundColor: colors.bg,
  },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
});
