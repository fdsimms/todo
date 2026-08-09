import { create } from 'zustand';
import type { Recipe, RecipeIngredient } from '../types';
import {
  dbGetAllRecipes,
  dbInsertRecipe,
  dbUpdateRecipe,
  dbDeleteRecipe,
} from '../db/database';
import { generateId } from '../utils/id';
import { groceryNameKey } from '../utils/groceryParse';
import {
  cleanRecipeName,
  cleanRecipeSource,
  ingredientsFromText,
  makeIngredient,
  mergeIngredients,
  remapIngredientKeyIn,
} from '../utils/recipeUtils';

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
  setSourceName: (id: string, source: string | null) => void;
  setServings: (id: string, servings: number | null) => void;
  toggleFavorite: (id: string) => void;
  deleteRecipe: (id: string) => void;

  /** Appends one typed line. Null when it parses to nothing or is already there. */
  addIngredient: (recipeId: string, line: string) => RecipeIngredient | null;
  /** Appends a pasted block. Returns how many were new. */
  addIngredientsFromText: (recipeId: string, raw: string) => number;
  updateIngredient: (recipeId: string, ingredientId: string, patch: Partial<RecipeIngredient>) => void;
  removeIngredient: (recipeId: string, ingredientId: string) => void;
  reorderIngredients: (recipeId: string, ids: string[]) => void;

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
      servings: null,
      ingredients: [],
      favorite: false,
      sortOrder: maxOrder + 1,
      createdAt: new Date().toISOString(),
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

  setServings(id, servings) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    // Clamped rather than validated at the call site: the stepper can't
    // overshoot, but a restored backup can carry anything.
    const next = servings === null ? null : Math.max(1, Math.min(99, Math.round(servings)));
    save(set, { ...recipe, servings: next });
  },

  toggleFavorite(id) {
    const recipe = get().recipes.find(r => r.id === id);
    if (!recipe) return;
    save(set, { ...recipe, favorite: !recipe.favorite });
  },

  deleteRecipe(id) {
    dbDeleteRecipe(id);
    set(s => ({ recipes: s.recipes.filter(r => r.id !== id) }));
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
