import type { FoodLogEntry, FoodNutrition, Leftover, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { groceryNameKey } from './groceryParse';
import { helpingNutrition } from './foodLog';
import { recalledHelping, recallFoods } from './foodRecall';
import { weighedHelping, type DishFigures } from './mealLog';

/**
 * What logging a container from the fridge writes, and where the figures came
 * from. Pure: the recipe's dish figures and the earlier entries are handed in,
 * since reading them reaches the stores (`recipeNutrition` is not pure).
 *
 * **Three sources, most specific first, and a container with none is `null`
 * rather than a guess.** The caller then asks (an estimate, or the recipe's own
 * prompt) instead of logging a food with no figures under a name that reads as
 * though it had them.
 *
 *  1. `container`: a panel stored on the container (`Leftover.nutrition`), set
 *     when it was put away or on its first log. It describes the whole
 *     container, so it is logged as one helping.
 *  2. `recipe`: the recipe's rollup scaled to what the container weighs. Needs
 *     a weight and the dish's cooked weight; a recipe-backed container with
 *     neither goes to the recipe's own servings prompt instead.
 *  3. `earlier`: the helping logged last time under the same name, verbatim.
 *     An exact name match only, not the fuzzy one a search uses, because a
 *     container borrowing another food's figures is a claim.
 */
export type ContainerFiguresSource = 'container' | 'recipe' | 'earlier';

export interface ContainerFigures {
  nutrition: FoodNutrition;
  /** What it weighs, when that is known. */
  grams: number | null;
  /** The amount as the entry reads it ("whole container", "412 g"). */
  quantity: string;
  source: ContainerFiguresSource;
}

export interface ContainerFiguresInput {
  leftover: Pick<Leftover, 'title' | 'recipeId' | 'weightG' | 'nutrition'>;
  /** The recipe's dish at the scale it was cooked, when it resolves. */
  dish: DishFigures | null;
  entries: readonly FoodLogEntry[];
  now: Date;
}

export function containerFigures({ leftover, dish, entries, now }: ContainerFiguresInput): ContainerFigures | null {
  if (leftover.nutrition) {
    return {
      nutrition: leftover.nutrition,
      grams: leftover.weightG,
      quantity: leftover.nutrition.servingText || 'whole container',
      source: 'container',
    };
  }

  if (leftover.recipeId && dish && leftover.weightG) {
    // A container heavier than the whole dish is a wrong weight, not a bigger
    // dish: refused here so the recipe's prompt asks instead.
    const helping = weighedHelping(dish, leftover.weightG);
    if (helping) {
      const nutrition = helpingNutrition(helping.amounts, helping.servingText, helping.grams, 'estimated', now);
      if (nutrition) {
        return { nutrition, grams: helping.grams, quantity: helping.servingText, source: 'recipe' };
      }
    }
  }

  const key = groceryNameKey(leftover.title);
  const food = key ? recallFoods(entries, leftover.title, 1)[0] : undefined;
  if (food && food.key === key) {
    const helping = recalledHelping(food, null, now);
    if (helping) {
      return { nutrition: helping.nutrition, grams: helping.grams, quantity: helping.quantity, source: 'earlier' };
    }
  }
  return null;
}

/**
 * A container's panel from typed amounts, for a tool or a form. One panel for
 * the whole container, so `perServing` with the container as the serving.
 * Null when there is no figure in it: absent is unknown, never zero.
 * Throws on a nutrient the app does not keep or a figure that is not a number,
 * so a typo is refused rather than dropped.
 */
export function containerPanelFromAmounts(
  amounts: Record<string, number>,
  opts: { estimated?: boolean; servingText?: string | null; grams?: number | null; now?: Date } = {},
): FoodNutrition | null {
  const keys = NUTRIENT_KEYS as readonly string[];
  const clean: Partial<Record<NutrientKey, number>> = {};
  for (const [k, v] of Object.entries(amounts)) {
    if (!keys.includes(k)) throw new Error(`"${k}" isn't a nutrient the app keeps. They are ${keys.join(', ')}.`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${k} must be a number, 0 or more.`);
    clean[k as NutrientKey] = v;
  }
  return helpingNutrition(
    clean,
    opts.servingText?.trim() || 'whole container',
    opts.grams && opts.grams > 0 ? opts.grams : null,
    opts.estimated === false ? 'manual' : 'estimated',
    opts.now ?? new Date(),
  );
}

/**
 * The live containers a search shows, newest-useful first as the store keeps
 * them: every one with nothing typed, and those whose name holds a word of the
 * search with something typed. Same name key as every other name match.
 */
export function fridgeMatches<T extends Pick<Leftover, 'title'>>(containers: readonly T[], query: string): T[] {
  const key = groceryNameKey(query);
  if (!key) return [...containers];
  const words = key.split(' ');
  return containers.filter(c => {
    const name = groceryNameKey(c.title);
    return words.every(w => name.includes(w));
  });
}
