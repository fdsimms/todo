import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, type FoodNutrition, type MealSlot } from '../types';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useFoodLogStore, type FoodLogDraft } from '../store/useFoodLogStore';
import { addCustomPortion, nutritionFor } from '../utils/foodNutrition';
import { combineFoodNutrition, helpingNutrition, recipeHelpingNutrition, scalePanelToAmount } from '../utils/foodLog';
import { cookedDishGrams, mealHelping, servingGrams, weighedHelping } from '../utils/mealLog';
import { perServing, recipeNutrition, recipeNutritionLines, type NutritionLine } from '../utils/recipeNutrition';
import { describeProduct } from '../utils/groceryProduct';
import { isNonFoodAisle } from '../utils/groceryAisles';
import { groceryNameKey } from '../utils/groceryParse';
import { haptics } from '../utils/haptics';
import { weighableLine } from '../utils/ingredientGrams';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { NutritionSearchSheet } from './NutritionSearchSheet';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';

/**
 * Writing down something eaten.
 *
 * **It logs only what it can measure.** Every candidate here already has a
 * nutrition panel, and the amount has to resolve against that panel's own
 * portion table before Save will do anything. A guessed helping is a wrong
 * calorie count with nothing on screen to say so, and these figures are what a
 * day's totals are built from. `scalePanelToAmount` states the three ways an
 * amount fails to resolve.
 *
 * **A dish is offered per serving and a food by its own amount**, because those
 * are the two questions that have answers. "How much of this lasagne did you
 * eat" is answerable in servings and not in grams; "how much milk" is the other
 * way round.
 *
 * **Unless the dish has been weighed, and then grams is the better question.**
 * `Recipe.cookedWeightG` is what the whole finished dish came to, so a plate
 * weighed against it is the fraction that was eaten — no servings count and no
 * assumption that the dish was divided evenly. A weighed dish opens on grams
 * and offers servings beside it; a dish nobody has weighed is offered in
 * servings as before, and one with neither a servings count nor a weight is
 * not offered at all rather than counted as one helping.
 *
 * **Nothing is written until Save**, so the swipe-down is guarded. What it
 * would otherwise lose is a picked food and a typed amount.
 *
 * **A refused amount can be weighed on the spot, which writes back to the
 * food itself, not just this entry.** When the typed amount names a unit
 * ("1 cup") the food's own portion table doesn't have, offering to weigh it
 * is cheaper than telling someone to go find a different way to say the same
 * thing they just measured. The offer is `weighableLine`'s to make rather
 * than this file's, and it is verified rather than inferred from the shape of
 * the amount: several of the ways `scalePanelToAmount` refuses are ones a
 * portion row cannot fix, and offering there costs a trip to the scale and
 * settles nothing. What's recorded is `{ unit, grams }`, exactly the
 * shape `FoodPortion` already holds — `addCustomPortion` (`foodNutrition.ts`)
 * appends it with `custom: true`, and it's written through `setItemNutrition`/
 * `setProductNutrition` so it's there the next time this food is logged, not
 * just for this entry.
 *
 * **A dish can carry lines nothing will ever fix for it.** "1 baguette,
 * warmed, for serving" has no amount to weigh and no figures to correct —
 * `recipeNutrition.ts`'s rollup already leaves it out, and `RecipeNutritionSheet`
 * has nothing to offer it either, because there is no single right answer to
 * write down once. What varies is how much of it this particular plate had,
 * which is a fact about this entry, not about the recipe — so it's asked for
 * here instead, per line, every time the dish is logged, and answering is
 * always optional. `combineFoodNutrition` folds whichever lines got an answer
 * into the dish's own figures; the rest are left out exactly as the recipe
 * page already leaves them out.
 */

interface Props {
  visible: boolean;
  /** Which meal it lands in, chosen by the section the add came from. */
  slot: MealSlot | null;
  /** The logical day being logged, so a backdated entry lands where it is shown. */
  at: Date;
  /**
   * A dish to open already picked, rather than a list to search.
   *
   * One caller: the estimate sheet, which offers a matching recipe instead of
   * guessing at a description. Handing over a list with the dish somewhere in
   * it would make the offer worth less than the tap it cost.
   */
  seedRecipeId?: string | null;
  onClose: () => void;
  /**
   * Offers to describe the meal instead of searching for it, handing off to
   * the estimate sheet. Omitted by a caller that has nowhere to send that
   * (no API key, no on-device engine) — same gate `FoodLogScreen`'s own
   * sparkles action uses, just read by the caller instead of duplicated here.
   */
  onEstimate?: () => void;
}

/** The two ways of saying how much of a dish was eaten. */
type DishMeasure = 'weight' | 'servings';

const DISH_MEASURE_OPTIONS: SegmentOption<DishMeasure>[] = [
  { value: 'weight', label: 'By weight' },
  { value: 'servings', label: 'By servings' },
];

/** What Save is about to write, once the typed amount resolves to something. */
interface Built {
  nutrition: FoodNutrition;
  grams: number | null;
  /** How the amount is written down, when the helping named itself. Foods use what was typed. */
  quantity?: string;
}

/** One thing that can be logged: a catalog food, a box of one, or a cooked dish. */
interface Candidate {
  key: string;
  label: string;
  detail: string | null;
  /** A dish is logged in servings; everything else in its own amount. */
  kind: 'food' | 'dish';
  panel: FoodNutrition | null;
  recipeId: string | null;
  itemId: string | null;
  productId: string | null;
  /** Present for a dish: what one serving of it works out to, when it says how many it makes. */
  servingPanel: FoodNutrition | null;
  /** Present for a dish: what the whole finished dish weighs, when somebody has weighed it. */
  cookedGrams: number | null;
  /** Present for a dish: how many servings its figures are, so a serving's own weight can be worked out. */
  dishServings: number | null;
}

export function FoodLogEntrySheet({ visible, slot, at, seedRecipeId, onClose, onEstimate }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const nonFoodAisles = useGroceryStore(useShallow(s => s.nonFoodAisles));
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addEntry = useFoodLogStore(s => s.addEntry);
  const setItemNutrition = useGroceryStore(s => s.setItemNutrition);
  const setProductNutrition = useGroceryStore(s => s.setProductNutrition);

  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [amount, setAmount] = useState('');
  // Which question the amount field is asking of a dish. Set from the picked
  // dish rather than remembered across picks — see `pickDish`.
  const [dishMeasure, setDishMeasure] = useState<DishMeasure>('servings');
  const [chosenSlot, setChosenSlot] = useState<MealSlot | null>(slot);
  const [weighing, setWeighing] = useState(false);
  const [weighGrams, setWeighGrams] = useState('');
  const [dbSearchOpen, setDbSearchOpen] = useState(false);
  // What was typed for each of a dish's amount-varies lines, keyed by the
  // recipe ingredient's own id. See `varyingLines` below.
  const [varyingAmounts, setVaryingAmounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setPicked(null);
    setAmount('');
    setChosenSlot(slot);
    setDbSearchOpen(false);
  }, [visible, slot]);

  // Closes the "weigh it" form whenever the picked food or its panel changes
  // out from under it — including right after a weighed portion is saved,
  // which is also when it should close.
  useEffect(() => {
    setWeighing(false);
    setWeighGrams('');
  }, [picked]);

  // A fresh dish starts with none of its varying lines answered, same as a
  // fresh food starts with no weighed portion above.
  useEffect(() => {
    setVaryingAmounts({});
  }, [picked]);


  // Only foods with a panel, because an entry with no figures records nothing a
  // total could use. A row offered here and then refused at Save would be worse
  // than not offering it.
  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    for (const product of itemProducts) {
      if (!product.nutrition) continue;
      const item = items.find(i => i.id === product.itemId);
      if (!item || isNonFoodAisle(item.aisle, nonFoodAisles)) continue;
      out.push({
        key: `p:${product.id}`,
        label: `${item.name}${describeProduct(product) ? `, ${describeProduct(product)}` : ''}`,
        detail: null,
        kind: 'food',
        panel: product.nutrition,
        recipeId: null,
        itemId: item.id,
        productId: product.id,
        servingPanel: null,
        cookedGrams: null,
        dishServings: null,
      });
    }
    for (const item of items) {
      if (isNonFoodAisle(item.aisle, nonFoodAisles)) continue;
      const panel = nutritionFor(item);
      if (!panel) continue;
      out.push({
        key: `i:${item.id}`,
        label: item.name,
        detail: null,
        kind: 'food',
        panel,
        recipeId: null,
        itemId: item.id,
        productId: null,
        servingPanel: null,
        cookedGrams: null,
        dishServings: null,
      });
    }
    for (const recipe of recipes) {
      const dish = recipeNutrition(recipe, items, itemProducts);
      if (!dish) continue;
      const serving = recipeHelpingNutrition(perServing(dish), 1);
      // Scale 1: this sheet logs the recipe as written rather than one night's
      // cooking of it, which is the same basis its figures above are on.
      const cookedGrams = cookedDishGrams(recipe.cookedWeightG, 1);
      // One or the other is enough. A dish that says how many it serves can be
      // logged in servings, and a dish somebody has weighed can be logged in
      // grams whether or not it ever named a serving count.
      if (!serving && cookedGrams === null) continue;
      out.push({
        key: `r:${recipe.id}`,
        label: recipe.name,
        // Named rather than implied: a dish's figures come from its
        // ingredients' panels through a coverage floor, so it is an estimate
        // however good those panels were.
        detail: dish.covered === dish.lines
          ? 'Estimated from every ingredient'
          : `Estimated from ${dish.covered} of ${dish.lines} ingredients`,
        kind: 'dish',
        panel: null,
        recipeId: recipe.id,
        itemId: null,
        productId: null,
        servingPanel: serving,
        cookedGrams,
        dishServings: dish.servings,
      });
    }
    return out;
  }, [items, itemProducts, recipes, nonFoodAisles]);

  // After the reset above, and off `candidates` rather than the recipe store,
  // so a dish that has no figures is left unpicked rather than opening onto a
  // form that can never save. Its amount seeds the way tapping the row does.
  //
  // Fired once per seed rather than on every `candidates` identity: that list
  // rebuilds on any grocery or recipe write, and re-running `choose` there
  // re-picked the dish and threw away whatever amount had been typed since.
  const [seededRecipeId, setSeededRecipeId] = useState<string | null>(null);
  useEffect(() => { if (!visible) setSeededRecipeId(null); }, [visible]);
  useEffect(() => {
    if (!visible || !seedRecipeId || seedRecipeId === seededRecipeId) return;
    const dish = candidates.find(c => c.recipeId === seedRecipeId);
    if (!dish) return;
    setSeededRecipeId(seedRecipeId);
    choose(dish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, seedRecipeId, seededRecipeId, candidates]);

  /**
   * Picking one, and opening it on the question it can actually answer: grams
   * for a dish that has been weighed, servings for one that hasn't. The weight
   * field opens empty because there is nothing sensible to pre-fill — a plate
   * has to be weighed — while a servings count opens at one.
   */
  const choose = (candidate: Candidate) => {
    setPicked(candidate);
    const weigh = candidate.kind === 'dish' && candidate.cookedGrams !== null;
    setDishMeasure(weigh ? 'weight' : 'servings');
    setAmount(candidate.kind === 'dish' && !weigh ? '1' : '');
  };

  const results = useMemo(() => {
    const key = groceryNameKey(query);
    if (!key) return candidates.slice(0, 40);
    return candidates.filter(c => groceryNameKey(c.label).includes(key)).slice(0, 40);
  }, [candidates, query]);

  // The dish's own lines with no fixed amount to count them by — a serving
  // suggestion like "1 baguette, warmed, for serving" rather than an
  // ingredient nobody's weighed yet. Excludes anything `weighableLine` could
  // settle with a one-time catalog weighing (RecipeNutritionSheet's own
  // remedy for that): what's left is genuinely different every time the dish
  // is made, so asking here — for this one helping — is the only place left
  // to ask it, rather than a fact `recipeNutrition.ts`'s static rollup could
  // ever hold for the recipe as a whole.
  const varyingLines = useMemo<NutritionLine[]>(() => {
    if (!picked || picked.kind !== 'dish') return [];
    const recipe = recipes.find(r => r.id === picked.recipeId);
    if (!recipe) return [];
    return recipeNutritionLines(recipe, items, itemProducts).filter(line => {
      if (line.state !== 'unmeasured' || !line.nutrition || !line.item) return false;
      return weighableLine(line.quantity, line.prep, line.nutrition, line.item.name) === null;
    });
  }, [picked, recipes, items, itemProducts]);

  const varyingResolved = useMemo(
    () => varyingLines.map(line => {
      const typed = varyingAmounts[line.id]?.trim() ?? '';
      const resolved = typed && line.nutrition ? scalePanelToAmount(line.nutrition, typed, line.prep) : null;
      return { line, typed, resolved };
    }),
    [varyingLines, varyingAmounts],
  );

  const built = useMemo<Built | null>(() => {
    if (!picked) return null;
    if (picked.kind === 'dish') {
      const typed = Number(amount.trim().replace(',', '.'));
      if (!Number.isFinite(typed) || typed <= 0) return null;
      // Rebuilt from the dish rather than scaled off the one-serving panel, so
      // the rounding happens once against the real per-serving figures.
      //
      // Looked up rather than asserted: the recipe can be deleted from another
      // screen while this sheet is open, and a non-null assertion turned that
      // into a crash rather than a Save that quietly stays disabled.
      const recipe = recipes.find(r => r.id === picked.recipeId);
      if (!recipe) return null;
      const dish = recipeNutrition(recipe, items, itemProducts);
      if (!dish) return null;
      const figures = {
        total: dish.total,
        perServing: perServing(dish),
        servings: dish.servings,
        cookedGrams: picked.cookedGrams,
      };
      const helping = dishMeasure === 'weight'
        ? weighedHelping(figures, typed)
        : mealHelping(figures, typed);
      if (!helping) return null;
      const base = helpingNutrition(helping.amounts, helping.servingText, helping.grams);
      if (!base) return null;
      const extras = varyingResolved.filter(r => r.resolved).map(r => ({ nutrition: r.resolved!.nutrition }));
      const nutrition = extras.length > 0 ? combineFoodNutrition(base, extras) : base;
      return {
        nutrition,
        // The dish's own weight stops describing the entry once something with
        // a weight of its own is folded in, so it's dropped rather than left
        // standing for a plate it no longer covers — the same call
        // `combineFoodNutrition` makes about its own `servingGrams`.
        grams: extras.length > 0 ? null : helping.grams,
        quantity: helping.servingText,
      };
    }
    if (!picked.panel) return null;
    return scalePanelToAmount(picked.panel, amount, null);
  }, [picked, amount, dishMeasure, recipes, items, itemProducts, varyingResolved]);

  // What's actually offered to weigh, which `weighableLine` decides rather
  // than the shape of the typed amount alone.
  //
  // The rule here used to be that the amount named a plain unit and hadn't
  // resolved, which sends somebody to the scale for a food a portion row
  // can't help: a per-serving panel with no serving weight wants the
  // *serving* weighed, and a table already listing small, medium and large is
  // refusing "1 medium" because the amount is ambiguous, which one more row
  // makes worse. `scalePanelToAmount` refuses on `panelMultiplier`, and that
  // helper re-runs the same refusal against the row it would write, so an
  // offer is one that actually settles the amount.
  const weighable = useMemo(() => {
    if (!picked || picked.kind !== 'food' || !picked.panel || built || !amount.trim()) return null;
    return weighableLine(amount, null, picked.panel, picked.label);
  }, [picked, built, amount]);

  /**
   * What the amount field means for a dish, said in the dish's own numbers.
   *
   * The weight line names what there is to measure against, since the plate
   * over the dish is the whole arithmetic, and adds what a serving comes to
   * when the dish also says how many it makes — the two answers are then
   * readable against each other rather than being two unrelated scales.
   */
  const dishWeightHint = useMemo(() => {
    if (!picked || picked.kind !== 'dish') return '';
    if (dishMeasure !== 'weight' || picked.cookedGrams === null) {
      return 'In servings of the recipe as written.';
    }
    const per = servingGrams({
      total: {},
      perServing: null,
      servings: picked.dishServings,
      cookedGrams: picked.cookedGrams,
    });
    return `What was on your plate. The whole dish weighs ${picked.cookedGrams} g`
      + (per !== null ? `, so a serving is about ${per} g.` : '.');
  }, [picked, dishMeasure]);

  // Listed from the food's own table rather than a fixed "e.g. 1 cup" — that
  // placeholder was suggesting an amount this specific food often can't
  // measure, which is the whole complaint. Falls back to a weight, since mass
  // is the one amount every food can always be logged by.
  const portionExamples = useMemo(() => {
    if (!picked || picked.kind !== 'food' || !picked.panel) return [];
    return picked.panel.portions.slice(0, 3).map(p => {
      const count = Number.isInteger(p.amount) ? String(p.amount) : p.amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      return `${count} ${p.label}`;
    });
  }, [picked]);

  const handleSaveWeighedPortion = () => {
    if (!picked || !picked.panel || !weighable) return;
    const grams = Number(weighGrams.trim().replace(',', '.'));
    if (!Number.isFinite(grams) || grams <= 0) { haptics.error(); return; }
    const updated = addCustomPortion(picked.panel, weighable.label, weighable.amount, grams);
    if (!updated) { haptics.error(); return; }
    if (picked.productId) setProductNutrition(picked.productId, updated);
    else if (picked.itemId) setItemNutrition(picked.itemId, updated);
    else { haptics.error(); return; }
    setPicked({ ...picked, panel: updated });
    haptics.success();
  };

  const handleSave = () => {
    if (!picked || !built) return;
    const answeredExtras = varyingResolved.filter(r => r.resolved).map(r => r.line.name);
    // A dish says how much in the words its helping already chose ("320 g",
    // "2 servings"); a food is recorded as the amount that was typed.
    const measured = built.quantity ?? amount.trim();
    const quantity = answeredExtras.length > 0
      ? `${measured}, plus ${answeredExtras.join(', ')}`
      : measured;
    const draft: FoodLogDraft = {
      label: picked.label,
      quantity,
      grams: built.grams,
      nutrition: built.nutrition,
      slot: chosenSlot,
      recipeId: picked.recipeId,
      itemId: picked.itemId,
      productId: picked.productId,
      mealPlanEntryId: null,
      at,
    };
    if (!addEntry(draft)) {
      haptics.error();
      return;
    }
    haptics.success();
    onClose();
  };

  // Nothing here has a `GroceryItem` or `ItemProduct` behind it, so there is
  // no row to attach the panel to — the candidate carries it directly, same
  // as a picked dish carries `servingPanel` rather than pointing at one.
  const handleDbPick = (nutrition: FoodNutrition, description: string) => {
    setPicked({
      key: `db:${description}`,
      label: description,
      detail: 'From a food database',
      kind: 'food',
      panel: nutrition,
      recipeId: null,
      itemId: null,
      productId: null,
      servingPanel: null,
      cookedGrams: null,
      dishServings: null,
    });
    setAmount('');
  };

  const handleCancel = () => {
    if (!picked && !amount.trim()) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const renderRow = ({ item }: { item: Candidate }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={interaction.activeOpacity}
      onPress={() => { haptics.tap(); choose(item); }}
      accessibilityRole="button"
      accessibilityLabel={`Log ${item.label}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{item.label}</Text>
        {!!item.detail && <Text style={styles.rowMeta}>{item.detail}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />
            {!picked && (
              <Text style={styles.headerTitle} numberOfLines={1}>What did you eat?</Text>
            )}
            <SheetHeaderButton label="Add" onPress={handleSave} disabled={!built} minWidth={64} />
          </View>
          {/* Full width of the header rather than squeezed between the two
              buttons, so a long scanned product name gets far more room
              before it has to truncate — see the header title note in
              CLAUDE.md's design system section. */}
          {!!picked && (
            <Text style={styles.headerFoodName} numberOfLines={2}>{picked.label}</Text>
          )}
        </View>

        {picked ? (
          // Scrolls, because this half can outgrow the sheet: the amount field
          // takes focus on arrival, so the keyboard is already up, and a dish
          // with a couple of "Anything else?" lines pushes Which meal under it
          // with no way to reach it. Its two siblings both handle this —
          // `ScanPortionSheet` with a ScrollView and `LogMealPrompt` with a
          // KeyboardAvoidingView.
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.label}>HOW MUCH</Text>
            {/* Only for a dish that can answer both ways. A weighed dish with
                no servings count has nothing to switch to, and offering the
                switch would offer a question with no answer. */}
            {picked.kind === 'dish' && picked.cookedGrams !== null && !!picked.servingPanel && (
              <View style={styles.measureRow}>
                <SegmentedControl
                  options={DISH_MEASURE_OPTIONS}
                  value={dishMeasure}
                  onChange={next => { setDishMeasure(next); setAmount(next === 'weight' ? '' : '1'); }}
                  label="How to measure it"
                />
              </View>
            )}
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              placeholder={
                picked.kind !== 'dish'
                  ? `e.g. ${portionExamples[0] ?? '100g'}`
                  : dishMeasure === 'weight' ? 'e.g. 320 (grams)' : 'e.g. 1.5'
              }
              placeholderTextColor={colors.textTertiary}
              autoFocus
              keyboardType={picked.kind === 'dish' ? 'decimal-pad' : 'default'}
              // The number pad has no return key, so without this there is no
              // way off it — the same accessory the weigh field below already
              // passes. Omitted for a food, whose amount is typed words ("1
              // cup") on the ordinary keyboard.
              inputAccessoryViewID={picked.kind === 'dish' ? NUMBER_PAD_ACCESSORY_ID : undefined}
              accessibilityLabel={
                picked.kind === 'dish' && dishMeasure === 'weight'
                  ? 'Weight on your plate in grams'
                  : 'How much you ate'
              }
            />
            <Text style={styles.hint}>
              {picked.kind === 'dish'
                ? dishWeightHint
                : portionExamples.length > 0
                  ? `A weight (like 100g), or one of this food's stated portions: ${portionExamples.join(', ')}. Anything else is refused rather than guessed at.`
                  : 'A weight, like 100g. This food has no stated portions — type an amount by volume or count and you can weigh it once to add it.'}
            </Text>

            {!!amount.trim() && !built && (
              <Text style={styles.error}>
                {picked.kind === 'dish'
                  ? (dishMeasure === 'weight'
                    ? `Enter what was on your plate, in grams, up to the ${picked.cookedGrams} g the whole dish weighs.`
                    : 'Enter how many servings you had.')
                  : 'This food has no way to weigh that amount, so the figures would be a guess. Try a weight, or an amount it states a portion for.'}
              </Text>
            )}

            {!!weighable && !weighing && (
              <InlineAction
                label={`Weigh ${amount.trim()} and save for next time`}
                icon="scale-outline"
                variant="neutral"
                onPress={() => { haptics.tap(); setWeighing(true); }}
                style={styles.weighAction}
              />
            )}

            {!!weighable && weighing && (
              <View style={styles.weighForm}>
                <Text style={styles.weighLabel}>
                  {`How many grams did ${amount.trim()} of this actually weigh?`}
                </Text>
                <View style={styles.weighRow}>
                  <TextInput
                    style={styles.weighInput}
                    value={weighGrams}
                    onChangeText={setWeighGrams}
                    placeholder="e.g. 240"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                    accessibilityLabel="Weight in grams"
                  />
                  <Text style={styles.weighUnit}>g</Text>
                  <InlineAction
                    label="Save"
                    onPress={handleSaveWeighedPortion}
                    disabled={!weighGrams.trim()}
                    haptic
                  />
                </View>
                <Text style={styles.weighHint}>
                  Remembered against this food, so the next time you log it, {amount.trim()} resolves on its own.
                </Text>
              </View>
            )}

            {!!built && (
              <Text style={styles.preview}>
                {built.nutrition.amounts.calorieKcal !== undefined
                  ? `${Math.round(built.nutrition.amounts.calorieKcal)} cal`
                  : 'No calories stated'}
                {built.grams !== null ? `, ${built.grams} g` : ''}
              </Text>
            )}

            {varyingLines.length > 0 && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>ANYTHING ELSE?</Text>
                <Text style={styles.hint}>
                  These have no fixed amount in the recipe, so they're not in the figures
                  above. Say how much you had of any you want counted, and skip the rest.
                </Text>
                {varyingResolved.map(({ line, typed, resolved }) => (
                  <View key={line.id} style={styles.varyingRow}>
                    <Text style={styles.varyingName} numberOfLines={1}>{line.name}</Text>
                    <TextInput
                      style={styles.varyingInput}
                      value={varyingAmounts[line.id] ?? ''}
                      onChangeText={text => setVaryingAmounts(a => ({ ...a, [line.id]: text }))}
                      placeholder="e.g. 2 slices"
                      placeholderTextColor={colors.textTertiary}
                      accessibilityLabel={`How much ${line.name} you had`}
                    />
                    {!!typed && !resolved && (
                      <Text style={styles.error}>Can't measure that against this food's own figures.</Text>
                    )}
                  </View>
                ))}
              </>
            )}

            <Text style={[styles.label, styles.labelSpaced]}>WHICH MEAL</Text>
            <SegmentedControl<MealSlot | null>
              options={[
                ...MEAL_SLOTS.map(s => ({ value: s as MealSlot | null, label: MEAL_SLOT_LABELS[s] })),
                { value: null, label: 'None' },
              ]}
              value={chosenSlot}
              onChange={setChosenSlot}
              columns={3}
              label="Which meal"
              surface="page"
            />
          </ScrollView>
        ) : (
          <>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search foods and recipes"
                placeholderTextColor={colors.textTertiary}
                autoCorrect={false}
              />
            </View>
            {!!onEstimate && (
              <InlineAction
                label="Describe what you ate instead"
                icon="sparkles-outline"
                variant="neutral"
                onPress={() => { haptics.tap(); onEstimate(); }}
                style={styles.estimateAction}
              />
            )}
            <FlatList
              style={styles.list}
              contentContainerStyle={styles.listContent}
              data={results}
              keyExtractor={c => c.key}
              renderItem={renderRow}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <EmptyState
                  icon="nutrition-outline"
                  title={candidates.length === 0 ? 'Nothing has figures yet' : 'No matching food'}
                  subtitle={
                    candidates.length === 0
                      ? 'A food can be logged once it has nutrition on it. Search a food database below, or open a grocery item to attach nutrition to it there.'
                      : 'Only foods and recipes with nutrition on them can be logged. Search a food database instead, or open a grocery item to attach nutrition to it there.'
                  }
                  actionLabel="Search a food database"
                  onAction={() => { haptics.tap(); setDbSearchOpen(true); }}
                />
              }
            />
          </>
        )}
      </View>
      <NutritionSearchSheet
        visible={dbSearchOpen}
        itemName={query}
        onClose={() => setDbSearchOpen(false)}
        onPick={handleDbPick}
      />
      <NumberPadAccessory />
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    headerFoodName: {
      marginTop: spacing.xs,
      textAlign: 'center',
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    bodyScroll: { flex: 1 },
    body: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    labelSpaced: { marginTop: spacing.lg },
    // Margin on both sides: the label above has none of its own below it, and
    // the amount field below has only spacing.xs of its own.
    measureRow: { marginTop: spacing.sm, marginBottom: spacing.xs },
    input: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginTop: spacing.xs,
    },
    hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, marginTop: spacing.xs },
    error: { color: colors.red, fontSize: font.sm, lineHeight: 18, marginTop: spacing.sm },
    preview: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold, marginTop: spacing.sm },
    weighAction: { alignSelf: 'flex-start', marginTop: spacing.sm },
    weighForm: {
      marginTop: spacing.sm,
      padding: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      gap: spacing.xs,
    },
    weighLabel: { color: colors.text, fontSize: font.sm, lineHeight: 18 },
    weighRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    weighInput: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bg,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    weighUnit: { color: colors.textSecondary, fontSize: font.sm },
    weighHint: { color: colors.textTertiary, fontSize: font.xs, lineHeight: 14 },
    varyingRow: { marginTop: spacing.sm },
    varyingName: { color: colors.text, fontSize: font.sm, marginBottom: spacing.xs },
    varyingInput: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.md, padding: 0 },
    estimateAction: { alignSelf: 'flex-start', marginHorizontal: spacing.md, marginBottom: spacing.sm },
    list: { flex: 1 },
    listContent: { flexGrow: 1, paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
    },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text, fontSize: font.md },
    rowMeta: { color: colors.textSecondary, fontSize: font.sm },
  });
}
