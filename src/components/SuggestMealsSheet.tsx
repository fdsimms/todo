import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { Leftover, Recipe, RecipeMealType } from '../types';
import { RECIPE_MEAL_TYPES, RECIPE_MEAL_TYPE_LABELS } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, iconSize, interaction, type Colors } from '../theme';
import { dayKeyOf } from '../utils/dateUtils';
import { describeCookHistory, describePantryCoverage, describeRecipe, type PantryCoverage } from '../utils/recipeUtils';
import { flattenRecipeIngredients, recipeMap, type FlatIngredient } from '../utils/recipeComponents';
import { describeStandingSwap, standingSwapMap } from '../utils/standingSwaps';
import { describeLeftover, isPlannedPastKeepUntil, liveFreshnessOf } from '../utils/leftovers';
import { convertQuantity } from '../utils/unitConvert';
import {
  mergeMealSuggestions, mealIdeaRecipeDraft, mealTitleKey,
  type MealIdea, type MealSuggestion,
} from '../utils/mealIdeas';
import { suggestMealIdeas, draftMealRecipe, describeAIError } from '../services/aiSuggestions';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { freshnessColor } from './LeftoversCard';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyState } from './EmptyState';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { haptics } from '../utils/haptics';

/**
 * A row Save can commit, in the order the days are handed out. The two the
 * sheet ranks (`MealSuggestion`) plus the fridge, which sits outside that union
 * on purpose: `mergeMealSuggestions` exists to keep an AI idea from displacing
 * an owned recipe, and a container isn't in that argument at all — it's a meal
 * that already exists, and it leads every list it appears in.
 */
type PickableSuggestion =
  | MealSuggestion
  | { kind: 'leftover'; key: string; leftover: Leftover };

interface Props {
  visible: boolean;
  /** Already ranked by suggestRecipesForEmptyNight — this sheet doesn't re-sort. */
  recipes: Recipe[];
  /**
   * Recipes made often and made recently (rankRecipeSuggestions) — the
   * comfort-food counterpart to `recipes` above, rendered in its own "Cook
   * again" group rather than merged into the pantry ranking, since the two
   * rank by opposite signals (this one rewards a recent cook, `recipes`
   * discounts one). The caller dedupes against `recipes` before handing it
   * over, so a recipe qualifying for both isn't shown twice.
   */
  cookAgainRecipes?: Recipe[];
  /**
   * The containers in the fridge this sheet may put on a night — already
   * narrowed and ordered by `suggestableLeftovers`, so this sheet no more
   * re-sorts them than it re-sorts `recipes`.
   *
   * They render above everything else and are assigned the earliest open
   * nights, which is the whole point: a dinner that already exists and is
   * counting down beats one that has to be cooked. See the fridge note on the
   * component below.
   */
  leftovers?: readonly Leftover[];
  /**
   * The visible half of #1103's pantry signal — a recipe missing from this
   * map (rather than present with `total: 0`) just renders with no badge, so
   * a caller that hasn't computed it yet degrades to the pre-#1103 row.
   */
  pantryByRecipeId?: ReadonlyMap<string, PantryCoverage>;
  /**
   * The nights an acceptance may land on, in the order they should be filled —
   * `daysWithoutMeal(entries, days, 'dinner')` at the moment the sheet opened.
   *
   * Deliberately not "the week": Save lands each pick on the next day in this
   * list without consulting the plan, so a list holding nights that are
   * already spoken for would quietly double-book them. Captured at open by
   * the caller, so a pick can't renumber the rest mid-flow.
   */
  openDays: Date[];
  /**
   * #1063's gate, decided by the caller: `!!anthropicApiKey`. False (the
   * default) and this sheet is exactly the offline one it was before — no
   * generate affordance, no network call, no mention of AI anywhere.
   */
  aiIdeasEnabled?: boolean;
  /** Meals already on the week, so the model isn't asked to invent one of them again. */
  plannedTitles?: readonly string[];
  /** What's been cooked lately (see recentlyCookedTitles) — same "don't suggest that again" job. */
  recentTitles?: readonly string[];
  /**
   * "Spinach — Use by today" for what's about to go bad in the kitchen, most
   * urgent first (`mealIdeas.expiringItemHints` off `useUpEntries`), passed
   * to the AI generator as inspiration — never a requirement, see
   * `suggestMealIdeas`'s own doc. Has no effect on the offline ranking above,
   * which already answers "what can I make from the catalog" on its own terms.
   */
  expiringItemHints?: readonly string[];
  /** Empty dinners to fill; clamped into the MIN/MAX idea band by clampIdeaCount. */
  slotsToFill?: number;
  onPlan: (recipe: Recipe, dateKey: string) => void;
  /**
   * Puts a container on a night — the same `planMeal({ leftoverId, title })`
   * write the fridge card's own plan action and its drag-onto-a-day make, so
   * the entry this creates is indistinguishable from one made either of those
   * ways. Omit it and the fridge section isn't rendered at all.
   */
  onPlanLeftover?: (leftover: Leftover, dateKey: string) => void;
  onClose: () => void;
}

/**
 * "What can I make from what I've got" for the nights still free — offline,
 * ranked by scoreRecipeAgainstCatalog (catalog coverage, nudged by how
 * recently the recipe itself was last cooked — #1103), no API key involved.
 *
 * **The list it opens with is the list it keeps.** The caller captures both the
 * ranking and `openDays` at open time, because planning a suggestion changes
 * the week this sheet was derived from — a live-derived list re-ranked (or,
 * as it once did, emptied) itself under the finger that had just tapped it,
 * which took the row's own "Planned for Thursday" confirmation with it.
 *
 * **Tapping a row selects it, it doesn't plan it.** A tap toggles the row's
 * pick state (and a picked row can be tapped again to drop it) — nothing
 * touches the week until "Save" is pressed. That's deliberate: a suggestion
 * list is for browsing, and a single tap silently rewriting the week gave the
 * user no room to change their mind mid-scroll. Save walks the picks in list
 * order and lands each on the next day in `openDays`, same assignment as
 * before, just deferred to one commit instead of one tap.
 *
 * **A meal-type filter narrows the list, it never hides anything by default.**
 * Every recipe (dinners, sides, condiments, desserts, …) is shown regardless
 * of `Recipe.mealType` until the user taps a category chip — this sheet fills
 * whatever's empty on the plan, and plenty of real plans want a side or a
 * condiment alongside (or instead of) a dinner. AI ideas have no `mealType`
 * of their own (they're always full dinner concepts), so narrowing to a
 * specific category hides the "NEW IDEAS" section rather than showing
 * ideas that don't belong to it.
 *
 * **The fridge is read before the recipe box.** Live leftovers lead the sheet,
 * in their own group, and a picked one takes the earliest open night. The sheet
 * spent a long time answering "what could I cook this week" alone, which meant
 * a fridge holding two containers and a week holding four empty nights got four
 * proposals to cook and no mention of the two dinners already sitting there.
 * Which containers, and in what order, is `suggestableLeftovers`' call, not
 * this sheet's — including that a container the week already points at isn't
 * offered again here.
 *
 * Since #1063 it has a second, optional half: **AI-invented** meal ideas, for
 * when the offline ranking has little or nothing to offer. The two never mix
 * and never compete —
 *
 * - The ranked recipes are computed and rendered exactly as before, whether or
 *   not a key is configured. `mergeMealSuggestions` puts every one of them
 *   ahead of every idea and drops an idea whose name collides with one, so an
 *   invention can't displace, reorder or hide a recipe the user actually owns.
 *   That's the settled call from #1041, restated in #1063.
 * - Generation is behind `aiIdeasEnabled` (`!!anthropicApiKey` at the call
 *   site) *and* behind an explicit tap. Opening this sheet never spends a
 *   request; the offline list is what it opens with.
 * - An idea is visibly not a recipe: dashed border, a sparkles glyph, an "AI
 *   idea" tag and no pantry/cook-history signals, because it has none. The
 *   user has to be able to tell which is which before accepting.
 *
 * Picking an *idea* and pressing Save does one extra step per idea: a call
 * that drafts a full recipe — shopping list, method, time, any advance prep —
 * and saves it as a real `Recipe` (`addRecipe`, `addStructuredIngredients`,
 * `setNotes`, `setEstimatedMinutes`, `addStep`, `addPrepTask`) before landing
 * it on a day — so the meal enters the recipe box exactly as fleshed out as
 * one pasted or photographed in, and is rankable, cookable and shoppable from
 * then on, rather than being a one-off free-text entry that has to be
 * invented again next month. A draft that fails (a flaky request, a name that
 * didn't survive cleaning) leaves that idea picked with an error under it and
 * doesn't spend a day on it — everything else picked alongside it still
 * saves, and the row is retried the next time Save is pressed.
 */
export function SuggestMealsSheet({
  visible, recipes, cookAgainRecipes = [], leftovers = [], pantryByRecipeId, openDays,
  aiIdeasEnabled = false, plannedTitles, recentTitles, expiringItemHints = [], slotsToFill,
  onPlan, onPlanLeftover, onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const aisleOrder = useGroceryStore(useShallow(s => s.aisleOrder));
  // The preview reads like the recipe screen does, standing swaps included —
  // it sits beside a pantry-coverage line that already counts them, and a
  // preview listing milk under "5/7 likely on hand" would be the app
  // disagreeing with itself on one row.
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const standingSwaps = useMemo(
    () => standingSwapMap(itemSubs, groceryItems),
    [itemSubs, groceryItems]
  );
  const allRecipes = useRecipeStore(useShallow(s => s.recipes));
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const addStructuredIngredients = useRecipeStore(s => s.addStructuredIngredients);
  const setNotes = useRecipeStore(s => s.setNotes);
  const setEstimatedMinutes = useRecipeStore(s => s.setEstimatedMinutes);
  const addStep = useRecipeStore(s => s.addStep);
  const addPrepTask = useRecipeStore(s => s.addPrepTask);
  const updatePrepTask = useRecipeStore(s => s.updatePrepTask);
  const unitSystem = useSettingsStore(s => s.unitSystem);
  const excludedRecipeTags = useSettingsStore(useShallow(s => s.excludedRecipeTags));
  const recipesById = useMemo(() => recipeMap(allRecipes), [allRecipes]);

  // ==== picks, and the days they'd land on ====

  const [filter, setFilter] = useState<RecipeMealType | 'all'>('all');
  /** A recipe being previewed — read-only, doesn't touch `selected`. */
  const [previewRecipe, setPreviewRecipe] = useState<Recipe | null>(null);

  /** Picked but not yet saved — toggled by tapping a row, cleared by Save/close. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Successfully saved this session — the day it landed on, keyed the same as `selected`. */
  const [landedOn, setLandedOn] = useState<Map<string, Date>>(new Map());
  const [saving, setSaving] = useState(false);
  /** Which idea Save is drafting right now, for its row's spinner. */
  const [savingKey, setSavingKey] = useState<string | null>(null);
  /** Per-row failures from the last Save, keyed the same as `selected`. */
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());

  // Ideas live only as long as the sheet does: they're a proposal, not data.
  const [ideas, setIdeas] = useState<MealIdea[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [hints, setHints] = useState('');

  useEffect(() => {
    if (visible) return;
    setFilter('all');
    setPreviewRecipe(null);
    setSelected(new Set());
    setLandedOn(new Map());
    setSaving(false);
    setSavingKey(null);
    setSaveErrors(new Map());
    setIdeas([]);
    setGenerating(false);
    setGenerateError(null);
    setHints('');
  }, [visible]);

  const availableMealTypes = useMemo(
    () => RECIPE_MEAL_TYPES.filter(type =>
      recipes.some(r => r.mealType === type) || cookAgainRecipes.some(r => r.mealType === type)),
    [recipes, cookAgainRecipes],
  );

  const filteredRecipes = useMemo(
    () => (filter === 'all' ? recipes : recipes.filter(r => r.mealType === filter)),
    [recipes, filter],
  );
  const filteredCookAgain = useMemo(
    () => (filter === 'all' ? cookAgainRecipes : cookAgainRecipes.filter(r => r.mealType === filter)),
    [cookAgainRecipes, filter],
  );
  // Ideas carry no mealType of their own — narrowing to a category has
  // nothing to match them against, so they drop out rather than showing up
  // in every category.
  const filteredIdeas = filter === 'all' ? ideas : [];
  // A container has no mealType either, and for a more basic reason than an
  // idea does: it's a portion of something already cooked, not a dish in the
  // box with a kind on it. Same treatment — a category filter hides the fridge
  // rather than guessing which category last night's chilli belongs to.
  const fridge = useMemo(
    () => (onPlanLeftover ? leftovers : []),
    [onPlanLeftover, leftovers],
  );
  const filteredLeftovers = filter === 'all' ? fridge : [];

  const suggestions = useMemo(
    () => mergeMealSuggestions(filteredRecipes, filteredIdeas),
    [filteredRecipes, filteredIdeas],
  );
  // Unfiltered, and in the same top-to-bottom order the sheet renders
  // (Cook again, then the pantry ranking, then ideas), so a pick made under
  // one category keeps its place — and its day assignment — if the filter
  // changes before Save is pressed.
  const allSuggestions = useMemo<PickableSuggestion[]>(
    () => [
      ...fridge.map(leftover => ({ kind: 'leftover' as const, key: `leftover:${leftover.id}`, leftover })),
      ...cookAgainRecipes.map(recipe => ({ kind: 'recipe' as const, key: `recipe:${recipe.id}`, recipe })),
      ...mergeMealSuggestions(recipes, ideas),
    ],
    [fridge, cookAgainRecipes, recipes, ideas],
  );

  const noOpenNights = openDays.length === 0;
  const capacityFull = landedOn.size + selected.size >= openDays.length;

  /** The day each current pick would land on if Save were pressed now. */
  const dayByKey = useMemo(() => {
    const map = new Map<string, Date>();
    const offset = landedOn.size;
    const picked = allSuggestions.filter(s => selected.has(s.key));
    picked.forEach((item, i) => {
      const day = openDays[offset + i];
      if (day) map.set(item.key, day);
    });
    return map;
  }, [allSuggestions, selected, openDays, landedOn]);

  const toggleSelect = (key: string) => {
    if (saving || landedOn.has(key)) return;
    haptics.tap();
    setSelected(prev => {
      if (prev.has(key)) {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }
      if (landedOn.size + prev.size >= openDays.length) return prev;
      return new Set(prev).add(key);
    });
    setSaveErrors(prev => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  // ==== the AI half: generating, dismissing, drafting a real recipe ====

  const generate = useCallback(async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await suggestMealIdeas(
        [...(plannedTitles ?? [])],
        [...(recentTitles ?? [])],
        slotsToFill ?? openDays.length,
        hints,
        excludedRecipeTags,
        [...expiringItemHints],
      );
      // The service dedupes against the context it was given; the recipe box
      // is the other half of "new". A dish the user already owns isn't an
      // idea — if it fits this week the offline ranking above should be the
      // one offering it, with its real ingredients behind it.
      const owned = new Set(allRecipes.map(r => mealTitleKey(r.name)));
      setIdeas(result.filter(i => !owned.has(mealTitleKey(i.title))));
    } catch (e) {
      setIdeas([]);
      setGenerateError(describeAIError(e));
    } finally {
      setGenerating(false);
    }
  }, [plannedTitles, recentTitles, expiringItemHints, allRecipes, slotsToFill, openDays.length, hints, excludedRecipeTags]);

  const dismissIdea = (idea: MealIdea) => {
    haptics.tap();
    const key = `idea:${idea.id}`;
    setIdeas(prev => prev.filter(i => i.id !== idea.id));
    setSelected(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setSaveErrors(prev => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  /**
   * Drafts an idea's shopping list and saves it as a real recipe. Doesn't
   * plan it — Save does that once this resolves, so a failure here never
   * leaves a planned entry pointing at nothing.
   */
  const saveIdeaAsRecipe = useCallback(async (idea: MealIdea): Promise<Recipe> => {
    const drafted = await draftMealRecipe(idea.title, [...aisleOrder], null);
    const draft = mealIdeaRecipeDraft(idea, drafted.ingredients, drafted);
    if (!draft.name) throw new Error('IDEA_NAME_EMPTY');
    // addRecipe refuses a name already in the box (nameKey is UNIQUE); land
    // on the existing recipe rather than telling the user no.
    const recipe = addRecipe(draft.name)
      ?? allRecipes.find(r => r.name.trim().toLowerCase() === draft.name.trim().toLowerCase())
      ?? null;
    if (!recipe) throw new Error('IDEA_SAVE_FAILED');
    if (draft.ingredients.length > 0) addStructuredIngredients(recipe.id, draft.ingredients);
    if (draft.notes) setNotes(recipe.id, draft.notes);
    if (draft.estimatedMinutes) setEstimatedMinutes(recipe.id, draft.estimatedMinutes);
    draft.steps.forEach(step => addStep(recipe.id, step));
    draft.prepTasks.forEach(task => {
      const added = addPrepTask(recipe.id, task.title);
      if (added && task.offsetDays !== added.offsetDays) {
        updatePrepTask(recipe.id, added.id, { offsetDays: task.offsetDays });
      }
    });
    return recipe;
  }, [
    aisleOrder, addRecipe, allRecipes, addStructuredIngredients,
    setNotes, setEstimatedMinutes, addStep, addPrepTask, updatePrepTask,
  ]);

  /**
   * Commits every current pick: containers and recipes plan straight away,
   * ideas draft and save first. Walked in list order against `openDays` so the assignment
   * matches the preview `dayByKey` was already showing. A failed idea keeps
   * its pick (so Save can be pressed again to retry) and doesn't consume a
   * day; the sheet only closes once nothing is left failing.
   */
  // ==== committing ====

  const handleSave = async () => {
    if (selected.size === 0) { onClose(); return; }
    setSaving(true);
    const toSave = allSuggestions.filter(s => selected.has(s.key));
    const errors = new Map<string, string>();
    const newlyLanded = new Map<string, Date>();
    let dayIndex = landedOn.size;
    for (const item of toSave) {
      const day = openDays[dayIndex];
      if (!day) break;
      if (item.kind === 'leftover') {
        // Guarded rather than asserted: the rows only exist when the callback
        // does (see `fridge`), so this is the type narrowing, not a fallback.
        onPlanLeftover?.(item.leftover, dayKeyOf(day));
        newlyLanded.set(item.key, day);
        dayIndex += 1;
      } else if (item.kind === 'recipe') {
        onPlan(item.recipe, dayKeyOf(day));
        newlyLanded.set(item.key, day);
        dayIndex += 1;
      } else {
        setSavingKey(item.key);
        try {
          const recipe = await saveIdeaAsRecipe(item.idea);
          onPlan(recipe, dayKeyOf(day));
          newlyLanded.set(item.key, day);
          dayIndex += 1;
        } catch (e) {
          const message = e instanceof Error && e.message === 'IDEA_NAME_EMPTY'
            ? 'That name didn’t survive. Try regenerating.'
            : e instanceof Error && e.message === 'IDEA_SAVE_FAILED'
              ? 'Couldn’t save that to your recipe box.'
              : describeAIError(e);
          errors.set(item.key, message);
        }
      }
    }
    setSavingKey(null);
    setSaving(false);
    if (newlyLanded.size > 0) setLandedOn(prev => new Map([...prev, ...newlyLanded]));
    if (errors.size > 0) {
      haptics.success();
      setSaveErrors(errors);
      setSelected(new Set(errors.keys()));
    } else {
      haptics.success();
      onClose();
    }
  };

  // Grouped by the recipe each line is actually written on — the root's own
  // lines first, then each component's under its own name — same convention
  // flattenRecipeIngredients' callers use elsewhere (RecipeToListSheet,
  // AddWeekToListSheet). Resolved to the defaults: a preview isn't a shop, so
  // there's nothing to pick an alternative for.
  // ==== the ingredient preview ====

  const previewGroups = useMemo(() => {
    if (!previewRecipe) return [];
    const flat = flattenRecipeIngredients(previewRecipe, recipesById, undefined, standingSwaps);
    const groups: { recipe: Recipe; items: FlatIngredient[] }[] = [];
    for (const item of flat) {
      let group = groups.find(g => g.recipe.id === item.recipe.id);
      if (!group) { group = { recipe: item.recipe, items: [] }; groups.push(group); }
      group.items.push(item);
    }
    return groups;
  }, [previewRecipe, recipesById, standingSwaps]);

  const openPreview = (recipe: Recipe) => { haptics.tap(); setPreviewRecipe(recipe); };

  // ==== rows ====

  /**
   * A container in the fridge, drawn the way the fridge card draws one: a
   * freshness dot and a tinted caption, so the same chilli reads the same on
   * both surfaces. No preview button — a leftover has no ingredient list to
   * open, and no pantry or cook-history signals for the same reason.
   *
   * The one thing this row says that the card doesn't is when a pick would
   * land *after* the day the container should have been eaten by
   * (`isPlannedPastKeepUntil`, the same call `LeftoverDragCard` makes over a
   * day it's hovering). It informs and never refuses, exactly as it does
   * there: a portion may be going in the freezer, or the keep-for was a guess.
   */
  const renderLeftoverRow = (leftover: Leftover) => {
    const key = `leftover:${leftover.id}`;
    const landedDay = landedOn.get(key);
    const isSelected = selected.has(key);
    const previewDay = dayByKey.get(key);
    const day = landedDay ?? (isSelected ? previewDay : undefined);
    const late = !!day && isPlannedPastKeepUntil(leftover, dayKeyOf(day));
    // liveFreshnessOf, not freshnessOf: a frozen container's day is suspended,
    // so tinting from it would glow red about food in no danger at all — the
    // same call, and the same reason, as the fridge card's own rows.
    const freshness = liveFreshnessOf(leftover);
    const tint = late
      ? colors.red
      : freshness ? freshnessColor(freshness, colors) : colors.textTertiary;
    // The dot always carries the freshness; the caption only carries it while
    // it *is* the freshness caption. Once a pick turns it into "will land on
    // Tuesday" the sentence has stopped being about the clock, and an orange
    // one there reads as a warning about a day that's perfectly fine. Late is
    // the exception, because then the day is exactly what's wrong with it.
    const captionTint = late ? colors.red : day ? colors.textTertiary : tint;
    const caption = landedDay
      ? `Planned for ${format(landedDay, 'EEEE')}${late ? ' · past its use-by' : ''}`
      : isSelected && previewDay
        ? `Selected, will land on ${format(previewDay, 'EEEE')}${late ? ' · past its use-by' : ''}`
        : describeLeftover(leftover);
    const disabled = saving || !!landedDay || (!isSelected && capacityFull);
    return (
      <TouchableOpacity
        style={[styles.row, !!landedDay && styles.rowDone, isSelected && !landedDay && styles.rowSelected]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => toggleSelect(key)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected: isSelected }}
        accessibilityLabel={landedDay
          ? `${leftover.title}, planned for ${format(landedDay, 'EEEE')}`
          : `${isSelected ? 'Deselect' : 'Select'} ${leftover.title}, from the fridge. ${describeLeftover(leftover)}`}
      >
        {/* The dot carries the freshness on its own, so the caption is never
            the only thing saying it — same pairing the fridge card makes. */}
        <View style={[styles.dot, { backgroundColor: tint }]} />
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{leftover.title}</Text>
          <Text style={[styles.meta, { color: captionTint }]} numberOfLines={1}>{caption}</Text>
        </View>
        <Ionicons
          name={landedDay || isSelected ? 'checkmark-circle' : 'add-circle-outline'}
          size={iconSize.md}
          color={landedDay ? colors.green : isSelected ? colors.accent : disabled ? colors.textTertiary : colors.accent}
        />
      </TouchableOpacity>
    );
  };

  const renderRecipeRow = (recipe: Recipe) => {
    const key = `recipe:${recipe.id}`;
    const landedDay = landedOn.get(key);
    const isSelected = selected.has(key);
    const previewDay = dayByKey.get(key);
    const coverage = pantryByRecipeId?.get(recipe.id);
    const pantryLabel = coverage ? describePantryCoverage(coverage) : null;
    const pantryKnown = !!coverage && coverage.catalogMatches > 0;
    const cookHistory = describeCookHistory(recipe);
    const signalsLabel = [cookHistory, pantryLabel].filter(Boolean).join('. ');
    // Unpickable once every night has a pick, rather than a tap that quietly
    // does nothing — the caption above the list says why.
    const disabled = saving || !!landedDay || (!isSelected && capacityFull);
    return (
      <TouchableOpacity
        style={[styles.row, !!landedDay && styles.rowDone, isSelected && !landedDay && styles.rowSelected]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => toggleSelect(key)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected: isSelected }}
        accessibilityLabel={landedDay
          ? `${recipe.name}, planned for ${format(landedDay, 'EEEE')}`
          : `${isSelected ? 'Deselect' : 'Select'} ${recipe.name}. ${describeRecipe(recipe)}${signalsLabel ? `. ${signalsLabel}` : ''}`}
      >
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{recipe.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {landedDay
              ? `Planned for ${format(landedDay, 'EEEE')}`
              : isSelected && previewDay
                ? `Selected, will land on ${format(previewDay, 'EEEE')}`
                : describeRecipe(recipe)}
          </Text>
          {!landedDay && (pantryLabel || cookHistory) && (
            <View style={styles.signalRow}>
              {pantryLabel && (
                <View style={[styles.pantryBadge, pantryKnown ? styles.pantryBadgeKnown : styles.pantryBadgeUnknown]}>
                  <Text
                    style={[styles.pantryBadgeText, pantryKnown ? styles.pantryBadgeTextKnown : styles.pantryBadgeTextUnknown]}
                    numberOfLines={1}
                  >
                    {pantryLabel}
                  </Text>
                </View>
              )}
              {cookHistory ? (
                <Text style={styles.cookHistory} numberOfLines={1}>{cookHistory}</Text>
              ) : null}
            </View>
          )}
        </View>
        <View style={styles.rowActions}>
          <TouchableOpacity
            onPress={() => openPreview(recipe)}
            activeOpacity={interaction.activeOpacity}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`See ingredients for ${recipe.name}`}
          >
            <Ionicons name="information-circle-outline" size={iconSize.md} color={colors.textTertiary} />
          </TouchableOpacity>
          <Ionicons
            name={landedDay || isSelected ? 'checkmark-circle' : 'add-circle-outline'}
            size={iconSize.md}
            color={landedDay ? colors.green : isSelected ? colors.accent : disabled ? colors.textTertiary : colors.accent}
          />
        </View>
      </TouchableOpacity>
    );
  };

  const renderIdeaRow = (idea: MealIdea) => {
    const key = `idea:${idea.id}`;
    const landedDay = landedOn.get(key);
    const isSelected = selected.has(key);
    const previewDay = dayByKey.get(key);
    const isSavingRow = saving && savingKey === key;
    const error = saveErrors.get(key) ?? null;
    const disabled = saving || !!landedDay || (!isSelected && capacityFull);
    return (
      <TouchableOpacity
        style={[styles.row, styles.ideaRow, !!landedDay && styles.rowDone, isSelected && !landedDay && styles.rowSelected]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => toggleSelect(key)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected: isSelected }}
        accessibilityLabel={landedDay
          ? `${idea.title}, planned for ${format(landedDay, 'EEEE')}`
          : `${isSelected ? 'Deselect' : 'Select'} ${idea.title} — saves it to your recipe box on Save`}
      >
        <View style={styles.body}>
          <View style={styles.ideaTitleRow}>
            <Ionicons name="sparkles" size={iconSize.xs} color={colors.purple} />
            <Text style={styles.name} numberOfLines={1}>{idea.title}</Text>
          </View>
          <Text style={styles.meta} numberOfLines={2}>
            {landedDay
              ? `Planned for ${format(landedDay, 'EEEE')} · saved to your recipe box`
              : isSelected && previewDay
                ? `Selected, will land on ${format(previewDay, 'EEEE')} and save to your recipe box`
                : (idea.blurb || 'A new idea. Accepting it adds it to your recipe box.')}
          </Text>
          {!landedDay && (
            <View style={styles.signalRow}>
              <View style={styles.ideaTag}>
                <Text style={styles.ideaTagText}>AI idea · no recipe yet</Text>
              </View>
            </View>
          )}
          {!!error && <Text style={styles.ideaError}>{error}</Text>}
        </View>
        {landedDay ? (
          <Ionicons name="checkmark-circle" size={iconSize.md} color={colors.green} />
        ) : isSavingRow ? (
          <ActivityIndicator color={colors.purple} />
        ) : (
          <View style={styles.ideaActions}>
            <TouchableOpacity
              onPress={() => dismissIdea(idea)}
              activeOpacity={interaction.activeOpacity}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss ${idea.title}`}
              hitSlop={8}
            >
              <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.textTertiary} />
            </TouchableOpacity>
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'add-circle-outline'}
              size={iconSize.md}
              color={isSelected ? colors.purple : disabled ? colors.textTertiary : colors.purple}
            />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // The generation half of the sheet: the ask, the wait, the failure, and the
  // regenerate — all of it below the offline list, and none of it rendered at
  // all without a key or while a category filter is narrowing the list.
  const renderIdeaSection = () => {
    if (!aiIdeasEnabled || filter !== 'all') return null;
    return (
      <View style={styles.ideaSection}>
        <Text style={styles.sectionHeader}>NEW IDEAS</Text>
        {/* Stays up while the request is in flight — with no offline matches
            this section is the whole screen, and a spinner alone in it says
            nothing about what's being waited for. */}
        {ideas.length === 0 && !generateError && (
          <Text style={styles.sectionHint}>
            {recipes.length === 0
              ? 'Nothing in your recipe box fits this week, so Claude can invent a few meals instead. Picking one saves it as a real recipe when you Save.'
              : 'Want something you haven’t made before? Claude can invent a few. Picking one saves it as a real recipe when you Save.'}
          </Text>
        )}

        {!generating && (
          <TextInput
            style={styles.hintInput}
            value={hints}
            onChangeText={setHints}
            placeholder="Anything in mind? e.g. quick, vegetarian"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            onSubmitEditing={() => { if (!generating) generate(); }}
            accessibilityLabel="What kind of meals to suggest"
          />
        )}

        {generating ? (
          <View style={styles.generating}>
            <ActivityIndicator color={colors.purple} />
            <Text style={styles.generatingText}>Thinking up meals…</Text>
          </View>
        ) : generateError ? (
          <View style={styles.generateError}>
            <Text style={styles.generateErrorText}>{generateError}</Text>
            <InlineAction
              label="Try again"
              icon="refresh"
              variant="neutral"
              surface="page"
              onPress={() => { haptics.tap(); generate(); }}
              accessibilityLabel="Try generating meal ideas again"
            />
          </View>
        ) : (
          <View style={styles.ideaCta}>
            <InlineAction
              label={ideas.length > 0 ? 'More ideas' : 'Invent meals'}
              icon={ideas.length > 0 ? 'refresh' : 'sparkles-outline'}
              tint={colors.purple}
              onPress={() => { haptics.tap(); generate(); }}
              accessibilityLabel={ideas.length > 0
                ? 'Generate more meal ideas'
                : 'Invent new meal ideas with Claude'}
            />
          </View>
        )}
      </View>
    );
  };

  // ==== render ====

  const nothingAtAll = filter === 'all' && recipes.length === 0 && cookAgainRecipes.length === 0
    && fridge.length === 0 && ideas.length === 0 && !aiIdeasEnabled;
  // The fridge isn't counted here: a category filter hides it (see
  // filteredLeftovers), so a fridge full of containers is no reason to tell
  // someone their Breakfast filter matched something.
  const nothingForFilter = filter !== 'all'
    && filteredRecipes.length === 0 && filteredCookAgain.length === 0 && filteredIdeas.length === 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} disabled={saving} minWidth={72} />
          <Text style={styles.headerTitle}>Suggest meals</Text>
          <SheetHeaderButton
            label={saving ? 'Saving…' : selected.size > 0 ? `Save (${selected.size})` : 'Save'}
            role="confirm"
            onPress={handleSave}
            disabled={saving}
            minWidth={72}
            accessibilityLabel={selected.size > 0 ? `Save ${selected.size} selected meals` : 'Save'}
          />
        </View>

        {availableMealTypes.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {(['all', ...availableMealTypes] as const).map(type => {
              const active = filter === type;
              const label = type === 'all' ? 'All' : RECIPE_MEAL_TYPE_LABELS[type];
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => { haptics.tap(); setFilter(type); }}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter by ${label}`}
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {nothingAtAll ? (
          <View style={styles.centered}>
            <EmptyState
              icon="restaurant-outline"
              title="Nothing to suggest"
              subtitle="None of your recipes share enough with what's in your grocery catalog yet."
            />
          </View>
        ) : nothingForFilter ? (
          <View style={styles.centered}>
            <EmptyState
              icon="restaurant-outline"
              title="Nothing in this category"
              subtitle={`No ${RECIPE_MEAL_TYPE_LABELS[filter as RecipeMealType].toLowerCase()} recipes match your catalog yet. Try All.`}
            />
          </View>
        ) : (
          <ScrollView
            ref={keyboardScroll.ref}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            {...keyboardScroll.props}
          >
            {/* The fridge leads, above the recipes and above the intro line
                that explains them: a container is a dinner that already exists
                and is the only one with a clock on it, so it's read before
                anything that would have to be cooked. Same order the screen
                behind this sheet puts LeftoversCard in, and for the same
                reason. */}
            {filteredLeftovers.length > 0 && (
              <View style={styles.fridgeSection}>
                <Text style={[styles.sectionHeader, styles.fridgeHeader]}>IN THE FRIDGE</Text>
                {filteredLeftovers.map(leftover => (
                  <React.Fragment key={`leftover:${leftover.id}`}>{renderLeftoverRow(leftover)}</React.Fragment>
                ))}
              </View>
            )}
            {/* Recipes made often and made recently — kept separate from the
                pantry ranking below rather than merged into it, since the two
                rank by opposite signals (see cookAgainRecipes' own doc). */}
            {filteredCookAgain.length > 0 && (
              <View style={styles.cookAgainSection}>
                <Text style={[styles.sectionHeader, styles.cookAgainHeader]}>COOK AGAIN</Text>
                {filteredCookAgain.map(recipe => (
                  <React.Fragment key={`again:${recipe.id}`}>{renderRecipeRow(recipe)}</React.Fragment>
                ))}
              </View>
            )}
            {noOpenNights ? (
              <Text style={styles.intro}>There's no open night left this week.</Text>
            ) : capacityFull ? (
              // Says why the rows have gone quiet. Reachable two ways: every
              // open night already has a pick, or a partial Save landed the
              // rest and left only a failed pick behind.
              <Text style={styles.intro}>
                Every open night has a pick now. Deselect one to swap it, or Save to add them.
              </Text>
            ) : filteredRecipes.length > 0 && (
              <Text style={styles.intro}>
                Made from what's already in your grocery catalog — tap to pick, then Save to plan them.
              </Text>
            )}
            {suggestions.map((item: MealSuggestion) => (
              <React.Fragment key={item.key}>
                {item.kind === 'recipe' ? renderRecipeRow(item.recipe) : renderIdeaRow(item.idea)}
              </React.Fragment>
            ))}
            {renderIdeaSection()}
          </ScrollView>
        )}

        {/* Nested inside this sheet's own Modal, not a sibling — a sibling
            Modal would ask the screen behind this one to present a second
            sheet while this one is already up (same reasoning as
            GroceryItemSheet inside GroceryCatalogSheet, see CLAUDE.md). */}
        <Modal
          visible={!!previewRecipe}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setPreviewRecipe(null)}
        >
          {previewRecipe && (
            <View style={styles.root}>
              <View style={styles.header}>
                <SheetHeaderButton label="Close" role="cancel" onPress={() => setPreviewRecipe(null)} minWidth={72} />
                <Text style={styles.headerTitle}>{previewRecipe.name}</Text>
                <SheetHeaderButton
                  label={selected.has(`recipe:${previewRecipe.id}`) ? 'Selected' : 'Select'}
                  role="confirm"
                  onPress={() => {
                    const key = `recipe:${previewRecipe.id}`;
                    if (!selected.has(key)) toggleSelect(key);
                    setPreviewRecipe(null);
                  }}
                  disabled={saving || !!landedOn.get(`recipe:${previewRecipe.id}`)
                    || (!selected.has(`recipe:${previewRecipe.id}`) && capacityFull)}
                  minWidth={72}
                />
              </View>
              <ScrollView contentContainerStyle={styles.previewList}>
                <Text style={styles.previewMeta}>{describeRecipe(previewRecipe)}</Text>
                {!!previewRecipe.notes && <Text style={styles.previewNotes}>{previewRecipe.notes}</Text>}
                {previewGroups.length === 0 ? (
                  <Text style={styles.previewNotes}>This recipe has no ingredients yet.</Text>
                ) : previewGroups.map(group => (
                  <View key={group.recipe.id} style={styles.previewGroup}>
                    {group.recipe.id !== previewRecipe.id && (
                      <Text style={styles.sectionHeader}>FROM {group.recipe.name.toUpperCase()}</Text>
                    )}
                    {group.items.map(({ ingredient, swappedFrom }) => {
                      const quantity = convertQuantity(ingredient.quantity, unitSystem).text;
                      return (
                        <View key={ingredient.id} style={styles.previewIngredientRow}>
                          <Text style={styles.previewIngredientName}>
                            {ingredient.name}{ingredient.prep ? `, ${ingredient.prep}` : ''}
                            {/* A swapped line always says what the recipe
                                wrote. Inline here rather than on its own line:
                                these rows are a compact preview, and the name
                                is already carrying its prep clause. */}
                            {!!swappedFrom && (
                              <Text style={styles.previewSwap}> · {describeStandingSwap(swappedFrom)}</Text>
                            )}
                          </Text>
                          {!!quantity && (
                            <Text style={styles.previewIngredientQty} numberOfLines={1}>{quantity}</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </Modal>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Accent, the same tint every other surface marks a swapped line with.
  previewSwap: { color: colors.accent },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filterChip: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.bgSecondary,
  },
  filterChipActive: { backgroundColor: colors.accent },
  filterChipText: { fontSize: font.sm, fontWeight: fontWeight.medium, color: colors.textSecondary },
  filterChipTextActive: { color: colors.onAccent },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  intro: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  list: { paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  rowDone: { opacity: 0.6 },
  // A picked-but-not-saved row, distinct from rowDone: still fully
  // interactive (tapping it again drops the pick), just visibly chosen.
  rowSelected: { backgroundColor: `${colors.accent}14` },
  body: { flex: 1, gap: 2 },
  name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  meta: { fontSize: font.xs, color: colors.textTertiary, lineHeight: lineHeight.xs },
  signalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  pantryBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  // Green tint once there's real purchase history behind the number — the
  // same "known and good news" treatment probablyHave gets everywhere else
  // in the grocery flow. Neutral (no color claim) when there's nothing to
  // judge from yet, so an untracked recipe doesn't read as "0% on hand".
  pantryBadgeKnown: { backgroundColor: `${colors.green}26` },
  pantryBadgeUnknown: { backgroundColor: colors.bgTertiary },
  pantryBadgeText: { fontSize: font.xs, fontWeight: fontWeight.medium },
  pantryBadgeTextKnown: { color: colors.green },
  pantryBadgeTextUnknown: { color: colors.textTertiary },
  cookHistory: { fontSize: font.xs, color: colors.textTertiary, flexShrink: 1 },

  // An idea is deliberately a *different object* from a recipe row, not a
  // recipe row with a badge: a dashed purple edge on the same card, which
  // reads as "provisional" at a glance and can't be mistaken for one of the
  // user's own recipes while scrolling past.
  ideaRow: {
    borderWidth: border.sm,
    borderStyle: 'dashed',
    borderColor: `${colors.purple}66`,
  },
  ideaTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ideaTag: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: `${colors.purple}26`,
  },
  ideaTagText: { fontSize: font.xs, fontWeight: fontWeight.medium, color: colors.purple },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ideaActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ideaError: { fontSize: font.xs, color: colors.red, marginTop: spacing.xs },

  ideaSection: { marginTop: spacing.lg, paddingHorizontal: spacing.md, gap: spacing.sm },
  cookAgainSection: { paddingTop: spacing.md, gap: 2 },
  cookAgainHeader: { paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  fridgeSection: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 2 },
  fridgeHeader: { paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  // The same 8pt dot the fridge card uses, so one container reads the same on
  // both surfaces.
  dot: { width: 8, height: 8, borderRadius: 4 },
  sectionHeader: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
  },
  sectionHint: { fontSize: font.sm, color: colors.textTertiary, lineHeight: lineHeight.sm },
  // No lineHeight on a TextInput — see CLAUDE.md; minHeight is what keeps the
  // box from resizing.
  hintInput: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
    color: colors.text,
    fontSize: font.md,
  },
  ideaCta: { alignItems: 'flex-start' },
  generating: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  generatingText: { fontSize: font.sm, color: colors.textSecondary },
  generateError: { gap: spacing.sm, alignItems: 'flex-start' },
  generateErrorText: { fontSize: font.sm, color: colors.red, lineHeight: lineHeight.sm },

  previewList: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  previewMeta: { fontSize: font.sm, color: colors.textTertiary, lineHeight: lineHeight.sm },
  previewNotes: { fontSize: font.sm, color: colors.textSecondary, lineHeight: lineHeight.sm },
  previewGroup: { gap: spacing.xs },
  previewIngredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 6,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  previewIngredientName: { flex: 1, fontSize: font.md, color: colors.text },
  previewIngredientQty: { fontSize: font.sm, color: colors.textTertiary },
});
