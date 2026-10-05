import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
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
  ESTIMATE_AMOUNT_MAX_LENGTH,
  ESTIMATE_DESCRIPTION_MAX_LENGTH,
  MAX_CONTEXT_FOODS,
  describeEstimate,
  estimateToPanel,
  refineDescription,
  type EstimateContextFood,
  type NutritionEstimate,
} from '../utils/nutritionEstimate';
import {
  RECALL_LIMIT,
  RECALL_MIN_QUERY,
  catalogRecallFoods,
  describeCatalogRecall,
  describeRecall,
  describedGrams,
  descriptionClauses,
  measuresByWeight,
  rankRecallCandidates,
  recallAmountAsk,
  recallFoods,
  recallMeasuringPanel,
  recallWeight,
  recalledHelping,
  type RecallAmountAsk,
  type RecallChange,
  type RecalledCatalogFood,
  type RecalledFood,
  type RecalledHelping,
} from '../utils/foodRecall';
import { creditedKeys, foodLogRecency, rankByRecency } from '../utils/foodLogRecents';
import { MAX_ESTIMATE_MULTIPLE, describeEstimateCount, estimateCountNoun, scalePanelToAmount, wholeEstimate } from '../utils/foodLog';
import { formatQuantityAmount } from '../utils/quantity';
import { perServing, recipeNutrition } from '../utils/recipeNutrition';
import { standingSwapMap } from '../utils/standingSwaps';
import { packageHelping } from '../utils/scanPortion';
import { useGroceryStore } from '../store/useGroceryStore';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { groceryNameKey } from '../utils/groceryParse';
import { recipeInBook } from '../utils/recipeUtils';
import { haptics } from '../utils/haptics';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CountStepper } from './CountStepper';
import { ESTIMATE_AMOUNT_OPTIONS, UNIT_OPTIONS, amountRefusal, amountText, factorFromTyped, type AmountUnit } from './EstimateAmountSheet';
import { InlineAction } from './InlineAction';
import { PressableScale } from './PressableScale';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';
import { TextField } from './TextField';

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
//   staged rows    a past entry's amount step (a weight, or an estimate's
//                  count or multiple), what it would log, and its one-tap +
//   save/cancel    filing the estimate as a recipe, the discard guard
//   render         the offer list (a staged row's amount step is
//                  `renderAmountStep`), the estimate row, the result card
// Below the component: PendingRecallCard, KcalFigure, NutrientLine, styles.

/**
 * A recall row staged for confirmation, before its amount is settled.
 *
 * `clause` is the piece of the typed description that produced this offer —
 * see `descriptionClauses` — and is what `logStaged` strikes from the field
 * on a successful log, rather than discarding the rest of a multi-food
 * description outright.
 */
type PendingRecallLog =
  | { kind: 'recall'; food: RecalledFood; clause: string }
  | { kind: 'catalog'; food: RecalledCatalogFood; clause: string };

/**
 * What a staged row's amount step holds, whichever question it asks (see
 * `askFor`): the weight field's text and the recorded weight it opened on, or
 * an estimate's count or multiple. Only the one its question reads is used.
 */
interface StagedAmount {
  weight: string;
  baseline: number | null;
  count: number | null;
  factor: number | null;
  /**
   * What was typed into a multiple's own amount field, or null while the field
   * shows the chosen share. Typed text outranks `factor` until a share is picked.
   */
  typed: string | null;
  unit: AmountUnit;
}

/** What logging a staged row writes, beside where and when it lands. */
type StagedWrite = RecalledHelping;

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
  // Every recipe, so a composed dish counts its components — see the same
  // map in FoodLogEntrySheet.
  const recipesById = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);
  const items = useGroceryStore(s => s.items);
  const itemProducts = useGroceryStore(s => s.itemProducts);
  // Standing swaps ("always use oat milk for milk"), so a recipe's figures here
  // are the ones its page shows and the ones it logs with. See standingSwaps.ts.
  const itemSubs = useGroceryStore(s => s.itemSubs);
  const swaps = useMemo(() => standingSwapMap(itemSubs, items), [itemSubs, items]);
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
   * `openPending` for why a tap used to log outright and no longer does.
   */
  const [pendingLog, setPendingLog] = useState<PendingRecallLog | null>(null);
  /**
   * The staged row's amount step, editable before it's logged, with what it
   * opened on so `stagedWrite` can tell an untouched amount from a changed
   * one and reuse the stored panel verbatim for the first.
   */
  const [pendingAmount, setPendingAmount] = useState<StagedAmount | null>(null);
  /** Why the staged row's last Log didn't log, shown in its card (#2914). */
  const [pendingError, setPendingError] = useState<string | null>(null);
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
   * The amount the person typed over the model's own guess ("200 g"), which
   * every re-ask carries, so answering a question afterward keeps it. Empty
   * means the model's assumption stands.
   */
  const [amount, setAmount] = useState('');
  /** The amount field's draft while it is open, or null while it is closed. */
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
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
    setPendingAmount(null);
    setPendingError(null);
    setEstimatedFor(null);
    setQuestions([]);
    setDetailsOpen(false);
    setAmount('');
    setAmountDraft(null);
    const today = getCurrentDayStart();
    setHistory(recentEntries(dayKeyOf(subDays(today, 90)), dayKeyOf(today)));
  }, [visible, slot]);

  // ==== offers: what has been eaten or filed before ====
  // Real data the user already owns beats a guess, so every offer is made
  // before the request rather than after it comes back.
  //
  // Matched per clause of the description (see `descriptionClauses`), not
  // over the whole string: "31 g baguette, 25g peach jam" is two foods, and
  // matching the whole thing as one query can surface a food that's only in
  // one of them while leaving no way to say which weight belongs to it.
  const recalled = useMemo(() => {
    const seen = new Set<string>();
    const out: { food: RecalledFood; clause: string }[] = [];
    for (const clause of descriptionClauses(description)) {
      for (const food of recallFoods(history, clause)) {
        if (seen.has(food.key)) continue;
        seen.add(food.key);
        out.push({ food, clause });
        if (out.length >= RECALL_LIMIT) return out;
      }
    }
    return out;
  }, [history, description]);

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
    const offered = new Set(recalled.flatMap(r => creditedKeys(r.food)));
    const open = catalogCandidates.filter(food => !offered.has(food.key));
    const ranked = rankByRecency(open, recency);
    const seen = new Set<string>();
    const out: { food: RecalledCatalogFood; clause: string }[] = [];
    for (const clause of descriptionClauses(description)) {
      for (const food of rankRecallCandidates(ranked, clause, 2)) {
        if (seen.has(food.key)) continue;
        seen.add(food.key);
        out.push({ food, clause });
        if (out.length >= 2) return out;
      }
    }
    return out;
  }, [catalogCandidates, recalled, recency, description]);

  /**
   * Recipes the description names, minus any already offered as something
   * eaten.
   *
   * A recipe logged last week appears on both lists otherwise, saying the same
   * name twice for two different actions. The recall wins that: it knows the
   * helping actually eaten, where the recipe row still has to go and ask for
   * one.
   *
   * Matched over the whole description rather than per clause: a recipe row
   * opens the picker instead of logging outright (its own accessibility label
   * already says the rest of the field is left out), so there's no weight to
   * misattribute and no in-place log to scope to one clause.
   */
  const matches = useMemo(() => {
    const key = groceryNameKey(description);
    if (key.length < RECALL_MIN_QUERY) return [];
    const offered = new Set(recalled.map(r => r.food.recipeId).filter(Boolean));
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
    for (const { food } of recalled) {
      out.push({ label: food.label, quantity: food.quantity, amounts: food.nutrition.amounts });
    }
    for (const { food } of catalogMatches) {
      const helping = helpingOf(food);
      if (helping) out.push({ label: food.label, quantity: food.choice.label, amounts: helping.amounts });
    }
    for (const recipe of matches) {
      const serving = perServing(recipeNutrition(recipe, items, itemProducts, recipesById, undefined, 1, swaps));
      if (serving) out.push({ label: recipe.name, quantity: '1 serving', amounts: serving });
    }
    return out.slice(0, MAX_CONTEXT_FOODS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recalled, catalogMatches, matches, items, itemProducts, at, swaps]);

  // ==== estimate: asking, refining, logging ====
  /**
   * Which request is the current one. Bumped on every open and close, and by
   * each new ask, so an answer is kept only if nothing has happened since it
   * was sent. A token rather than the `visibleRef` the recipe sheets keep,
   * because this sheet resets on open rather than on close: a request sent
   * just before a cancel, answered just after a quick reopen, would otherwise
   * fill the new session with the old meal's estimate.
   */
  const runTokenRef = useRef(0);
  useEffect(() => { runTokenRef.current += 1; }, [visible]);

  /**
   * Resolves to whether the request came back with an estimate, or null when
   * its answer was dropped because the session it belonged to has ended.
   */
  const run = async (text: string, fresh: boolean): Promise<boolean | null> => {
    const token = ++runTokenRef.current;
    setLoading(true);
    setError(null);
    setSavedRecipeId(null);
    try {
      const result = await estimateMealNutrition(text, context);
      if (token !== runTokenRef.current) return null;
      setEstimate(result);
      if (fresh) setQuestions(result.questions);
      return true;
    } catch (e) {
      if (token !== runTokenRef.current) return null;
      // A failed first ask has nothing to keep. A failed refinement does: the
      // estimate it was refining is still a real answer, with its Log button
      // and its questions, so it stays and the error is added under it rather
      // than the whole card going blank over one bad request.
      if (fresh) setEstimate(null);
      setError(describeAIError(e));
      return false;
    } finally {
      if (token === runTokenRef.current) setLoading(false);
    }
  };

  const handleEstimate = () => {
    if (!description.trim() || loading) return;
    haptics.tap();
    Keyboard.dismiss();
    setAnswers({});
    setQuestions([]);
    setDetailsOpen(false);
    setAmount('');
    setAmountDraft(null);
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
  /** What a re-ask sends: the description with the typed amount and answers folded in. */
  const refinedText = (base: string, nextAnswers: Record<string, string>, nextAmount: string) =>
    refineDescription(
      base,
      questions.map(q => ({ prompt: q.prompt, answer: nextAnswers[q.prompt] ?? '' })),
      nextAmount,
    );

  const handleAnswer = (prompt: string, option: string) => {
    if (estimatedFor == null || loading) return;
    haptics.tap();
    const previous = answers;
    const next = { ...answers, [prompt]: answers[prompt] === option ? '' : option };
    setAnswers(next);
    void run(refinedText(estimatedFor, next, amount), false).then(ok => {
      // The kept estimate still answers the old choices, so the chips go back
      // to them rather than showing an answer the figures don't reflect. Not
      // for a dropped answer (null): that session's chips are already gone.
      if (ok === false) setAnswers(previous);
    });
  };

  // The typed amount is re-asked like an answer is, for the same reason: the
  // model knows what 200 g of this is and this sheet does not. A failed ask
  // puts the old amount back so the row never names an amount the figures
  // don't reflect.
  const handleAmountSubmit = () => {
    if (estimatedFor == null || loading || amountDraft == null) return;
    const next = amountDraft.trim();
    if (next === amount) { setAmountDraft(null); return; }
    haptics.tap();
    Keyboard.dismiss();
    const previous = amount;
    setAmount(next);
    setAmountDraft(null);
    void run(refinedText(estimatedFor, answers, next), false).then(ok => {
      if (ok === false) setAmount(previous);
    });
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
   * The row's measuring panel (`measuringPanel`) scaled to the weight this
   * row's own clause names, when it names one — "25g" against a food last
   * logged at 30g scales every stated key by 25/30, the same arithmetic a
   * portion sheet already trusts.
   *
   * Read off `staged.clause`, not the whole description: a second food named
   * alongside this one can carry its own weight ("31 g baguette, 25g peach
   * jam"), and a search over the whole field would find whichever number
   * comes first rather than the one next to this food. Null for the ordinary
   * case (no weight named in this clause, or one this food's panel can't
   * answer — a serving count with no `servingGrams`, say), which is what lets
   * every caller fall back to the recorded amount unchanged.
   */
  const scaledWeight = (staged: PendingRecallLog) => {
    const grams = describedGrams(staged.clause);
    return grams ? scalePanelToAmount(measuringPanel(staged), grams, null, at) : null;
  };

  /** The confirm step's weight field, read as a positive number of grams. */
  const parseWeightGrams = (text: string): number | null => {
    const n = Number(text.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  /**
   * What a staged row's amount is measured against: a catalog row's own
   * panel, or for something eaten before the panel `recallMeasuringPanel`
   * picks, which is the database panel an unfiled food kept when it kept one.
   * `stagedWrite` measures off the same one, so the default weight and the
   * figure on the row are the ones that land.
   */
  const measuringPanel = (staged: PendingRecallLog) =>
    staged.kind === 'recall' ? recallMeasuringPanel(staged.food) : staged.food.nutrition;

  /**
   * Which question a staged row's amount step asks (#2914): a count in its
   * own unit or a multiple of the whole for an estimate, grams for anything
   * that can be weighed, and no field at all for a food that can't, since a
   * field whose value is ignored is worse than none. A catalog row is weighed
   * against its own panel when that panel can be. See `recallAmountAsk`.
   */
  /** The stated weight of the whole an estimate describes, when it has one. */
  const wholeGramsOf = (staged: PendingRecallLog): number | null => {
    if (staged.kind !== 'recall') return null;
    const grams = wholeEstimate(staged.food)?.servingGrams;
    return grams && grams > 0 ? grams : null;
  };

  const askFor = (staged: PendingRecallLog): RecallAmountAsk => {
    if (staged.kind === 'recall') return recallAmountAsk(staged.food);
    return measuresByWeight(staged.food.nutrition) ? { kind: 'weight' } : { kind: 'none' };
  };

  /**
   * The amount a staged row opens with: the weight a "205g" already typed into
   * this food's own part of the description implies (`scaledWeight`), or the recorded one otherwise, and for an
   * estimate the count or multiple it was last logged at. `baseline` is the
   * recorded weight, kept so `stagedWrite` can tell an untouched weight from
   * an edited one; a count or multiple is compared with the ask's own
   * `opensAt` the same way.
   */
  const stagedDefaults = (staged: PendingRecallLog): StagedAmount => {
    const ask = askFor(staged);
    const scaled = ask.kind === 'weight' ? scaledWeight(staged) : null;
    const baseline = staged.kind === 'recall'
      ? staged.food.grams
      : helpingOf(staged.food)?.servingGrams ?? null;
    const weight = scaled?.grams != null ? String(scaled.grams) : (baseline != null ? String(baseline) : '');
    return {
      weight,
      baseline,
      count: ask.kind === 'count' ? ask.opensAt ?? ask.count.count : null,
      factor: ask.kind === 'multiple' ? ask.opensAt : null,
      typed: null,
      unit: wholeGramsOf(staged) ? 'grams' : 'percent',
    };
  };

  /**
   * What a staged row logs at `amount`, or why it can't, in the words the card
   * shows. Everything that logs or shows a figure reads this: the row's
   * calories and its + at the amount the step opens with, the card's preview
   * and Log at whatever was chosen. So the figure on the row is the figure
   * that lands, and nothing logs a helping other than the one on screen.
   *
   * **An amount left as it opened logs the stored panel verbatim**, which is
   * the point: its `source` is the claim it was recorded under, and
   * re-describing the same food to the model would replace that with
   * `estimated`, permanently. A new weight is measured (`scalePanelToAmount`
   * keeps the source), and a new count or multiple of an estimate is taken of
   * its whole (`recalledHelping`), so changing the amount doesn't cost the
   * claim either. Comparing against what it opened with rather than scaling
   * unconditionally keeps an untouched amount byte-identical to the entry it
   * came from.
   *
   * **A weight that can't be used is said, never swapped for the recorded
   * helping.** That swap was the report (#2914): 110 typed into the field for
   * an estimate of "2 slices" logged the whole previous helping, with the
   * field still reading 110. Estimates are asked for a count or a multiple now
   * and never for grams, a food that can't be weighed shows no field, and
   * what's left (a field emptied, or a figure that isn't a weight) gets a line
   * in the card instead of a log.
   */
  const stagedWrite = (staged: PendingRecallLog, amount: StagedAmount): StagedWrite | { error: string } => {
    const ask = askFor(staged);
    let change: RecallChange | null = null;
    if (ask.kind === 'count') {
      if (amount.count !== null && amount.count !== ask.opensAt) change = { factor: amount.count / ask.count.count };
    } else if (ask.kind === 'multiple') {
      let factor = amount.factor;
      if (amount.typed !== null) {
        factor = factorFromTyped(amount.typed, amount.unit, wholeGramsOf(staged));
        // A typed amount that isn't usable is said, never swapped for a share.
        if (factor === null) return { error: amountRefusal(amount.unit, wholeGramsOf(staged)) };
      }
      if (factor !== null && factor !== ask.opensAt) change = { factor };
    } else if (ask.kind === 'weight') {
      const text = amount.weight.trim();
      const grams = parseWeightGrams(text);
      if (grams === null && (text || amount.baseline !== null)) return { error: 'Enter a weight in grams.' };
      if (grams !== null && grams !== amount.baseline) change = { grams };
    }

    const unmeasured = { error: 'That amount can\'t be measured for this food, so nothing was logged.' };
    if (staged.kind === 'recall') return recalledHelping(staged.food, change, at) ?? unmeasured;

    const food = staged.food;
    if (change && 'grams' in change) {
      const scaled = scalePanelToAmount(food.nutrition, `${change.grams}g`, null, at);
      if (!scaled) return unmeasured;
      return {
        quantity: scaled.grams != null ? `${scaled.grams}g` : food.choice.label,
        grams: scaled.grams,
        nutrition: scaled.nutrition,
        sourcePanel: null,
      };
    }
    const nutrition = helpingOf(food);
    if (!nutrition) return unmeasured;
    return { quantity: food.choice.label, grams: nutrition.servingGrams, nutrition, sourcePanel: null };
  };

  /**
   * The calories the row's + would log, for the row to show beside it. The
   * same write `logStaged` makes at the default amount, so the number on the
   * row is the number that lands in the day.
   */
  const stagedKcal = (staged: PendingRecallLog): number | undefined => {
    const write = stagedWrite(staged, stagedDefaults(staged));
    return 'error' in write ? undefined : write.nutrition.amounts.calorieKcal;
  };

  /**
   * Opens a "you've had this before" row into its amount step. Tapping the row
   * used to log it outright, at whatever weight it carried, with nothing on
   * screen saying so. The row's own + button is the one-tap log now, and the
   * "Change amount" button under the name is the way into this step; a bare
   * name tap was found unguessable.
   */
  const openPending = (staged: PendingRecallLog) => {
    haptics.tap();
    setPendingLog(staged);
    setPendingAmount(stagedDefaults(staged));
    setPendingError(null);
  };

  const cancelPending = () => {
    haptics.tap();
    Keyboard.dismiss();
    setPendingLog(null);
    setPendingAmount(null);
    setPendingError(null);
  };

  /** One field of the open amount step changed, which also clears a stale error. */
  const editPending = (patch: Partial<StagedAmount>) => {
    setPendingAmount(current => current && { ...current, ...patch });
    setPendingError(null);
  };

  /**
   * Logs a staged row at `amount`, through `stagedWrite`. Returns the reason
   * when it couldn't, for the card to show.
   *
   * Something eaten before carries the panel it kept (#2914): without it, a
   * database food nobody filed came back as an entry that could only be
   * renamed, and an estimate at a new count keeps the whole it was taken of so
   * it can be changed again. `mealPlanEntryId` is dropped for the reason
   * `duplicateEntry` drops it (this is a fresh eating, not the planned meal
   * again) unless the caller named one.
   *
   * The section this was opened from decides the meal; with no section, a
   * recalled food's own last-eaten meal stands, rather than it landing under
   * no meal at all.
   */
  const logStaged = (staged: PendingRecallLog, amount: StagedAmount): string | null => {
    const write = stagedWrite(staged, amount);
    if ('error' in write) { haptics.error(); return write.error; }

    const { food } = staged;
    const written = staged.kind === 'recall'
      ? addEntry({
        label: food.label,
        quantity: write.quantity,
        grams: write.grams,
        nutrition: write.nutrition,
        sourcePanel: write.sourcePanel,
        slot: chosenSlot ?? staged.food.slot,
        recipeId: staged.food.recipeId,
        itemId: staged.food.itemId,
        productId: staged.food.productId,
        mealPlanEntryId: mealPlanEntryId ?? null,
        at,
      })
      : addEntry({
        label: food.label,
        quantity: write.quantity,
        grams: write.grams,
        nutrition: write.nutrition,
        slot: chosenSlot,
        itemId: staged.food.itemId,
        productId: staged.food.productId,
        mealPlanEntryId: mealPlanEntryId ?? null,
        at,
      });
    if (!written) { haptics.error(); return 'Couldn\'t log this. Try again.'; }

    haptics.success();
    Keyboard.dismiss();
    setPendingLog(null);
    setPendingAmount(null);
    setPendingError(null);

    // Logging this row is logging its own clause, not the whole field: "31 g
    // baguette, 25g peach jam" still has a baguette in it once the jam is
    // written. Strike just the clause that was logged and keep the sheet open
    // on what's left, rather than closing over an unlogged food with nothing
    // said about it. Only the first match is removed, in case two identical
    // clauses were typed. The now-stale estimate state (if any exists) is
    // cleared too, since it was asked about the fuller description.
    let struck = false;
    const remaining = descriptionClauses(description)
      .filter(clause => {
        if (!struck && clause === staged.clause) { struck = true; return false; }
        return true;
      })
      .join(', ');
    if (remaining.trim()) {
      setDescription(remaining);
      setEstimate(null);
      setEstimatedFor(null);
      setQuestions([]);
      setAnswers({});
      setError(null);
      setSavedRecipeId(null);
      return null;
    }

    onLogged?.();
    onClose();
    return null;
  };

  const confirmPending = () => {
    if (!pendingLog || !pendingAmount) return;
    setPendingError(logStaged(pendingLog, pendingAmount));
  };

  /**
   * The row's + button: logs it at the amount the amount step would open with.
   * Should that ever fail, the step opens with the reason rather than the tap
   * doing nothing.
   */
  const quickLog = (staged: PendingRecallLog) => {
    const failed = logStaged(staged, stagedDefaults(staged));
    if (failed) {
      openPending(staged);
      setPendingError(failed);
    }
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
    // The box refuses a name it already has under no book, which is where
    // this is filed — land on that recipe rather than failing, the same call
    // InventRecipeSheet makes. A cookbook's recipe of the same name is some
    // other dish and doesn't count.
    const existing = recipeInBook(recipes, estimate.label, null);
    const recipe = existing ?? addRecipe(estimate.label);
    if (!recipe) { haptics.error(); return; }
    if (!existing) {
      const lines = descriptionClauses(description).join('\n');
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
    ...recalled.map(r => ({ kind: 'recall' as const, food: r.food, clause: r.clause })),
    ...catalogMatches.map(r => ({ kind: 'catalog' as const, food: r.food, clause: r.clause })),
  ];
  const hasOffers = staged.length > 0 || matches.length > 0;
  const trimmed = description.trim();
  // The estimate row stays while there is nothing estimated yet, and comes back
  // once the field says something other than what the estimate on screen was
  // asked about.
  const showEstimateRow = !!trimmed && (!estimate || trimmed !== estimatedFor?.trim());

  /**
   * The open card's amount step, in whichever question `askFor` says the row
   * is asked: a weight, a count in the estimate's own unit, a multiple of the
   * whole, or none at all.
   */
  const renderAmountStep = (row: PendingRecallLog, ask: RecallAmountAsk, amount: StagedAmount) => {
    const { food } = row;
    switch (ask.kind) {
      case 'weight':
        return (
          <View style={styles.confirmWeightRow}>
            <Text style={styles.confirmWeightLabel}>Amount to log</Text>
            <TextField
              style={styles.confirmWeightInput}
              value={amount.weight}
              onChangeText={text => editPending({ weight: text })}
              keyboardType="numeric"
              placeholder="grams"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel={`Amount to log for ${food.label}, in grams`}
            />
            <Text style={styles.confirmWeightUnit}>g</Text>
          </View>
        );
      case 'count': {
        const count = amount.count ?? ask.count.count;
        return (
          <View style={styles.confirmWeightRow}>
            <Text style={styles.confirmWeightLabel}>Amount to log</Text>
            <CountStepper
              value={count}
              onChange={next => { if (next !== null) editPending({ count: next }); }}
              min={Math.min(ask.count.step, ask.count.count)}
              max={ask.count.count * MAX_ESTIMATE_MULTIPLE}
              step={ask.count.step}
              format={n => formatQuantityAmount(n, ask.count.decimal)}
              label={`Amount of ${food.label} to log`}
              describeValue={n => describeEstimateCount(ask.count, n ?? ask.count.count)}
              style={styles.confirmStepper}
            />
            <Text style={styles.confirmWeightUnit}>{estimateCountNoun(ask.count, count)}</Text>
          </View>
        );
      }
      case 'multiple': {
        const wholeGrams = wholeGramsOf(row);
        const fieldText = amount.typed ?? (amount.factor === null ? '' : amountText(amount.factor, amount.unit, wholeGrams));
        const typedBad = amount.typed !== null && amount.typed.trim() !== ''
          && factorFromTyped(amount.typed, amount.unit, wholeGrams) === null;
        return (
          <View style={styles.confirmMultiple}>
            <Text style={styles.confirmMultipleLabel}>Amount to log</Text>
            {/* On a card of its own colour, so the track reads as a track
                rather than as the card it sits in. */}
            <View style={styles.confirmTrackCard}>
              <SegmentedControl
                options={ESTIMATE_AMOUNT_OPTIONS}
                value={amount.typed === null ? amount.factor : null}
                onChange={factor => editPending({ factor, typed: null })}
                columns={3}
                label={`Amount of ${food.label} to log`}
              />
            </View>
            <View style={styles.confirmWeightRow}>
              <Text style={styles.confirmWeightLabel}>Or enter an amount</Text>
              <TextField
                style={styles.confirmWeightInput}
                value={fieldText}
                onChangeText={text => editPending({ typed: text })}
                keyboardType="decimal-pad"
                selectTextOnFocus
                placeholder={amount.unit === 'grams' ? 'e.g. 30' : 'e.g. 50'}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={`Amount of ${food.label} to log, in ${amount.unit === 'grams' ? 'grams' : 'percent of the amount shown'}`}
              />
              {wholeGrams ? (
                <SegmentedControl
                  options={UNIT_OPTIONS}
                  value={amount.unit}
                  onChange={unit => editPending({
                    unit,
                    // Keep the amount shown, restated in the new unit.
                    factor: amount.typed === null ? amount.factor : factorFromTyped(amount.typed, amount.unit, wholeGrams),
                    typed: null,
                  })}
                  label="Unit"
                />
              ) : (
                <Text style={styles.confirmWeightUnit}>%</Text>
              )}
            </View>
            {typedBad && <Text style={styles.error}>{amountRefusal(amount.unit, wholeGrams)}</Text>}
          </View>
        );
      }
      case 'none':
        return null;
    }
  };

  const renderStagedRow = (row: PendingRecallLog, index: number) => {
    const { food } = row;
    const meta = row.kind === 'recall' ? describeRecall(row.food) : describeCatalogRecall(row.food);
    if (pendingLog?.kind === row.kind && pendingLog.food.key === food.key && pendingAmount) {
      const ask = askFor(row);
      const write = stagedWrite(row, pendingAmount);
      const preview = 'error' in write ? null : write;
      const kcal = preview?.nutrition.amounts.calorieKcal;
      return (
        <PendingRecallCard
          key={`${row.kind}-${food.key}`}
          styles={styles}
          label={food.label}
          meta={meta}
          amount={renderAmountStep(row, ask, pendingAmount)}
          preview={preview && (
            ask.kind === 'none'
              // Nothing to change, so the line says why rather than showing a
              // field that would be ignored.
              ? `Logs ${preview.quantity}. Its figures can't be measured at another weight.`
              : `${kcal !== undefined ? `${Math.round(kcal).toLocaleString()} cal` : 'No calories stated'}, ${preview.quantity}`
          )}
          error={pendingError}
          onCancel={cancelPending}
          onConfirm={confirmPending}
        />
      );
    }
    const rowKcal = stagedKcal(row);
    return (
      <View key={`${row.kind}-${food.key}`} style={[styles.offerRow, index > 0 && styles.offerDivider]}>
        <View style={styles.offerMain}>
          <Text style={styles.offerName}>{food.label}</Text>
          <Text style={styles.offerMeta}>{meta}</Text>
          {/* On its own line under the name, so the name keeps the row's width. */}
          <InlineAction
            label="Change amount"
            variant="neutral"
            onPress={() => openPending(row)}
            accessibilityLabel={`Change the amount of ${food.label} before logging. ${meta}`}
            style={styles.offerChange}
          />
        </View>
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
          <TextField
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
                  const serving = perServing(recipeNutrition(recipe, items, itemProducts, recipesById, undefined, 1, swaps));
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
                Tap + to log the same amount again, or Change amount to log a different one.
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
              {/* The amount these figures assume, said outright and open to
                  change: a description like "tofu" leaves the portion to the
                  model, and the figures are only as right as that guess. */}
              {amountDraft == null ? (
                <TouchableOpacity
                  style={styles.amountRow}
                  activeOpacity={interaction.activeOpacity}
                  disabled={loading}
                  onPress={() => { haptics.tap(); setAmountDraft(amount); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Based on ${estimate.quantity}. Change the amount`}
                >
                  <Text style={styles.quantity}>Based on {estimate.quantity}</Text>
                  <Ionicons name="create-outline" size={iconSize.sm} color={colors.accent} />
                </TouchableOpacity>
              ) : (
                <View style={styles.amountRow}>
                  <TextField
                    style={styles.amountInput}
                    value={amountDraft}
                    onChangeText={setAmountDraft}
                    placeholder="e.g. 200 g, half a block"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={ESTIMATE_AMOUNT_MAX_LENGTH}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleAmountSubmit}
                    accessibilityLabel="How much you had"
                  />
                  <InlineAction
                    label={amountDraft.trim() ? 'Update' : 'Reset'}
                    onPress={handleAmountSubmit}
                    accessibilityLabel={amountDraft.trim() ? 'Update the estimate for this amount' : 'Go back to the estimated amount'}
                  />
                </View>
              )}
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
  label: string;
  meta: string;
  /** The amount step itself, or null for a food with nothing to change. */
  amount: React.ReactNode;
  /** What Log would write, in words, or null while the amount can't be used. */
  preview: string | null;
  /** Why the last Log didn't log, until the amount is changed again. */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The "you already have figures for this" row, expanded into a confirm step
 * once tapped — see `openPending`/`stagedWrite`'s doc comments for why a tap
 * no longer logs outright and what each amount step asks. Shared between the
 * recalled-entry and catalog-row lists, which differ only in what `meta`,
 * `label` and the amount step say.
 */
function PendingRecallCard({ styles, label, meta, amount, preview, error, onCancel, onConfirm }: PendingRecallCardProps) {
  return (
    <View style={styles.confirmCard}>
      <Text style={styles.offerName}>{label}</Text>
      <Text style={styles.offerMeta}>{meta}</Text>
      {amount}
      {!!preview && <Text style={styles.confirmPreview}>{preview}</Text>}
      {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
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
    quantity: { color: colors.textSecondary, fontSize: font.sm, flexShrink: 1 },
    amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm },
    amountInput: {
      flex: 1,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      color: colors.text,
      fontSize: font.sm,
    },
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
    optionOn: { backgroundColor: colors.accentFill },
    optionText: { color: colors.text, fontSize: font.sm },
    optionTextOn: { color: colors.onAccent, fontWeight: fontWeight.medium },
    action: {
      backgroundColor: colors.accentFill,
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
    offerChange: { alignSelf: 'flex-start', marginTop: spacing.xsm },
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
    // The stepper's own pill is bgTertiary, the card's colour, so it takes the
    // field colour the weight input already uses to read as a control.
    confirmStepper: { backgroundColor: colors.bgSecondary },
    confirmMultiple: { gap: spacing.smd },
    confirmMultipleLabel: { color: colors.text, fontSize: font.sm },
    confirmTrackCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, padding: spacing.xs },
    confirmPreview: { color: colors.textSecondary, fontSize: font.sm },
    confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
    error: { color: colors.redText, fontSize: font.sm, lineHeight: 18 },
  });
}
