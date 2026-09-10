import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
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
import { recipeHelpingNutrition, scalePanelToAmount } from '../utils/foodLog';
import { perServing, recipeNutrition } from '../utils/recipeNutrition';
import { describeProduct } from '../utils/groceryProduct';
import { groceryNameKey } from '../utils/groceryParse';
import { haptics } from '../utils/haptics';
import { parseQuantity, rationalToNumber } from '../utils/quantity';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { NutritionSearchSheet } from './NutritionSearchSheet';
import { SegmentedControl } from './SegmentedControl';
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
 * way round. A recipe that never said how many servings it makes is not offered
 * at all rather than counted as one helping.
 *
 * **Nothing is written until Save**, so the swipe-down is guarded. What it
 * would otherwise lose is a picked food and a typed amount.
 *
 * **A refused amount can be weighed on the spot, which writes back to the
 * food itself, not just this entry.** When the typed amount names a unit
 * ("1 cup") the food's own portion table doesn't have, offering to weigh it
 * is cheaper than telling someone to go find a different way to say the same
 * thing they just measured. What's recorded is `{ unit, grams }`, exactly the
 * shape `FoodPortion` already holds — `addCustomPortion` (`foodNutrition.ts`)
 * appends it with `custom: true`, and it's written through `setItemNutrition`/
 * `setProductNutrition` so it's there the next time this food is logged, not
 * just for this entry.
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
  /** Present for a dish: what one serving of it works out to. */
  servingPanel: FoodNutrition | null;
}

export function FoodLogEntrySheet({ visible, slot, at, seedRecipeId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addEntry = useFoodLogStore(s => s.addEntry);
  const setItemNutrition = useGroceryStore(s => s.setItemNutrition);
  const setProductNutrition = useGroceryStore(s => s.setProductNutrition);

  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [amount, setAmount] = useState('');
  const [chosenSlot, setChosenSlot] = useState<MealSlot | null>(slot);
  const [weighing, setWeighing] = useState(false);
  const [weighGrams, setWeighGrams] = useState('');
  const [dbSearchOpen, setDbSearchOpen] = useState(false);

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


  // Only foods with a panel, because an entry with no figures records nothing a
  // total could use. A row offered here and then refused at Save would be worse
  // than not offering it.
  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    for (const product of itemProducts) {
      if (!product.nutrition) continue;
      const item = items.find(i => i.id === product.itemId);
      if (!item) continue;
      out.push({
        key: `p:${product.id}`,
        label: `${item.name}${describeProduct(product) ? `, ${describeProduct(product)}` : ''}`,
        detail: 'This one in particular',
        kind: 'food',
        panel: product.nutrition,
        recipeId: null,
        itemId: item.id,
        productId: product.id,
        servingPanel: null,
      });
    }
    for (const item of items) {
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
      });
    }
    for (const recipe of recipes) {
      const dish = recipeNutrition(recipe, items, itemProducts);
      if (!dish) continue;
      const serving = recipeHelpingNutrition(perServing(dish), 1);
      if (!serving) continue;
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
      });
    }
    return out;
  }, [items, itemProducts, recipes]);

  // After the reset above, and off `candidates` rather than the recipe store,
  // so a dish that has no figures is left unpicked rather than opening onto a
  // form that can never save. Its amount seeds the way tapping the row does.
  useEffect(() => {
    if (!visible || !seedRecipeId) return;
    const dish = candidates.find(c => c.recipeId === seedRecipeId);
    if (!dish) return;
    setPicked(dish);
    setAmount('1');
  }, [visible, seedRecipeId, candidates]);

  const results = useMemo(() => {
    const key = groceryNameKey(query);
    if (!key) return candidates.slice(0, 40);
    return candidates.filter(c => groceryNameKey(c.label).includes(key)).slice(0, 40);
  }, [candidates, query]);

  const built = useMemo(() => {
    if (!picked) return null;
    if (picked.kind === 'dish') {
      const helpings = Number(amount.trim().replace(',', '.'));
      if (!Number.isFinite(helpings) || helpings <= 0) return null;
      // Rebuilt from the dish rather than scaled off the one-serving panel, so
      // the rounding happens once against the real per-serving figures.
      const dish = recipeNutrition(
        recipes.find(r => r.id === picked.recipeId)!,
        items,
        itemProducts,
      );
      if (!dish) return null;
      const nutrition = recipeHelpingNutrition(perServing(dish), helpings);
      return nutrition ? { nutrition, grams: null as number | null } : null;
    }
    if (!picked.panel) return null;
    return scalePanelToAmount(picked.panel, amount, null);
  }, [picked, amount, recipes, items, itemProducts]);

  // What's actually offered to weigh: the amount typed has to name a plain
  // unit ("1 cup") rather than a sized container ("14 oz can", already a
  // weight) or nothing at all ("a pinch") — the one shape this food's own
  // portion table could be missing a row for.
  const weighable = useMemo(() => {
    if (!picked || picked.kind !== 'food' || built || !amount.trim()) return null;
    const q = parseQuantity(amount);
    if (q.amount === null || !q.unit || q.container) return null;
    return { unit: q.unit, count: rationalToNumber(q.amount) };
  }, [picked, built, amount]);

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
    const updated = addCustomPortion(picked.panel, weighable.unit, weighable.count, grams);
    if (!updated) { haptics.error(); return; }
    if (picked.productId) setProductNutrition(picked.productId, updated);
    else if (picked.itemId) setItemNutrition(picked.itemId, updated);
    else { haptics.error(); return; }
    setPicked({ ...picked, panel: updated });
    haptics.success();
  };

  const handleSave = () => {
    if (!picked || !built) return;
    const draft: FoodLogDraft = {
      label: picked.label,
      quantity: amount.trim(),
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
      onPress={() => { haptics.tap(); setPicked(item); setAmount(item.kind === 'dish' ? '1' : ''); }}
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
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {picked ? picked.label : 'What did you eat?'}
          </Text>
          <SheetHeaderButton label="Add" onPress={handleSave} disabled={!built} minWidth={64} />
        </View>

        {picked ? (
          <View style={styles.body}>
            <Text style={styles.label}>HOW MUCH</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              placeholder={picked.kind === 'dish' ? 'e.g. 1.5' : `e.g. ${portionExamples[0] ?? '100g'}`}
              placeholderTextColor={colors.textTertiary}
              autoFocus
              keyboardType={picked.kind === 'dish' ? 'decimal-pad' : 'default'}
              accessibilityLabel="How much you ate"
            />
            <Text style={styles.hint}>
              {picked.kind === 'dish'
                ? 'In servings of the recipe as written.'
                : portionExamples.length > 0
                  ? `A weight (like 100g), or one of this food's stated portions: ${portionExamples.join(', ')}. Anything else is refused rather than guessed at.`
                  : 'A weight, like 100g. This food states no portions to measure by, so a volume or a count can\'t be used yet.'}
            </Text>

            {!!amount.trim() && !built && (
              <Text style={styles.error}>
                {picked.kind === 'dish'
                  ? 'Enter how many servings you had.'
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
                {built.grams !== null ? `, ${built.grams}g` : ''}
              </Text>
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

            <TouchableOpacity
              style={styles.change}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setPicked(null); setAmount(''); }}
              accessibilityRole="button"
              accessibilityLabel="Pick a different food"
            >
              <Text style={styles.changeText}>Pick something else</Text>
            </TouchableOpacity>
          </View>
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
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    body: { padding: spacing.md, gap: spacing.xs },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    labelSpaced: { marginTop: spacing.lg },
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
    change: { marginTop: spacing.lg, alignSelf: 'flex-start' },
    changeText: { color: colors.accent, fontSize: font.sm },
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
