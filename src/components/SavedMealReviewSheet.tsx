import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { LazySheet } from './LazySheet';
import { FoodLogEntrySheet } from './FoodLogEntrySheet';
import { TextField } from './TextField';
import { SegmentedControl } from './SegmentedControl';
import { UNIT_OPTIONS, amountRefusal, amountText, countFromTyped, countRefusal, factorFromTyped, type AmountUnit } from './EstimateAmountSheet';
import { UnitMenuChip, OTHER_UNIT_KEY } from './UnitMenuChip';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { useAmountOperators } from '../hooks/useAmountOperators';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { nutritionFor } from '../utils/foodNutrition';
import { haptics } from '../utils/haptics';
import {
  ESTIMATE_CHOICES,
  appendLine,
  itemAmountEdit,
  itemAtAmount,
  itemAtEstimateFactor,
  replaceLine,
  reviewChanged,
  reviewedCalories,
  reviewedItems,
  reviewLinesFor,
  toggleRemoved,
  type ReviewLine,
} from '../utils/savedMealReview';
import { confirmDiscard } from '../utils/confirmDiscard';
import {
  amountExample,
  composeFoodAmount,
  convertAmountNumber,
  currentEstimateCount,
  currentEstimateFactor,
  estimateCount,
  estimateCountNoun,
  estimateWholeGrams,
  foodUnitOptionsFor,
  largeAmountWarning,
  parseFoodAmount,
  wholeEstimate,
} from '../utils/foodLog';
import { formatQuantityAmount } from '../utils/quantity';
import { confirmLargeAmount } from '../utils/confirmLargeAmount';
import type { FoodNutrition, MealSlot, SavedMeal, SavedMealItem } from '../types';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  meal: SavedMeal;
  /** The meal slot and logical day the log lands on, for the picker's own defaults. */
  slot: MealSlot | null;
  at: Date;
  /** Logs the reviewed items. The caller writes them and closes what it opened. */
  onLog: (items: SavedMealItem[]) => void;
  /** Makes the reviewed items the saved meal's items. Returns whether it was saved. */
  onSaveChanges: (items: SavedMealItem[]) => boolean;
  onClose: () => void;
}

type PickTarget = { kind: 'replace'; key: string } | { kind: 'add' };

/**
 * What an estimated item's amount field asks in: the count its own words give
 * ("2 slices"), else grams when the meal states a weight, else a percent. The
 * same question `EstimateAmountSheet` asks of a logged estimate.
 */
function estimateAsk(item: SavedMealItem) {
  const whole = wholeEstimate(item);
  return {
    counted: whole ? estimateCount(whole.servingText) : null,
    wholeGrams: whole ? estimateWholeGrams(whole) : null,
  };
}

/** The multiple of the whole a typed estimate amount means, or why it isn't one. */
function typedEstimateFactor(item: SavedMealItem, text: string, unit: AmountUnit): { factor: number } | { reason: string } {
  const { counted, wholeGrams } = estimateAsk(item);
  if (counted) {
    const n = countFromTyped(text, counted);
    return n === null ? { reason: countRefusal(counted) } : { factor: n / counted.count };
  }
  const factor = factorFromTyped(text, unit, wholeGrams);
  return factor === null ? { reason: amountRefusal(unit, wholeGrams) } : { factor };
}

/**
 * A saved meal opened for changes before it is logged: an amount, a food
 * dropped, a food swapped for another, a food added.
 *
 * **Nothing is written until Log.** Every edit stages in `lines` and the saved
 * meal is untouched unless "Save changes to this meal" is chosen, so a swap
 * made once for tonight does not rewrite the shortcut. That makes this a
 * `pageSheet` holding uncommitted state, hence `handleCancel` wired to both
 * `onRequestClose` and Cancel (the rule in CLAUDE.md).
 *
 * The rules (which amounts can change, and how) are in `savedMealReview.ts`;
 * this owns layout and the staged state. The food picker is
 * `FoodLogEntrySheet` in its `onPickFood` mode, rendered **inside** this sheet's
 * Modal so it presents from this sheet rather than from the root, which is
 * already presenting it (the sibling Modal rule).
 */
export function SavedMealReviewSheet({ visible, meal, slot, at, onLog, onSaveChanges, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });
  const amountOperators = useAmountOperators();
  const groceryItems = useGroceryStore(s => s.items);
  const itemProducts = useGroceryStore(s => s.itemProducts);

  const [lines, setLines] = useState<ReviewLine[]>(() => reviewLinesFor(meal));
  /** Amount text typed but not yet applied, by line key. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /**
   * The unit and number a line's amount is split into, by line key. Kept apart
   * from `drafts` (the composed text) so a unit picked before a number is typed,
   * or "Something else", survives re-renders instead of being re-parsed away.
   */
  const [units, setUnits] = useState<Record<string, string>>({});
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  /** What was typed for an estimated line's amount, by line key, and the unit it is in. */
  const [estimateTyped, setEstimateTyped] = useState<Record<string, string>>({});
  const [estimateUnits, setEstimateUnits] = useState<Record<string, AmountUnit>>({});
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);
  const nextKey = useRef(0);

  // Seeded each time the sheet opens, or when it is opened on another meal.
  useEffect(() => {
    if (!visible) return;
    setLines(reviewLinesFor(meal));
    setDrafts({});
    setErrors({});
    setUnits({});
    setNumbers({});
    setEstimateTyped({});
    setEstimateUnits({});
    setPickTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, meal.id]);

  const panelFor = (item: SavedMealItem): FoodNutrition | null => {
    const product = item.productId ? itemProducts.find(p => p.id === item.productId) : null;
    const row = item.itemId ? groceryItems.find(i => i.id === item.itemId) : null;
    return nutritionFor(row, product);
  };

  const setItem = (key: string, item: SavedMealItem) => {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, item } : l)));
  };

  const clearDraft = (key: string) => {
    setDrafts(prev => { const { [key]: _gone, ...rest } = prev; return rest; });
    setErrors(prev => { const { [key]: _gone, ...rest } = prev; return rest; });
    setEstimateTyped(prev => { const { [key]: _gone, ...rest } = prev; return rest; });
    setEstimateUnits(prev => { const { [key]: _gone, ...rest } = prev; return rest; });
  };

  /**
   * Applies an estimated line's typed amount as it is typed. A refused one
   * leaves the line as it was and says why under the field; `settleDrafts`
   * then refuses to log it, so the field and the log can't disagree.
   */
  const changeEstimate = (line: ReviewLine, text: string, unit: AmountUnit) => {
    setEstimateTyped(prev => ({ ...prev, [line.key]: text }));
    const typed = typedEstimateFactor(line.item, text, unit);
    if ('reason' in typed) {
      if (text.trim()) setErrors(prev => ({ ...prev, [line.key]: typed.reason }));
      return;
    }
    const result = itemAtEstimateFactor(line.item, typed.factor);
    if (!result.ok) { setErrors(prev => ({ ...prev, [line.key]: result.reason })); return; }
    setItem(line.key, result.item);
    setErrors(prev => { const { [line.key]: _gone, ...rest } = prev; return rest; });
  };

  /** Applies one line's typed amount. Returns whether the line is now settled. */
  const applyDraft = (line: ReviewLine, text: string): boolean => {
    const typed = text.trim();
    if (!typed) {
      setErrors(prev => ({ ...prev, [line.key]: 'Enter an amount, such as 170 g or 2 servings.' }));
      return false;
    }
    const result = itemAtAmount(line.item, typed, panelFor);
    if (!result.ok) {
      setErrors(prev => ({ ...prev, [line.key]: result.reason }));
      return false;
    }
    setItem(line.key, result.item);
    clearDraft(line.key);
    return true;
  };

  /**
   * Applies every amount still sitting in a field. Needed because a tap on Log
   * can land before the field has reported its end of editing, and an amount
   * that was typed must not be logged as the old one.
   */
  const settleDrafts = (): ReviewLine[] | null => {
    let current = lines;
    let ok = true;
    for (const line of lines) {
      const estimateText = estimateTyped[line.key];
      if (estimateText !== undefined && !line.removed) {
        // Applied as it was typed, so only a refused amount is left to catch.
        const typed = typedEstimateFactor(line.item, estimateText, estimateUnits[line.key] ?? (estimateAsk(line.item).wholeGrams ? 'grams' : 'percent'));
        if ('reason' in typed) {
          ok = false;
          setErrors(prev => ({ ...prev, [line.key]: typed.reason }));
        }
        continue;
      }
      const text = drafts[line.key];
      if (text === undefined || line.removed) continue;
      const typed = text.trim();
      const result = typed ? itemAtAmount(line.item, typed, panelFor) : null;
      if (result && result.ok) {
        const item = result.item;
        current = current.map(l => (l.key === line.key ? { ...l, item } : l));
      } else {
        ok = false;
        const reason = result && !result.ok ? result.reason : 'Enter an amount, such as 170 g or 2 servings.';
        setErrors(prev => ({ ...prev, [line.key]: reason }));
      }
    }
    if (!ok) { haptics.error(); return null; }
    setLines(current);
    setDrafts({});
    setErrors({});
    return current;
  };

  const kept = lines.filter(l => !l.removed);
  const calories = reviewedCalories(lines);
  const hasPending = Object.keys(drafts).length > 0;
  const changed = reviewChanged(meal, lines) || hasPending;

  /**
   * The first amount the person changed in this sheet that reads like a weight
   * in the wrong unit. A meal's own saved amounts aren't asked about again on
   * every log: only a line edited here, or added here, can be a slip.
   */
  const firstLargeAmount = (settled: ReviewLine[]) => {
    for (const line of settled) {
      if (line.removed) continue;
      const original = line.fromMeal ? meal.items[Number(line.key.slice('item-'.length))] : undefined;
      if (original && original.quantity === line.item.quantity) continue;
      const panel = panelFor(line.item);
      const warning = panel ? largeAmountWarning(panel, line.item.quantity, line.item.label) : null;
      if (warning) return warning;
    }
    return null;
  };

  const handleLog = () => {
    const settled = settleDrafts();
    if (!settled) return;
    const items = reviewedItems(settled);
    if (items.length === 0) return;
    const log = () => { haptics.success(); onLog(items); };
    const large = firstLargeAmount(settled);
    if (large) confirmLargeAmount(large, log); else log();
  };

  const handleSaveChanges = () => {
    const settled = settleDrafts();
    if (!settled) return;
    const items = reviewedItems(settled);
    if (items.length === 0) return;
    const save = () => {
      if (onSaveChanges(items)) {
        haptics.success();
        setLines(reviewLinesFor({ ...meal, items }));
      }
    };
    const large = firstLargeAmount(settled);
    if (large) confirmLargeAmount(large, save); else save();
  };

  const handleCancel = () => {
    if (!changed) { onClose(); return; }
    confirmDiscard(onClose);
  };

  const handlePicked = (item: SavedMealItem) => {
    const key = `new-${nextKey.current++}`;
    if (pickTarget?.kind === 'replace') {
      const replacing = pickTarget.key;
      clearDraft(replacing);
      setLines(prev => replaceLine(prev, replacing, item, key));
    } else {
      setLines(prev => appendLine(prev, item, key));
    }
    setPickTarget(null);
  };

  const removeLine = (key: string) => {
    haptics.tap();
    clearDraft(key);
    setLines(prev => toggleRemoved(prev, key));
  };

  return (
    <SheetModal
      name="Review saved meal"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <SheetHeader
          title={meal.name}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label="Log" onPress={handleLog} disabled={kept.length === 0} minWidth={64} />}
        />

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <Text style={styles.hint}>
            Changes here apply to this log only, unless you save them to the meal.
          </Text>

          {lines.map(line => {
            const edit = itemAmountEdit(line.item);
            const draft = drafts[line.key];
            const error = errors[line.key];
            return (
              <View key={line.key} style={[styles.card, line.removed && styles.cardRemoved]}>
                <Text style={[styles.name, line.removed && styles.nameRemoved]}>{line.item.label}</Text>

                {line.removed ? (
                  <Text style={styles.meta}>Left out of this log</Text>
                ) : edit.kind === 'measure' ? (
                  <View>
                    <Text style={styles.fieldLabel}>AMOUNT</Text>
                    {(() => {
                      // The food's own panel decides which units are offered, so
                      // an amount it can't measure isn't one to type. A food with
                      // no panel to read units from keeps the free-text field.
                      const panel = panelFor(line.item);
                      const unitOptions = panel ? foodUnitOptionsFor(panel) : [];
                      const text = draft ?? edit.amount;
                      const parsed = unitOptions.length > 0 ? parseFoodAmount(text, unitOptions) : null;
                      // An amount the units can't reconstruct (a fraction, a
                      // weighed one-off) opens on "Something else" with its text
                      // intact, rather than a blank number.
                      const unitKey = units[line.key] ?? parsed?.unitKey ?? OTHER_UNIT_KEY;
                      const usingPills = unitOptions.length > 0 && unitKey !== OTHER_UNIT_KEY;
                      const unit = unitOptions.find(o => o.key === unitKey);
                      const clearError = () => setErrors(prev => { const { [line.key]: _gone, ...rest } = prev; return rest; });
                      const change = (typed: string) => {
                        if (usingPills) {
                          setNumbers(prev => ({ ...prev, [line.key]: typed }));
                          // Clearing the number leaves no text to read the unit
                          // from, which would drop the row to "Other" and the
                          // text keyboard mid-edit. Pin the unit it is on.
                          setUnits(prev => (prev[line.key] === unitKey ? prev : { ...prev, [line.key]: unitKey }));
                        }
                        setDrafts(prev => ({ ...prev, [line.key]: usingPills ? composeFoodAmount(typed, unit) : typed }));
                        clearError();
                      };
                      return (
                        <View style={styles.inputRow}>
                          <TextField
                            style={styles.inputInRow}
                            value={usingPills ? (numbers[line.key] ?? parsed?.number ?? '') : text}
                            onChangeText={change}
                            {...(usingPills ? amountOperators.fieldProps(line.key, () => numbers[line.key] ?? parsed?.number ?? '', change) : {})}
                            onEndEditing={e => {
                              if (drafts[line.key] === undefined) return;
                              applyDraft(line, usingPills ? composeFoodAmount(e.nativeEvent.text, unit) : e.nativeEvent.text);
                            }}
                            returnKeyType="done"
                            autoCorrect={false}
                            keyboardType={usingPills ? 'decimal-pad' : 'default'}
                            inputAccessoryViewID={usingPills ? NUMBER_PAD_ACCESSORY_ID : undefined}
                            placeholder={usingPills ? 'e.g. 1.5' : `e.g. ${panel ? amountExample(panel) : '1 cup'}`}
                            placeholderTextColor={colors.textTertiary}
                            accessibilityLabel={`Amount of ${line.item.label}`}
                          />
                          {unitOptions.length > 0 && (
                            <UnitMenuChip
                              name="SavedMealReviewSheet unit menu"
                              options={unitOptions}
                              selectedKey={unitKey}
                              chipBackground={colors.bgSecondary}
                              onSelect={key => {
                                setUnits(prev => ({ ...prev, [line.key]: key }));
                                if (key === OTHER_UNIT_KEY) return;
                                const option = unitOptions.find(o => o.key === key);
                                const typedNumber = numbers[line.key] ?? parsed?.number ?? '';
                                // Keeps the amount the same amount (57 g is 1.8
                                // servings), and keeps the typed number where the
                                // two units can't be weighed against each other.
                                const number = (panel && convertAmountNumber(panel, typedNumber, unit, option)) ?? typedNumber;
                                setNumbers(prev => ({ ...prev, [line.key]: number }));
                                const composed = composeFoodAmount(number, option);
                                if (!composed) return;
                                setDrafts(prev => ({ ...prev, [line.key]: composed }));
                                applyDraft(line, composed);
                              }}
                            />
                          )}
                        </View>
                      );
                    })()}
                    {!!error && <Text style={styles.error}>{error}</Text>}
                  </View>
                ) : edit.kind === 'estimate' ? (
                  <View>
                    <Text style={styles.meta}>{line.item.quantity}</Text>
                    {(() => {
                      const { counted, wholeGrams } = estimateAsk(line.item);
                      const unit: AmountUnit = estimateUnits[line.key] ?? (wholeGrams ? 'grams' : 'percent');
                      const factorNow = currentEstimateFactor(line.item);
                      const countNow = counted ? (currentEstimateCount(line.item) ?? counted.count) : null;
                      const text = estimateTyped[line.key]
                        ?? (counted
                          ? formatQuantityAmount(countNow ?? counted.count, counted.decimal)
                          : factorNow === null ? '' : amountText(factorNow, unit, wholeGrams));
                      const typed = typedEstimateFactor(line.item, text, unit);
                      const pickUnit = (next: AmountUnit) => {
                        // Keeps the amount the same amount, restated in the new unit.
                        const factor = 'factor' in typed ? typed.factor : factorNow;
                        setEstimateUnits(prev => ({ ...prev, [line.key]: next }));
                        setEstimateTyped(prev => {
                          if (factor === null) { const { [line.key]: _gone, ...rest } = prev; return rest; }
                          return { ...prev, [line.key]: amountText(factor, next, wholeGrams) };
                        });
                      };
                      return (
                        <View>
                          <Text style={styles.fieldLabel}>{counted ? 'HOW MUCH' : wholeGrams ? 'AMOUNT' : 'HOW MUCH OF IT'}</Text>
                          <View style={styles.inputRow}>
                            <TextField
                              style={styles.inputInRow}
                              value={text}
                              onChangeText={t => changeEstimate(line, t, unit)}
                              keyboardType="decimal-pad"
                              inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                              returnKeyType="done"
                              selectTextOnFocus
                              placeholder="e.g. 150"
                              placeholderTextColor={colors.textTertiary}
                              accessibilityLabel={`Amount of ${line.item.label}${counted ? '' : unit === 'grams' ? ', in grams' : ', in percent of the meal'}`}
                            />
                            {counted ? (
                              <Text style={styles.unitText}>
                                {`${estimateCountNoun(counted, countFromTyped(text, counted) ?? counted.count)}${counted.rest}`}
                              </Text>
                            ) : wholeGrams ? (
                              <View style={styles.unitTrack}>
                                <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={pickUnit} label="Unit" />
                              </View>
                            ) : (
                              <Text style={styles.unitText}>% of the meal</Text>
                            )}
                          </View>
                          {!!error && <Text style={styles.error}>{error}</Text>}
                          {/* With a weight or a count to type against, the shares
                              only repeat the field in fractions. */}
                          {!counted && !wholeGrams && (
                            <View style={[styles.choices, styles.choicesBelow]}>
                              {ESTIMATE_CHOICES.map(choice => (
                                <TouchableOpacity
                                  key={choice.label}
                                  style={styles.choice}
                                  activeOpacity={interaction.activeOpacity}
                                  onPress={() => {
                                    haptics.tap();
                                    const result = itemAtEstimateFactor(line.item, choice.value);
                                    if (result.ok) { setItem(line.key, result.item); clearDraft(line.key); }
                                  }}
                                  accessibilityRole="button"
                                  accessibilityLabel={`${choice.spoken} of ${line.item.label}`}
                                >
                                  <Text style={styles.choiceText}>{choice.label}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </View>
                      );
                    })()}
                  </View>
                ) : (
                  <View>
                    <Text style={styles.meta}>{line.item.quantity}</Text>
                    <Text style={styles.reason}>{edit.reason}</Text>
                  </View>
                )}

                <View style={styles.actions}>
                  {!line.removed && (
                    <InlineAction
                      label="Replace"
                      icon="swap-horizontal-outline"
                      variant="neutral"
                      onPress={() => { haptics.tap(); setPickTarget({ kind: 'replace', key: line.key }); }}
                    />
                  )}
                  <InlineAction
                    label={line.removed ? 'Put back' : line.fromMeal ? 'Leave out' : 'Remove'}
                    icon={line.removed ? 'arrow-undo-outline' : 'close-outline'}
                    variant="neutral"
                    onPress={() => removeLine(line.key)}
                  />
                </View>
              </View>
            );
          })}

          <View style={styles.addRow}>
            <InlineAction
              label="Add a food"
              icon="add"
              onPress={() => { haptics.tap(); setPickTarget({ kind: 'add' }); }}
            />
          </View>

          <View style={styles.summary}>
            <Ionicons name="flame-outline" size={iconSize.sm} color={colors.textSecondary} />
            <Text style={styles.summaryText}>
              {kept.length} {kept.length === 1 ? 'food' : 'foods'}
              {calories !== null ? ` · ${calories} cal` : ''}
            </Text>
          </View>

          {changed && kept.length > 0 && (
            <View style={styles.saveBack}>
              <InlineAction
                label="Save changes to this meal"
                icon="bookmark-outline"
                variant="neutral"
                surface="page"
                onPress={handleSaveChanges}
              />
              <Text style={styles.saveBackHint}>
                Replaces the foods and amounts in “{meal.name}” with the ones above.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Inside this sheet's Modal, not beside it: see the note on `overlays` in FoodLogEntrySheet. */}
        <LazySheet open={pickTarget !== null}>
          <FoodLogEntrySheet
            visible={pickTarget !== null}
            slot={slot}
            at={at}
            onPickFood={handlePicked}
            onClose={() => setPickTarget(null)}
          />
        </LazySheet>
        <NumberPadAccessory onOperator={amountOperators.onOperator} />
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    hint: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.md },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.smd,
    },
    cardRemoved: { opacity: 0.6 },
    name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    nameRemoved: { textDecorationLine: 'line-through' },
    meta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs },
    reason: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs },
    fieldLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
    },
    inputInRow: {
      flex: 1,
      paddingVertical: spacing.smd,
      color: colors.text,
      fontSize: font.md,
    },
    unitTrack: { width: 112 },
    unitText: { color: colors.textSecondary, fontSize: font.md },
    choicesBelow: { marginTop: spacing.sm },
    error: { color: colors.redText, fontSize: font.sm, marginTop: spacing.xs },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xsm },
    choice: {
      minWidth: 44,
      alignItems: 'center',
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.xsm,
    },
    choiceText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.smd },
    addRow: { flexDirection: 'row', marginTop: spacing.xs, marginBottom: spacing.md },
    summary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xsm,
      paddingTop: spacing.smd,
      borderTopWidth: border.hairline,
      borderTopColor: colors.separator,
    },
    summaryText: { color: colors.textSecondary, fontSize: font.sm },
    saveBack: { marginTop: spacing.md, alignItems: 'flex-start' },
    saveBackHint: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs },
  });
}
