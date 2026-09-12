import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { perServing, recipeNutrition } from '../utils/recipeNutrition';
import {
  cookedDishGrams,
  defaultHelpings,
  mealHelping,
  servingGrams,
  weighedHelping,
} from '../utils/mealLog';
import { helpingNutrition } from '../utils/foodLog';
import { haptics } from '../utils/haptics';
import { CountStepper } from './CountStepper';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';

/** The two ways of saying how much of a dish was eaten. */
type Measure = 'weight' | 'servings';

const MEASURE_OPTIONS: SegmentOption<Measure>[] = [
  { value: 'weight', label: 'By weight' },
  { value: 'servings', label: 'By servings' },
];

/**
 * "You just finished dinner. Log it?"
 *
 * **Mounted once, beside `FinishLeftoverPrompt`, not on any one screen** —
 * completing the Eat step can land here from Today, Search, Stuck, the widget
 * or a bulk-complete, and finishing a leftover can land from four more places
 * again. Same reasoning that put the leftover Alert there.
 *
 * **It waits for the leftover Alert rather than stacking on it.** Ticking the
 * meal task for a leftover-backed dinner sets both pending flags in the same
 * commit, and a Modal drawn over a native Alert is a dialog nobody can read.
 * `CookRecap` already defers on exactly this flag.
 *
 * **It asks one question: how much.** Everything else the moment already
 * knows. A recipe scaled for four and eaten by one person is a quarter, which
 * is the difference between a useful record and a wrong one, and it is the
 * only thing the app cannot work out for itself.
 *
 * **A dish that has been weighed is answered on a scale, and that is the
 * accurate half.** Servings are an estimate about how evenly a dish was
 * divided; the plate over the whole dish is arithmetic. So the weight field
 * leads whenever `Recipe.cookedWeightG` is set, servings stay for every dish
 * nobody has weighed, and either way the entry records the grams it knows —
 * see `mealLog.ts`.
 *
 * **Declining costs one tap and is never punished.** No badge, no "you didn't
 * log", no streak, and the offer does not come back for that meal.
 */

export function LogMealPrompt() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const pending = useFoodLogStore(s => s.pendingMealLog);
  const setPending = useFoodLogStore(s => s.setPendingMealLog);
  const addEntry = useFoodLogStore(s => s.addEntry);
  const setLogMeal = useMealPlanStore(s => s.setLogMeal);
  const pendingFinishLeftoverId = useLeftoverStore(s => s.pendingFinishLeftoverId);
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));

  const [helpings, setHelpings] = useState<number | null>(defaultHelpings());
  const [platedText, setPlatedText] = useState('');
  const [measure, setMeasure] = useState<Measure>('servings');

  useEffect(() => {
    if (pending) {
      setHelpings(defaultHelpings());
      // What the container weighed, when something already knows — finishing a
      // leftover that was weighed on the way into the fridge. A figure to
      // correct, not an answer: see PendingMealLog.grams.
      setPlatedText(pending.grams === null ? '' : String(pending.grams));
    }
  }, [pending]);

  // The dish's figures, computed when the prompt opens rather than carried on
  // the pending flag: the store that sets it must not reach the recipe store,
  // and the figures are the same either way.
  const recipesById = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);

  const figures = useMemo(() => {
    if (!pending?.recipeId) return null;
    const recipe = recipes.find(r => r.id === pending.recipeId);
    if (!recipe) return null;
    const dish = recipeNutrition(
      recipe,
      items,
      itemProducts,
      // Every recipe, not just this one: a composed dish measures its
      // components through this map, and a map holding only the outer recipe
      // would silently drop everything they contribute.
      recipesById,
      // The either/or answers that cooking actually used, so a night that
      // picked serrano over jalapeño is measured as the dish that was made
      // rather than as the one the recipe leaves open. Same read
      // collectPlannedIngredients makes off the same field.
      { chosen: pending.choices },
      pending.scale,
    );
    if (!dish) return null;
    return {
      total: dish.total,
      perServing: perServing(dish),
      servings: dish.servings,
      // Multiplied by this cooking's own scale, exactly as the figures above
      // already are: a doubled batch weighs twice what the recipe says.
      cookedGrams: cookedDishGrams(recipe.cookedWeightG, pending.scale),
    };
  }, [pending, recipes, recipesById, items, itemProducts]);

  // Weight leads for a dish somebody has weighed, and is simply unavailable
  // for one nobody has: there is nothing to measure a plate against. Reset per
  // opening rather than remembered, since the next meal is a different dish.
  const canWeigh = figures?.cookedGrams !== null && figures?.cookedGrams !== undefined;
  useEffect(() => {
    setMeasure(canWeigh ? 'weight' : 'servings');
  }, [pending, canWeigh]);

  const plated = Number(platedText.trim().replace(',', '.'));
  const helping = measure === 'weight' && canWeigh
    ? weighedHelping(figures, Number.isFinite(plated) ? plated : 0)
    : mealHelping(figures, helpings ?? 0);
  const oneServing = figures ? servingGrams(figures) : null;

  // Nothing measurable came back, so there is no question worth asking. The
  // flag is cleared rather than left pending, or the next thing that sets one
  // would find it already occupied.
  useEffect(() => {
    if (pending && !figures) setPending(null);
  }, [pending, figures, setPending]);

  if (!pending || !figures || pendingFinishLeftoverId) return null;

  const close = () => { Keyboard.dismiss(); setPending(null); };

  const handleLog = () => {
    if (!helping) return;
    const nutrition = helpingNutrition(helping.amounts, helping.servingText, helping.grams);
    if (!nutrition) { haptics.error(); return; }
    addEntry({
      label: pending.label,
      quantity: helping.servingText,
      grams: helping.grams,
      // Already scaled to the helping, so this is one of them.
      nutrition: { ...nutrition, servingText: helping.servingText },
      slot: pending.slot,
      recipeId: pending.recipeId,
      mealPlanEntryId: pending.mealPlanEntryId,
    });
    haptics.success();
    close();
  };

  const handleNever = () => {
    // The per-meal "no", written only when somebody says it in as many words.
    // Declining once is not declining for ever, which is why "Not this time"
    // above writes nothing at all.
    if (pending.mealPlanEntryId) setLogMeal(pending.mealPlanEntryId, false);
    haptics.tap();
    close();
  };

  return (
    <Modal visible animationType="fade" transparent onRequestClose={close}>
      <NumberPadAccessory />
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Log {pending.label.toLowerCase()}?</Text>
          <Text style={styles.body}>
            {helping
              ? `About ${Math.round(helping.amounts.calorieKcal ?? 0)} cal for ${helping.servingText}.`
              : 'Choose how much you had.'}
          </Text>

          {canWeigh && (
            <View style={styles.stepper}>
              <SegmentedControl
                options={MEASURE_OPTIONS}
                value={measure}
                onChange={setMeasure}
                label="How to measure it"
              />
            </View>
          )}

          {measure === 'weight' && canWeigh ? (
            <>
              <View style={styles.weightRow}>
                <TextInput
                  style={styles.weightInput}
                  value={platedText}
                  onChangeText={setPlatedText}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                  placeholder="e.g. 320"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={6}
                  accessibilityLabel="Weight on your plate in grams"
                />
                <Text style={styles.weightUnit}>g</Text>
              </View>
              <Text style={styles.hint}>
                {pending.grams !== null
                  ? `What the container weighed when you put it away. Change it if you didn't finish it all. The whole dish weighs ${figures.cookedGrams} g.`
                  : `What was on your plate. The whole dish weighs ${figures.cookedGrams} g`
                    + (oneServing !== null ? `, so a serving is about ${oneServing} g.` : '.')}
              </Text>
            </>
          ) : (
            <>
              <View style={styles.stepper}>
                <CountStepper
                  value={helpings}
                  onChange={setHelpings}
                  min={1}
                  max={20}
                  label={helping?.countsServings ? 'Servings' : 'Whole dishes'}
                />
              </View>
              <Text style={styles.hint}>
                {figures.perServing
                  ? 'In servings of the recipe as it was cooked.'
                  : 'This recipe doesn\'t say how many servings it makes, so this counts whole dishes.'}
              </Text>
            </>
          )}

          <View style={styles.actions}>
            <SheetHeaderButton label="Log it" onPress={handleLog} disabled={!helping} />
            <TouchableOpacity
              style={styles.secondary}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); close(); }}
              accessibilityRole="button"
              accessibilityLabel="Not this time"
            >
              <Text style={styles.secondaryText}>Not this time</Text>
            </TouchableOpacity>
            {!!pending.mealPlanEntryId && (
              <TouchableOpacity
                style={styles.secondary}
                activeOpacity={interaction.activeOpacity}
                onPress={handleNever}
                accessibilityRole="button"
                accessibilityLabel="Never ask about this meal"
              >
                <Text style={styles.secondaryText}>Don't ask for this meal</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.backdrop,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      borderWidth: border.hairline,
      borderColor: colors.separator,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    title: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
    body: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
    stepper: { marginTop: spacing.sm, marginBottom: spacing.xs },
    weightRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    weightInput: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    weightUnit: { color: colors.textSecondary, fontSize: font.sm },
    hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
    actions: { marginTop: spacing.md, gap: spacing.sm, alignItems: 'flex-start' },
    secondary: { paddingVertical: spacing.xs },
    secondaryText: { color: colors.textSecondary, fontSize: font.sm },
  });
}
