import { useCallback, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import type { Recipe } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { recipeMap } from '../utils/recipeComponents';
import { standingSwapMap } from '../utils/standingSwaps';
import { overlapSeedFromRecipes, rankOverlapRecipes, type OverlapMatch } from '../utils/recipeOverlap';
import { haptics } from '../utils/haptics';

/** What the sheet needs, captured at open. Null means closed. */
export interface OverlapPickerState {
  matches: OverlapMatch[];
  seedLabel: string;
}

/**
 * "Cook something with this", from a screen that has a recipe but no week.
 *
 * The recipe-side entry points (a recipe's own page, and a row in the recipe
 * list) can rank overlaps perfectly well, and can't plan them: the open nights
 * live in `useMealPlanStore`, which is range-scoped, so asking it here would
 * silently move the window the meal plan is showing. So `handOff` navigates
 * with the picked ids and MealPlanScreen opens the same sheet against its own
 * visible week — one owner of what's open, rather than two disagreeing.
 *
 * Shared rather than copied because both entry points need the identical
 * ranking, the identical snapshot rule and the identical navigation payload,
 * which is the same reason `usePlanMeal` exists.
 */
export function useOverlapPicker() {
  const navigation = useNavigation<any>();
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const [state, setState] = useState<OverlapPickerState | null>(null);

  const recipesById = useMemo(() => recipeMap(recipes), [recipes]);
  const standingSwaps = useMemo(
    () => standingSwapMap(itemSubs, groceryItems),
    [itemSubs, groceryItems]
  );

  /**
   * Rank once, here, and hand the sheet a snapshot — the ranking must not
   * resort under the finger picking from it.
   */
  const open = useCallback((seed: Recipe) => {
    haptics.tap();
    setState({
      matches: rankOverlapRecipes(
        overlapSeedFromRecipes([seed], recipesById, groceryItems, standingSwaps),
        recipes,
        recipesById,
        groceryItems,
        standingSwaps
      ),
      seedLabel: seed.name,
    });
  }, [recipes, recipesById, groceryItems, standingSwaps]);

  const close = useCallback(() => setState(null), []);

  const handOff = useCallback((recipeIds: string[]) => {
    setState(null);
    // Stamped, so carrying the same picks over twice still opens the sheet —
    // the idiom MealPlanScreen's `focusStamp` already uses.
    navigation.navigate('MealPlan', { overlapRecipeIds: recipeIds, overlapStamp: Date.now() });
  }, [navigation]);

  return { overlap: state, openOverlap: open, closeOverlap: close, handOffOverlap: handOff };
}
