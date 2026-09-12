// The food log's entry sheet: pick a food, a box of one or a cooked dish, say
// how much, and save it as a helping. One component of ~1,070 lines, so grep a
// landmark rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   makeStyles              styles, at the bottom
//
// The refusals are the design and they are argued in the doc comment below:
// nothing is offered that has no panel, and no amount is logged that cannot be
// measured against one. See also `foodLog.ts` for the scaling and
// `docs/arch/health-data.md` for why a wrong figure here is expensive.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
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
import { MEAL_SLOTS, MEAL_SLOT_LABELS, type FoodLogEntry, type FoodNutrition, type GroceryItem, type MealSlot } from '../types';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useFoodLogStore, type FoodLogDraft } from '../store/useFoodLogStore';
import { subDays } from 'date-fns/subDays';
import { addCustomPortion, catalogPanelWrite, nutritionFor } from '../utils/foodNutrition';
import { combineFoodNutrition, foodLogEntryEdit, helpingNutrition, recipeHelpingNutrition, scalePanelToAmount } from '../utils/foodLog';
import { cookedDishGrams, mealHelping, servingGrams, weighedHelping } from '../utils/mealLog';
import { perServing, recipeNutrition, recipeNutritionLines, type NutritionLine } from '../utils/recipeNutrition';
import { describeProduct } from '../utils/groceryProduct';
import { isNonFoodAisle } from '../utils/groceryAisles';
import { groceryNameKey } from '../utils/groceryParse';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { foodLogRecency, rankByRecency } from '../utils/foodLogRecents';
import { haptics } from '../utils/haptics';
import { weighableLine } from '../utils/ingredientGrams';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { CatalogLinkPicker } from './CatalogLinkPicker';
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
 *
 * **Correcting an entry is this same sheet, reopened on it** (`editing`), and
 * that is the whole reason a wrong portion is no longer a delete and a retype.
 * A second, smaller editor was the alternative and would have had to grow its
 * own amount field, its own portion hints and its own refusal copy, and could
 * offer neither the weigh-it rescue above nor a dish's varying lines — which
 * is the drift `InlineAction` and `RuleListSheet` exist to undo, one sheet up.
 * Reopening here also means a corrected amount is measured by the code that
 * measured the original, rather than multiplied out of figures that are
 * already one helping's worth. `foodLogEntryEdit` decides which entries can
 * come back at all and what their amount field opens on.
 */

interface Props {
  visible: boolean;
  /** Which meal it lands in, chosen by the section the add came from. */
  slot: MealSlot | null;
  /**
   * An existing entry to correct rather than a new one to write.
   *
   * The sheet opens on that entry's own food, with its amount and its meal
   * already in the fields, and Save patches the row through `reviseEntry`
   * instead of inserting one. The row keeps its id, so its place in the day
   * and the meal plan square it points back at both survive the correction.
   *
   * A caller offers this only for an entry `foodLogEntryEdit` accepts. The one
   * case that still opens unseeded is a food whose catalog row or recipe has
   * since been deleted: the list has nothing to pick, so the search field
   * opens on the entry's own name and whatever is chosen replaces it. That is
   * the honest answer for a food the app no longer has.
   */
  editing?: FoodLogEntry | null;
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
  /**
   * The search field's starting text, for a caller that already knows what
   * this entry is probably about — `LogMealEntrySheet`, opening on a meal
   * plan entry's own name so finding it is a tap rather than a retype.
   * Ordinary text, not a pick: it filters `candidates` exactly as if it had
   * been typed, and nothing is chosen until a row is tapped.
   */
  initialQuery?: string;
  /**
   * The planned meal this entry is logging, carried onto whatever gets
   * saved — the manual counterpart of `seedRecipeId`'s own caller. Omitted
   * (or null) for every other caller, which is why `FoodLogDraft`'s field
   * defaults to null rather than this prop defaulting to it: a screen simply
   * adding an entry has no meal plan row to point back at.
   */
  mealPlanEntryId?: string | null;
  onClose: () => void;
  /**
   * Offers to describe the meal instead of searching for it, handing off to
   * the estimate sheet. Omitted by a caller that has nowhere to send that
   * (no API key, no on-device engine) — same gate `FoodLogScreen`'s own
   * sparkles action uses, just read by the caller instead of duplicated here.
   */
  onEstimate?: () => void;
  /**
   * Opens the barcode scanner, handing off to `ScanToLogFlow` — the third way
   * in, beside searching and describing. Omitted by a caller with nowhere to
   * send it, same split `onEstimate` draws.
   *
   * It is here rather than only on the screen's header because a packaged food
   * is most often reached for *after* the search has come up empty: the sheet
   * is open, the packet is in hand, and cancelling out to find a header button
   * is the step this removes.
   */
  onScan?: () => void;
  /**
   * "Don't ask about this meal" — the manual sheet's counterpart to
   * `LogMealPrompt`'s own secondary button of the same name. Present only
   * while there's a meal to decline: `LogMealEntrySheet` supplies it exactly
   * when its `pending.mealPlanEntryId` is set, and every other caller (the
   * plain "add a food" flow, the estimate sheet) leaves it out, since there's
   * no meal here to say no to. Writing the flag and closing the sheet is left
   * to the caller, same split `onEstimate` already draws.
   */
  onDeclineMeal?: () => void;
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
  /**
   * The catalog row this panel actually lives on, which is not always the row
   * the entry is filed as.
   *
   * The two are the same for every candidate the catalog itself offers, and
   * part company for a food found in a database and then filed against a row
   * that already stated figures of its own: the entry points at that row, and
   * the figures being logged are still the database's. **`handleSaveWeighedPortion`
   * writes against this one and never `itemId`**, or weighing out a cup of the
   * database's flour would overwrite the panel somebody had transcribed off
   * their own bag.
   */
  panelItemId: string | null;
  /**
   * Whether this food came out of a food database rather than off a row this
   * app already had.
   *
   * Recorded rather than inferred from `itemId`/`productId`/`recipeId` all
   * being null, which is what it used to be read as: those three go on being
   * null for a row the catalog simply hasn't got, and once filing sets `itemId`
   * the shape stops telling you anything at all. It is what says whether the
   * catalog offer below belongs on screen, and afterwards what lets the sheet
   * say where the food went.
   */
  fromDatabase: boolean;
  /** Present for a dish: what one serving of it works out to, when it says how many it makes. */
  servingPanel: FoodNutrition | null;
  /** Present for a dish: what the whole finished dish weighs, when somebody has weighed it. */
  cookedGrams: number | null;
  /** Present for a dish: how many servings its figures are, so a serving's own weight can be worked out. */
  dishServings: number | null;
}

export function FoodLogEntrySheet({
  visible, slot, at, seedRecipeId, initialQuery, mealPlanEntryId, editing, onClose, onEstimate, onScan, onDeclineMeal,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Lifts the amount field (which autofocuses, so the keyboard is already up
  // when this half renders) clear of the keyboard instead of leaving it to a
  // plain ScrollView — same mechanism as every other keyboard-heavy sheet.
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  // ==== store bindings ====
  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const nonFoodAisles = useGroceryStore(useShallow(s => s.nonFoodAisles));
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addEntry = useFoodLogStore(s => s.addEntry);
  const reviseEntry = useFoodLogStore(s => s.reviseEntry);
  const setItemNutrition = useGroceryStore(s => s.setItemNutrition);
  const setProductNutrition = useGroceryStore(s => s.setProductNutrition);
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const recentEntries = useFoodLogStore(s => s.recentEntries);

  // ==== local state (what is picked, how much, and which extra form is open) ====
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
  /** Whether the "which item is this" picker is open under a database food. */
  const [catalogPickOpen, setCatalogPickOpen] = useState(false);
  // What was typed for each of a dish's amount-varies lines, keyed by the
  // recipe ingredient's own id. See `varyingLines` below.
  const [varyingAmounts, setVaryingAmounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    setQuery(initialQuery ?? '');
    setPicked(null);
    setAmount('');
    setChosenSlot(slot);
    setDbSearchOpen(false);
    setCatalogPickOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, slot]);

  // Closes the "weigh it" form whenever the picked food or its panel changes
  // out from under it — including right after a weighed portion is saved,
  // which is also when it should close.
  useEffect(() => {
    setWeighing(false);
    setWeighGrams('');
    setCatalogPickOpen(false);
  }, [picked]);

  // A fresh dish starts with none of its varying lines answered, same as a
  // fresh food starts with no weighed portion above.
  useEffect(() => {
    setVaryingAmounts({});
  }, [picked]);


  // Only foods with a panel, because an entry with no figures records nothing a
  // total could use. A row offered here and then refused at Save would be worse
  // than not offering it.
  // ==== the list: what can be logged, and what to put in front of it ====
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
        panelItemId: item.id,
        fromDatabase: false,
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
        panelItemId: item.id,
        fromDatabase: false,
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
        panelItemId: null,
        fromDatabase: false,
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

  /**
   * What has actually been eaten lately, read once when the sheet opens.
   *
   * A snapshot rather than a subscription: nothing that happens while this is
   * open should reorder the list under the finger picking from it, and the one
   * thing that could — saving an entry — closes the sheet anyway. Ninety days
   * because the question is "what do you eat", which a fortnight answers badly
   * for anything weekly.
   */
  const [recency, setRecency] = useState(() => foodLogRecency([]));
  useEffect(() => {
    if (!visible) return;
    const today = getCurrentDayStart();
    setRecency(foodLogRecency(recentEntries(dayKeyOf(subDays(today, 90)), dayKeyOf(today))));
  }, [visible, recentEntries]);

  // ==== reopening an existing entry ====
  /**
   * What a correction opened on, so Cancel can tell one that has changed
   * something from one that has only been looked at, and so the seeding below
   * happens once per opening rather than on every rebuild of `candidates`.
   *
   * Null for an ordinary add, where an untouched sheet is simply an empty one.
   */
  const seededRef = useRef<{ id: string; key: string | null; amount: string; slot: MealSlot | null } | null>(null);

  useEffect(() => {
    if (!visible) { seededRef.current = null; return; }
    if (!editing || seededRef.current?.id === editing.id) return;

    const plan = foodLogEntryEdit(editing);
    // Matched on the entry's own links rather than on a candidate key, so this
    // file and `foodLog.ts` need not agree on a string format. Most specific
    // first, the order `foodLogEntryEdit` reads them in; the last arm rules
    // out a box, whose row is the one above it.
    const candidate = candidates.find(c => (
      editing.recipeId ? c.recipeId === editing.recipeId
        : editing.productId ? c.productId === editing.productId
          : c.itemId === editing.itemId && c.productId === null
    ));

    // Recorded either way, so a food that could not be seeded is attempted
    // once rather than on every catalog write while the sheet sits open.
    seededRef.current = {
      id: editing.id,
      key: candidate?.key ?? null,
      amount: plan && candidate ? plan.amount : '',
      slot: editing.slot,
    };
    setChosenSlot(editing.slot);

    if (!plan || !candidate) {
      // The catalog row or the recipe is gone, so there is nothing to reopen
      // on. Opening the search on the entry's own name is all this can offer,
      // and is still the delete and the retype it replaces, minus the delete.
      setQuery(editing.label);
      return;
    }
    setPicked(candidate);
    setAmount(plan.amount);
    if (plan.dishMeasure) setDishMeasure(plan.dishMeasure);
  }, [visible, editing, candidates]);

  const results = useMemo(() => {
    const key = groceryNameKey(query);
    // Ranked before the cap, not after, which is the whole point: a food eaten
    // every morning was landing below forty things bought once and being cut
    // off by the slice, so the list promised what it could not be searched for.
    const ranked = rankByRecency(candidates, recency);
    if (!key) return ranked.slice(0, 40);
    return ranked.filter(c => groceryNameKey(c.label).includes(key)).slice(0, 40);
  }, [candidates, query, recency]);

  // The dish's own lines with no fixed amount to count them by — a serving
  // suggestion like "1 baguette, warmed, for serving" rather than an
  // ingredient nobody's weighed yet. Excludes anything `weighableLine` could
  // settle with a one-time catalog weighing (RecipeNutritionSheet's own
  // remedy for that): what's left is genuinely different every time the dish
  // is made, so asking here — for this one helping — is the only place left
  // to ask it, rather than a fact `recipeNutrition.ts`'s static rollup could
  // ever hold for the recipe as a whole.
  // ==== the amount: what it resolves to, and the two ways it can be rescued ====
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
    // `panelItemId`, never `itemId` — see its note on the candidate. A food
    // filed against a row that already had figures is pointing at that row
    // while still carrying a database's own panel, and writing a portion back
    // onto it would replace figures nobody asked to replace.
    if (picked.productId) setProductNutrition(picked.productId, updated);
    else if (picked.panelItemId) setItemNutrition(picked.panelItemId, updated);
    else { haptics.error(); return; }
    setPicked({ ...picked, panel: updated });
    haptics.success();
  };

  /**
   * Whether the food on screen is one a database answered and the catalog has
   * never heard of.
   *
   * The one candidate with nowhere to go: every other row here came off a
   * `GroceryItem`, an `ItemProduct` or a `Recipe` and already knows what it is.
   * A database result is figures and a description, and without this it stayed
   * that way — the panel rode onto the entry and was gone, so eating the same
   * thing next week meant searching for it again, and the weigh-it offer below
   * had no row to write a portion to at all.
   */
  // ==== filing a database food into the grocery catalog ====
  const unfiled = !!picked && picked.fromDatabase && !!picked.panel && picked.itemId === null;

  /** What a just-filed food ended up as, for the line that says so. */
  const filedAs = useMemo(() => {
    if (!picked?.fromDatabase || !picked.itemId) return null;
    return items.find(i => i.id === picked.itemId)?.name ?? null;
  }, [picked, items]);

  /**
   * Filing a database food against a catalog row.
   *
   * **Two separable things happen here and the user decides the second one.**
   * The link is always written: this entry is that food, which is a fact about
   * the entry and costs the catalog nothing. Whether the row's own figures
   * become these figures is a different question, and `catalogPanelWrite` is
   * what says which of the three ways it can go. A row with no record takes
   * them with nothing to ask. A row that already states figures is asked
   * about, and **keeping what it has is offered first**, because the common
   * case is filing a database's "Milk, whole" against a Milk row somebody
   * transcribed off their own carton, and silently replacing that is the one
   * outcome this may not produce.
   */
  const fileInCatalog = (item: GroceryItem) => {
    if (!picked || !picked.panel) return;
    const panel = picked.panel;
    setCatalogPickOpen(false);
    const link = (panelItemId: string | null) => {
      setPicked(current => (current ? { ...current, itemId: item.id, panelItemId } : current));
      haptics.success();
    };
    const verdict = catalogPanelWrite(item.nutrition, panel);
    if (verdict === 'refuse') { haptics.error(); return; }
    if (verdict === 'write') {
      setItemNutrition(item.id, panel);
      link(item.id);
      return;
    }
    Alert.alert(
      `${item.name} already has figures`,
      `Keep the ones already on ${item.name}, or replace them with these? Either way this entry is filed as ${item.name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Keep its own', onPress: () => link(null) },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => { setItemNutrition(item.id, panel); link(item.id); },
        },
      ],
    );
  };

  /** Filing it under its own name, minting the row when there isn't one. */
  const fileAsNewItem = () => {
    if (!picked) return;
    // `ensureCatalogItem` rather than `addByName`, the same restraint
    // `FoodLogScreen`'s scan handler takes: eating something is not a plan to
    // buy it, so a row minted here arrives off the list.
    const item = ensureCatalogItem(picked.label);
    if (!item) { haptics.error(); return; }
    fileInCatalog(item);
  };

  // ==== actions: saving, picking from the database, leaving ====
  const handleSave = () => {
    if (!picked || !built) return;
    const answeredExtras = varyingResolved.filter(r => r.resolved).map(r => r.line.name);
    // A dish says how much in the words its helping already chose ("320 g",
    // "2 servings"); a food is recorded as the amount that was typed.
    const measured = built.quantity ?? amount.trim();
    const quantity = answeredExtras.length > 0
      ? `${measured}, plus ${answeredExtras.join(', ')}`
      : measured;
    const measurement = {
      label: picked.label,
      quantity,
      grams: built.grams,
      nutrition: built.nutrition,
      slot: chosenSlot,
      recipeId: picked.recipeId,
      itemId: picked.itemId,
      productId: picked.productId,
    };
    if (editing) {
      // `reviseEntry` rather than `updateEntry`, because this reaches the
      // figures: the samples the entry already wrote to Health are retracted
      // and the corrected ones written in their place. The row keeps its id,
      // so its position in the day and the meal plan square it points back at
      // both survive the correction.
      reviseEntry(editing.id, measurement);
    } else {
      const draft: FoodLogDraft = { ...measurement, mealPlanEntryId: mealPlanEntryId ?? null, at };
      if (!addEntry(draft)) {
        haptics.error();
        return;
      }
    }
    haptics.success();
    Keyboard.dismiss();
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
      panelItemId: null,
      fromDatabase: true,
      servingPanel: null,
      cookedGrams: null,
      dishServings: null,
    });
    setAmount('');
  };

  const handleCancel = () => {
    // A correction opens with fields already filled, so "nothing typed yet"
    // is not what clean means for one: it is measured against what the entry
    // was seeded with instead. Otherwise every look at an entry would end in
    // a discard confirm.
    const seeded = seededRef.current;
    const answeredExtra = Object.values(varyingAmounts).some(v => v.trim());
    const dirty = seeded
      ? (picked?.key ?? null) !== seeded.key
        || amount.trim() !== seeded.amount
        || chosenSlot !== seeded.slot
        || answeredExtra
      : !!picked || !!amount.trim();
    if (!dirty) { Keyboard.dismiss(); onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { Keyboard.dismiss(); onClose(); } },
      ],
    );
  };

  // ==== render. Everything below is JSX ====
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
              <Text style={styles.headerTitle} numberOfLines={1}>
                {editing ? 'What was it?' : 'What did you eat?'}
              </Text>
            )}
            <SheetHeaderButton label={editing ? 'Save' : 'Add'} onPress={handleSave} disabled={!built} minWidth={64} />
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
          // with no way to reach it. `useKeyboardInsetScroll` is what actually
          // keeps the focused field clear of the keyboard — its two siblings
          // use the same mechanism (`ScanPortionSheet`) or `LogMealPrompt`'s
          // `KeyboardAvoidingView`, which fits that sheet's centered-card
          // shape instead.
          <ScrollView
            ref={keyboardScroll.ref}
            style={styles.bodyScroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            {...keyboardScroll.props}
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
                  : 'A weight, like 100g. This food has no stated portions. Type an amount by volume or count and you can weigh it once to add it.'}
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

            {unfiled && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>KEEP THIS FOOD</Text>
                <Text style={styles.hint}>
                  Your grocery catalog has nothing for this yet, so these figures
                  go on the entry and nowhere else. File it and it's here to pick
                  next time instead of to search for.
                </Text>
                <View style={styles.fileRow}>
                  <InlineAction
                    label={`Add “${picked.label}”`}
                    icon="add"
                    onPress={() => { haptics.tap(); fileAsNewItem(); }}
                  />
                  <InlineAction
                    label={catalogPickOpen ? 'Never mind' : 'Something I already have'}
                    icon="albums-outline"
                    variant="neutral"
                    onPress={() => { haptics.tap(); setCatalogPickOpen(o => !o); }}
                  />
                </View>
                {catalogPickOpen && (
                  <CatalogLinkPicker
                    items={items}
                    initialQuery={picked.label}
                    onPick={fileInCatalog}
                  />
                )}
              </>
            )}

            {/* Said once it has somewhere to live, so filing has a visible
                result rather than the buttons merely disappearing. */}
            {!!filedAs && (
              <Text style={styles.filedNote}>{`Filed in your catalog as ${filedAs}.`}</Text>
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
            {(!!onScan || !!onEstimate) && (
              <View style={styles.actionRow}>
                {!!onScan && (
                  <InlineAction
                    label="Scan a barcode"
                    icon="barcode-outline"
                    onPress={() => { haptics.tap(); Keyboard.dismiss(); onScan(); }}
                  />
                )}
                {!!onEstimate && (
                  <InlineAction
                    label="Describe what you ate instead"
                    icon="sparkles-outline"
                    variant="neutral"
                    onPress={() => { haptics.tap(); Keyboard.dismiss(); onEstimate(); }}
                  />
                )}
              </View>
            )}
            {!!onDeclineMeal && (
              <TouchableOpacity
                style={styles.declineMeal}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); Keyboard.dismiss(); onDeclineMeal(); }}
                accessibilityRole="button"
                accessibilityLabel="Don't ask about this meal"
              >
                <Text style={styles.declineMealText}>Don't ask about this meal</Text>
              </TouchableOpacity>
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
    // Wraps rather than truncating: the first pill carries the food's own name,
    // which can be a database description several words long.
    fileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    filedNote: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.md },
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
    // TextSecondary rather than accent — a decline, not a link, the same
    // weighting LogMealPrompt's own secondary buttons carry.
    // Indented to the same gutter the field, the actions and the rows all sit
    // on — it had none of its own, so it hugged the screen edge — and given
    // the block gap below it rather than leaning on the list's own padding.
    declineMeal: {
      alignSelf: 'flex-start',
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      paddingVertical: spacing.xs,
    },
    declineMealText: { color: colors.textSecondary, fontSize: font.sm },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      marginBottom: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.md, padding: 0 },
    // The three blocks above the list — field, actions, results — sat
    // spacing.sm apart, which is the same gap the result rows keep between
    // themselves, so the actions read as one more row of the list rather than
    // as a separate offer. spacing.md is the stacked-block default, and it is
    // what separates them. Wraps because both labels together are wider than a
    // phone.
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      // Or a row's default stretch gives a wrapped pill the height of its
      // line rather than its own.
      alignItems: 'flex-start',
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
    },
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
    rowText: { flex: 1, gap: spacing.xxs },
    rowTitle: { color: colors.text, fontSize: font.md },
    rowMeta: { color: colors.textSecondary, fontSize: font.sm },
  });
}
