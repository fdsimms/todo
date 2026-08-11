import { create } from 'zustand';
import type { Recipe, RecipeIngredient, RecipeMealType, RecipePrepTask } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
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
  cleanRecipeName,
  cleanRecipeSource,
  ingredientsFromText,
  makeIngredient,
  mergeIngredients,
  remapIngredientKeyIn,
} from '../utils/recipeUtils';
import { cookTimerElapsed } from '../utils/recipeTimer';
import { makeComponent, recipeMap, wouldCreateRecipeCycle } from '../utils/recipeComponents';

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
   * `servingsMax` is the top of a range ("serves 4-6") and is optional — omit
   * it (or pass null) for a plain count. A max at or below `servings` isn't a
   * range, so it's dropped rather than stored as one.
   */
  setServings: (id: string, servings: number | null, servingsMax?: number | null) => void;
  /** What the recipe makes when a person-count doesn't fit — "3 cups", "2 dozen cookies". */
  setRecipeYield: (id: string, recipeYield: string | null) => void;
  /**
   * Sets or clears a recipe's attached photo — `uri` is a file already saved
   * by `pickRecipeImage` (src/utils/recipePhoto.ts); this call just records
   * it. Deletes the previous file, if any, once the new value is committed —
   * an orphaned image is bytes nothing else will ever point at again.
   */
  setImage: (id: string, uri: string | null) => void;
  setMealType: (id: string, mealType: RecipeMealType | null) => void;
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

  /**
   * Bumps cookCount and stamps lastCookedAt. Called once per "Mark cooked" on
   * a planned meal entry — see useMealPlanStore.markCooked, which stamps the
   * entry itself. The two are separate writes because the counter lives on
   * the recipe and is never recomputed from entries (see Recipe.cookCount).
   */
  markCooked: (id: string) => void;

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

  /** Appends one typed line. Null when it parses to nothing or is already there. */
  addIngredient: (recipeId: string, line: string) => RecipeIngredient | null;
  /** Appends a pasted block. Returns how many were new. */
  addIngredientsFromText: (recipeId: string, raw: string) => number;
  /**
   * Merges already-structured ingredients — e.g. from AI recipe extraction —
   * bypassing makeIngredient's text parse, since these already arrived as
   * name/quantity/aisle. Returns how many were new.
   */
  addStructuredIngredients: (recipeId: string, ingredients: RecipeIngredient[]) => number;
  updateIngredient: (recipeId: string, ingredientId: string, patch: Partial<RecipeIngredient>) => void;
  removeIngredient: (recipeId: string, ingredientId: string) => void;
  reorderIngredients: (recipeId: string, ids: string[]) => void;

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
  addComponent: (recipeId: string, componentRecipeId: string) => boolean;
  /** Unlinks by the component's own id, so a broken link can be cleared too. */
  removeComponent: (recipeId: string, componentId: string) => void;

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
      servings: null,
      servingsMax: null,
      recipeYield: null,
      imagePath: null,
      mealType: null,
      ingredients: [],
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

  markCooked(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    save(set, { ...recipe, cookCount: recipe.cookCount + 1, lastCookedAt: new Date().toISOString() });
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

  addIngredient(recipeId, line) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return null;
    const ingredient = makeIngredient(line);
    if (!ingredient) return null;
    const merged = mergeIngredients(recipe.ingredients, [ingredient]);
    if (merged.length === recipe.ingredients.length) return null;
    save(set, { ...recipe, ingredients: merged });
    return ingredient;
  },

  addIngredientsFromText(recipeId, raw) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return 0;
    const merged = mergeIngredients(recipe.ingredients, ingredientsFromText(raw));
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

  removeIngredient(recipeId, ingredientId) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const ingredients = recipe.ingredients.filter(i => i.id !== ingredientId);
    if (ingredients.length === recipe.ingredients.length) return;
    save(set, { ...recipe, ingredients });
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
    save(set, { ...recipe, ingredients: [...ordered, ...rest] });
  },

  addComponent(recipeId, componentRecipeId) {
    const recipes = get().recipes;
    const recipe = recipes.find(r => r.id === recipeId);
    const target = recipes.find(r => r.id === componentRecipeId);
    if (!recipe || !target) return false;
    if (recipe.components.some(c => c.recipeId === componentRecipeId)) return false;
    if (wouldCreateRecipeCycle(recipeMap(recipes), recipeId, componentRecipeId)) return false;
    save(set, { ...recipe, components: [...recipe.components, makeComponent(target)] });
    return true;
  },

  removeComponent(recipeId, componentId) {
    const recipe = get().recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const components = recipe.components.filter(c => c.id !== componentId);
    if (components.length === recipe.components.length) return;
    save(set, { ...recipe, components });
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
 */
function save(set: SetRecipes, recipe: Recipe): void {
  dbUpdateRecipe(recipe);
  set(s => ({ recipes: s.recipes.map(r => (r.id === recipe.id ? recipe : r)) }));
}
