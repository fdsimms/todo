import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import type { FoodLogEntry } from '../types';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  ESTIMATE_AMOUNTS,
  MAX_ESTIMATE_MULTIPLE,
  currentEstimateCount,
  currentEstimateFactor,
  describeEstimateCount,
  estimateAmountPatch,
  estimateAmountUnchanged,
  estimateCount,
  estimateCountNoun,
  estimateCountQuestion,
  wholeEstimate,
  type EstimateAmountPatch,
} from '../utils/foodLog';
import { formatQuantityAmount } from '../utils/quantity';
import { CountStepper } from './CountStepper';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  /** The estimated entry being corrected. Its label is the sheet's subject. */
  entry: FoodLogEntry | null;
  /** Writes the new amount. The host closes the sheet in the same handler. */
  onSave: (patch: EstimateAmountPatch) => void;
  onClose: () => void;
}

/**
 * The closed set for an estimate with no count. `null` never matches one, which
 * is how an entry whose figures are none of them opens with nothing raised.
 */
export const ESTIMATE_AMOUNT_OPTIONS: SegmentOption<number | null>[] = ESTIMATE_AMOUNTS.map(a => ({
  value: a.value,
  label: a.label,
  accessibilityLabel: a.spoken,
}));

/**
 * "Change amount": how much of an estimated meal was actually eaten, less or
 * more than the model was told about.
 *
 * The one correction a described meal can take besides a rename (#2914). An
 * estimate has no panel to re-measure a new amount against, so the entry sheet
 * can't reopen on it, but "I actually ate 3 slices" needs no new figures: it
 * is the model's own figures for 2 slices, half as many again.
 * `estimateAmountPatch` is the arithmetic and says why it is the one exception
 * to "re-measured, never multiplied"; this is only the question.
 *
 * **Asked in the estimate's own unit when its words give one.** "2 slices" is
 * asked as "How many slices" on a `CountStepper` opened on the count logged
 * now, because that is the question the person is answering. Words that count
 * nothing, or count only part of the meal ("1 burger and a regular fries"), get
 * a closed set in a `SegmentedControl` instead: the shares, the whole, and a
 * few multiples of it, since an estimate is not made more exact by saying 0.47
 * of it. Which one is `estimateCount`'s call, made on the whole as first
 * estimated, so an entry never switches question between one change and the
 * next. Every choice is taken of that whole, so the count the model described,
 * or All, is always the way back.
 *
 * A bottom card rather than a page sheet, like the chain step sheets: one
 * question, and a scrim tap losing the choice costs one tap to make again, so
 * there is no unsaved-changes guard to need. `KeyboardAvoidingView` because
 * the stepper's digits open a number pad, the carve-out `LogMealPrompt` and
 * `ChainStepMedicationSheet` already hold for a small bottom-anchored card.
 */
export function EstimateAmountSheet({ visible, entry, onSave, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const card = useCardSheet();

  const whole = entry ? wholeEstimate(entry) : null;
  const counted = whole ? estimateCount(whole.servingText) : null;

  /** The count asked for, when the estimate's words give one. */
  const [count, setCount] = useState(1);
  /** The chosen multiple of the whole, when they don't. */
  const [factor, setFactor] = useState<number | null>(1);

  useEffect(() => {
    if (!visible) return;
    setFactor(entry ? currentEstimateFactor(entry) : null);
    if (counted) setCount((entry && currentEstimateCount(entry)) ?? counted.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry?.id]);

  const dismiss = (after: () => void) => {
    card.close(() => {
      after();
    });
  };

  const chosen = counted ? count / counted.count : factor;
  const patch = entry && chosen !== null ? estimateAmountPatch(entry, chosen) : null;
  const unchanged = !patch || (!!entry && estimateAmountUnchanged(entry, patch));

  const save = () => {
    if (!patch || unchanged) return;
    haptics.success();
    dismiss(() => { onSave(patch); onClose(); });
  };

  const kcal = patch?.nutrition.amounts.calorieKcal;
  const protein = patch?.nutrition.amounts.proteinG;
  const wholeKcal = whole?.amounts.calorieKcal;
  const wholeKcalText = wholeKcal !== undefined ? `${Math.round(wholeKcal).toLocaleString()} cal` : null;
  const question = counted ? estimateCountQuestion(counted) : 'How much you ate';

  return (
    <CardSheet
      name="EstimateAmountSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss(onClose)}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
          <Text style={styles.heading} numberOfLines={2}>{entry?.label ?? ''}</Text>
          <SheetHeaderButton
            label="Save"
            onPress={save}
            disabled={unchanged}
            minWidth={56}
            style={styles.headerRight}
          />
        </View>

        <Text style={styles.label}>{question}</Text>
        <View style={styles.body}>
          {counted ? (
            <View style={styles.countRow}>
              <CountStepper
                value={count}
                onChange={next => { if (next !== null) setCount(next); }}
                min={Math.min(counted.step, counted.count)}
                max={counted.count * MAX_ESTIMATE_MULTIPLE}
                step={counted.step}
                format={n => formatQuantityAmount(n, counted.decimal)}
                label={question}
                describeValue={n => describeEstimateCount(counted, n ?? counted.count)}
              />
              {/* The noun agrees with the count, and whatever the count
                  is "of" follows it, so the row reads as the amount. */}
              <Text style={styles.countNoun}>
                {`${estimateCountNoun(counted, count)}${counted.rest}`}
              </Text>
            </View>
          ) : (
            <SegmentedControl
              options={ESTIMATE_AMOUNT_OPTIONS}
              value={factor}
              onChange={setFactor}
              columns={3}
              label={question}
            />
          )}
          {!!patch && (
            <View style={styles.previewBlock}>
              <Text style={styles.preview}>
                {kcal !== undefined ? `${Math.round(kcal).toLocaleString()} cal` : 'No calories stated'}
                {protein !== undefined ? `, ${Math.round(protein)} g protein` : ''}
              </Text>
              {/* On its own line: the meal's own words can run long, and
                  the figures are what the choice is being made on. A
                  count already says its amount in the row above. */}
              {!counted && !!patch.quantity && <Text style={styles.amount}>{patch.quantity}</Text>}
            </View>
          )}
          <Text style={styles.hint}>
            {counted
              ? `The estimate was ${wholeKcalText ? `${wholeKcalText} ` : ''}for ${whole?.servingText ?? ''}. The figures change with the count, so nothing new is guessed. Setting it back to ${formatQuantityAmount(counted.count, counted.decimal)} puts them back.`
              : `The figures are the estimate for the whole meal${wholeKcalText ? ` (${wholeKcalText})` : ''}, scaled to your choice, so nothing new is guessed. All puts them back.`}
          </Text>
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
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
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  countNoun: { flex: 1, color: colors.text, fontSize: font.md },
  previewBlock: { gap: spacing.xxs, marginTop: spacing.xs },
  preview: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
  amount: { color: colors.textSecondary, fontSize: font.sm },
  hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
});
