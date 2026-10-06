// The food log's entry sheet: pick a food, a box of one or a cooked dish, say
// how much, and save it as a helping. One component of ~1,900 lines, so grep a
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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, isPortionBox, type FoodLogEntry, type FoodNutrition, type GroceryItem, type MealSlot } from '../types';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useFoodLogStore, type FoodLogDraft } from '../store/useFoodLogStore';
import { subDays } from 'date-fns/subDays';
import { addCustomPortion, catalogPanelWrite, nutritionFor } from '../utils/foodNutrition';
import {
  amountExample,
  amountHint,
  combineFoodNutrition,
  composeFoodAmount,
  describeFoodLogEntry,
  foodLogEntryEdit,
  foodUnitOptionsFor,
  helpingNutrition,
  keptDatabasePanel,
  wholeEstimate,
  type EstimateAmountPatch,
  matchMealPlanEntry,
  parseFoodAmount,
  recallAmount,
  recipeHelpingNutrition,
  scalePanelToAmount,
} from '../utils/foodLog';
import { cookedDishGrams, mealHelping, servingGrams, weighedHelping } from '../utils/mealLog';
import { perServing, recipeNutrition, recipeNutritionLines, type NutritionLine } from '../utils/recipeNutrition';
import { standingSwapMap } from '../utils/standingSwaps';
import { describeProduct } from '../utils/groceryProduct';
import { isNonFoodAisle } from '../utils/groceryAisles';
import { groceryNameKey } from '../utils/groceryParse';
import { dayKeyOf, getCurrentDayStart, getLogicalDayKey } from '../utils/dateUtils';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  foodLastAmounts,
  foodLogRecency,
  helpingAgain,
  rankByRecency,
  recentUnlinkedHelpings,
} from '../utils/foodLogRecents';
import { haptics } from '../utils/haptics';
import type { PantryReviewAnswer } from '../utils/pantryReview';
import { weighableLine } from '../utils/ingredientGrams';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { EmptyState } from './EmptyState';
import { InlineAction } from './InlineAction';
import { NutritionSearchSheet, navigateToFoodSearchSettings } from './NutritionSearchSheet';
import { EstimateAmountSheet } from './EstimateAmountSheet';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useFilterField } from '../hooks/useFilterField';
import { TextField } from './TextField';

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
 *
 * **A food with no row is offered again as the helping it was** (#2914). The
 * list can only offer rows, so an estimate or a database food nobody filed
 * was a second request or a second search every time it was eaten. The ones
 * logged lately sit above the list (`recentUnlinkedHelpings`) and log on the
 * tap as Duplicate does, the same figures under the same claim. That keeps the
 * rule above rather than bending it: nothing is measured, because nothing new
 * is being said about how much.
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
   * A caller offers this only for an entry `foodLogEntryEdit` accepts. A food
   * a database answered and nobody filed has no row on the list, so it reopens
   * on the panel it kept (`FoodLogEntry.sourcePanel`), built into a candidate
   * the way a fresh database pick is. The one case that still opens unseeded
   * is a food whose catalog row or recipe has since been deleted: the list has
   * nothing to pick, so the search field opens on the entry's own name and
   * whatever is chosen replaces it. That is the honest answer for a food the
   * app no longer has.
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
  /**
   * Whether "Add another" may keep this sheet open after a save instead of
   * closing it, for a caller with an open-ended run of foods to log rather
   * than one thing to log and be done.
   *
   * Only the plain "add a food" mount sets this. `LogMealEntrySheet` and the
   * estimate sheet's own reopen (`seedRecipeId`) each answer one particular
   * planned or described meal — `mealPlanEntryId`/`initialQuery` name it —
   * and closing once that's logged is the point, the same reasoning
   * `QuickAddModal` gives for gating its own burst mode off a seeded sheet.
   * Ignored whenever `editing` is set, regardless of what a caller passes: a
   * correction is never a burst of one.
   */
  allowBurst?: boolean;
  onClose: () => void;
  /**
   * Offers to describe the meal instead of searching for it, handing off to
   * the estimate sheet. Omitted by a caller that has nowhere to send that
   * (no API key, no on-device engine) — same gate `FoodLogScreen`'s own
   * sparkles action uses, just read by the caller instead of duplicated here.
   *
   * **It carries whatever is in the search field**, so the estimate sheet opens
   * on the dish rather than on an empty box. This is the one route by which a
   * composed or homemade thing gets logged at all — a grilled cheese with
   * mozzarella is in no barcode source and no food database — and it is
   * reached *after* a search has come up empty, so the words have already been
   * typed once. Two callers, two sources for the same string and neither needs
   * a second mechanism: `initialQuery` seeds this field from a meal's own name
   * (`LogMealEntrySheet`), and anything typed since replaces it.
   */
  onEstimate?: (query: string) => void;
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
   * Opens the saved-meals list — the fourth way in, beside searching,
   * describing and scanning. Logs several entries at once rather than one,
   * so unlike the other three it never hands control back to this sheet: the
   * caller closes this one and opens `SavedMealsSheet` in its place, same
   * split `onEstimate`/`onScan` already draw. Omitted by a caller with
   * nowhere to send it, or nothing yet saved to offer.
   */
  onSavedMeal?: () => void;
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
  /**
   * The sheets `onScan`/`onEstimate`/`onSavedMeal` raise, rendered **inside**
   * this sheet's own Modal rather than beside it in the caller.
   *
   * That placement is the whole point and is not a tidiness choice. iOS
   * presents a Modal from `[self reactViewController]`, the nearest view
   * controller up the responder chain, and one view controller can present
   * only one thing at a time. A sheet rendered as this one's *sibling* asks
   * the root view controller to present while it is already presenting this
   * sheet: UIKit refuses, nothing appears, and RN has already set its own
   * `_isPresented`, so the flow wedges with no error. Rendered in here it
   * presents from this sheet's view controller, which is presenting nothing,
   * exactly as `NutritionSearchSheet` below already does.
   *
   * Nesting rather than hiding this sheet is what keeps what the user typed:
   * a hidden Modal unmounts its children once it finishes dismissing, so the
   * search field would come back empty from a cancelled scan.
   *
   * The caller still owns the sheets and their state and passes them through;
   * only where they render is fixed here.
   */
  overlays?: React.ReactNode;
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
  /** True when the figures came from `scalePanelToAmount`'s beverage density fallback. */
  approximate?: boolean;
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

/**
 * A food a database answered, as a candidate: its panel and nothing filed.
 *
 * One builder for the two ways one arrives, a fresh pick from the database
 * search and an entry reopened on the panel it kept, so a correction measures
 * against exactly the candidate the original was logged from.
 */
function databaseCandidate(key: string, label: string, panel: FoodNutrition): Candidate {
  return {
    key,
    label,
    detail: 'From a food database',
    kind: 'food',
    panel,
    recipeId: null,
    itemId: null,
    productId: null,
    panelItemId: null,
    fromDatabase: true,
    servingPanel: null,
    cookedGrams: null,
    dishServings: null,
  };
}

export function FoodLogEntrySheet({
  visible, slot, at, seedRecipeId, initialQuery, mealPlanEntryId, editing, allowBurst, onClose, onEstimate, onScan, onSavedMeal, onDeclineMeal,
  overlays,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();
  // Lifts the amount field (which autofocuses, so the keyboard is already up
  // when this half renders) clear of the keyboard instead of leaving it to a
  // plain ScrollView — same mechanism as every other keyboard-heavy sheet.
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });
  // The search half's results list is a FlatList, so it needs its own: without
  // one the last rows sit behind the keyboard with nothing to scroll them
  // clear. `fieldAbove` because the search field sits over the list rather than
  // in it, and carries the Done bar (see the hook's note on that option).
  const listScroll = useKeyboardInsetScroll<FlatList>({ ownsSheet: true, fieldAbove: true });
  // The search field, refocused after a burst save — see handleSave.
  // Set by handleSave's burst branch, consumed by the effect below once the
  // search field it wants to focus has actually mounted.
  const pendingBurstFocus = useRef(false);

  // ==== store bindings ====
  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const nonFoodAisles = useGroceryStore(useShallow(s => s.nonFoodAisles));
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  // Every recipe, not just the one being logged: a composed dish measures its
  // components through this map, and `recipeNutrition`'s default (a map of the
  // outer recipe alone) silently dropped everything they contribute. The same
  // map `LogMealPrompt` passes, so the figures a recipe logs with and the ones
  // an edit re-measures it against come off one rollup.
  const recipesById = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);
  // "Always use oat milk for milk", so a dish logs as the recipe page's
  // nutrition row reads it rather than as written. See standingSwaps.ts.
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const swaps = useMemo(() => standingSwapMap(itemSubs, items), [itemSubs, items]);
  const addEntry = useFoodLogStore(s => s.addEntry);
  const reviseEntry = useFoodLogStore(s => s.reviseEntry);
  const setItemNutrition = useGroceryStore(s => s.setItemNutrition);
  const answerPantryReview = useGroceryStore(s => s.answerPantryReview);
  const setProductNutrition = useGroceryStore(s => s.setProductNutrition);
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const recentEntries = useFoodLogStore(s => s.recentEntries);
  const keepOpenAfterFoodLog = useSettingsStore(s => s.keepOpenAfterFoodLog);
  // Searching a food database by name needs a FoodData Central key, and the
  // empty list below is where a newcomer with no foods reaches for that search
  // first. Said there rather than after a search fails.
  const productLookupEnabled = useSettingsStore(s => s.productLookupEnabled);
  const hasFdcKey = useSettingsStore(s => !!s.fdcApiKey);
  const setKeepOpenAfterFoodLog = useSettingsStore(s => s.setKeepOpenAfterFoodLog);

  // Whether this save should stay open for another food instead of closing —
  // see `allowBurst`'s own doc comment for why a correction never takes this,
  // whatever the caller passes.
  const burstMode = !!allowBurst && !editing && keepOpenAfterFoodLog;

  // ==== local state (what is picked, how much, and which extra form is open) ====
  const searchFilter = useFilterField();
  const query = searchFilter.query;
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [amount, setAmount] = useState('');
  // The split view of `amount` a food with a matched unit renders as: a unit
  // pill plus a number-only field, kept in step with `amount` at every write
  // rather than derived from it, so a value `parseFoodAmount` can't read back
  // (see its own doc comment) doesn't lose what was actually typed or saved.
  const [amountUnit, setAmountUnit] = useState<string | null>(null);
  const [amountNumber, setAmountNumber] = useState('');
  // The amount `choose` filled in from the last time this food was logged, or
  // null when it opened on the ordinary default. Compared against `amount`
  // rather than cleared on edit, so the hint that says where the number came
  // from goes the moment it stops being that number.
  const [recalledAmount, setRecalledAmount] = useState<string | null>(null);
  // The amount picking a food left in the field (recalled or the default), so
  // Cancel can tell a number somebody typed from one nobody touched.
  const pickedAmountRef = useRef('');
  // Which question the amount field is asking of a dish. Set from the picked
  // dish rather than remembered across picks — see `choose`.
  const [dishMeasure, setDishMeasure] = useState<DishMeasure>('servings');
  const [chosenSlot, setChosenSlot] = useState<MealSlot | null>(slot);
  // What the person says about the picked item's pantry stock while logging it.
  // Null leaves the pantry alone. Staged until Add, like the meal, so Cancel
  // discards it; reset whenever the picked food changes (effect below).
  const [pantryAnswer, setPantryAnswer] = useState<PantryReviewAnswer | null>(null);
  const [weighGrams, setWeighGrams] = useState('');
  const [dbSearchOpen, setDbSearchOpen] = useState(false);
  // The earlier estimated helping whose amount is being changed before it is
  // logged again (`openHelping`).
  const [amountHelping, setAmountHelping] = useState<FoodLogEntry | null>(null);
  /** Whether the "which item is this" picker is open under a database food. */
  const [catalogPickOpen, setCatalogPickOpen] = useState(false);
  // What was typed for each of a dish's amount-varies lines, keyed by the
  // recipe ingredient's own id. See `varyingLines` below.
  const [varyingAmounts, setVaryingAmounts] = useState<Record<string, string>>({});
  // Foods filed since the sheet opened, while "Add another" is on — the
  // sheet's own record of a burst, since nothing behind it is announcing
  // them (see handleSave). Cleared with the rest of the fields on open.
  const [burstAdded, setBurstAdded] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    searchFilter.seed(initialQuery ?? '');
    setPicked(null);
    setAmount('');
    setAmountUnit(null);
    setAmountNumber('');
    setRecalledAmount(null);
    setChosenSlot(slot);
    setPantryAnswer(null);
    setDbSearchOpen(false);
    setCatalogPickOpen(false);
    setBurstAdded([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, slot]);

  // Fires once a burst save's reset has committed and the search field it
  // wants to focus has actually mounted — see `pendingBurstFocus`'s own note.
  useEffect(() => {
    if (!pendingBurstFocus.current) return;
    pendingBurstFocus.current = false;
    searchFilter.inputRef.current?.focus();
  }, [picked]);

  // Clears whatever was typed into the weight field whenever the picked food
  // or its panel changes out from under it — including right after a
  // weighed portion is saved, which is also when it should clear.
  useEffect(() => {
    setWeighGrams('');
    setCatalogPickOpen(false);
    setPantryAnswer(null);
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
      // A frozen portion is some of an item rather than a brand of it; the
      // item's own row below already offers it. See ItemProduct.isPortion.
      if (!product.nutrition || isPortionBox(product)) continue;
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
      const dish = recipeNutrition(recipe, items, itemProducts, recipesById, undefined, 1, swaps);
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
  }, [items, itemProducts, recipes, nonFoodAisles, swaps]);

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
   *
   * **Unless it has been logged before**, and then it opens on the amount it
   * was last logged in (`foodLastAmounts`), re-measured against the panel it
   * has now by `recallAmount`. The same yogurt at the same 250 g every morning
   * was a food found in one tap and an amount retyped every time. The number
   * is still only a starting point: Save measures it like anything typed, and
   * an old amount the food can no longer measure opens on the default above
   * rather than on a refusal.
   */
  const choose = (candidate: Candidate) => {
    setPicked(candidate);
    const weigh = candidate.kind === 'dish' && candidate.cookedGrams !== null;
    const options = candidate.kind === 'food' && candidate.panel ? foodUnitOptionsFor(candidate.panel) : [];
    const recalled = recallAmount(
      lastAmounts.get(candidate.key),
      candidate.kind === 'food' && candidate.panel
        ? { kind: 'food', panel: candidate.panel, name: candidate.label }
        : { kind: 'dish', weighed: weigh, served: !!candidate.servingPanel },
    );
    setRecalledAmount(recalled?.amount ?? null);
    pickedAmountRef.current = recalled ? recalled.amount : (candidate.kind === 'dish' && !weigh ? '1' : '');
    if (recalled) {
      setDishMeasure(recalled.dishMeasure ?? (weigh ? 'weight' : 'servings'));
      setAmount(recalled.amount);
      setAmountUnit(recalled.unitKey);
      setAmountNumber(recalled.number);
      return;
    }
    setDishMeasure(weigh ? 'weight' : 'servings');
    setAmount(candidate.kind === 'dish' && !weigh ? '1' : '');
    setAmountUnit(options[0]?.key ?? null);
    setAmountNumber('');
  };

  /**
   * What has actually been eaten lately, read once when the sheet opens.
   *
   * A snapshot rather than a subscription: nothing that happens while this is
   * open should reorder the list under the finger picking from it. The one
   * thing that could — saving an entry — closes the sheet anyway, unless
   * burst mode kept it open for another food, which is exactly why
   * `handleSave` retakes this same snapshot on that path: a burst continuing
   * onto the search list is the "something happened while this stayed open"
   * case this comment used to say couldn't occur. Ninety days because the
   * question is "what do you eat", which a fortnight answers badly for
   * anything weekly.
   */
  const [recency, setRecency] = useState(() => foodLogRecency([]));
  // Read off the same snapshot, for the amount `choose` opens a food on.
  const [lastAmounts, setLastAmounts] = useState(() => foodLastAmounts([]));
  // And the snapshot itself, for the earlier helpings offered above the list:
  // the foods logged under no row, which `recency` cannot promote.
  const [recentLog, setRecentLog] = useState<FoodLogEntry[]>([]);
  const refreshRecency = () => {
    const today = getCurrentDayStart();
    const entries = recentEntries(dayKeyOf(subDays(today, 90)), dayKeyOf(today));
    setRecency(foodLogRecency(entries));
    setLastAmounts(foodLastAmounts(entries));
    setRecentLog(entries);
  };
  useEffect(() => {
    if (!visible) return;
    refreshRecency();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    //
    // An entry linked to nothing has no row to find, and matching its null
    // links against the list would land on a dish (whose item and product are
    // null too). A database food that kept its panel is rebuilt from it
    // instead, which is the candidate it was logged from.
    const linked = !!(editing.recipeId || editing.productId || editing.itemId);
    const candidate = !linked
      ? (editing.sourcePanel ? databaseCandidate(`kept:${editing.id}`, editing.label, editing.sourcePanel) : undefined)
      : candidates.find(c => (
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
      searchFilter.seed(editing.label);
      return;
    }
    setPicked(candidate);
    setAmount(plan.amount);
    setRecalledAmount(null);
    if (plan.dishMeasure) setDishMeasure(plan.dishMeasure);
    const options = candidate.kind === 'food' && candidate.panel ? foodUnitOptionsFor(candidate.panel) : [];
    const parsed = options.length > 0 ? parseFoodAmount(plan.amount, options) : null;
    // A saved amount this sheet's own units can't reconstruct — a fraction, a
    // per100ml volume, a weighed one-off — reopens on "Something else" with
    // the exact text intact, rather than silently defaulting to the first
    // pill with a blank number (see `parseFoodAmount`'s own doc comment).
    setAmountUnit(parsed?.unitKey ?? (options.length > 0 ? 'other' : null));
    setAmountNumber(parsed?.number ?? '');
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

  // Earlier helpings of foods with no row (an estimate, a database food nobody
  // filed), offered above the list to log again as they were, since the list
  // itself can only offer rows. Narrowed by the same search. Not offered while
  // correcting an entry: that replaces one helping, and logging another from
  // there would add a second.
  const helpings = useMemo(
    () => (editing ? [] : recentUnlinkedHelpings(recentLog, query)),
    [editing, recentLog, query],
  );

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
    // The same map and swaps the dish's own rollup below measures with, so the
    // lines asked about here are lines of the dish being logged.
    return recipeNutritionLines(recipe, items, itemProducts, recipesById, undefined, 1, swaps).filter(line => {
      if (line.state !== 'unmeasured' || !line.nutrition || !line.item) return false;
      return weighableLine(line.quantity, line.prep, line.nutrition, line.item.name) === null;
    });
  }, [picked, recipes, recipesById, items, itemProducts, swaps]);

  const varyingResolved = useMemo(
    () => varyingLines.map(line => {
      const typed = varyingAmounts[line.id]?.trim() ?? '';
      const resolved = typed && line.nutrition
        ? scalePanelToAmount(line.nutrition, typed, line.prep, undefined, line.item?.name ?? null)
        : null;
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
      const dish = recipeNutrition(recipe, items, itemProducts, recipesById, undefined, 1, swaps);
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
    return scalePanelToAmount(picked.panel, amount, null, undefined, picked.label);
  }, [picked, amount, dishMeasure, recipes, items, itemProducts, varyingResolved, swaps]);

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
  //
  // `built` alone can't gate this any more: a per-100ml panel answers a
  // volume amount's calories from its own volume math with no weight
  // involved, so `built` comes back non-null while `built.grams` is still
  // null. That's still a gap `weighableLine` will offer to close.
  const weighable = useMemo(() => {
    if (!picked || picked.kind !== 'food' || !picked.panel || !amount.trim()) return null;
    if (built && built.grams !== null) return null;
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

  // Every unit this food's panel can resolve — its stated portions, plus
  // grams and/or servings wherever they'd actually work (`foodUnitOptionsFor`).
  // A unit is a pill rather than a `SegmentedControl` — see that component's
  // own doc comment — because it pairs with the free number beside it, the
  // shape that doc comment itself calls out ("a unit beside a stepper").
  // Empty only for the rare panel with no portions and no resolvable grams or
  // servings (a `per100ml` panel with nothing stated), which keeps the plain
  // free-text amount field below instead.
  const foodUnitOptions = useMemo(() => {
    if (!picked || picked.kind !== 'food' || !picked.panel) return [];
    return foodUnitOptionsFor(picked.panel);
  }, [picked]);

  // The weight field itself is shown as soon as a per-100ml food's unit pill
  // is picked — before an amount is even typed — so the option to save a
  // weight is never hidden behind typing something first. Only `weighable`
  // (which needs a typed, unresolved amount) decides whether Save can
  // actually be pressed. Scoped to the pill flow, same as `weighable`'s own
  // per-100ml volume case: a free-typed amount names no unit until it's
  // parsed, so there's nothing to head the field with in advance.
  const weighUnitLabel = picked?.kind === 'food' && picked.panel?.basis === 'per100ml'
    && foodUnitOptions.length > 0 && amountUnit !== 'other'
    ? foodUnitOptions.find(o => o.key === amountUnit)?.label ?? null
    : null;
  const showWeighField = !!weighUnitLabel && (!built || built.grams === null);

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
    setWeighGrams('');
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

  /**
   * Filing it as a new catalog row, minting the row when there isn't one.
   *
   * **The name is asked for first, opening on the database's own** (#2914). A
   * database names a food the way a database does ("Chicken, broilers or
   * fryers, breast, meat only, cooked, roasted"), and filing used to make that
   * the row's name in the grocery catalog with no chance to shorten it, which
   * is then the name it is searched for and listed under from here on. Only
   * the catalog row takes the typed name: this entry keeps the description it
   * was found under, the same as filing it against "Something I already have"
   * does. A blank name files nothing, the way the app's renames treat a blank.
   */
  const fileAsNewItem = () => {
    if (!picked) return;
    const described = picked.label;
    Alert.prompt(
      'Add as a new item',
      'The name it will have in your grocery catalog. It is not added to your shopping list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (text?: string) => {
            const name = (text ?? '').trim();
            if (!name) return;
            // `ensureCatalogItem` rather than `addByName`, the same restraint
            // `FoodLogScreen`'s scan handler takes: eating something is not a
            // plan to buy it, so a row minted here arrives off the list.
            const item = ensureCatalogItem(name);
            if (!item) { haptics.error(); return; }
            fileInCatalog(item);
          },
        },
      ],
      'plain-text',
      described,
    );
  };

  // ==== actions: saving, picking from the database, leaving ====
  /**
   * Writes a new entry, with the planned meal it probably answers. Shared by
   * Save and by logging an earlier helping again, so the two can't disagree
   * about which meal plan square a lunch fills. False when the store refused.
   */
  const logNew = (measurement: Omit<FoodLogDraft, 'mealPlanEntryId' | 'at'>): boolean => {
    // A caller that already knows the planned meal (`LogMealEntrySheet`,
    // the estimate sheet's offer) says so via the prop; a plain manual log
    // has none, so it gets one last chance at `matchMealPlanEntry` before
    // settling for null — see that function's doc comment for why this
    // stays a guess rather than something the store attempts on every save.
    const resolvedMealPlanEntryId = mealPlanEntryId ?? (() => {
      const dayKey = getLogicalDayKey(at);
      const dayPlan = useMealPlanStore.getState().entriesForDayLive(dayKey);
      if (dayPlan.length === 0) return null;
      const alreadyLinked = new Set(
        recentEntries(dayKey, dayKey)
          .map(e => e.mealPlanEntryId)
          .filter((id): id is string => id != null),
      );
      const match = matchMealPlanEntry(dayPlan, alreadyLinked, {
        slot: measurement.slot ?? null,
        recipeId: measurement.recipeId ?? null,
      });
      return match?.id ?? null;
    })();
    const draft: FoodLogDraft = { ...measurement, mealPlanEntryId: resolvedMealPlanEntryId, at };
    if (!addEntry(draft)) {
      haptics.error();
      return false;
    }
    return true;
  };

  /**
   * What happens once a save has landed: close, or with "Add another" on,
   * stay for the next food.
   *
   * `chosenSlot` is deliberately left alone in a burst — a burst is usually
   * one meal's worth of things — and everything else resets the same way the
   * `visible` effect above seeds a fresh open. `refreshRecency` retakes the
   * snapshot `recency`'s own doc comment argues for, since this is the one
   * path where something did happen while the sheet stayed open.
   *
   * From the amount half, the search field doesn't exist yet to focus: `picked`
   * is still truthy, so the JSX is still on the amount-entry branch and
   * `searchFilter.inputRef` points at nothing. `pendingBurstFocus` hands the
   * actual `.focus()` to the effect above, which fires once the reset has
   * committed and the search field has mounted in its place. From the list
   * half (an earlier helping logged again) the field is already there, and
   * `seed` carries its focus across on its own.
   */
  const afterSave = (label: string) => {
    haptics.success();
    if (burstMode) {
      setBurstAdded(prev => [...prev, label]);
      searchFilter.seed(initialQuery ?? '');
      if (picked) pendingBurstFocus.current = true;
      setPicked(null);
      setAmount('');
      setAmountUnit(null);
      setAmountNumber('');
      setRecalledAmount(null);
      setDbSearchOpen(false);
      refreshRecency();
      return;
    }
    Keyboard.dismiss();
    onClose();
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
    const measurement = {
      label: picked.label,
      quantity,
      grams: built.grams,
      nutrition: built.nutrition,
      // The database's own panel, kept on the entry while no catalog row holds
      // it, so the amount can be corrected later (see FoodLogEntry.sourcePanel).
      // Null for everything else, which on a correction also clears one that
      // no longer describes how the helping was measured: it was re-measured
      // against a row, or it is a different food now.
      sourcePanel: picked.fromDatabase && picked.itemId === null ? picked.panel : null,
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
    } else if (!logNew(measurement)) {
      return;
    }
    // Written only once the entry is, so a refused log leaves the pantry as it
    // was. The same write the pantry review's three answers make.
    if (pantryAnswer && picked.itemId && !editing) answerPantryReview(picked.itemId, pantryAnswer);
    afterSave(picked.label);
  };

  /**
   * An earlier helping of something linked to no row, logged again as it was
   * (#2914). The same figures under the same claim, and the panel it kept if
   * it kept one, the way `duplicateEntry` copies an entry; see
   * `recentUnlinkedHelpings` for why these are offered at all. It lands in the
   * meal the sheet was opened for, or the one it was eaten at last time when
   * the sheet names none, the call the estimate sheet's recall makes.
   */
  const logHelpingAgain = (entry: FoodLogEntry) => {
    const again = helpingAgain(entry);
    const logged = logNew({
      ...again,
      slot: chosenSlot ?? entry.slot,
      recipeId: null,
      itemId: null,
      productId: null,
    });
    if (logged) afterSave(again.label);
  };

  /** An estimated helping logged again at the amount the card chose, as a multiple of its whole. */
  const logHelpingAtAmount = (entry: FoodLogEntry, patch: EstimateAmountPatch) => {
    const logged = logNew({
      label: entry.label,
      quantity: patch.quantity,
      grams: patch.grams,
      nutrition: patch.nutrition,
      sourcePanel: patch.sourcePanel,
      slot: chosenSlot ?? entry.slot,
      recipeId: null,
      itemId: null,
      productId: null,
    });
    if (logged) afterSave(entry.label);
  };

  /**
   * The row body of an earlier helping: change the amount first, where the +
   * logs it as it was. An estimate opens "Change amount", the question its
   * figures can answer (a multiple of the whole it described). A database
   * food that kept its panel opens the ordinary amount form on that panel, at
   * the weight it was logged at, so it is re-measured rather than multiplied.
   * Anything else has no amount to change, so the row logs it as recorded.
   */
  const openHelping = (entry: FoodLogEntry) => {
    haptics.tap();
    if (wholeEstimate(entry)) { Keyboard.dismiss(); setAmountHelping(entry); return; }
    const panel = keptDatabasePanel(entry);
    if (!panel) { logHelpingAgain(entry); return; }
    handleDbPick(panel, entry.label);
    const grams = foodUnitOptionsFor(panel).find(o => o.key === 'g');
    if (grams && entry.grams) {
      const number = String(entry.grams);
      setAmountUnit('g');
      setAmountNumber(number);
      setAmount(composeFoodAmount(number, grams));
    }
  };

  // Nothing here has a `GroceryItem` or `ItemProduct` behind it, so there is
  // no row to attach the panel to — the candidate carries it directly, same
  // as a picked dish carries `servingPanel` rather than pointing at one.
  const handleDbPick = (nutrition: FoodNutrition, description: string) => {
    setPicked(databaseCandidate(`db:${description}`, description, nutrition));
    pickedAmountRef.current = '';
    setAmount('');
    setRecalledAmount(null);
    const options = foodUnitOptionsFor(nutrition);
    setAmountUnit(options[0]?.key ?? null);
    setAmountNumber('');
  };

  // The dirty check and confirm behind both Cancel and "Open Settings" from
  // the nested NutritionSearchSheet — the latter needs to close this whole
  // sheet too (see that sheet's own onOpenSettings note), and shouldn't
  // silently drop a draft any more than Cancel does.
  const requestClose = (onClosed: () => void) => {
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
      : picked
        ? amount.trim() !== pickedAmountRef.current.trim() || answeredExtra
        : !!amount.trim();
    if (!dirty) { Keyboard.dismiss(); onClosed(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { Keyboard.dismiss(); onClosed(); } },
      ],
    );
  };

  const handleCancel = () => requestClose(onClose);

  // The one door into the food database search, shared by the action row and
  // the empty state so a missing key is answered the same way from both.
  const openFoodDatabase = () => {
    haptics.tap();
    Keyboard.dismiss();
    if (hasFdcKey) { setDbSearchOpen(true); return; }
    // The key row is shown only while lookups are on, so with them off this
    // lands on the switch that brings it back.
    const entryId = productLookupEnabled ? 'fdcApiKey' : 'productLookupEnabled';
    requestClose(() => { onClose(); navigateToFoodSearchSettings(navigation, entryId); });
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

  // While searching, what matches the catalog comes first and the earlier
  // helpings follow it: someone typing "oat milk" wants the food, not the
  // three most recent estimates that happen to mention it. With nothing typed
  // they stay on top as quick recents.
  const helpingsAfterResults = query.trim().length > 0 && results.length > 0;
  const helpingsBlock = helpings.length > 0 ? (
    <View>
      <Text style={[styles.label, styles.helpingsLabel]}>LOG THE SAME AGAIN</Text>
      {helpings.map(entry => (
        <View key={entry.id} style={[styles.row, styles.helpingRow]}>
          {/* The body opens the amount first, like a row below. */}
          <TouchableOpacity
            style={styles.helpingBody}
            activeOpacity={interaction.activeOpacity}
            onPress={() => openHelping(entry)}
            accessibilityRole="button"
            accessibilityLabel={`Change amount of ${entry.label}, ${describeFoodLogEntry(entry)}`}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{entry.label}</Text>
              <Text style={styles.rowMeta}>{describeFoodLogEntry(entry)}</Text>
            </View>
          </TouchableOpacity>
          {/* The plus logs it as it was, at once. */}
          <TouchableOpacity
            style={styles.helpingAdd}
            activeOpacity={interaction.activeOpacity}
            onPress={() => logHelpingAgain(entry)}
            accessibilityRole="button"
            accessibilityLabel={`Log ${entry.label} again, ${describeFoodLogEntry(entry)}`}
          >
            <Ionicons name="add-circle-outline" size={iconSize.md} color={colors.accent} />
          </TouchableOpacity>
        </View>
      ))}
      {!helpingsAfterResults && results.length > 0 && (
        <Text style={[styles.label, styles.listLabel]}>FOODS AND RECIPES</Text>
      )}
    </View>
  ) : null;

  return (
    <SheetModal name="What did you eat?" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
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
            {(() => {
              const usingFoodUnitPills = picked.kind === 'food' && foodUnitOptions.length > 0 && amountUnit !== 'other';
              const selectedFoodUnit = usingFoodUnitPills ? foodUnitOptions.find(o => o.key === amountUnit) : undefined;
              return (
                <View style={usingFoodUnitPills ? styles.inputRow : undefined}>
                  <TextField
                    style={usingFoodUnitPills ? styles.inputWithSuffix : styles.input}
                    value={usingFoodUnitPills ? amountNumber : amount}
                    onChangeText={text => {
                      if (usingFoodUnitPills) {
                        setAmountNumber(text);
                        setAmount(composeFoodAmount(text, selectedFoodUnit));
                      } else {
                        setAmount(text);
                      }
                    }}
                    placeholder={
                      picked.kind === 'dish'
                        ? (dishMeasure === 'weight' ? 'e.g. 320 (grams)' : 'e.g. 1.5')
                        : usingFoodUnitPills
                          ? 'Amount'
                          : `e.g. ${picked.panel ? amountExample(picked.panel) : '100g'}`
                    }
                    placeholderTextColor={colors.textTertiary}
                    autoFocus
                    // An amount filled in from last time is selected on
                    // arrival, so typing a different one replaces it rather
                    // than appending to it ("250" becoming "250200").
                    selectTextOnFocus={recalledAmount !== null && amount === recalledAmount}
                    keyboardType={
                      picked.kind === 'dish' || usingFoodUnitPills
                        ? 'decimal-pad' : 'default'
                    }
                    // The number pad has no return key, so without this there is no
                    // way off it — the same accessory the weigh field below already
                    // passes. Omitted for the free-text field, whose amount is
                    // typed words ("1 cup", "250 ml") on the ordinary keyboard.
                    inputAccessoryViewID={
                      picked.kind === 'dish' || usingFoodUnitPills
                        ? NUMBER_PAD_ACCESSORY_ID : undefined
                    }
                    accessibilityLabel={
                      picked.kind === 'dish' && dishMeasure === 'weight'
                        ? 'Weight on your plate in grams'
                        : 'How much you ate'
                    }
                  />
                  {/* The placeholder alone only names the unit before anything
                      is typed — it's gone the moment a number is, which is
                      exactly when a "servings" vs. "g" mix-up would matter.
                      This sits outside the placeholder so it stays visible. */}
                  {usingFoodUnitPills && selectedFoodUnit && (
                    <Text style={styles.inputSuffix}>{selectedFoodUnit.label}</Text>
                  )}
                </View>
              );
            })()}
            {picked.kind === 'food' && foodUnitOptions.length > 0 && (
              <View style={styles.portionChips}>
                {foodUnitOptions.map(option => {
                  const on = amountUnit === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.portionChip, on && styles.portionChipOn]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => {
                        haptics.tap();
                        setAmountUnit(option.key);
                        setAmount(composeFoodAmount(amountNumber, option));
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={option.label}
                    >
                      <Text style={[styles.portionChipText, on && styles.portionChipTextOn]}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
                {/* The escape hatch for a unit this food's own panel doesn't
                    state: swaps the number-only field above back to free
                    text, so a novel amount can still be typed and, if it
                    names a unit the panel can't resolve, weighed in via
                    `weighable` — the same offer this sheet already makes for
                    any refused amount. */}
                <TouchableOpacity
                  key="other"
                  style={[styles.portionChip, amountUnit === 'other' && styles.portionChipOn]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => { haptics.tap(); setAmountUnit('other'); setAmount(''); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: amountUnit === 'other' }}
                  accessibilityLabel="Something else"
                >
                  <Text style={[styles.portionChipText, amountUnit === 'other' && styles.portionChipTextOn]}>
                    Something else
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.hint}>
              {/* Says where a number nobody typed came from, and only while
                  the field still holds it. */}
              {recalledAmount !== null && amount === recalledAmount ? 'Filled in from the last time you logged this. ' : ''}
              {picked.kind === 'dish'
                ? dishWeightHint
                : foodUnitOptions.length > 0 && amountUnit !== 'other'
                  ? 'Choose a unit below and type the amount. Anything else is refused rather than guessed at.'
                  : picked.panel
                    ? `${amountHint(picked.panel)}${
                      picked.panel.basis === 'per100ml'
                        ? ' Type an amount by volume and you can weigh it once to add its weight.'
                        : ' Type an amount by volume or count and you can weigh it once to add it.'
                    }`
                    : 'A weight, like 100g.'}
            </Text>

            {!!amount.trim() && !built && (
              <Text style={styles.error}>
                {picked.kind === 'dish'
                  ? (dishMeasure === 'weight'
                    ? `Enter what was on your plate, in grams, up to the ${picked.cookedGrams} g the whole dish weighs.`
                    : 'Enter how many servings you had.')
                  : `This food has no way to measure that amount, so the figures would be a guess. ${
                    picked.panel ? amountHint(picked.panel) : 'Try a weight, or an amount it states a portion for.'
                  }`}
              </Text>
            )}

            {showWeighField && (
              <View style={styles.weighForm}>
                <View style={styles.weighHeader}>
                  <Ionicons name="scale-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.weighHeaderLabel}>{`Weight (${weighUnitLabel})`}</Text>
                </View>
                <View style={styles.weighRow}>
                  <TextField
                    style={styles.weighInput}
                    value={weighGrams}
                    onChangeText={setWeighGrams}
                    placeholder="e.g. 240"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                    // This field can be focused while the amount field's
                    // keyboard is already up, which is the one case
                    // `automaticallyAdjustKeyboardInsets` can't cover — see
                    // `useScrollFieldIntoView`'s doc comment. Without this
                    // the row can render entirely behind the keyboard with
                    // no way to reach it.
                    onFocus={e => {
                      if (typeof e.nativeEvent.target === 'number') {
                        keyboardScroll.focusInput(e.nativeEvent.target);
                      }
                    }}
                    accessibilityLabel={`Weight in grams, ${weighUnitLabel}`}
                  />
                  <Text style={styles.weighUnit}>g</Text>
                  <InlineAction
                    label="Save"
                    onPress={handleSaveWeighedPortion}
                    disabled={!weighable || !weighGrams.trim()}
                    haptic
                  />
                </View>
                <Text style={styles.weighHint}>
                  Weigh it and enter the total weight. The app remembers it for next time.
                </Text>
              </View>
            )}

            {!!built && (
              <Text style={styles.preview}>
                {built.nutrition.amounts.calorieKcal !== undefined
                  ? `${Math.round(built.nutrition.amounts.calorieKcal)} cal`
                  : 'No calories stated'}
                {built.nutrition.amounts.proteinG !== undefined
                  ? `, ${Math.round(built.nutrition.amounts.proteinG)} g protein`
                  : ''}
                {built.grams !== null ? `, ${built.grams} g` : ''}
              </Text>
            )}
            {/* This label states no density of its own, so the weight behind
                a volume amount is approximated from water's — right for most
                drinks, off for anything syrupy or creamy. See
                `scalePanelToAmount`'s beverage fallback. */}
            {!!built?.approximate && (
              <Text style={styles.hint}>Approximate: no manufacturer serving data.</Text>
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
                    label="Add as a new item"
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
                    <TextField
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

            {/* Only for a food that is a catalog row (a dish or a bare database
                food has no pantry entry to update), and not when correcting an
                entry that was logged already. */}
            {!!picked.itemId && !editing && (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>PANTRY</Text>
                <SegmentedControl<PantryReviewAnswer | null>
                  options={[
                    { value: null, label: 'No change' },
                    { value: 'have', label: 'Still have it' },
                    { value: 'low', label: 'Running low' },
                    { value: 'out', label: 'Out of it' },
                  ]}
                  value={pantryAnswer}
                  onChange={setPantryAnswer}
                  columns={2}
                  label="Pantry"
                  surface="page"
                />
                {pantryAnswer === 'low' && (
                  <Text style={styles.hint}>Running low also adds it to your grocery list.</Text>
                )}
              </>
            )}
          </ScrollView>
        ) : (
          <>
            {/* A tap on the gaps around the search field and the chips puts the
                keyboard away; the controls inside handle their own taps. */}
            <Pressable onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
              <TextInput
                key={searchFilter.fieldKey}
                {...searchFilter.props}
                style={styles.searchInput}
                placeholder="Search foods and recipes"
                inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                placeholderTextColor={colors.textTertiary}
                autoCorrect={false}
              />
            </View>
            {/* Hidden for a caller answering one specific food (a correction,
                a seeded dish, an already-known meal), same as this sheet's
                other one-off affordances above. */}
            {!!allowBurst && !editing && (
              <View style={styles.burstRow}>
                <TouchableOpacity
                  style={[styles.keepOpenChip, keepOpenAfterFoodLog && styles.keepOpenChipOn]}
                  onPress={() => { haptics.tap(); setKeepOpenAfterFoodLog(!keepOpenAfterFoodLog); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: keepOpenAfterFoodLog }}
                  accessibilityLabel="Add another"
                >
                  <Ionicons
                    name={keepOpenAfterFoodLog ? 'checkmark-circle' : 'ellipse-outline'}
                    size={15}
                    color={keepOpenAfterFoodLog ? colors.accent : colors.textSecondary}
                  />
                  <Text style={[styles.keepOpenText, keepOpenAfterFoodLog && styles.keepOpenTextOn]}>
                    Add another
                  </Text>
                </TouchableOpacity>
                {burstAdded.length > 0 && (
                  <Text style={styles.burstCount}>
                    {burstAdded.length} added
                  </Text>
                )}
              </View>
            )}
            <View style={styles.actionRow}>
              {!!onScan && (
                <InlineAction
                  label="Scan a barcode"
                  icon="barcode-outline"
                  onPress={() => { haptics.tap(); Keyboard.dismiss(); onScan(); }}
                />
              )}
              {/* Always offered: the catalog list above only holds foods that
                  already have figures, and this is the way to a food that
                  doesn't. It searches what is typed above. */}
              <InlineAction
                label={hasFdcKey ? 'Search a food database' : 'Add a food database key'}
                icon="search-outline"
                variant="neutral"
                onPress={openFoodDatabase}
              />
              {!!onSavedMeal && (
                <InlineAction
                  label="Log a saved meal"
                  icon="bookmark-outline"
                  variant="neutral"
                  onPress={() => { haptics.tap(); Keyboard.dismiss(); onSavedMeal(); }}
                />
              )}
              {!!onEstimate && (
                <InlineAction
                  label="Describe what you ate instead"
                  icon="sparkles-outline"
                  variant="neutral"
                  onPress={() => { haptics.tap(); Keyboard.dismiss(); onEstimate(query); }}
                />
              )}
            </View>
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
            </Pressable>
            <FlatList
              ref={listScroll.ref}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              data={results}
              keyExtractor={c => c.key}
              renderItem={renderRow}
              keyboardShouldPersistTaps="handled"
              // The only way to put the keyboard away from here: nothing else
              // on this half is tappable-to-dismiss, and a pageSheet has no
              // outside to tap.
              keyboardDismissMode="on-drag"
              {...listScroll.props}
              ListHeaderComponent={helpingsAfterResults ? null : helpingsBlock}
              ListFooterComponent={helpingsAfterResults ? helpingsBlock : null}
              ListEmptyComponent={
                <EmptyState
                  icon="nutrition-outline"
                  // Said about the catalog when logged-before rows are showing
                  // above, so it doesn't claim there is nothing to log while
                  // offering something to log.
                  title={candidates.length === 0
                    ? (helpings.length > 0 ? 'Nothing in your catalog has figures yet' : 'Nothing has figures yet')
                    : (helpings.length > 0 ? 'Nothing in your catalog matches' : 'No matching food')}
                  subtitle={
                    (candidates.length === 0
                      ? 'A food can be logged once it has nutrition on it.'
                      : 'Only foods and recipes with nutrition on them can be logged.')
                    + (hasFdcKey
                      ? (candidates.length === 0
                        ? ' Search a food database below, or open a grocery item to attach nutrition to it there.'
                        : ' Search a food database instead, or open a grocery item to attach nutrition to it there.')
                      // Without a key the search can only fail, so the next
                      // step is the key, not the search.
                      : ' Searching a food database by name needs a free FoodData Central key, which you can add in Settings. You can also open a grocery item to add its nutrition there.')
                  }
                  actionLabel={hasFdcKey ? 'Search a food database' : 'Add a food database key'}
                  onAction={openFoodDatabase}
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
        onOpenSettings={entryId => {
          setDbSearchOpen(false);
          requestClose(() => { onClose(); navigateToFoodSearchSettings(navigation, entryId); });
        }}
      />
      {/* Inside this Modal, not beside it: the card is raised from a sheet that
          is already presenting. */}
      <EstimateAmountSheet
        visible={amountHelping !== null}
        entry={amountHelping}
        saveLabel="Log"
        allowUnchanged
        onSave={patch => { if (amountHelping) logHelpingAtAmount(amountHelping, patch); }}
        onClose={() => setAmountHelping(null)}
      />
      {overlays}
      <NumberPadAccessory />
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
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
      marginTop: spacing.smd,
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
    portionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    portionChip: {
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bgSecondary,
    },
    portionChipOn: { backgroundColor: colors.accentFill },
    portionChipText: { color: colors.text, fontSize: font.sm },
    portionChipTextOn: { color: colors.onAccent, fontWeight: fontWeight.medium },
    input: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginTop: spacing.xs,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      marginTop: spacing.xs,
    },
    inputWithSuffix: {
      flex: 1,
      paddingVertical: spacing.sm,
      color: colors.text,
      fontSize: font.md,
    },
    inputSuffix: {
      color: colors.textSecondary,
      fontSize: font.md,
      marginLeft: spacing.xs,
    },
    hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, marginTop: spacing.xs },
    error: { color: colors.redText, fontSize: font.sm, lineHeight: 18, marginTop: spacing.sm },
    preview: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold, marginTop: spacing.sm },
    // Wraps rather than truncating: the first pill carries the food's own name,
    // which can be a database description several words long.
    fileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    filedNote: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.md },
    weighForm: {
      marginTop: spacing.sm,
      padding: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      gap: spacing.xs,
    },
    weighHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    weighHeaderLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
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
    // Same shape as QuickAddModal's own burst row: the chip toggles the
    // setting directly (no local on/off state of its own), and the count
    // beside it only appears once there's something to count.
    burstRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
    },
    keepOpenChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.bgTertiary,
    },
    keepOpenChipOn: {
      backgroundColor: colors.accent + '22',
    },
    keepOpenText: {
      color: colors.textSecondary,
      fontSize: font.sm,
    },
    keepOpenTextOn: {
      color: colors.accent,
      fontWeight: fontWeight.semibold,
    },
    burstCount: {
      color: colors.textSecondary,
      fontSize: font.sm,
    },
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
    // The section labels above and inside the list's own rows, which keep
    // spacing.sm between themselves; a label takes that below it and a block
    // gap above when it starts the second group.
    // The row's padding moves onto its two touch targets, so the body and the
    // plus each reach the card's edge instead of leaving a dead margin.
    helpingRow: { paddingHorizontal: 0, paddingVertical: 0, gap: 0, alignItems: 'stretch' },
    helpingBody: { flex: 1, justifyContent: 'center', paddingLeft: spacing.md, paddingVertical: spacing.md },
    helpingAdd: { justifyContent: 'center', paddingHorizontal: spacing.md },
    helpingsLabel: { marginBottom: spacing.sm },
    listLabel: { marginTop: spacing.md, marginBottom: spacing.sm },
  });
}
