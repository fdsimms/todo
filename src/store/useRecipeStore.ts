import { create } from 'zustand';
import type { Recipe, RecipeIngredient, RecipeMealType, RecipePrepTask, RecipeSourceType } from '../types';
import { GROCERY_NAME_MAX_LENGTH, RECIPE_PAGE_MAX_LENGTH, RECIPE_SECTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../types';
import {
  dbGetAllRecipes,
  dbInsertRecipe,
  dbUpdateRecipe,
  dbDeleteRecipe,
} from '../db/database';
import { generateId } from '../utils/id';
import { groceryNameKey } from '../utils/groceryParse';
import { deleteRecipeImage } from '../utils/recipePhoto';
import {
  applyMeasuredCookTime,
  applyMeasuredPrepTime,
  cleanChoiceGroup,
  cleanRecipeName,
  cleanRecipeSource,
  ingredientsFromText,
  makeIngredient,
  mergeIngredients,
  remapIngredientKeyIn,
} from '../utils/recipeUtils';
import { cookTimerElapsed, prepTimerElapsed } from '../utils/recipeTimer';
import { clampKeepDays } from '../utils/leftovers';
import { normalizeRecipeTags } from '../utils/recipeTags';
import { makeComponent, recipeMap, wouldCreateRecipeCycle } from '../utils/recipeComponents';
import { resolveSectionDrop, sectionsOf } from '../utils/recipeSections';

/**
 * The recipe library.
 *
 * A separate store from useGroceryStore, which is the opposite call to the one
 * shops got — and deliberately so. Shops live inside the grocery store because
 * they're grocery *configuration*, read by the same screens on every render. A
 * recipe is its own document with its own screens, and the only thing it shares
 * with the catalog is a key. Keeping them apart also keeps the dependency
 * one-way at the point that matters: this store never touches grocery_items,
 * and the one write in the other direction (renameItem keeping ingredient keys
 * in step) goes through remapIngredientKey rather than reaching into rows.
 *
 * Thin on purpose — the logic lives in recipeUtils where jest can reach it.
 */
/** What a cooking bumped, kept so an undo can hand it straight back. */
export interface CookStats {
  cookCount: number;
  lastCookedAt: string | null;
}

interface RecipeStore {
  recipes: Recipe[];
  initialized: boolean;

  initialize: () => void;

  /** Null when the name is empty or already taken — the caller shows why. */
  addRecipe: (name: string) => Recipe | null;
  /** False on an empty name or a collision with another recipe. */
  renameRecipe: (id: string, name: string) => boolean;
  setNotes: (id: string, notes: string) => void;
  setSourceUrl: (id: string, url: string | null) => void;
  /** @deprecated superseded by setAuthor/setSource (#1266); kept for old callers. */
  setSourceName: (id: string, source: string | null) => void;
  setAuthor: (id: string, author: string | null) => void;
  setSource: (id: string, source: string | null) => void;
  /**
   * Clears `sourcePage` the moment the type stops being 'cookbook' — the same
   * rule `setServings` follows for a max that no longer beats its min: a page
   * number only means anything alongside the book it's a page of.
   */
  setSourceType: (id: string, sourceType: RecipeSourceType | null) => void;
  /** A cookbook page number ("142", "112-115"). Free text, not validated as numeric — some books print "xii". */
  setSourcePage: (id: string, sourcePage: string | null) => void;
  /**
   * `servingsMax` is the top of a range ("serves 4-6") and is optional — omit
   * it (or pass null) for a plain count. A max at or below `servings` isn't a
   * range, so it's dropped rather than stored as one.
   */
  setServings: (id: string, servings: number | null, servingsMax?: number | null) => void;
  /** What the recipe makes when a person-count doesn't fit — "3 cups", "2 dozen cookies". */
  setRecipeYield: (id: string, recipeYield: string | null) => void;
  /**
   * How long this dish's leftovers keep. null hands the question back to the
   * standard window, which is what every recipe says until told otherwise.
   *
   * Clamped to the stepper's own range rather than validated, the same call
   * setServings makes. **Changes nothing already in the fridge** — see
   * leftoverKeepDaysFor: this is the number the log sheet opens on, not a rule
   * applied to containers whose day was decided when they went in.
   */
  setLeftoverKeepDays: (id: string, days: number | null) => void;
  /**
   * Sets or clears a recipe's attached photo — `uri` is a file already saved
   * by `pickRecipeImage` (src/utils/recipePhoto.ts); this call just records
   * it. Deletes the previous file, if any, once the new value is committed —
   * an orphaned image is bytes nothing else will ever point at again.
   */
  setImage: (id: string, uri: string | null) => void;
  setMealType: (id: string, mealType: RecipeMealType | null) => void;
  /**
   * Replaces a recipe's whole tag list — the editor holds a draft and commits
   * on Done, same as it does for meal type, so there's no per-tag add/remove
   * action to keep in step with it. Cleaned and de-duplicated here rather than
   * trusted (see normalizeRecipeTags): this is the only door into the column,
   * and a tag's spelling is its identity.
   */
  setTags: (id: string, tags: readonly string[]) => void;
  toggleFavorite: (id: string) => void;
  /**
   * Deliberately doesn't rewrite the recipes that used this one as a component
   * — see RecipeComponent.recipeId. Unfiling the links would silently edit
   * recipes the user didn't ask to touch, and re-adding a restored backup
   * couldn't put them back; a link that stops resolving renders as a row saying
   * so, which they can remove or replace. The editor's confirm names those
   * parents first (see RecipeEditor.handleDelete).
   */
  deleteRecipe: (id: string) => void;
  /** Deletes every named recipe. No undo — same as deleteRecipe's own confirm-only flow. */
  bulkDeleteRecipes: (ids: string[]) => void;
  /** Sets favorite on every named recipe at once — the bulk form of toggleFavorite. */
  bulkSetFavorite: (ids: string[], favorite: boolean) => void;

  /**
   * Bumps cookCount and stamps lastCookedAt. Called once per "Mark cooked" on
   * a planned meal entry — see useMealPlanStore.markCooked, which stamps the
   * entry itself. The two are separate writes because the counter lives on
   * the recipe and is never recomputed from entries (see Recipe.cookCount).
   *
   * Returns what the two fields were beforehand, so the caller can hand them
   * back if the whole action is undone (null when the recipe doesn't resolve).
   * The caller has to carry that snapshot because only it knows the cooking and
   * the bump were one action — see restoreCookStats.
   */
  markCooked: (id: string) => CookStats | null;

  /**
   * Puts cookCount and lastCookedAt back to a snapshot markCooked returned.
   *
   * **This is for undo, and only for undo.** It is not a decrement, and
   * "mark not cooked" must not call it: cookCount is a counter that only goes
   * up everywhere else in this app, and un-ticking a meal is a statement about
   * *that meal* going forward, not a claim that the cooking never happened.
   * Undo is the one action that does claim exactly that, which is why it alone
   * gets to reach in here.
   */
  restoreCookStats: (id: string, stats: CookStats) => void;

  /** null clears it. Rounded and floored at 1 minute, same clamp as a task's estimate. */
  setEstimatedMinutes: (id: string, minutes: number | null) => void;

  /**
   * The cook timer, mirroring useTaskStore's startTimer/pauseTimer/resetTimer/
   * stopTimer for the plain stopwatch case (see src/utils/recipeTimer.ts).
   * start/pause bank and resume a run segment without touching anything
   * logged; reset abandons the current segment unlogged; stop banks the
   * final segment and logs it via applyMeasuredCookTime, which is the one
   * action that writes lastCookMinutes/cookTimeCount/totalCookMinutes (and
   * backfills estimatedMinutes the first time, same as a task's stopTimer
   * backfills estimatedMinutes/effort).
   */
  startCookTimer: (id: string) => void;
  pauseCookTimer: (id: string) => void;
  resetCookTimer: (id: string) => void;
  stopCookTimer: (id: string) => void;
  /**
   * Logs a cook time typed in directly, for whoever times a cook on their own
   * stove clock rather than this one — same applyMeasuredCookTime write
   * stopCookTimer makes, just skipping the running/paused segment entirely.
   * A no-op run must not still bank a log, so this never touches
   * timerStartedAt/timerElapsedSeconds; abandon the timer first if one is live.
   */
  logManualCookTime: (id: string, minutes: number) => void;

  /** null clears it. Rounded and floored at 1 minute, same clamp as setEstimatedMinutes. */
  setPrepMinutes: (id: string, minutes: number | null) => void;

  /**
   * The prep timer — same shape as startCookTimer/pauseCookTimer/
   * resetCookTimer/stopCookTimer above, targeting prepMinutes/
   * prepTimerStartedAt/prepTimerElapsedSeconds and logging through
   * applyMeasuredPrepTime instead. Independent of the cook timer: starting
   * one never touches the other, so prep can run while a previous batch is
   * still on the cook clock.
   */
  startPrepTimer: (id: string) => void;
  pausePrepTimer: (id: string) => void;
  resetPrepTimer: (id: string) => void;
  stopPrepTimer: (id: string) => void;
  /** The prep-timer counterpart of logManualCookTime, logging through applyMeasuredPrepTime. */
  logManualPrepTime: (id: string, minutes: number) => void;

  /**
   * Appends one typed line. Null when it parses to nothing or is already
   * there. `section` stamps the same heading onto the new row that
   * `RecipeIngredientSheet`'s Section field writes by hand — the editor's add
   * field passes whatever section is currently selected there.
   */
  addIngredient: (recipeId: string, line: string, section?: string | null) => RecipeIngredient | null;
  /** Appends a pasted block. Returns how many were new. `section` as above, applied to every new line. */
  addIngredientsFromText: (recipeId: string, raw: string, section?: string | null) => number;
  /**
   * Merges already-structured ingredients — e.g. from AI recipe extraction —
   * bypassing makeIngredient's text parse, since these already arrived as
   * name/quantity/aisle. Returns how many were new.
   */
  addStructuredIngredients: (recipeId: string, ingredients: RecipeIngredient[]) => number;
  updateIngredient: (recipeId: string, ingredientId: string, patch: Partial<RecipeIngredient>) => void;
  /**
   * Turns one "cheddar or manchego" line into that many real ingredient rows,
   * filed as alternatives of each other — the accept half of the suggestion
   * splitAlternativeNames makes (see RecipeIngredient.choiceGroup).
   *
   * The new rows take the original's place in the list and inherit its
   * quantity, prep, purpose, section and aisle: they're alternatives for one
   * slot in the recipe, so whatever was true of that slot is true of each way
   * of filling it.
   *
   * Returns how many rows the line became, and 0 without writing when the split
   * wouldn't produce a real choice — an unknown recipe or ingredient, fewer
   * than two names, or names the recipe already carries elsewhere (which would
   * leave a "group" of one).
   */
  splitIngredientAlternatives: (
    recipeId: string,
    ingredientId: string,
    names: readonly string[],
    choiceGroup: string,
  ) => number;
  removeIngredient: (recipeId: string, ingredientId: string) => void;
  /**
   * The new order, and — because the order is what decides which section a row
   * renders under — the re-filing that goes with it. See `resolveSectionDrop`
   * for exactly when a dragged row changes section and when it keeps its own.
   */
  reorderIngredients: (recipeId: string, ids: string[]) => void;
  /** Removes several ingredients from one recipe at once — the bulk form of removeIngredient. */
  bulkRemoveIngredients: (recipeId: string, ingredientIds: string[]) => void;
  /** Files several ingredients from one recipe into the same aisle at once. */
  bulkSetIngredientAisle: (recipeId: string, ingredientIds: string[], aisle: string | null) => void;

  /**
   * Declares a heading with nothing filed under it yet, so it's choosable
   * from the Section field and the sticky heading input before any ingredient
   * carries it. False on a blank name or one that's already a heading here,
   * real or declared. `save()` prunes an entry the moment a row actually
   * adopts the same label — see Recipe.emptySections.
   */
  addEmptySection: (recipeId: string, name: string) => boolean;
  /** Un-declares a heading that never got anything under it. */
  removeEmptySection: (recipeId: string, name: string) => void;

  /**
   * References `componentRecipeId` as a part of `recipeId` — the shared
   * "mashed potatoes" inside two different dinners.
   *
   * False, and no write, for anything that isn't a usable link: an unknown
   * recipe on either end, a recipe referencing itself, one already linked, or
   * one that would close a loop. The picker disables those rows for the same
   * reasons (see RecipeComponentPicker), so this is the backstop rather than
   * the user-facing explanation — the same division NestedTemplatePicker and
   * wouldCreateCycle already have.
   */
  addComponent: (recipeId: string, componentRecipeId: string, choiceGroup?: string | null) => boolean;
  /** Unlinks by the component's own id, so a broken link can be cleared too. */
  removeComponent: (recipeId: string, componentId: string) => void;

  /**
   * Files a component under an either/or label, or takes it back out of one
   * with null — see RecipeComponent.choiceGroup. Trimmed and length-capped
   * here, so a label arriving from a text field can't differ from the one the
   * options it's meant to join are stored under.
   */
  setComponentChoiceGroup: (recipeId: string, componentId: string, choiceGroup: string | null) => void;

  /**
   * Makes a component the one its group falls back to, by moving it ahead of
   * its fellow options — the default *is* first place (see
   * RecipeComponent.choiceGroup), so this is a reorder rather than a flag.
   *
   * It moves the link to where the group's first option currently sits, leaving
   * every ungrouped component and every other group exactly where they are: the
   * list is what the recipe reads like, and promoting the roast potatoes should
   * not shuffle the steak.
   */
  makeComponentDefault: (recipeId: string, componentId: string) => void;

  /** Null when the title is empty. Defaults to a day before the meal, no reminder. */
  addPrepTask: (recipeId: string, title: string) => RecipePrepTask | null;
  updatePrepTask: (recipeId: string, prepTaskId: string, patch: Partial<RecipePrepTask>) => void;
  removePrepTask: (recipeId: string, prepTaskId: string) => void;

  /**
   * Follows a grocery item's rename across every recipe that referenced its old
   * key. Called by useGroceryStore.renameItem — see the note there.
   */
  remapIngredientKey: (fromKey: string, toKey: string) => void;

  recipeById: (id: string) => Recipe | undefined;
}

export const useRecipeStore = create<RecipeStore>((set, get) => ({
  recipes: [],
  initialized: false,

  initialize() {
    set({ recipes: dbGetAllRecipes(), initialized: true });
  },

  addRecipe(name) {
    const clean = cleanRecipeName(name);
    if (!clean) return null;
    const key = groceryNameKey(clean) || clean.toLowerCase();
    if (get().recipes.some(r => r.nameKey === key)) return null;

    const maxOrder = get().recipes.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    const recipe: Recipe = {
      id: generateId(),
      name: clean,
      nameKey: key,
      notes: '',
      sourceUrl: null,
      sourceName: null,
      author: null,
      source: null,
      sourceType: null,
      sourcePage: null,
      servings: null,
      servingsMax: null,
      recipeYield: null,
      leftoverKeepDays: null,
      imagePath: null,
      mealType: null,
      tags: [],
      ingredients: [],
      emptySections: [],
      components: [],
      prepTasks: [],
      favorite: false,
      sortOrder: maxOrder + 1,
      createdAt: new Date().toISOString(),
      cookCount: 0,
      lastCookedAt: null,
      estimatedMinutes: null,
      timerStartedAt: null,
      timerElapsedSeconds: 0,
      lastCookMinutes: null,
      cookTimeCount: 0,
      totalCookMinutes: 0,
      prepMinutes: null,
      prepTimerStartedAt: null,
      prepTimerElapsedSeconds: 0,
      lastPrepMinutes: null,
      prepTimeCount: 0,
      totalPrepMinutes: 0,
    };
    dbInsertRecipe(recipe);
    set(s => ({ recipes: [...s.recipes, recipe] }));
    return recipe;
  },

  renameRecipe(id, name) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return false;
    const clean = cleanRecipeName(name);
    if (!clean) return false;
    const key = groceryNameKey(clean) || clean.toLowerCase();
    // A rename that only changes capitalisation keeps the same key, so compare
    // against *other* recipes rather than refusing to touch this one.
    if (key !== recipe.nameKey && get().recipes.some(r => r.nameKey === key)) return false;
    save(set, { ...recipe, name: clean, nameKey: key });
    return true;
  },

  setNotes(id, notes) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    save(set, { ...recipe, notes: notes.trim() });
  },

  setSourceUrl(id, url) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const trimmed = url?.trim() ?? '';
    save(set, { ...recipe, sourceUrl: trimmed || null });
  },

  setSourceName(id, source) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const clean = cleanRecipeSource(source ?? '');
    save(set, { ...recipe, sourceName: clean || null });
  },

  setAuthor(id, author) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const clean = cleanRecipeSource(author ?? '');
    save(set, { ...recipe, author: clean || null });
  },

  setSource(id, source) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const clean = cleanRecipeSource(source ?? '');
    save(set, { ...recipe, source: clean || null });
  },

  setSourceType(id, sourceType) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const sourcePage = sourceType === 'cookbook' ? recipe.sourcePage : null;
    save(set, { ...recipe, sourceType, sourcePage });
  },

  setSourcePage(id, sourcePage) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const clean = cleanRecipeSource(sourcePage ?? '', RECIPE_PAGE_MAX_LENGTH);
    save(set, { ...recipe, sourcePage: clean || null });
  },

  setServings(id, servings, servingsMax) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    // Clamped rather than validated at the call site: the stepper can't
    // overshoot, but a restored backup can carry anything.
    const next = servings === null ? null : Math.max(1, Math.min(99, Math.round(servings)));
    const clampedMax = servingsMax == null ? null : Math.max(1, Math.min(99, Math.round(servingsMax)));
    // A max only means anything alongside a min it actually exceeds — no
    // `servings` or a max that doesn't beat it collapses back to a plain count.
    const nextMax = next !== null && clampedMax !== null && clampedMax > next ? clampedMax : null;
    save(set, { ...recipe, servings: next, servingsMax: nextMax });
  },

  setRecipeYield(id, recipeYield) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const clean = cleanRecipeSource(recipeYield ?? '');
    save(set, { ...recipe, recipeYield: clean || null });
  },

  setLeftoverKeepDays(id, days) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    save(set, { ...recipe, leftoverKeepDays: days === null ? null : clampKeepDays(days) });
  },

  setImage(id, uri) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const previous = recipe.imagePath;
    save(set, { ...recipe, imagePath: uri });
    if (previous && previous !== uri) deleteRecipeImage(previous);
  },

  setMealType(id, mealType) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    save(set, { ...recipe, mealType });
  },

  setTags(id, tags) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const next = normalizeRecipeTags(tags);
    // A no-op edit is the common case here — the editor commits every field on
    // Done, tags included, whether or not they were touched.
    if (next.length === recipe.tags.length && next.every((t, i) => t === recipe.tags[i])) return;
    save(set, { ...recipe, tags: next });
  },

  toggleFavorite(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    save(set, { ...recipe, favorite: !recipe.favorite });
  },

  deleteRecipe(id) {
    const recipe = get().recipes.find(r => r.id === id);
    dbDeleteRecipe(id);
    set(s => ({ recipes: s.recipes.filter(r => r.id !== id) }));
    if (recipe) deleteRecipeImage(recipe.imagePath);
  },

  bulkDeleteRecipes(ids) {
    const idSet = new Set(ids);
    const toDelete = get().recipes.filter(r => idSet.has(r.id));
    if (toDelete.length === 0) return;
    toDelete.forEach(r => dbDeleteRecipe(r.id));
    set(s => ({ recipes: s.recipes.filter(r => !idSet.has(r.id)) }));
  },

  bulkSetFavorite(ids, favorite) {
    const idSet = new Set(ids);
    const toUpdate = get().recipes.filter(r => idSet.has(r.id) && r.favorite !== favorite);
    if (toUpdate.length === 0) return;
    const updated = toUpdate.map(r => ({ ...r, favorite }));
    updated.forEach(dbUpdateRecipe);
    const byId = new Map(updated.map(r => [r.id, r]));
    set(s => ({ recipes: s.recipes.map(r => byId.get(r.id) ?? r) }));
  },

  markCooked(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return null;
    const before: CookStats = { cookCount: recipe.cookCount, lastCookedAt: recipe.lastCookedAt };
    save(set, { ...recipe, cookCount: recipe.cookCount + 1, lastCookedAt: new Date().toISOString() });
    return before;
  },

  restoreCookStats(id, stats) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    save(set, { ...recipe, ...stats });
  },

  setEstimatedMinutes(id, minutes) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const next = minutes === null ? null : Math.max(1, Math.round(minutes));
    save(set, { ...recipe, estimatedMinutes: next });
  },

  startCookTimer(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe || recipe.timerStartedAt !== null) return;
    save(set, { ...recipe, timerStartedAt: new Date().toISOString() });
  },

  pauseCookTimer(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe || recipe.timerStartedAt === null) return;
    save(set, { ...recipe, timerStartedAt: null, timerElapsedSeconds: cookTimerElapsed(recipe) });
  },

  resetCookTimer(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    save(set, { ...recipe, timerStartedAt: null, timerElapsedSeconds: 0 });
  },

  stopCookTimer(id) {
    const recipe = get().recipes.find(r => r.id === id);
    // Nothing to log — no run in flight and nothing banked from an earlier pause.
    if (!recipe || (recipe.timerStartedAt === null && recipe.timerElapsedSeconds <= 0)) return;
    const minutes = cookTimerElapsed(recipe) / 60;
    save(set, {
      ...recipe,
      timerStartedAt: null,
      timerElapsedSeconds: 0,
      ...applyMeasuredCookTime(minutes, recipe),
    });
  },

  logManualCookTime(id, minutes) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe || minutes <= 0) return;
    save(set, { ...recipe, ...applyMeasuredCookTime(minutes, recipe) });
  },

  setPrepMinutes(id, minutes) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    const next = minutes === null ? null : Math.max(1, Math.round(minutes));
    save(set, { ...recipe, prepMinutes: next });
  },

  startPrepTimer(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe || recipe.prepTimerStartedAt !== null) return;
    save(set, { ...recipe, prepTimerStartedAt: new Date().toISOString() });
  },

  pausePrepTimer(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe || recipe.prepTimerStartedAt === null) return;
    save(set, { ...recipe, prepTimerStartedAt: null, prepTimerElapsedSeconds: prepTimerElapsed(recipe) });
  },

  resetPrepTimer(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    save(set, { ...recipe, prepTimerStartedAt: null, prepTimerElapsedSeconds: 0 });
  },

  stopPrepTimer(id) {
    const recipe = get().recipes.find(r => r.id === id);
    // Nothing to log — no run in flight and nothing banked from an earlier pause.
    if (!recipe || (recipe.prepTimerStartedAt === null && recipe.prepTimerElapsedSeconds <= 0)) return;
    const minutes = prepTimerElapsed(recipe) / 60;
    save(set, {
      ...recipe,
      prepTimerStartedAt: null,
      prepTimerElapsedSeconds: 0,
      ...applyMeasuredPrepTime(minutes, recipe),
    });
  },

  logManualPrepTime(id, minutes) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe || minutes <= 0) return;
    save(set, { ...recipe, ...applyMeasuredPrepTime(minutes, recipe) });
  },

  addIngredient(recipeId, line, section = null) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return null;
    const ingredient = makeIngredient(line, section);
    if (!ingredient) return null;
    const merged = mergeIngredients(recipe.ingredients, [ingredient]);
    if (merged.length === recipe.ingredients.length) return null;
    save(set, { ...recipe, ingredients: merged });
    return ingredient;
  },

  addIngredientsFromText(recipeId, raw, section = null) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return 0;
    const merged = mergeIngredients(recipe.ingredients, ingredientsFromText(raw, section));
    const added = merged.length - recipe.ingredients.length;
    if (added === 0) return 0;
    save(set, { ...recipe, ingredients: merged });
    return added;
  },

  addStructuredIngredients(recipeId, ingredients) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return 0;
    const merged = mergeIngredients(recipe.ingredients, ingredients);
    const added = merged.length - recipe.ingredients.length;
    if (added === 0) return 0;
    save(set, { ...recipe, ingredients: merged });
    return added;
  },

  updateIngredient(recipeId, ingredientId, patch) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    let touched = false;
    const ingredients = recipe.ingredients.map(i => {
      if (i.id !== ingredientId) return i;
      touched = true;
      const next = { ...i, ...patch };
      // The key is derived, never passed in — a patch that changes the name has
      // to move the key with it or the bridge to the catalog goes stale.
      return { ...next, nameKey: groceryNameKey(next.name) };
    });
    if (!touched) return;
    save(set, { ...recipe, ingredients });
  },

  splitIngredientAlternatives(recipeId, ingredientId, names, choiceGroup) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return 0;
    const index = recipe.ingredients.findIndex(i => i.id === ingredientId);
    if (index < 0) return 0;
    const original = recipe.ingredients[index];
    const group = cleanChoiceGroup(choiceGroup);
    if (!group) return 0;

    // Every *other* row's key, so a split that would recreate an ingredient the
    // recipe already lists drops that option rather than duplicating it.
    const takenKeys = new Set(
      recipe.ingredients.filter(i => i.id !== ingredientId).map(i => i.nameKey)
    );
    const rows: RecipeIngredient[] = [];
    for (const raw of names) {
      const name = raw.trim().slice(0, GROCERY_NAME_MAX_LENGTH).trim();
      if (!name) continue;
      const nameKey = groceryNameKey(name);
      if (!nameKey || takenKeys.has(nameKey)) continue;
      takenKeys.add(nameKey);
      rows.push({
        ...original,
        // The first row keeps the original's id, so anything already pointing
        // at this line (a meal's stored pick, most of all) still resolves —
        // and it lands first, which makes it the group's default.
        id: rows.length === 0 ? original.id : generateId(),
        name,
        nameKey,
        choiceGroup: group,
      });
    }
    // One survivor is not a choice; leave the line exactly as the user wrote it.
    if (rows.length < 2) return 0;

    save(set, {
      ...recipe,
      ingredients: [
        ...recipe.ingredients.slice(0, index),
        ...rows,
        ...recipe.ingredients.slice(index + 1),
      ],
    });
    return rows.length;
  },

  removeIngredient(recipeId, ingredientId) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const ingredients = recipe.ingredients.filter(i => i.id !== ingredientId);
    if (ingredients.length === recipe.ingredients.length) return;
    save(set, { ...recipe, ingredients });
  },

  bulkRemoveIngredients(recipeId, ingredientIds) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const idSet = new Set(ingredientIds);
    const ingredients = recipe.ingredients.filter(i => !idSet.has(i.id));
    if (ingredients.length === recipe.ingredients.length) return;
    save(set, { ...recipe, ingredients });
  },

  bulkSetIngredientAisle(recipeId, ingredientIds, aisle) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const idSet = new Set(ingredientIds);
    let touched = false;
    const ingredients = recipe.ingredients.map(i => {
      if (!idSet.has(i.id)) return i;
      touched = true;
      return { ...i, aisle };
    });
    if (!touched) return;
    save(set, { ...recipe, ingredients });
  },

  addEmptySection(recipeId, name) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return false;
    const cleaned = name.trim().slice(0, RECIPE_SECTION_MAX_LENGTH).trim();
    if (!cleaned) return false;
    if (sectionsOf(recipe.ingredients).includes(cleaned)) return false;
    if (recipe.emptySections.includes(cleaned)) return false;
    save(set, { ...recipe, emptySections: [...recipe.emptySections, cleaned] });
    return true;
  },

  removeEmptySection(recipeId, name) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe || !recipe.emptySections.includes(name)) return;
    save(set, { ...recipe, emptySections: recipe.emptySections.filter(s => s !== name) });
  },

  reorderIngredients(recipeId, ids) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const byId = new Map(recipe.ingredients.map(i => [i.id, i]));
    const ordered = ids.map(id => byId.get(id)).filter((i): i is RecipeIngredient => !!i);
    // Anything the caller didn't name keeps its place at the end rather than
    // being dropped — a stale id list must not delete ingredients.
    const named = new Set(ordered.map(i => i.id));
    const rest = recipe.ingredients.filter(i => !named.has(i.id));
    const next = [...ordered, ...rest];

    // Dragging a row under a heading is how it joins that section — the order
    // was already what decides which section a row renders in, so leaving the
    // label behind is what made the heading appear to teleport past the row.
    // One write, not two: a reorder followed by a separate re-file is a frame
    // of the list with the row in its new place and its old heading.
    const drop = resolveSectionDrop(recipe.ingredients, next);
    const ingredients = drop
      ? next.map(i => (i.id === drop.id ? { ...i, section: drop.section } : i))
      : next;

    save(set, { ...recipe, ingredients });
  },

  addComponent(recipeId, componentRecipeId, choiceGroup = null) {
    const recipes = get().recipes;
    const recipe = recipes.find(r => r.id === recipeId);
    const target = recipes.find(r => r.id === componentRecipeId);
    if (!recipe || !target) return false;
    if (recipe.components.some(c => c.recipeId === componentRecipeId)) return false;
    if (wouldCreateRecipeCycle(recipeMap(recipes), recipeId, componentRecipeId)) return false;
    save(set, {
      ...recipe,
      components: [...recipe.components, makeComponent(target, cleanChoiceGroup(choiceGroup))],
    });
    return true;
  },

  removeComponent(recipeId, componentId) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const components = recipe.components.filter(c => c.id !== componentId);
    if (components.length === recipe.components.length) return;
    save(set, { ...recipe, components });
  },

  setComponentChoiceGroup(recipeId, componentId, choiceGroup) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const clean = cleanChoiceGroup(choiceGroup);
    if (!recipe.components.some(c => c.id === componentId)) return;
    save(set, {
      ...recipe,
      components: recipe.components.map(c => (c.id === componentId ? { ...c, choiceGroup: clean } : c)),
    });
  },

  makeComponentDefault(recipeId, componentId) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const target = recipe.components.find(c => c.id === componentId);
    if (!target?.choiceGroup) return;
    const firstIndex = recipe.components.findIndex(c => c.choiceGroup === target.choiceGroup);
    if (firstIndex < 0 || recipe.components[firstIndex].id === componentId) return;
    const rest = recipe.components.filter(c => c.id !== componentId);
    save(set, { ...recipe, components: [...rest.slice(0, firstIndex), target, ...rest.slice(firstIndex)] });
  },

  addPrepTask(recipeId, title) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return null;
    const clean = title.trim().slice(0, TITLE_MAX_LENGTH);
    if (!clean) return null;
    // A day before, no reminder — the least committal default, same reasoning
    // CountStepper's own docs give for not picking a ceiling nobody asked for.
    const prepTask: RecipePrepTask = { id: generateId(), title: clean, offsetDays: -1, reminderOffsetMinutes: null };
    save(set, { ...recipe, prepTasks: [...recipe.prepTasks, prepTask] });
    return prepTask;
  },

  updatePrepTask(recipeId, prepTaskId, patch) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    let touched = false;
    const prepTasks = recipe.prepTasks.map(t => {
      if (t.id !== prepTaskId) return t;
      touched = true;
      return { ...t, ...patch };
    });
    if (!touched) return;
    save(set, { ...recipe, prepTasks });
  },

  removePrepTask(recipeId, prepTaskId) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const prepTasks = recipe.prepTasks.filter(t => t.id !== prepTaskId);
    if (prepTasks.length === recipe.prepTasks.length) return;
    save(set, { ...recipe, prepTasks });
  },

  remapIngredientKey(fromKey, toKey) {
    const changed = remapIngredientKeyIn(get().recipes, fromKey, toKey);
    if (changed.length === 0) return;
    changed.forEach(dbUpdateRecipe);
    const byId = new Map(changed.map(r => [r.id, r]));
    set(s => ({ recipes: s.recipes.map(r => byId.get(r.id) ?? r) }));
  },

  recipeById(id) {
    return get().recipes.find(r => r.id === id);
  },
}));

type SetRecipes = (fn: (s: { recipes: Recipe[] }) => { recipes: Recipe[] }) => void;

/**
 * Write-then-patch. Every mutation above is a whole-row update — the row holds
 * its ingredients as a blob, so there is no such thing as a partial write here
 * — which makes one helper honest rather than a premature abstraction.
 *
 * Also the one place `emptySections` is reconciled against `ingredients`,
 * rather than every mutator that can assign a `section` doing it itself: a
 * declared heading is only ever meant to bridge the gap until a real row
 * carries the label, so the moment one does, the declaration is redundant and
 * dropped. Cheap to check unconditionally — most saves carry no declared
 * sections at all.
 */
function save(set: SetRecipes, recipe: Recipe): void {
  const next = recipe.emptySections.length === 0 ? recipe : {
    ...recipe,
    emptySections: recipe.emptySections.filter(
      name => !recipe.ingredients.some(i => i.section === name)
    ),
  };
  dbUpdateRecipe(next);
  set(s => ({ recipes: s.recipes.map(r => (r.id === next.id ? next : r)) }));
}
