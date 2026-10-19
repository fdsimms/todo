import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { useStoreWhileOpen } from '../hooks/useStoreWhileOpen';
import type { GroceryItem, ItemPick, ItemProduct, ItemSubLink, MealPlanEntry, Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { perServing, recipeNutrition } from '../utils/recipeNutrition';
import { standingSwapMap } from '../utils/standingSwaps';
import { flattenRecipeIngredients, type ChoiceResolution } from '../utils/recipeComponents';
import { describeEitherPair, eitherPairsInUse, lastUsedPick, withItemPick } from '../utils/itemEither';
import {
  cookedDishGrams,
  defaultHelpings,
  mealHelping,
  servingGrams,
  weighedHelping,
} from '../utils/mealLog';
import { helpingNutrition, logInstantFor } from '../utils/foodLog';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import { CountStepper } from './CountStepper';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { PressableScale } from './PressableScale';
import { TextField } from './TextField';

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
 *
 * **Somebody who doesn't track food can say so here, once.** "Stop asking
 * after meals" writes the same `mealLogPrompt` switch Settings holds, from the
 * moment the question is asked, rather than leaving the per-meal "no" as the
 * only decline on offer (it is written on one plan entry, so next week's
 * copied dinner asked again). Offered only when the app raised the prompt on
 * its own: a person who tapped to log a meal asked for this sheet, and that
 * switch doesn't govern it.
 */

// What the catalog reads hold before there has been a meal to ask about.
const NO_RECIPES: Recipe[] = [];
const NO_ITEMS: GroceryItem[] = [];
const NO_PRODUCTS: ItemProduct[] = [];
const NO_SUBS: ItemSubLink[] = [];
const NO_ENTRIES: MealPlanEntry[] = [];
const NO_PICKS: ItemPick[] = [];

export function LogMealPrompt() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const pending = useFoodLogStore(s => s.pendingMealLog);
  const setPending = useFoodLogStore(s => s.setPendingMealLog);
  const addEntry = useFoodLogStore(s => s.addEntry);
  const setLogMeal = useMealPlanStore(s => s.setLogMeal);
  const setMealLogPrompt = useSettingsStore(s => s.setMealLogPrompt);
  const pendingFinishLeftoverId = useLeftoverStore(s => s.pendingFinishLeftoverId);
  // Read only while there is a meal to ask about: this is mounted for the
  // life of the app, and the maps below were rebuilt on every grocery and
  // recipe write with nothing on screen to use them.
  const asking = pending !== null;
  const recipes = useStoreWhileOpen(useRecipeStore, asking, s => s.recipes, NO_RECIPES);
  const items = useStoreWhileOpen(useGroceryStore, asking, s => s.items, NO_ITEMS);
  const itemProducts = useStoreWhileOpen(useGroceryStore, asking, s => s.itemProducts, NO_PRODUCTS);
  const itemSubs = useStoreWhileOpen(useGroceryStore, asking, s => s.itemSubs, NO_SUBS);
  const mealEntries = useStoreWhileOpen(useMealPlanStore, asking, s => s.entries, NO_ENTRIES);
  const setItemPicks = useMealPlanStore(s => s.setItemPicks);
  // The answers to "either one" pairs, held per offer: the pending flag carries
  // what the meal already had, and picking here adds to it. Keyed by the offer
  // itself so a stale answer from the last meal is never read for this one.
  const [pickState, setPickState] = useState<{ offer: unknown; picks: ItemPick[] }>({ offer: null, picks: [] });
  const [draftPicks, setDraftPicks] = useState<Record<string, string>>({});

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
  // "Always use oat milk for milk", applied as the recipe page's nutrition row
  // and the meal plan's week line apply it, so the dish logged is the dish
  // those showed rather than the recipe as written. See standingSwaps.ts.
  const swaps = useMemo(() => standingSwapMap(itemSubs, items), [itemSubs, items]);

  const picks = pickState.offer === pending ? pickState.picks : (pending?.itemPicks ?? NO_PICKS);
  // This cooking as the logger sees it: always a cooking in hand, so a pair
  // nobody has answered is undecided here rather than read as written.
  const resolution = useMemo<ChoiceResolution | null>(() => pending ? {
    chosen: pending.choices,
    ...(pending.overrides?.length ? { overrides: pending.overrides } : {}),
    itemPicks: picks,
  } : null, [pending, picks]);

  // The "either one" pairs this dish involves and which are still unanswered.
  // Asked before anything is measured: two items that differ in nutrition are
  // the one thing the figures below must not guess (`itemEither.ts`).
  const eitherPairs = useMemo(() => {
    if (!pending?.recipeId || !resolution) return [];
    const recipe = recipes.find(r => r.id === pending.recipeId);
    if (!recipe) return [];
    return eitherPairsInUse(flattenRecipeIngredients(recipe, recipesById, resolution, swaps));
  }, [pending, resolution, recipes, recipesById, swaps]);
  const undecided = eitherPairs.filter(p => p.use === null);
  const suggestionFor = (pair: (typeof undecided)[number]): string | null => {
    const last = lastUsedPick(mealEntries, pair.pair);
    return last && pair.items.some(i => i.nameKey === last) ? last : null;
  };
  const chosenFor = (pair: (typeof undecided)[number]): string | null => draftPicks[pair.pair] ?? suggestionFor(pair);
  const allChosen = undecided.every(p => chosenFor(p) !== null);

  const figures = useMemo(() => {
    if (!pending?.recipeId || !resolution || undecided.length > 0) return null;
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
      resolution,
      pending.scale,
      swaps,
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
  }, [pending, resolution, undecided.length, recipes, recipesById, items, itemProducts, swaps]);

  // Nothing measurable came back, so there is no question worth asking. The
  // flag is cleared rather than left pending, or the next thing that sets one
  // would find it already occupied.
  //
  // A meal somebody tapped to log goes on to the search sheet rather than
  // vanishing: from the food log's planned row or the meal plan's "Log this
  // meal", a recipe with no figures used to make the button do nothing at
  // all. Unasked (a meal's own finish), it still just doesn't come up.
  const setPendingManual = useFoodLogStore(s => s.setPendingManualMealLog);
  useEffect(() => {
    // Waiting on an "either one" answer is not "nothing measurable": the offer
    // stays up and asks.
    if (!pending || figures || undecided.length > 0) return;
    setPending(null);
    if (pending.asked) {
      setPendingManual({
        label: pending.label,
        slot: pending.slot,
        dayKey: pending.dayKey,
        mealPlanEntryId: pending.mealPlanEntryId,
      });
    }
  }, [pending, figures, undecided.length, setPending, setPendingManual]);

  // Declining clears `pending`/`figures` in the same commit that starts the
  // close animation, but SheetModal keeps rendering this sheet's children
  // through that animation (see its own doc comment) — it has to stay
  // mounted and toggle `visible`, the way every other sheet in the app does,
  // rather than being unmounted outright when there's nothing pending. This
  // used to return null instead, tearing the whole SheetModal down rather
  // than lowering `visible`, which raced the keyboard's dismissal against
  // the Modal's own and froze the screen behind it. Holding the last real
  // values is what gives the still-mounted sheet something sane to render
  // while it fades out.
  const lastPending = useRef(pending);
  const lastFigures = useRef(figures);
  if (pending && figures) {
    lastPending.current = pending;
    lastFigures.current = figures;
  }
  const shown = pending ?? lastPending.current;
  const shownFigures = figures ?? lastFigures.current;
  // Waits for CookRecap too, which the same tick raises: the recap is where a
  // dish gets weighed, and asking "how much did you have?" first meant the
  // prompt had no weight to measure a plate against. The recap clears itself
  // when it has nothing to ask, so this can't be starved.
  const cookRecapUp = useMealPlanStore(s => s.cookRecap !== null);
  const asksWhichItem = !!pending && undecided.length > 0;
  const visible = !!pending && (!!figures || asksWhichItem) && !pendingFinishLeftoverId && !cookRecapUp;

  // Weight leads for a dish somebody has weighed, and is simply unavailable
  // for one nobody has: there is nothing to measure a plate against. Reset per
  // opening rather than remembered, since the next meal is a different dish.
  const canWeigh = shownFigures?.cookedGrams !== null && shownFigures?.cookedGrams !== undefined;
  useEffect(() => {
    setMeasure(canWeigh ? 'weight' : 'servings');
  }, [pending, canWeigh]);

  const plated = Number(platedText.trim().replace(',', '.'));
  const helping = measure === 'weight' && canWeigh
    ? weighedHelping(shownFigures, Number.isFinite(plated) ? plated : 0)
    : mealHelping(shownFigures, helpings ?? 0);
  const oneServing = shownFigures ? servingGrams(shownFigures) : null;

  const close = () => { Keyboard.dismiss(); setPending(null); };

  const handleLog = () => {
    if (!pending || !helping) return;
    const nutrition = helpingNutrition(helping.amounts, helping.servingText, helping.grams);
    if (!nutrition) { haptics.error(); return; }
    // The real moment for a meal eaten today, noon for any other day, and
    // never the day key's own midnight: see `logInstantFor`. addEntry keys it
    // with getLogicalDayKey, so a dinner logged at 1 AM inside the grace
    // window still lands on the day it was planned for.
    const at = logInstantFor(pending.dayKey, dayKeyOf(getCurrentDayStart()));
    addEntry({
      label: pending.label,
      quantity: helping.servingText,
      grams: helping.grams,
      // Already scaled to the helping, so this is one of them.
      nutrition: { ...nutrition, servingText: helping.servingText },
      slot: pending.slot,
      recipeId: pending.recipeId,
      mealPlanEntryId: pending.mealPlanEntryId,
      // So a later re-measure of this dish reads the same lines this one did.
      itemPicks: picks,
      at,
    });
    haptics.success();
    close();
  };

  const handleContinue = () => {
    if (!pending || !allChosen) return;
    // Everything still open gets its confirmed answer, the suggestion included:
    // preselected is not answered until this tap.
    const next = undecided.reduce((acc, p) => {
      const use = chosenFor(p);
      return use ? withItemPick(acc, p.pair, use) : acc;
    }, picks);
    setPickState({ offer: pending, picks: next });
    setDraftPicks({});
    // The cooking records what it used, so the plan, the shopping read and a
    // re-measure all agree with the log.
    if (pending.mealPlanEntryId) setItemPicks(pending.mealPlanEntryId, next);
    haptics.tap();
  };

  const handleNever = () => {
    // The per-meal "no", written only when somebody says it in as many words.
    // Declining once is not declining for ever, which is why "Not this time"
    // above writes nothing at all.
    if (pending?.mealPlanEntryId) setLogMeal(pending.mealPlanEntryId, false);
    haptics.tap();
    close();
  };

  const handleStopAsking = () => {
    // The whole offer, not this meal: the Settings switch, written from here so
    // it can be said at the moment it is asked. Settings can turn it back on.
    setMealLogPrompt(false);
    haptics.tap();
    close();
  };

  if (!shown) return null;

  if (asksWhichItem) {
    return (
      <SheetModal visible={visible} animationType="fade" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>What went into {shown.label}?</Text>
            <Text style={styles.body}>
              It calls for something you can swap for another. They have different nutrition, so pick the one you used.
            </Text>
            {undecided.map(pair => (
              <View key={pair.pair} style={styles.pickGroup}>
                <Text style={styles.pickLabel}>{describeEitherPair(pair.items)}</Text>
                {pair.items.map(item => {
                  const selected = chosenFor(pair) === item.nameKey;
                  return (
                    <PressableScale
                      key={item.id}
                      style={[styles.pickOption, selected && styles.pickOptionSelected]}
                      onPress={() => { haptics.tap(); setDraftPicks(d => ({ ...d, [pair.pair]: item.nameKey })); }}
                      accessibilityRole="radio"
                      accessibilityLabel={item.name}
                      accessibilityState={{ selected }}
                    >
                      <Text style={styles.pickOptionName}>{item.name}</Text>
                      {suggestionFor(pair) === item.nameKey && (
                        <Text style={styles.pickOptionHint}>Used last time</Text>
                      )}
                    </PressableScale>
                  );
                })}
              </View>
            ))}
            <View style={styles.actions}>
              <View style={styles.buttonRow}>
                <PressableScale
                  style={[styles.button, styles.buttonNeutral]}
                  onPress={() => { haptics.tap(); close(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Not this time"
                >
                  <Text style={styles.buttonNeutralText}>Not this time</Text>
                </PressableScale>
                <PressableScale
                  style={[styles.button, styles.buttonPrimary, !allChosen && styles.buttonDisabled]}
                  onPress={handleContinue}
                  disabled={!allChosen}
                  accessibilityRole="button"
                  accessibilityLabel="Continue"
                  accessibilityState={{ disabled: !allChosen }}
                >
                  <Text style={styles.buttonPrimaryText}>Continue</Text>
                </PressableScale>
              </View>
            </View>
          </View>
        </View>
      </SheetModal>
    );
  }

  return (
    <SheetModal visible={visible} animationType="fade" transparent onRequestClose={close}>
      <NumberPadAccessory />
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Log {shown.label}?</Text>
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
                <TextField
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
                {shown.grams !== null
                  ? `What the container weighed when you put it away. Change it if you didn’t finish it all. The whole dish weighs ${shownFigures?.cookedGrams} g.`
                  : `What was on your plate. The whole dish weighs ${shownFigures?.cookedGrams} g`
                    + (oneServing !== null ? `, so a serving is about ${oneServing} g.` : '.')}
              </Text>
            </>
          ) : (
            <>
              <View style={styles.stepper}>
                {/* Half steps, down to a half: a bowl of soup that was half
                    a serving, or half the dish, was otherwise unsayable here
                    and had to be logged as one and corrected afterwards.
                    `describeHelping` already words both ("half the dish"). */}
                <CountStepper
                  value={helpings}
                  onChange={setHelpings}
                  min={0.5}
                  max={20}
                  step={0.5}
                  label={helping?.countsServings ? 'Servings' : 'Whole dishes'}
                />
              </View>
              <Text style={styles.hint}>
                {shownFigures?.perServing
                  ? 'In servings of the recipe as it was cooked.'
                  : 'This recipe has no serving count, so this counts whole dishes.'}
              </Text>
            </>
          )}

          {/* One primary, one neutral beside it, and the two "no, and stop
              bringing it up" answers as quiet links underneath. They were four
              equal text rows, so the one that logs read as one of a list. */}
          <View style={styles.actions}>
            <View style={styles.buttonRow}>
              <PressableScale
                style={[styles.button, styles.buttonNeutral]}
                onPress={() => { haptics.tap(); close(); }}
                accessibilityRole="button"
                accessibilityLabel="Not this time"
              >
                <Text style={styles.buttonNeutralText}>Not this time</Text>
              </PressableScale>
              <PressableScale
                style={[styles.button, styles.buttonPrimary, !helping && styles.buttonDisabled]}
                onPress={handleLog}
                disabled={!helping}
                accessibilityRole="button"
                accessibilityLabel="Log it"
                accessibilityState={{ disabled: !helping }}
              >
                <Text style={styles.buttonPrimaryText}>Log it</Text>
              </PressableScale>
            </View>
            {(!!shown.mealPlanEntryId || !shown.asked) && (
              <View style={styles.quietLinks}>
                {!!shown.mealPlanEntryId && (
                  <TouchableOpacity
                    style={styles.quietLink}
                    activeOpacity={interaction.activeOpacity}
                    onPress={handleNever}
                    accessibilityRole="button"
                    accessibilityLabel="Don’t ask about this meal"
                  >
                    <Text style={styles.quietLinkText}>Don’t ask about this meal</Text>
                  </TouchableOpacity>
                )}
                {!shown.asked && (
                  <View style={styles.quietGroup}>
                    <TouchableOpacity
                      style={styles.quietLink}
                      activeOpacity={interaction.activeOpacity}
                      onPress={handleStopAsking}
                      accessibilityRole="button"
                      accessibilityLabel="Stop asking after meals"
                      accessibilityHint="Turn “Ask what you ate” back on in Settings, under Groceries & meals."
                    >
                      <Text style={styles.quietLinkText}>Stop asking after meals</Text>
                    </TouchableOpacity>
                    <Text style={[styles.hint, styles.hintCentered, styles.hintDim]}>
                      Turn it back on in Settings, under Groceries & meals.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SheetModal>
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
    hintCentered: { textAlign: 'center' },
    hintDim: { color: colors.textTertiary },
    actions: { marginTop: spacing.md, gap: spacing.sm },
    buttonRow: { flexDirection: 'row', gap: spacing.sm },
    button: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
    },
    buttonPrimary: { backgroundColor: colors.accentFill },
    buttonPrimaryText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
    buttonNeutral: { backgroundColor: colors.bgTertiary },
    buttonNeutralText: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    buttonDisabled: { opacity: 0.4 },
    quietLinks: { marginTop: spacing.xs, gap: spacing.sm },
    quietGroup: { gap: spacing.xsm },
    quietLink: {
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: border.sm,
      borderColor: colors.controlBorder,
      paddingHorizontal: spacing.md,
    },
    quietLinkText: { color: colors.text, fontSize: font.sm },
    pickGroup: { marginTop: spacing.sm, gap: spacing.xsm },
    pickLabel: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold },
    pickOption: {
      minHeight: 48,
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: border.sm,
      borderColor: colors.controlBorder,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pickOptionSelected: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
    pickOptionName: { color: colors.text, fontSize: font.md },
    pickOptionHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  });
}
