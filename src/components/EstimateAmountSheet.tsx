import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import type { FoodLogEntry } from '../types';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
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
  estimateWholeGrams,
  wholeEstimate,
  type EstimateAmountPatch,
} from '../utils/foodLog';
import { formatQuantityAmount } from '../utils/quantity';
import { CountStepper } from './CountStepper';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';

interface Props {
  visible: boolean;
  /** The estimated entry being corrected. Its label is the sheet's subject. */
  entry: FoodLogEntry | null;
  /** Writes the new amount. The host closes the sheet in the same handler. */
  onSave: (patch: EstimateAmountPatch) => void;
  onClose: () => void;
  /** The confirm button's label. "Save" by default; "Log" where the amount is for a new entry. */
  saveLabel?: string;
  /**
   * Whether confirming the amount the sheet opened on does anything. Off for a
   * correction, where there is nothing to write; on when the amount is for a
   * new entry, so the same amount can be logged as it is.
   */
  allowUnchanged?: boolean;
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

export type AmountUnit = 'grams' | 'percent';

export const UNIT_OPTIONS: SegmentOption<AmountUnit>[] = [
  { value: 'grams', label: 'g', accessibilityLabel: 'Grams' },
  { value: 'percent', label: '%', accessibilityLabel: 'Percent of the meal' },
];

/**
 * The multiple of the whole meal a typed amount means, or null when it isn't a
 * number or is outside what `estimateAmountPatch` accepts. Grams are divided by
 * the meal's own stated weight, so the unit is offered only when there is one.
 */
export function factorFromTyped(text: string, unit: AmountUnit, wholeGrams: number | null): number | null {
  const n = parseFloat(text.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const factor = unit === 'grams' ? (wholeGrams ? n / wholeGrams : null) : n / 100;
  if (factor === null || factor > MAX_ESTIMATE_MULTIPLE + 1e-9) return null;
  return factor;
}

/** A multiple of the whole written in the field's unit, with no trailing dust. */
export function amountText(factor: number, unit: AmountUnit, wholeGrams: number | null): string {
  const n = unit === 'grams' && wholeGrams ? factor * wholeGrams : factor * 100;
  return String(Math.round(n * 10) / 10);
}

export function amountRefusal(unit: AmountUnit, wholeGrams: number | null): string {
  const max = MAX_ESTIMATE_MULTIPLE;
  return unit === 'grams' && wholeGrams
    ? `Enter an amount above 0 g, up to ${Math.round(wholeGrams * max).toLocaleString()} g.`
    : `Enter a percent above 0, up to ${(max * 100).toLocaleString()}.`;
}

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
 * a typed amount instead (grams when the meal's own weight is stated, else a
 * percent), with the common shares as chips that fill the field. Which one is
 * `estimateCount`'s call, made on the whole as first estimated, so an entry never switches question between one change and the
 * next. Every choice is taken of that whole, so the count the model described,
 * or All, is always the way back.
 *
 * A bottom card rather than a page sheet, like the chain step sheets: one
 * question, and a scrim tap losing the choice costs one tap to make again, so
 * there is no unsaved-changes guard to need. The number pad opens for the
 * stepper's digits and the typed amount alike.
 */
export function EstimateAmountSheet({ visible, entry, onSave, onClose, saveLabel = 'Save', allowUnchanged = false }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const card = useCardSheet();
  const amountRef = useRef<TextInput>(null);

  const whole = entry ? wholeEstimate(entry) : null;
  const counted = whole ? estimateCount(whole.servingText) : null;

  /** The count asked for, when the estimate's words give one. */
  const [count, setCount] = useState(1);
  /** The chosen multiple of the whole, when they don't. */
  const [factor, setFactor] = useState<number | null>(1);
  /** What was typed in the amount field, or null while the field shows the chosen multiple. */
  const [typed, setTyped] = useState<string | null>(null);
  const [unit, setUnit] = useState<AmountUnit>('percent');

  const wholeGrams = whole ? estimateWholeGrams(whole) : null;

  useEffect(() => {
    if (!visible) return;
    setFactor(entry ? currentEstimateFactor(entry) : null);
    setTyped(null);
    setUnit(wholeGrams ? 'grams' : 'percent');
    if (counted) setCount((entry && currentEstimateCount(entry)) ?? counted.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry?.id]);

  const dismiss = (after: () => void) => {
    card.close(() => {
      after();
    });
  };

  const typedFactor = typed === null ? null : factorFromTyped(typed, unit, wholeGrams);
  const chosen = counted ? count / counted.count : typed !== null ? typedFactor : factor;
  const fieldText = typed ?? (factor === null ? '' : amountText(factor, unit, wholeGrams));
  const pickUnit = (next: AmountUnit) => {
    // Keep the amount the person has now, restated in the new unit.
    if (chosen !== null) setFactor(chosen);
    setTyped(null);
    setUnit(next);
  };
  const pickShare = (value: number) => {
    haptics.tap();
    setFactor(value);
    setTyped(null);
  };
  const patch = entry && chosen !== null ? estimateAmountPatch(entry, chosen) : null;
  const unchanged = !patch || (!allowUnchanged && !!entry && estimateAmountUnchanged(entry, patch));

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
      // The sheet stays mounted across opens, so a bare `autoFocus` would only
      // fire once. The stepper has no field to focus.
      onShow={() => amountRef.current?.focus()}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
          <Text style={styles.heading} numberOfLines={2}>{entry?.label ?? ''}</Text>
          <SheetHeaderButton
            label={saveLabel}
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
            <View style={styles.amountBlock}>
              <View style={styles.amountRow}>
                <TextField
                  ref={amountRef}
                  style={styles.amountInput}
                  value={fieldText}
                  onChangeText={text => { setTyped(text); }}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  selectTextOnFocus
                  placeholder="e.g. 150"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel={`${question}, in ${unit === 'grams' ? 'grams' : 'percent of the meal'}`}
                />
                {wholeGrams ? (
                  <View style={styles.unitTrack}>
                    <SegmentedControl
                      options={UNIT_OPTIONS}
                      value={unit}
                      onChange={pickUnit}
                      label="Unit"
                    />
                  </View>
                ) : (
                  <Text style={styles.unitText}>% of the meal</Text>
                )}
              </View>
              {/* With a weight to type against, the shares only repeat the
                  field in fractions of a mix nobody portions that way. */}
              {!wholeGrams && <View style={styles.shareRow}>
                {ESTIMATE_AMOUNTS.map(a => {
                  const on = chosen !== null && typed === null && Math.abs(chosen - a.value) < 1e-9;
                  return (
                    <TouchableOpacity
                      key={a.label}
                      style={[styles.share, on && styles.shareOn]}
                      onPress={() => pickShare(a.value)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={a.spoken}
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.shareText, on && styles.shareTextOn]}>{a.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>}
              {typed !== null && typedFactor === null && typed.trim() !== '' && (
                <Text style={styles.error}>{amountRefusal(unit, wholeGrams)}</Text>
              )}
            </View>
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
              ? `The estimate was ${wholeKcalText ? `${wholeKcalText} ` : ''}for ${whole?.servingText ?? ''}. The figures change with the count, so nothing is re-estimated. Setting it back to ${formatQuantityAmount(counted.count, counted.decimal)} puts them back.`
              : `The figures are the estimate for the whole meal${wholeKcalText ? ` (${wholeKcalText})` : ''}, scaled to your choice, so nothing is re-estimated. ${wholeGrams ? `Entering ${Math.round(wholeGrams * 10) / 10} g puts them back.` : 'All puts them back.'}`}
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
  amountBlock: { gap: spacing.smd },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  amountInput: {
    flex: 1,
    minWidth: 96,
    color: colors.text,
    fontSize: font.lg,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.smd,
    // Height rather than lineHeight, see the TextInput note in CLAUDE.md.
    minHeight: 44,
  },
  // The track's segments are `flex: 1`, so left to size itself it claims the
  // whole row and squeezes the field to nothing. A fixed width gives it a size.
  unitTrack: { width: 112 },
  unitText: { color: colors.textSecondary, fontSize: font.md },
  shareRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xsm },
  share: {
    minWidth: 48,
    minHeight: 36,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareOn: { backgroundColor: colors.accent },
  shareText: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  shareTextOn: { color: colors.onAccent },
  error: { color: colors.textSecondary, fontSize: font.xs },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  countNoun: { flex: 1, color: colors.text, fontSize: font.md },
  previewBlock: { gap: spacing.xxs, marginTop: spacing.xs },
  preview: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
  amount: { color: colors.textSecondary, fontSize: font.sm },
  hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
});
