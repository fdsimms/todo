import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { SheetModal } from './SheetModal';
import type { FoodLogEntry } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { animation, font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  EATEN_FRACTIONS,
  currentEatenFraction,
  eatenFractionPatch,
  wholeEstimate,
  type EatenFractionPatch,
} from '../utils/foodLog';
import { SafeBlurView } from './SafeBlurView';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetScrim } from './SheetScrim';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  /** The estimated entry being corrected. Its label is the sheet's subject. */
  entry: FoodLogEntry | null;
  /** Writes the share. The host closes the sheet in the same handler. */
  onSave: (patch: EatenFractionPatch) => void;
  onClose: () => void;
}

const FRACTION_OPTIONS: SegmentOption<number>[] = EATEN_FRACTIONS.map(f => ({
  value: f.value,
  label: f.label,
  accessibilityLabel: f.spoken,
}));

/**
 * "Fraction eaten": how much of an estimated meal was actually eaten.
 *
 * The one correction a described meal can take besides a rename, and a small
 * one on purpose (#2914). An estimate has no panel to re-measure a new amount
 * against, so the entry sheet can't reopen on it, but "I ate two-thirds of it"
 * needs no new figures at all: it is a share of the ones the model already
 * stated. `eatenFractionPatch` is the arithmetic and says why it is the one
 * exception to "re-measured, never multiplied"; this is only the question.
 *
 * **A closed set in a `SegmentedControl`**, the control CLAUDE.md names for
 * picking one of a few fixed values, rather than a typed number: an estimate
 * is not made more exact by saying 0.47 of it. It opens on the share the entry
 * stands at now, which is All until one is taken, and every choice is a share
 * of the whole meal as estimated, so All is always the way back.
 *
 * A bottom card rather than a page sheet, like the chain step sheets: one
 * question, nothing typed, so a scrim tap losing the choice costs one tap to
 * make again, and there is no unsaved-changes guard to need.
 */
export function EatenFractionSheet({ visible, entry, onSave, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const hiddenY = useSheetHiddenOffset();
  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const [fraction, setFraction] = useState(1);
  const opened = entry ? currentEatenFraction(entry) : null;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    setFraction(opened ?? 1);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry?.id]);

  const dismiss = (after: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      after();
    });
  };

  const whole = entry ? wholeEstimate(entry) : null;
  const patch = entry ? eatenFractionPatch(entry, fraction) : null;
  const unchanged = opened !== null && fraction === opened;

  const save = () => {
    if (!patch || unchanged) return;
    haptics.success();
    dismiss(() => { onSave(patch); onClose(); });
  };

  const kcal = patch?.nutrition.amounts.calorieKcal;
  const protein = patch?.nutrition.amounts.proteinG;
  const wholeKcal = whole?.amounts.calorieKcal;

  return (
    <SheetModal name="Fraction eaten" visible={visible} animationType="none" transparent onRequestClose={() => dismiss(onClose)}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={() => dismiss(onClose)} />

      <View style={styles.avoider} pointerEvents="box-none">
        <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
              <Text style={styles.heading} numberOfLines={2}>{entry?.label ?? ''}</Text>
              <SheetHeaderButton
                label="Save"
                onPress={save}
                disabled={!patch || unchanged}
                minWidth={56}
                style={styles.headerRight}
              />
            </View>

            <Text style={styles.label}>How much of it you ate</Text>
            <View style={styles.body}>
              <SegmentedControl
                options={FRACTION_OPTIONS}
                value={fraction}
                onChange={setFraction}
                label="How much of it you ate"
              />
              {!!patch && (
                <View style={styles.previewBlock}>
                  <Text style={styles.preview}>
                    {kcal !== undefined ? `${Math.round(kcal).toLocaleString()} cal` : 'No calories stated'}
                    {protein !== undefined ? `, ${Math.round(protein)} g protein` : ''}
                  </Text>
                  {/* On its own line: the meal's own words can run long, and
                      the figures are what the choice is being made on. */}
                  {!!patch.quantity && <Text style={styles.amount}>{patch.quantity}</Text>}
                </View>
              )}
              <Text style={styles.hint}>
                {`The figures become that share of the estimate for the whole meal${
                  wholeKcal !== undefined ? ` (${Math.round(wholeKcal).toLocaleString()} cal)` : ''
                }, so nothing new is guessed. All puts them back.`}
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  avoider: { flex: 1, justifyContent: 'flex-end' },
  sheetOuter: {
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
  body: { paddingHorizontal: spacing.md, gap: spacing.sm },
  previewBlock: { gap: spacing.xxs, marginTop: spacing.xs },
  preview: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
  amount: { color: colors.textSecondary, fontSize: font.sm },
  hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
});
