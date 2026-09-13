import { create } from 'zustand';
import type { FoodLogEntry, MealSlot, SavedMeal, SavedMealItem } from '../types';
import { dbDeleteSavedMeal, dbGetSavedMeals, dbInsertSavedMeal } from '../db/database';
import { generateId } from '../utils/id';
import { useFoodLogStore } from './useFoodLogStore';

/**
 * Saved meals — several food log entries bundled under a name so the whole
 * combination can be logged again in one tap. See `SavedMeal` in
 * `types/index.ts` for why this is its own lightweight shape rather than a
 * trimmed `Recipe`.
 *
 * A thin CRUD store, same reasoning `useTemplateCategoryStore` is thin for:
 * there is no window to page through and no branching logic of its own — it
 * reads the whole table once and writes straight through. `logMeal` is the
 * one action with any behavior, and what it does is call `useFoodLogStore`'s
 * own `addEntry` once per item, which is deliberate: a saved meal has no
 * write path of its own into the log, it just replays the ordinary one N
 * times.
 */
interface SavedMealsStore {
  meals: SavedMeal[];
  initialized: boolean;
  initialize: () => void;
  /** Bundles the given entries into a new saved meal — the bulk bar's "Save as meal". */
  addFromEntries: (name: string, entries: FoodLogEntry[]) => SavedMeal | null;
  /**
   * The same write `addFromEntries` makes, taking already-built items rather
   * than logged entries — for the one caller with no entries to bundle:
   * `demoSeed.ts`, building a saved meal straight from catalog panels the way
   * every other seeded row is built, without first writing (and then having
   * to account for) throwaway food log entries just to read their shape back.
   */
  addMeal: (name: string, items: SavedMealItem[]) => SavedMeal | null;
  removeMeal: (id: string) => void;
  /**
   * Logs every item in a saved meal, at the given moment and meal slot.
   *
   * Each item becomes its own new `FoodLogEntry` — the same rows re-picking
   * each food one at a time would have produced, just without re-finding or
   * re-amounting any of them. Skips whatever `addEntry` itself refuses (an
   * item with no figures can't exist here, since `dbGetSavedMeals` already
   * dropped it on read, but the check costs nothing to keep in step with it).
   */
  logMeal: (meal: SavedMeal, slot: MealSlot | null, at: Date) => FoodLogEntry[];
}

export const useSavedMealsStore = create<SavedMealsStore>((set, get) => ({
  meals: [],
  initialized: false,

  initialize() {
    set({ meals: dbGetSavedMeals(), initialized: true });
  },

  addFromEntries(name, entries) {
    if (entries.length === 0) return null;
    return get().addMeal(name, entries.map(e => ({
      label: e.label,
      recipeId: e.recipeId,
      itemId: e.itemId,
      productId: e.productId,
      quantity: e.quantity,
      grams: e.grams,
      nutrition: e.nutrition,
    })));
  },

  addMeal(name, items) {
    const trimmed = name.trim();
    // Same refusal addEntry itself makes for a blank label: a meal nobody
    // could tell apart from another blank one is worth nothing saved.
    if (!trimmed || items.length === 0) return null;

    const meal: SavedMeal = {
      id: generateId(),
      name: trimmed,
      items,
      createdAt: new Date().toISOString(),
    };
    dbInsertSavedMeal(meal);
    set(s => ({ meals: [meal, ...s.meals] }));
    return meal;
  },

  removeMeal(id) {
    dbDeleteSavedMeal(id);
    set(s => ({ meals: s.meals.filter(m => m.id !== id) }));
  },

  logMeal(meal, slot, at) {
    const addEntry = useFoodLogStore.getState().addEntry;
    const written: FoodLogEntry[] = [];
    for (const item of meal.items) {
      const entry = addEntry({
        label: item.label,
        quantity: item.quantity,
        grams: item.grams,
        nutrition: item.nutrition,
        slot,
        recipeId: item.recipeId,
        itemId: item.itemId,
        productId: item.productId,
        at,
      });
      if (entry) written.push(entry);
    }
    return written;
  },
}));
