import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NUTRIENT_KEYS, type FoodNutrition, type NutrientKey } from '../types';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { addCustomPortion, NUTRIENT_LABEL } from '../utils/foodNutrition';
import { unfixableQuantityReason, weighableLine, type LineWeighing } from '../utils/ingredientGrams';
import {
  lineContribution,
  perServing,
  type NutritionLine,
  type RecipeNutritionReading,
} from '../utils/recipeNutrition';
import { EditorSheet } from './EditorSheet';
import { GroceryItemSheet } from './GroceryItemSheet';
import { InlineAction } from './InlineAction';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { NutritionPanelSheet } from './NutritionPanelSheet';
import { NutritionSearchSheet } from './NutritionSearchSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';

/**
 * A dish's whole nutrition panel, and the ingredients it couldn't count.
 *
 * **What this closes is that "from 6 of 9 ingredients" was a dead end.** The
 * coverage clause has always been the honest half of the estimate, and it named
 * a number nobody could act on: which three, why, and what to do about it were
 * all unanswerable from the recipe page. So the figure that told you the total
 * was incomplete was also the reason you couldn't complete it.
 *
 * **It shows the whole panel, not the two nutrients the summary leads with.**
 * `SUMMARY_KEYS` carries only calories and protein because a line under the
 * cost estimate wraps at three, and its own note says the rest is "in `total`
 * and unshown, waiting for a surface with room for it". This is that surface;
 * nothing new is computed for it.
 *
 * **A gap is offered a remedy only where one exists, and they are not
 * interchangeable.** A line with no catalog row has nowhere to keep figures,
 * so its remedy is minting one — `ensureCatalogItem` plus `GroceryItemSheet`,
 * the same off-list creation `addToPantry`'s neutral half already relies on —
 * rather than the grocery catalog's own *linking* flow, which is for renaming
 * a line onto an item that already exists and lives one sheet along in
 * `IngredientCatalogMatchSheet`; reproducing that one here would be a second
 * way to do the same job. A row with no figures gets the pair `GroceryItemSheet`
 * already offers for exactly this, in the same words: find the food in a
 * database, or copy the label off the packet. Figures that can't be measured
 * against the amount asked for get a scale, and only when `weighableLine` has
 * confirmed that weighing would actually settle it. **The two refusals
 * `unfixableQuantityReason` names — no amount at all ("several cloves"), or a
 * counted container ("2 14 oz cans")** — get neither: nothing on the food's
 * side could ever relate either one to a weight, so the row says the actual
 * fix is rewriting the recipe's own line rather than offering a button
 * ("Edit these figures", a scale) that would only look like one.
 *
 * **Filling in figures writes to the grocery catalog, never to the recipe.**
 * What is missing is a fact about a food, not about this dish, so filling it
 * in here fixes every other recipe calling for the same thing and the food
 * log with it. That is also why nothing here is undone when the sheet closes.
 *
 * **"Don't count this" is the one write that goes the other way**, onto
 * `RecipeIngredient.excludeFromNutrition` rather than the catalog — what it
 * says isn't a fact about the food (a handful of basil has real figures), it's
 * that this dish's total doesn't need them. So it's scoped to this recipe's
 * own line, the same way `noSwap` and `optional` already are, and every other
 * recipe calling for basil keeps counting it.
 *

 * **Rows leave as they are answered**, because the list is recomputed from the
 * store on every write rather than held in state. The row disappearing is the
 * confirmation, the way it is in `IngredientCatalogMatchSheet` and the way a
 * ticked task leaves Today. It is also what makes a refused weighing safe: a
 * portion that turns out not to settle the line leaves the row where it was,
 * saying so, instead of reporting a success the total doesn't share.
 *
 * **The COUNTED section names what each ingredient that reached the total
 * actually added to it.** `lineContribution` is the same arithmetic `fold`
 * already sums, read back per line instead of summed — nothing new is
 * computed, only shown. A row collapses to the ingredient and its calories,
 * matching the density of a gap row; expanding it shows the rest of that
 * line's panel and the same "Edit these figures" action the gap rows offer,
 * so correcting a covered ingredient's figures is the identical write to
 * correcting an uncovered one's — the grocery catalog, not the recipe.
 */

interface Props {
  visible: boolean;
  /**
   * The recipe page's own reading, passed in rather than recomputed.
   *
   * It arrives already scaled by whatever the scale chips say, so the amounts
   * here are the amounts on the page behind it, and it refreshes on every
   * catalog write because the screen's memo watches the same store.
   */
  reading: RecipeNutritionReading;
  onClose: () => void;
}

/** A figure as a label prints it: calories whole, everything else to a tenth at most. */
function formatAmount(key: NutrientKey, amount: number): string {
  if (key === 'calorieKcal') return String(Math.round(amount));
  return String(Math.round(amount * 10) / 10);
}

export function RecipeNutritionSheet({ visible, reading, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const setItemNutrition = useGroceryStore(s => s.setItemNutrition);
  const setProductNutrition = useGroceryStore(s => s.setProductNutrition);
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const updateIngredient = useRecipeStore(s => s.updateIngredient);

  // Which line each nested sheet is open for, rather than a boolean and a
  // separate id: the two can't disagree if there is only one of them.
  const [panelLine, setPanelLine] = useState<NutritionLine | null>(null);
  const [searchLine, setSearchLine] = useState<NutritionLine | null>(null);
  const [weighingId, setWeighingId] = useState<string | null>(null);
  const [weighGrams, setWeighGrams] = useState('');
  // Which COUNTED row is showing its full breakdown, one at a time.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The catalog row `addToCatalog` just minted, so `GroceryItemSheet` can open
  // straight onto it — off-list, exactly as `ensureCatalogItem` leaves it,
  // until the person fills something in.
  const [newItemId, setNewItemId] = useState<string | null>(null);

  const { nutrition, gaps } = reading;

  // Per serving where the recipe said how many it makes, and the whole dish
  // where it didn't — the same choice `describeNutrition` makes, so the sheet
  // and the line that opened it are quoting one figure rather than two.
  const figures = useMemo(() => {
    if (!nutrition) return null;
    const per = perServing(nutrition);
    return { amounts: per ?? nutrition.total, perServing: per !== null };
  }, [nutrition]);

  // Paired with the weighing each line would take, so a row can offer a scale
  // only where one would settle it. Recomputed with the reading, so a line
  // answered a moment ago is gone rather than still offering.
  const fillable = useMemo(
    () => gaps.fillable.map(line => ({
      line,
      weighing:
        line.state === 'unmeasured' && line.nutrition && line.item
          ? weighableLine(line.quantity, line.prep, line.nutrition, line.item.name)
          : null,
      // Null whenever a food's figures (or a scale) could still answer the
      // line — set only for the two refusals that are never about the food,
      // where nothing offered below can help and the fix is rewriting the
      // recipe's own line instead. See `unfixableQuantityReason`.
      unfixable: line.state === 'unmeasured' ? unfixableQuantityReason(line.quantity) : null,
    })),
    [gaps.fillable],
  );

  // What each ingredient that reached the total actually added to it, in the
  // same order the ingredient list itself shows them.
  const covered = useMemo(
    () => reading.lines
      .filter(line => line.state === 'covered')
      .map(line => ({ line, contribution: lineContribution(line) })),
    [reading.lines],
  );

  /**
   * Puts figures back on whichever row the ones on screen came from.
   *
   * A panel that spoke for this line came from the preferred box or from the
   * catalog row, and `nutritionFor`'s precedence means correcting the wrong
   * one leaves the screen showing the figure the person was trying to fix. A
   * line with no panel at all has nothing to correct, so new figures go on the
   * catalog row, where they speak for the food rather than for one box of it.
   */
  const writePanel = (line: NutritionLine, next: FoodNutrition | null) => {
    if (line.product?.nutrition) setProductNutrition(line.product.id, next);
    else if (line.item) setItemNutrition(line.item.id, next);
  };

  /** Mints an off-list catalog row for a line with nothing to match, and opens it. */
  const addToCatalog = (line: NutritionLine) => {
    haptics.tap();
    const item = ensureCatalogItem(line.name);
    if (item) setNewItemId(item.id);
  };

  /**
   * Leaves a line out of this recipe's total for good, same as a staple —
   * for an amount too small to matter, like a garnish. Writes to the
   * ingredient itself (RecipeIngredient.excludeFromNutrition), not the
   * catalog, since what's being said is "this dish doesn't need this
   * counted", not a fact about the food.
   */
  const excludeLine = (line: NutritionLine) => {
    haptics.tap();
    updateIngredient(line.recipeId, line.id, { excludeFromNutrition: true });
  };

  const startWeighing = (line: NutritionLine) => {
    haptics.tap();
    setWeighingId(line.id);
    setWeighGrams('');
  };

  const saveWeighing = (line: NutritionLine, weighing: LineWeighing) => {
    const grams = Number(weighGrams.trim().replace(',', '.'));
    if (!Number.isFinite(grams) || grams <= 0 || !line.nutrition) {
      haptics.error();
      return;
    }
    const updated = addCustomPortion(line.nutrition, weighing.label, weighing.amount, grams);
    if (!updated) {
      haptics.error();
      return;
    }
    writePanel(line, updated);
    haptics.success();
    setWeighingId(null);
    setWeighGrams('');
  };

  const countLine =
    gaps.total === 0
      ? null
      : `Counted from ${gaps.covered} of ${gaps.total} ingredients.`;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title="Nutrition"
          size="lg"
          left={<SheetHeaderButton label="Done" onPress={onClose} minWidth={40} />}
          right={<View style={styles.headerSpacer} />}
        />
      }
      footer={
        <>
          <NutritionSearchSheet
            visible={searchLine !== null}
            itemName={searchLine?.item?.name ?? ''}
            onClose={() => setSearchLine(null)}
            onPick={next => { if (searchLine) writePanel(searchLine, next); }}
          />
          <NutritionPanelSheet
            visible={panelLine !== null}
            foodName={panelLine?.item?.name ?? ''}
            nutrition={panelLine?.nutrition ?? null}
            onClose={() => setPanelLine(null)}
            onSave={next => { if (panelLine) writePanel(panelLine, next); }}
          />
          <GroceryItemSheet
            visible={newItemId !== null}
            itemId={newItemId}
            onClose={() => setNewItemId(null)}
          />
          <NumberPadAccessory />
        </>
      }
    >
      {!!countLine && <Text style={styles.count}>{countLine}</Text>}

      {figures ? (
        <>
          <Text style={styles.groupLabel}>
            {figures.perServing ? 'PER SERVING' : 'WHOLE RECIPE'}
          </Text>
          <View style={styles.card}>
            {NUTRIENT_KEYS.filter(key => figures.amounts[key] !== undefined).map(key => (
              <View key={key} style={styles.nutrientRow}>
                <Text style={styles.nutrientLabel}>{NUTRIENT_LABEL[key].label}</Text>
                <Text style={styles.nutrientAmount}>
                  {formatAmount(key, figures.amounts[key] as number)} {NUTRIENT_LABEL[key].unit}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.hint}>
            Added up from the ingredients' own labels, so these are as good as those
            labels are. A nutrient too few of them state is left out rather than counted
            as zero.
          </Text>
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.emptyTotal}>
            Too few of these ingredients have figures to total the dish yet. Fill some in
            below and the panel appears here.
          </Text>
        </View>
      )}

      {covered.length > 0 && (
        <>
          <Text style={styles.groupLabel}>COUNTED</Text>
          <View style={styles.card}>
            {covered.map(({ line, contribution }, index) => {
              const expanded = expandedId === line.id;
              return (
                <View key={line.id} style={[styles.countedRow, index > 0 && styles.gapRowRuled]}>
                  <TouchableOpacity
                    style={styles.countedHeader}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => { haptics.tap(); setExpandedId(expanded ? null : line.id); }}
                    accessibilityRole="button"
                    accessibilityLabel={`${expanded ? 'Hide' : 'Show'} what ${line.name} contributes`}
                    accessibilityState={{ expanded }}
                  >
                    <Text style={styles.gapName} numberOfLines={1}>
                      {line.quantity ? `${line.quantity} ${line.name}` : line.name}
                    </Text>
                    {contribution?.calorieKcal !== undefined && (
                      <Text style={styles.nutrientAmount}>
                        {formatAmount('calorieKcal', contribution.calorieKcal)} cal
                      </Text>
                    )}
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={iconSize.xs}
                      color={colors.textTertiary}
                    />
                  </TouchableOpacity>
                  {expanded && contribution && (
                    <View style={styles.countedDetail}>
                      {NUTRIENT_KEYS.filter(key => contribution[key] !== undefined).map(key => (
                        <View key={key} style={styles.countedDetailRow}>
                          <Text style={styles.countedDetailLabel}>{NUTRIENT_LABEL[key].label}</Text>
                          <Text style={styles.countedDetailAmount}>
                            {formatAmount(key, contribution[key] as number)} {NUTRIENT_LABEL[key].unit}
                          </Text>
                        </View>
                      ))}
                      <View style={styles.countedDetailActions}>
                        <InlineAction
                          label="Edit these figures"
                          variant="neutral"
                          onPress={() => { haptics.tap(); setPanelLine(line); }}
                          accessibilityLabel={`Edit nutrition figures for ${line.name}`}
                        />
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </>
      )}

      {fillable.length > 0 && (
        <>
          <Text style={styles.groupLabel}>NOT COUNTED</Text>
          <View style={styles.card}>
            {fillable.map(({ line, weighing, unfixable }, index) => (
              <View key={line.id} style={[styles.gapRow, index > 0 && styles.gapRowRuled]}>
                <Text style={styles.gapName} numberOfLines={1}>
                  {line.quantity ? `${line.quantity} ${line.name}` : line.name}
                </Text>
                <Text style={styles.gapReason}>
                  {line.state === 'noPanel'
                    ? 'Nothing recorded for this food yet.'
                    : weighing
                      ? `No weight recorded for ${weighing.text}.`
                      : unfixable === 'noAmount'
                        ? "This amount doesn't have a number in it, so there's nothing to relate to a weight. Edit the ingredient in the recipe to give it one, like \"3 cloves\" instead of \"several\"."
                        : unfixable === 'countedContainer'
                          ? "This is a count of containers, not how much is in one, so there's no figure that answers it. Edit the ingredient in the recipe to say how much one holds."
                          : "This amount can't be matched to its figures. Check the serving size on them."}
                </Text>

                {weighingId === line.id && weighing ? (
                  <View style={styles.weighRow}>
                    <TextInput
                      style={styles.weighInput}
                      value={weighGrams}
                      onChangeText={setWeighGrams}
                      // Names the field rather than giving an example, so it
                      // needs no "e.g." — and an example here would have to be
                      // a plausible weight for a food and an amount this
                      // doesn't know, which is the number being asked for.
                      placeholder="Weight in grams"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="decimal-pad"
                      inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                      autoFocus
                      accessibilityLabel={`Weight of ${weighing.text} of ${line.name} in grams`}
                    />
                    <Text style={styles.weighUnit}>g</Text>
                    <InlineAction label="Save" onPress={() => saveWeighing(line, weighing)} />
                    <InlineAction
                      label="Cancel"
                      variant="neutral"
                      onPress={() => { haptics.tap(); setWeighingId(null); }}
                    />
                  </View>
                ) : (
                  <View style={styles.gapActions}>
                    {line.state === 'noPanel' ? (
                      <>
                        <InlineAction
                          label="Find this food"
                          icon="search"
                          onPress={() => { haptics.tap(); setSearchLine(line); }}
                        />
                        <InlineAction
                          label="Type in a label"
                          variant="neutral"
                          onPress={() => { haptics.tap(); setPanelLine(line); }}
                        />
                      </>
                    ) : weighing ? (
                      <InlineAction
                        label="Weigh it"
                        icon="scale-outline"
                        onPress={() => startWeighing(line)}
                      />
                    ) : unfixable ? null : (
                      <InlineAction
                        label="Edit these figures"
                        variant="neutral"
                        onPress={() => { haptics.tap(); setPanelLine(line); }}
                      />
                    )}
                    <InlineAction
                      label="Don't count this"
                      variant="neutral"
                      onPress={() => excludeLine(line)}
                      accessibilityLabel={`Leave ${line.name} out of this recipe's nutrition total`}
                    />
                  </View>
                )}
              </View>
            ))}
            <Text style={styles.hint}>
              Figures are saved against the food in your grocery catalog, so filling one in
              here also fills it in for every other recipe that calls for it.
            </Text>
          </View>
        </>
      )}

      {gaps.unmatched.length > 0 && (
        <>
          <Text style={styles.groupLabel}>NOT IN YOUR CATALOG</Text>
          <View style={styles.card}>
            {gaps.unmatched.map((line, index) => (
              <View key={line.id} style={[styles.gapRow, index > 0 && styles.gapRowRuled]}>
                <View style={styles.unmatchedNameRow}>
                  <Ionicons name="ellipse-outline" size={iconSize.xs} color={colors.textTertiary} />
                  <Text style={styles.gapName} numberOfLines={1}>{line.name}</Text>
                </View>
                <View style={styles.gapActions}>
                  <InlineAction
                    label="Add to catalog"
                    variant="neutral"
                    onPress={() => addToCatalog(line)}
                    accessibilityLabel={`Add ${line.name} to your grocery catalog`}
                  />
                  <InlineAction
                    label="Don't count this"
                    variant="neutral"
                    onPress={() => excludeLine(line)}
                    accessibilityLabel={`Leave ${line.name} out of this recipe's nutrition total`}
                  />
                </View>
              </View>
            ))}
            <Text style={styles.hint}>
              These lines don't match anything in your grocery catalog, so there's nowhere
              to keep figures for them yet. Adding one lets you set a brand, a price or
              figures for it. Most one-off ingredients are fine left as they are.
            </Text>
          </View>
        </>
      )}

      {fillable.length === 0 && gaps.unmatched.length === 0 && gaps.total > 0 && (
        <Text style={styles.hint}>Every ingredient this dish calls for was counted.</Text>
      )}
    </EditorSheet>
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
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.separator,
    },
    headerSpacer: { minWidth: 40 },
    scroll: { flex: 1 },
    scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
    count: {
      fontSize: font.sm,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: spacing.sm,
      marginHorizontal: spacing.xs,
    },
    groupLabel: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      color: colors.textSecondary,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
      marginHorizontal: spacing.xs,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    nutrientRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    nutrientLabel: { flex: 1, fontSize: font.md, color: colors.text },
    nutrientAmount: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    emptyTotal: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 18 },
    countedRow: { paddingVertical: spacing.xs },
    countedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    countedDetail: { marginTop: spacing.xs, marginBottom: spacing.xs },
    countedDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xxs,
    },
    countedDetailLabel: { fontSize: font.sm, color: colors.textSecondary },
    countedDetailAmount: { fontSize: font.sm, fontWeight: fontWeight.medium, color: colors.text },
    countedDetailActions: { flexDirection: 'row', marginTop: spacing.xs },
    gapRow: { gap: spacing.xs, paddingVertical: spacing.sm },
    // A gap row is three stacked lines rather than the one an ordinary list
    // row is, so without a rule between them two of them read as one row with
    // a great deal in it.
    gapRowRuled: { borderTopWidth: 1, borderTopColor: colors.separator, marginTop: spacing.xs },
    gapName: { flex: 1, fontSize: font.md, color: colors.text },
    gapReason: { fontSize: font.xs, color: colors.textSecondary, lineHeight: 16 },
    // Margin above only: the hint below the last row supplies its own top gap,
    // and the row above this one already ends on its own vertical padding.
    gapActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    weighRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    weighInput: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bg,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.separator,
    },
    weighUnit: { fontSize: font.sm, color: colors.textSecondary },
    unmatchedNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    hint: {
      fontSize: font.xs,
      color: colors.textTertiary,
      lineHeight: 16,
      marginTop: spacing.sm,
      marginHorizontal: spacing.xs,
    },
  });
}
