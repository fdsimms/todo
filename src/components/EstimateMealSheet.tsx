import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { subDays } from 'date-fns/subDays';
import { SheetModal } from './SheetModal';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, NUTRIENT_KEYS, type FoodLogEntry, type FoodNutrition, type MealSlot, type NutrientKey } from '../types';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { describeAIError, estimateMealNutrition } from '../services/aiSuggestions';
import {
  ESTIMATE_DESCRIPTION_MAX_LENGTH,
  MAX_CONTEXT_FOODS,
  describeEstimate,
  estimateToPanel,
  refineDescription,
  type EstimateContextFood,
  type NutritionEstimate,
} from '../utils/nutritionEstimate';
import {
  RECALL_MIN_QUERY,
  catalogRecallFoods,
  describeCatalogRecall,
  describeRecall,
  describedGrams,
  rankRecallCandidates,
  recallFoods,
  recallWeight,
  type RecalledCatalogFood,
  type RecalledFood,
} from '../utils/foodRecall';
import { creditedKeys, foodLogRecency, rankByRecency } from '../utils/foodLogRecents';
import { scalePanelToAmount } from '../utils/foodLog';
import { perServing, recipeNutrition } from '../utils/recipeNutrition';
import { packageHelping } from '../utils/scanPortion';
import { useGroceryStore } from '../store/useGroceryStore';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { groceryNameKey } from '../utils/groceryParse';
import { haptics } from '../utils/haptics';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import Ionicons from '@expo/vector-icons/Ionicons';
import { InlineAction } from './InlineAction';
import { PressableScale } from './PressableScale';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';

/**
 * "Cheeseburger and fries at Five Guys", read into figures to confirm.
 *
 * **The estimate is a proposal until somebody taps Log.** Nothing is written
 * before that, which is the rule the whole feature rests on rather than a
 * nicety: `docs/arch/health-data.md` licenses a dietary figure on it having
 * been entered by a person, and an estimate stored unconfirmed breaks exactly
 * that argument. The figures are on screen, itemised, before the tap. Same
 * call `sharedRecipeLinks` makes about a page waiting to be imported rather
 * than importing itself.
 *
 * **What the estimate claims is said in words beside it.** A chain's published
 * figures and a guess at a pub burger are different claims, and rendering a
 * bare number for both would present the second as the first. That sentence is
 * `describeEstimate`, which is a pure function so the rule that it never
 * advises is checkable rather than merely intended.
 *
 * **It offers what has already been eaten before it estimates anything.** If
 * the description names something in the food log or the recipe box, that is
 * real data the user already owns and it beats a guess. The offer is a row,
 * not a substitution: they may have eaten out and named the dish the same
 * thing.
 *
 * The food log half of that is the one with teeth, and `foodRecall.ts` sets out
 * why: a panel logged from a barcode or a database carries a source, and
 * describing the same food to the model records it again as an estimate, which
 * is permanent and which `sourceMix` then counts as a guess for ever. Handing
 * the stored panel straight back is the only path here that does not weaken
 * what is already known. A catalog row with figures filed on it is offered on
 * the same card and for the same reason, one serving at a time, since
 * `ItemProduct` holds no pack size for a whole-package option to divide.
 *
 * **What is left over is composition, and that is what the model gets the
 * records for.** "Half my chili recipe with rice" names nothing the log holds
 * whole, so no row can answer it, and the figures for the parts are sitting
 * right here. They go to `estimateMealNutrition` as context and come back as
 * `basis: 'own'`, which is a claim about where the numbers came from rather
 * than about how good they are: the result is still marked `estimated`,
 * because a composition the app did not compute is a guess however good its
 * inputs. `EstimateBasis` argues that at length.
 *
 * **Questions are asked, then skippable.** One or two, only where the answer
 * moves the figures a lot, and skipping simply leaves them out of the re-ask.
 * That is deliberately unlike `templateQuestions`, where every question has a
 * fallback answer because it fills a blank that must have a value; these only
 * narrow a re-ask, so unanswered is a meaningful state rather than a third one
 * for every reader to handle.
 *
 * The description typed here is staged before an explicit Log, so the swipe
 * down is guarded.
 */

// Map of this file (one component holding most of it; `grep -n '// ===='` is
// the table of contents):
//   state          the description, the estimate on screen, the staged row
//   offers         past entries, catalog rows and recipes the text names
//   estimate       asking the model, refining with answers, the Log button
//   staged rows    a past entry's amount step, and its one-tap +
//   save/cancel    filing the estimate as a recipe, the discard guard
//   render         the offer list, the estimate row, the result card
// Below the component: PendingRecallCard, KcalFigure, NutrientLine, styles.

/** A recall row staged for confirmation, before its amount is settled. */
type PendingRecallLog =
  | { kind: 'recall'; food: RecalledFood }
  | { kind: 'catalog'; food: RecalledCatalogFood };

interface Props {
  visible: boolean;
  /** Which meal it lands in, chosen by the section the estimate was started from. */
  slot: MealSlot | null;
  /** The logical day being logged, so a backdated estimate lands where it is shown. */
  at: Date;
  /**
   * The planned meal this estimate is logging, carried onto whatever gets
   * saved — same field `FoodLogEntrySheet`'s own `mealPlanEntryId` prop
   * writes, for a caller reached from a meal-plan prompt rather than the
   * plain "add a food" flow. Omitted (or null) for every other caller.
   */
  mealPlanEntryId?: string | null;
  /**
   * What the description field starts as — the dish's own name, from whatever
   * the caller already knew: a meal's title, or the words typed into the food
   * search before it came up empty (`FoodLogEntrySheet`'s `onEstimate`).
   *
   * It seeds the field rather than estimating on open, and that distinction is
   * the whole of it: a request costs Anthropic tokens, so the person still taps
   * Estimate. Same call `sharedRecipeLinks` makes about a page waiting for a
   * tap, and the reason `nutritionEstimate.ts` cites it.
   *
   * Read at the moment the sheet opens, like `slot` beside it. A caller that
   * changes it while the sheet is up would otherwise rewrite a description
   * somebody is part-way through editing.
   */
  initialDescription?: string;
  onClose: () => void;
  /** Offered instead of estimating, when the description names one. See the note above. */
  onPickRecipe: (recipeId: string) => void;
  /**
   * Fired right before `onClose` on a successful Log, and only then — a
   * caller that keeps its own "what did you eat?" sheet open underneath this
   * one (rather than closing it to open this) uses this to close that sheet
   * too, so a completed estimate doesn't reveal it again. Cancelling leaves
   * it unfired, which is what lets that sheet stay in place.
   */
  onLogged?: () => void;
}

export function EstimateMealSheet({ visible, slot, at, mealPlanEntryId, initialDescription, onClose, onPickRecipe, onLogged }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const addEntry = useFoodLogStore(s => s.addEntry);
  const recentEntries = useFoodLogStore(s => s.recentEntries);
  const recipes = useRecipeStore(s => s.recipes);
  const items = useGroceryStore(s => s.items);
  const itemProducts = useGroceryStore(s => s.itemProducts);
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const addIngredientsFromText = useRecipeStore(s => s.addIngredientsFromText);

  // ==== state ====
  const [description, setDescription] = useState('');
  const [estimate, setEstimate] = useState<NutritionEstimate | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosenSlot, setChosenSlot] = useState<MealSlot | null>(slot);
  // Which recipe this estimate was just filed as, so the button can turn into
  // a confirmation instead of offering to file the same thing twice. Reset
  // whenever the estimate itself changes, since a re-estimate or a fresh
  // description is a different candidate recipe.
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);
  /**
   * The "you already have figures for this" row a person tapped, staged for
   * confirmation rather than logged on the tap itself — see the note above
   * `openRecall`/`openCatalog` for why a tap used to log outright and no
   * longer does.
   */
  const [pendingLog, setPendingLog] = useState<PendingRecallLog | null>(null);
  /** The weight field for the staged row, editable before it's logged. */
  const [pendingWeight, setPendingWeight] = useState('');
  /**
   * The recorded weight the staged row opened with, so `confirmPending` can
   * tell an untouched field from an edited one and only rescale on the
   * latter — reusing the stored panel verbatim otherwise, for the reason
   * `confirmPending`'s own doc comment (below) gives.
   */
  const [pendingDefaultGrams, setPendingDefaultGrams] = useState<number | null>(null);
  /**
   * The description the current estimate was asked about, before any answers
   * were folded into it. A refinement re-asks from this rather than from the
   * field, so an answer tapped after the field was edited still refines the
   * meal on screen; and the field differing from it is what brings the
   * estimate row back, to ask about the new text.
   */
  const [estimatedFor, setEstimatedFor] = useState<string | null>(null);
  /**
   * The questions the first estimate asked, held apart from the estimate
   * itself. A re-ask with an answer folded in may come back asking fewer (or
   * none), and the other questions leaving the screen the moment one is
   * answered would strand them unanswerable.
   */
  const [questions, setQuestions] = useState<NutritionEstimate['questions']>([]);
  /** Whether the full nutrient list and the per-ingredient split are open. */
  const [detailsOpen, setDetailsOpen] = useState(false);
  /**
   * What has been eaten lately, taken once when the sheet opens.
   *
   * A snapshot rather than a subscription, the call `FoodLogEntrySheet` makes
   * for its own ranking: nothing happening underneath should reorder the offers
   * under the finger picking one, and the only thing that could is a write that
   * closes this sheet anyway. Ninety days for the reason given there, that a
   * fortnight answers "what do you eat" badly for anything weekly.
   */
  const [history, setHistory] = useState<FoodLogEntry[]>([]);

  // `initialDescription` is deliberately not a dependency: it is read on the
  // opening edge only, so a caller whose value changes underneath (the food
  // search's own query keeps moving while its sheet sits open behind this one)
  // cannot wipe an edit in progress. Same reason `defaultSlot` is held in a ref
  // in `PlanMealSheet`; here `visible` already gates it.
  useEffect(() => {
    if (!visible) return;
    setDescription(initialDescription ?? '');
    setEstimate(null);
    setAnswers({});
    setLoading(false);
    setError(null);
    setChosenSlot(slot);
    setSavedRecipeId(null);
    setPendingLog(null);
    setPendingWeight('');
    setPendingDefaultGrams(null);
    setEstimatedFor(null);
    setQuestions([]);
    setDetailsOpen(false);
    const today = getCurrentDayStart();
    setHistory(recentEntries(dayKeyOf(subDays(today, 90)), dayKeyOf(today)));
  }, [visible, slot]);

  // ==== offers: what has been eaten or filed before ====
  // Real data the user already owns beats a guess, so every offer is made
  // before the request rather than after it comes back.
  const recalled = useMemo(() => recallFoods(history, description), [history, description]);

  /**
   * Catalog rows with figures on them, arranged by what has actually been
   * eaten before the description is matched against them.
   *
   * `rankByRecency` first and `rankRecallCandidates` second, which is the order
   * that matters: the match decides *whether* a row is offered and recency
   * decides which of two equally-named ones leads, so a pot eaten weekly
   * outranks a duplicate nobody has touched.
   */
  const catalogCandidates = useMemo(
    () => catalogRecallFoods(items, itemProducts),
    [items, itemProducts],
  );
  const recency = useMemo(() => foodLogRecency(history), [history]);
  const catalogMatches = useMemo(() => {
    // Anything already offered as something eaten is not offered again as
    // something owned: the entry knows the helping actually taken, where this
    // only knows what one serving of it is.
    const offered = new Set(recalled.flatMap(creditedKeys));
    const open = catalogCandidates.filter(food => !offered.has(food.key));
    return rankRecallCandidates(rankByRecency(open, recency), description, 2);
  }, [catalogCandidates, recalled, recency, description]);

  /**
   * Recipes the description names, minus any already offered as something
   * eaten.
   *
   * A recipe logged last week appears on both lists otherwise, saying the same
   * name twice for two different actions. The recall wins that: it knows the
   * helping actually eaten, where the recipe row still has to go and ask for
   * one.
   */
  const matches = useMemo(() => {
    const key = groceryNameKey(description);
    if (key.length < RECALL_MIN_QUERY) return [];
    const offered = new Set(recalled.map(food => food.recipeId).filter(Boolean));
    return recipes
      .filter(r => !offered.has(r.id))
      .map(recipe => ({ recipe, weight: recallWeight(groceryNameKey(recipe.name), key) }))
      .filter(scored => scored.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.recipe.name.localeCompare(b.recipe.name))
      .slice(0, 3)
      .map(scored => scored.recipe);
  }, [description, recipes, recalled]);

  /**
   * One helping of a catalog row, scaled off its own panel.
   *
   * Through `packageHelping` rather than read raw, because a panel filed per
   * 100g states figures for 100g and the row offers a serving. It carries the
   * panel's `source` through unchanged, which is as true of the helping as of
   * the packet.
   */
  const helpingOf = (food: RecalledCatalogFood) =>
    packageHelping(food.nutrition, food.choice.servings, food.choice.label, at);

  /**
   * The user's own figures, handed to the model for the meal that is not any
   * one of them.
   *
   * Everything offered as a row above is offered here too, plus the matched
   * recipes' per-serving figures, which have no row of their own because a
   * recipe row still has to go and ask for a helping. A description naming one
   * of these outright never needs the model at all; this is for "half my chili
   * with rice", where every part is known and the whole is not.
   */
  const context = useMemo<EstimateContextFood[]>(() => {
    const out: EstimateContextFood[] = [];
    for (const food of recalled) {
      out.push({ label: food.label, quantity: food.quantity, amounts: food.nutrition.amounts });
    }
    for (const food of catalogMatches) {
      const helping = helpingOf(food);
      if (helping) out.push({ label: food.label, quantity: food.choice.label, amounts: helping.amounts });
    }
    for (const recipe of matches) {
      const serving = perServing(recipeNutrition(recipe, items, itemProducts));
      if (serving) out.push({ label: recipe.name, quantity: '1 serving', amounts: serving });
    }
    return out.slice(0, MAX_CONTEXT_FOODS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recalled, catalogMatches, matches, items, itemProducts, at]);

  // ==== estimate: asking, refining, logging ====
  const run = async (text: string, fresh: boolean) => {
    setLoading(true);
    setError(null);
    setSavedRecipeId(null);
    try {
      const result = await estimateMealNutrition(text, context);
      setEstimate(result);
      if (fresh) setQuestions(result.questions);
    } catch (e) {
      setEstimate(null);
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleEstimate = () => {
    if (!description.trim() || loading) return;
    haptics.tap();
    Keyboard.dismiss();
    setAnswers({});
    setQuestions([]);
    setDetailsOpen(false);
    setEstimatedFor(description);
    run(description, true);
  };

  // Re-asked rather than adjusted here: the model knows what a large changes
  // about a portion and this sheet does not, and scaling a published figure by
  // a guessed multiplier would turn a real number into an invented one.
  //
  // Asked on the tap itself rather than behind a second "estimate again"
  // button, so an answer reads as changing the figures, which is what it does.
  // Clearing the last answer re-asks the plain description, not the stale
  // refinement.
  const handleAnswer = (prompt: string, option: string) => {
    if (estimatedFor == null || loading) return;
    haptics.tap();
    const next = { ...answers, [prompt]: answers[prompt] === option ? '' : option };
    setAnswers(next);
    const anyAnswered = questions.some(q => next[q.prompt]);
    run(
      anyAnswered
        ? refineDescription(estimatedFor, questions.map(q => ({ prompt: q.prompt, answer: next[q.prompt] ?? '' })))
        : estimatedFor,
      false,
    );
  };

  const handleLog = () => {
    if (!estimate) return;
    const nutrition = estimateToPanel(estimate, at);
    if (!nutrition) { haptics.error(); return; }
    const written = addEntry({
      label: estimate.label,
      quantity: estimate.quantity,
      // No weight: a gram figure for a described meal would be one more
      // invented number with nothing to check it against.
      grams: null,
      nutrition,
      slot: chosenSlot,
      at,
      mealPlanEntryId: mealPlanEntryId ?? null,
    });
    if (!written) { haptics.error(); return; }
    haptics.success();
    Keyboard.dismiss();
    onLogged?.();
    onClose();
  };

  // ==== staged rows: the amount step and the one-tap + ====
  /**
   * `food`'s own panel scaled to the weight the typed description names,
   * when it names one — "205g" against a food last logged at 127g scales
   * every stated key by 205/127, the same arithmetic a portion sheet already
   * trusts. Null for the ordinary case (no weight named, or one this food's
   * panel can't answer — a serving count with no `servingGrams`, say), which
   * is what lets every caller fall back to the recorded amount unchanged.
   */
  const scaledWeight = (nutrition: FoodNutrition) => {
    const grams = describedGrams(description);
    return grams ? scalePanelToAmount(nutrition, grams, null, at) : null;
  };

  /** The confirm step's weight field, read as a positive number of grams. */
  const parseWeightGrams = (text: string): number | null => {
    const n = Number(text.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  /**
   * The amount a staged row opens with: the weight a "205g" already typed into
   * the description implies, or the recorded one otherwise. `baseline` is the
   * recorded weight, kept so `logStaged` can tell an untouched amount from an
   * edited one.
   */
  const stagedDefaults = (staged: PendingRecallLog) => {
    const scaled = scaledWeight(staged.food.nutrition);
    const baseline = staged.kind === 'recall'
      ? staged.food.grams
      : helpingOf(staged.food)?.servingGrams ?? null;
    const weight = scaled?.grams != null ? String(scaled.grams) : (baseline != null ? String(baseline) : '');
    return { weight, baseline };
  };

  /**
   * The calories the row's + would log, for the row to show beside it. The
   * same panel `logStaged` writes at the default amount, so the number on the
   * row is the number that lands in the day.
   */
  const stagedKcal = (staged: PendingRecallLog): number | undefined => {
    const scaled = scaledWeight(staged.food.nutrition);
    const panel = scaled?.nutrition
      ?? (staged.kind === 'recall' ? staged.food.nutrition : helpingOf(staged.food));
    return panel?.amounts.calorieKcal;
  };

  /**
   * Opens a "you've had this before" row into its amount step. Tapping the row
   * used to log it outright, at whatever weight it carried, with nothing on
   * screen saying so. The row's own + button is the one-tap log now, and says
   * so by being a button; the row body is for changing the amount first.
   */
  const openPending = (staged: PendingRecallLog) => {
    haptics.tap();
    const { weight, baseline } = stagedDefaults(staged);
    setPendingLog(staged);
    setPendingWeight(weight);
    setPendingDefaultGrams(baseline);
  };

  const cancelPending = () => {
    haptics.tap();
    Keyboard.dismiss();
    setPendingLog(null);
    setPendingWeight('');
    setPendingDefaultGrams(null);
  };

  /**
   * Logs a staged row as it was eaten, or at the weight `weightText` names
   * when that differs from `baseline`.
   *
   * The stored panel goes back verbatim when the amount wasn't changed, which
   * is the point: its `source` is the claim it was recorded under, and
   * re-describing the same food to the model would replace that with
   * `estimated`, permanently. A scale keeps that same source (see
   * `scalePanelToAmount`), so naming a different weight doesn't cost the
   * claim either. Comparing against the baseline rather than scaling
   * unconditionally keeps an untouched amount byte-identical to the entry it
   * came from rather than run back through the scaling arithmetic for no
   * reason. Same reuse `duplicateEntry` performs, and `mealPlanEntryId` is
   * dropped for the same reason it drops it (this is a fresh eating, not the
   * planned meal again) unless the caller named one.
   *
   * The section this was opened from decides the meal; with no section, a
   * recalled food's own last-eaten meal stands, rather than it landing under
   * no meal at all.
   */
  const logStaged = (staged: PendingRecallLog, weightText: string, baseline: number | null) => {
    const grams = parseWeightGrams(weightText);
    const changed = grams != null && grams !== baseline;
    const scale = (nutrition: FoodNutrition) => (changed ? scalePanelToAmount(nutrition, `${grams}g`, null, at) : null);

    if (staged.kind === 'recall') {
      const food = staged.food;
      const scaled = scale(food.nutrition);
      const written = addEntry({
        label: food.label,
        quantity: scaled?.grams != null ? `${scaled.grams}g` : food.quantity,
        grams: scaled ? scaled.grams : food.grams,
        nutrition: scaled?.nutrition ?? food.nutrition,
        slot: chosenSlot ?? food.slot,
        recipeId: food.recipeId,
        itemId: food.itemId,
        productId: food.productId,
        mealPlanEntryId: mealPlanEntryId ?? null,
        at,
      });
      if (!written) { haptics.error(); return; }
    } else {
      const food = staged.food;
      const scaled = scale(food.nutrition);
      const nutrition = scaled?.nutrition ?? helpingOf(food);
      if (!nutrition) { haptics.error(); return; }
      const written = addEntry({
        label: food.label,
        quantity: scaled?.grams != null ? `${scaled.grams}g` : food.choice.label,
        grams: nutrition.servingGrams,
        nutrition,
        slot: chosenSlot,
        itemId: food.itemId,
        productId: food.productId,
        mealPlanEntryId: mealPlanEntryId ?? null,
        at,
      });
      if (!written) { haptics.error(); return; }
    }

    haptics.success();
    Keyboard.dismiss();
    setPendingLog(null);
    setPendingWeight('');
    setPendingDefaultGrams(null);
    onLogged?.();
    onClose();
  };

  const confirmPending = () => {
    if (!pendingLog) return;
    logStaged(pendingLog, pendingWeight, pendingDefaultGrams);
  };

  /** The row's + button: logs it at the amount the amount step would open with. */
  const quickLog = (staged: PendingRecallLog) => {
    const { weight, baseline } = stagedDefaults(staged);
    logStaged(staged, weight, baseline);
  };

  // ==== save as recipe, cancel ====
  // Files the description as a recipe made of the lines it names, so it can be
  // logged again later without re-describing it. Deliberately not the
  // estimate's own total figures: those are a claim about *this* telling
  // ("typical for this dish", "a rough guess") and refining an existing
  // recipe's own nutrition every time it's re-logged is exactly what
  // recipeNutrition.ts already does from its ingredients — same pipeline
  // every other recipe goes through, not a second one for this sheet.
  // "Recipe" here means "a filed batch of ingredients", not "cookable": no
  // steps are written, same as any recipe nobody's added a method to yet.
  const handleSaveRecipe = () => {
    if (!estimate || !description.trim()) return;
    haptics.tap();
    const key = groceryNameKey(estimate.label);
    // The box refuses a name it already has (nameKey is UNIQUE) — land on
    // that recipe rather than failing, the same call InventRecipeSheet makes.
    const existing = recipes.find(r => r.nameKey === key);
    const recipe = existing ?? addRecipe(estimate.label);
    if (!recipe) { haptics.error(); return; }
    if (!existing) {
      const lines = description.split(',').map(s => s.trim()).filter(Boolean).join('\n');
      if (lines) addIngredientsFromText(recipe.id, lines);
    }
    setSavedRecipeId(recipe.id);
    haptics.success();
  };

  const handleCancel = () => {
    if (!description.trim() && !estimate) { Keyboard.dismiss(); onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { Keyboard.dismiss(); onClose(); } },
      ],
    );
  };

  // ==== render ====
  const shown = estimate ? NUTRIENT_KEYS.filter(k => estimate.amounts[k] !== undefined) : [];
  const kcal = estimate?.amounts.calorieKcal;
  const macros = estimate ? MACRO_KEYS.filter(k => estimate.amounts[k] !== undefined) : [];
  // Everything stated beyond the headline number and the tiles, for the one
  // line that says the rest exists (and that the unstated rest is unknown).
  const otherStated = shown.filter(k => k !== 'calorieKcal' && !MACRO_KEYS.includes(k)).length;

  const staged: PendingRecallLog[] = [
    ...recalled.map(food => ({ kind: 'recall' as const, food })),
    ...catalogMatches.map(food => ({ kind: 'catalog' as const, food })),
  ];
  const hasOffers = staged.length > 0 || matches.length > 0;
  const trimmed = description.trim();
  // The estimate row stays while there is nothing estimated yet, and comes back
  // once the field says something other than what the estimate on screen was
  // asked about.
  const showEstimateRow = !!trimmed && (!estimate || trimmed !== estimatedFor?.trim());

  const renderStagedRow = (row: PendingRecallLog, index: number) => {
    const { food } = row;
    const meta = row.kind === 'recall' ? describeRecall(row.food) : describeCatalogRecall(row.food);
    if (pendingLog?.kind === row.kind && pendingLog.food.key === food.key) {
      return (
        <PendingRecallCard
          key={`${row.kind}-${food.key}`}
          styles={styles}
          colors={colors}
          label={food.label}
          meta={meta}
          weight={pendingWeight}
          onChangeWeight={setPendingWeight}
          onCancel={cancelPending}
          onConfirm={confirmPending}
        />
      );
    }
    const rowKcal = stagedKcal(row);
    return (
      <View key={`${row.kind}-${food.key}`} style={[styles.offerRow, index > 0 && styles.offerDivider]}>
        <TouchableOpacity
          style={styles.offerMain}
          activeOpacity={interaction.activeOpacity}
          onPress={() => openPending(row)}
          accessibilityRole="button"
          accessibilityLabel={`Change the amount of ${food.label} before logging. ${meta}`}
        >
          <Text style={styles.offerName}>{food.label}</Text>
          <Text style={styles.offerMeta}>{meta}</Text>
        </TouchableOpacity>
        {rowKcal !== undefined && <KcalFigure styles={styles} kcal={rowKcal} />}
        <PressableScale
          style={styles.offerAdd}
          onPress={() => quickLog(row)}
          accessibilityLabel={`Log ${food.label}, same amount as before`}
        >
          <Ionicons name="add" size={iconSize.md} color={colors.accent} />
        </PressableScale>
      </View>
    );
  };

  return (
    <SheetModal name="Describe a meal" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title="Describe a meal"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<View style={styles.headerSpacer} />}
        />

        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          // The results sit under the field, so the keyboard left up after
          // editing the description covers them; a drag down the page puts it
          // away, the way NutritionPanelSheet's form does.
          keyboardDismissMode="interactive"
          {...keyboardScroll.props}
        >
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. cheeseburger and fries at Five Guys"
            placeholderTextColor={colors.textTertiary}
            maxLength={ESTIMATE_DESCRIPTION_MAX_LENGTH}
            multiline
            blurOnSubmit
            returnKeyType="done"
            onSubmitEditing={() => { if (!hasOffers) handleEstimate(); }}
            accessibilityLabel="What you ate"
          />

          {hasOffers && !estimate && (
            <>
              <Text style={styles.label}>YOU'VE HAD THIS BEFORE</Text>
              <View style={styles.offerList}>
                {staged.map(renderStagedRow)}
                {/* A recipe is logged in servings, a question this sheet
                    doesn't ask, so its row opens the picker rather than
                    logging, and a chevron says so where the others have +. */}
                {matches.map((recipe, index) => {
                  const serving = perServing(recipeNutrition(recipe, items, itemProducts));
                  return (
                    <TouchableOpacity
                      key={recipe.id}
                      style={[styles.offerRow, (staged.length > 0 || index > 0) && styles.offerDivider]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => { haptics.tap(); Keyboard.dismiss(); onPickRecipe(recipe.id); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Log ${recipe.name}, a recipe, in servings. Anything else typed above is left out.`}
                    >
                      <View style={styles.offerMain}>
                        <Text style={styles.offerName}>{recipe.name}</Text>
                        <Text style={styles.offerMeta}>Recipe, per serving</Text>
                      </View>
                      {serving?.calorieKcal !== undefined && <KcalFigure styles={styles} kcal={serving.calorieKcal} />}
                      <View style={styles.offerAdd}>
                        <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.accent} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.listHint}>
                Tap + to log the same amount again, or tap a name to change the amount first.
              </Text>
            </>
          )}

          {showEstimateRow && (
            <TouchableOpacity
              style={[styles.estimateRow, loading && styles.actionOff]}
              activeOpacity={interaction.activeOpacity}
              disabled={loading}
              onPress={handleEstimate}
              accessibilityRole="button"
              accessibilityLabel={`Estimate the nutrition of ${trimmed}`}
            >
              <View style={styles.estimateIcon}>
                {loading
                  ? <ActivityIndicator size="small" color={colors.accent} />
                  : <Ionicons name="sparkles" size={iconSize.sm} color={colors.accent} />}
              </View>
              <View style={styles.offerMain}>
                <Text style={styles.estimateTitle} numberOfLines={1}>
                  {`Estimate \u201C${trimmed}\u201D${hasOffers && !estimate ? ' instead' : ''}`}
                </Text>
                <Text style={styles.offerMeta}>
                  {hasOffers && !estimate
                    ? 'For something new. Name the place too for a closer estimate.'
                    : 'Name the place too for a closer estimate.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          )}

          {!trimmed && !estimate && (
            <Text style={styles.listHint}>
              Type what you ate. Anything you've logged before shows up here, and anything new
              can be estimated.
            </Text>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          {estimate && (
            <View style={[styles.card, loading && styles.cardBusy]}>
              <View style={styles.resultHead}>
                <Text style={styles.cardTitle}>{estimate.label}</Text>
                <Text style={styles.estimateTag}>Estimate</Text>
              </View>
              <Text style={styles.quantity}>{estimate.quantity}</Text>
              {kcal !== undefined && (
                <Text style={styles.bigKcal}>
                  {Math.round(kcal).toLocaleString()}
                  <Text style={styles.bigKcalUnit}> cal</Text>
                </Text>
              )}
              {macros.length > 0 && (
                <View style={styles.macros}>
                  {macros.map(key => (
                    <View key={key} style={styles.macro}>
                      <Text style={styles.macroValue}>{Math.round(estimate.amounts[key] as number)}g</Text>
                      <Text style={styles.macroLabel}>{MACRO_LABEL[key]}</Text>
                    </View>
                  ))}
                </View>
              )}
              {/* What the figures claim, stated rather than implied. */}
              <Text style={styles.claim}>{describeEstimate(estimate)}</Text>

              <TouchableOpacity
                style={styles.disclosure}
                activeOpacity={interaction.activeOpacity}
                // Opening the list is asking to read it, and with the field
                // still focused the keyboard would sit over everything it adds.
                onPress={() => { haptics.tap(); if (!detailsOpen) Keyboard.dismiss(); setDetailsOpen(o => !o); }}
                accessibilityRole="button"
                accessibilityState={{ expanded: detailsOpen }}
                accessibilityLabel="All nutrients and ingredients"
              >
                <Text style={styles.disclosureText}>
                  {otherStated > 0 ? `All nutrients (${otherStated} more)` : 'All nutrients'}
                  {estimate.breakdown.length > 0 ? ' and ingredients' : ''}
                </Text>
                <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>

              {detailsOpen && (
                <View style={styles.details}>
                  {shown.map(key => (
                    <NutrientLine key={key} styles={styles} nutrient={key} amount={estimate.amounts[key] as number} />
                  ))}
                  {/* Absent stays absent: a nutrient the model said nothing about
                      simply has no row, rather than a row reading zero. */}
                  <Text style={styles.hint}>
                    {shown.length === NUTRIENT_KEYS.length
                      ? 'Every nutrient stated.'
                      : `${shown.length} of ${NUTRIENT_KEYS.length} nutrients stated. The rest are unknown rather than zero.`}
                  </Text>
                  {/* The same total, split into pieces small enough to check
                      against what you'd guess yourself rather than taken whole. */}
                  {estimate.breakdown.map((item, index) => (
                    <View key={`${item.label}-${index}`} style={styles.ingredient}>
                      <Text style={styles.ingredientLabel}>{item.label}</Text>
                      {NUTRIENT_KEYS.filter(k => item.amounts[k] !== undefined).map(key => (
                        <NutrientLine key={key} styles={styles} nutrient={key} amount={item.amounts[key] as number} />
                      ))}
                    </View>
                  ))}
                </View>
              )}

              {savedRecipeId ? (
                <Text style={styles.hint}>Saved to your recipe box, so you can log this again later.</Text>
              ) : (
                <InlineAction
                  label="Save as a recipe"
                  onPress={handleSaveRecipe}
                  variant="neutral"
                  accessibilityLabel="Save this meal as a recipe you can log again"
                />
              )}
            </View>
          )}

          {estimate && questions.length > 0 && (
            <View style={styles.card}>
              {questions.map(q => (
                <View key={q.prompt} style={styles.question}>
                  <Text style={styles.questionPrompt}>{q.prompt}</Text>
                  <View style={styles.options}>
                    {q.options.map(option => {
                      const on = answers[q.prompt] === option;
                      return (
                        <TouchableOpacity
                          key={option}
                          style={[styles.option, on && styles.optionOn, loading && styles.actionOff]}
                          activeOpacity={interaction.activeOpacity}
                          disabled={loading}
                          // Tapping the chosen one again clears it, so an
                          // answer given by accident is one tap to take back.
                          onPress={() => handleAnswer(q.prompt, option)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on, disabled: loading }}
                          accessibilityLabel={`${q.prompt} ${option}`}
                        >
                          <Text style={[styles.optionText, on && styles.optionTextOn]}>{option}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
              <Text style={styles.hint}>
                {loading ? 'Updating the estimate…' : 'Answering updates the figures. Skipping is fine.'}
              </Text>
            </View>
          )}

          {estimate && (
            <>
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
            </>
          )}
        </ScrollView>

        {estimate && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.action, loading && styles.actionOff]}
              activeOpacity={interaction.activeOpacity}
              disabled={loading}
              onPress={handleLog}
              accessibilityRole="button"
              accessibilityLabel={kcal !== undefined ? `Log ${Math.round(kcal)} calories` : 'Log this meal'}
            >
              <Text style={styles.actionText}>
                {kcal !== undefined ? `Log ${Math.round(kcal).toLocaleString()} cal` : 'Log'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SheetModal>
  );
}

/** The three tiles under the headline calories, in label order. */
const MACRO_KEYS: readonly NutrientKey[] = ['proteinG', 'carbsG', 'fatG'];
const MACRO_LABEL: Partial<Record<NutrientKey, string>> = { proteinG: 'Protein', carbsG: 'Carbs', fatG: 'Fat' };

function KcalFigure({ styles, kcal }: { styles: ReturnType<typeof makeStyles>; kcal: number }) {
  return (
    <View style={styles.kcal}>
      <Text style={styles.kcalValue}>{Math.round(kcal).toLocaleString()}</Text>
      <Text style={styles.kcalUnit}>cal</Text>
    </View>
  );
}

function NutrientLine({ styles, nutrient, amount }: { styles: ReturnType<typeof makeStyles>; nutrient: NutrientKey; amount: number }) {
  const { label, unit } = NUTRIENT_LABEL[nutrient];
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>
        {Math.round(amount).toLocaleString()}
        {unit === 'cal' ? ' cal' : unit}
      </Text>
    </View>
  );
}

interface PendingRecallCardProps {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  label: string;
  meta: string;
  weight: string;
  onChangeWeight: (text: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The "you already have figures for this" row, expanded into a confirm step
 * once tapped — see `openRecall`/`confirmPending`'s doc comments for why a
 * tap no longer logs outright. Shared between the recalled-entry and
 * catalog-row lists, which differ only in what `meta` and `label` say.
 */
function PendingRecallCard({ styles, colors, label, meta, weight, onChangeWeight, onCancel, onConfirm }: PendingRecallCardProps) {
  return (
    <View style={styles.confirmCard}>
      <Text style={styles.offerName}>{label}</Text>
      <Text style={styles.offerMeta}>{meta}</Text>
      <View style={styles.confirmWeightRow}>
        <Text style={styles.confirmWeightLabel}>Amount to log</Text>
        <TextInput
          style={styles.confirmWeightInput}
          value={weight}
          onChangeText={onChangeWeight}
          keyboardType="numeric"
          placeholder="grams"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={`Amount to log for ${label}, in grams`}
        />
        <Text style={styles.confirmWeightUnit}>g</Text>
      </View>
      <View style={styles.confirmActions}>
        <InlineAction label="Cancel" onPress={onCancel} variant="neutral" accessibilityLabel={`Cancel logging ${label}`} />
        <InlineAction label="Log" onPress={onConfirm} variant="accent" accessibilityLabel={`Log ${label}`} />
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    body: { flex: 1 },
    bodyContent: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    labelSpaced: { marginTop: spacing.md },
    input: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      color: colors.text,
      fontSize: font.md,
      minHeight: 52,
      textAlignVertical: 'top',
    },
    hint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    quantity: { color: colors.textSecondary, fontSize: font.sm },
    claim: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
    figure: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    figureLabel: { color: colors.text, fontSize: font.sm },
    figureValue: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
    ingredient: { gap: spacing.xxs },
    ingredientLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.4,
      marginTop: spacing.xs,
    },
    question: { gap: spacing.sm },
    questionPrompt: { color: colors.text, fontSize: font.sm },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    option: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
    },
    optionOn: { backgroundColor: colors.accent },
    optionText: { color: colors.text, fontSize: font.sm },
    optionTextOn: { color: colors.onAccent, fontWeight: fontWeight.medium },
    action: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    actionOff: { opacity: interaction.activeOpacity * 0.6 },
    actionText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
    // Rows of one inset-grouped card, the way every list in the app reads.
    offerList: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, overflow: 'hidden' },
    offerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.smd,
      paddingLeft: spacing.md,
      paddingRight: spacing.smd,
      paddingVertical: spacing.smd,
    },
    // Between rows only, so the card's last row doesn't draw a line along
    // its rounded bottom edge.
    offerDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
    offerMain: { flex: 1, minWidth: 0, gap: spacing.xxs },
    offerName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    offerMeta: { color: colors.textSecondary, fontSize: font.xs },
    offerAdd: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.accentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    kcal: { alignItems: 'flex-end' },
    kcalValue: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    kcalUnit: { color: colors.textSecondary, fontSize: font.xxs },
    listHint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, paddingHorizontal: spacing.xs },
    estimateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.smd,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
    },
    estimateIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.accentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    estimateTitle: { color: colors.accent, fontSize: font.md, fontWeight: fontWeight.medium },
    headerSpacer: { minWidth: 64 },
    cardBusy: { opacity: 0.5 },
    resultHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    estimateTag: { color: colors.textSecondary, fontSize: font.xs },
    bigKcal: { color: colors.text, fontSize: 34, fontWeight: fontWeight.bold },
    bigKcalUnit: { color: colors.textSecondary, fontSize: font.md, fontWeight: fontWeight.medium },
    macros: { flexDirection: 'row', gap: spacing.sm },
    macro: {
      flex: 1,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.sm,
    },
    macroValue: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    macroLabel: { color: colors.textSecondary, fontSize: font.xxs },
    disclosure: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    disclosureText: { color: colors.textSecondary, fontSize: font.sm },
    details: { gap: spacing.xs },
    footer: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.smd,
      paddingBottom: spacing.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
      backgroundColor: colors.bg,
    },
    // The recall row's confirm step, in place of the plain row while it's
    // staged — same tint as the row it replaces, with room for the weight
    // field and the Cancel/Log pair.
    confirmCard: {
      backgroundColor: colors.bgTertiary,
      margin: spacing.sm,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    confirmWeightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    confirmWeightLabel: { color: colors.text, fontSize: font.sm, flex: 1 },
    confirmWeightInput: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      color: colors.text,
      fontSize: font.sm,
      minWidth: 64,
      textAlign: 'right',
    },
    confirmWeightUnit: { color: colors.textSecondary, fontSize: font.sm },
    confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
    error: { color: colors.red, fontSize: font.sm, lineHeight: 18 },
  });
}
