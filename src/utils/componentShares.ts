import type { Recipe, RecipeComponent } from '../types';
import { activeComponents, type ChoiceResolution } from './recipeComponents';
import { groceryNameKey } from './groceryParse';
import { parseQuantity, rationalToNumber } from './quantity';
import { measureQuantity } from './unitConvert';

/**
 * How much of each used recipe a dish actually eats, as a fraction of the
 * batch the part's own recipe makes, keyed by that recipe's id. A recipe not
 * in the map counts whole.
 *
 * A used recipe's lines are flattened in whole, so "1 tbsp Fishy Seasoning"
 * charged the dish for the entire 3/4 cup batch. The amount comes from the
 * link's own `amountUsed` when one was typed ("1 tbsp", "2 fillets", or a
 * bare "1/4" for a quarter of the batch), else from the parent's own
 * ingredient line naming the part. It is only believed when it can be
 * compared with the part's `recipeYield`: both measured in one dimension, or
 * both counting the same unit. Anything else (no amount, no yield, "to taste",
 * mismatched units) counts whole, as it always did, and `amountUsedCounts`
 * is how a screen says so. Shares compound down a chain of parts. A recipe's
 * `cookedWeightG` is not consulted: a line in tablespoons has no weight until
 * the part's own panel is worked out.
 *
 * Walks only the links this cooking keeps (`activeComponents`), the same ones
 * `flattenRecipeIngredients` emits lines through. A part both sides of an
 * either/or use was otherwise counted at the share of whichever link came
 * first in the list, picked or not.
 */
export function componentShares(
  root: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  resolution?: ChoiceResolution,
): Map<string, number> {
  const shares = new Map<string, number>();
  const visited = new Set<string>([root.id]);
  const walk = (node: Recipe, share: number): void => {
    for (const component of activeComponents(node, resolution)) {
      if (visited.has(component.recipeId)) continue;
      const part = recipesById.get(component.recipeId);
      if (!part) continue;
      visited.add(part.id);
      const used = usedFraction(node, component, part);
      const partShare = share * (used ?? 1);
      if (partShare !== 1) shares.set(part.id, partShare);
      walk(part, partShare);
    }
  };
  walk(root, 1);
  return shares;
}

/** `amount` as a fraction of `yielded`, or null when the two cannot be compared. */
function fractionOf(amount: string, yielded: string | null): number | null {
  const q = parseQuantity(amount);
  if (!q.amount) return null;
  const used = rationalToNumber(q.amount);
  if (!(used > 0)) return null;
  // A bare number is a number of batches: "1/4" is a quarter of it.
  if (q.unit === null && q.rest === '') return used;
  if (!yielded) return null;
  const a = measureQuantity(amount);
  const y = measureQuantity(yielded);
  if (a && y) return a.dimension === y.dimension && y.base > 0 ? a.base / y.base : null;
  // Counts of one thing: "2 fillets" of "4 fillets".
  const yq = parseQuantity(yielded);
  if (q.unit && yq.amount && yq.unit === q.unit) {
    const total = rationalToNumber(yq.amount);
    return total > 0 ? used / total : null;
  }
  return null;
}

function usedFraction(parent: Recipe, component: RecipeComponent, part: Recipe): number | null {
  if (component.amountUsed) return fractionOf(component.amountUsed, part.recipeYield);
  if (!part.recipeYield) return null;
  const line = parent.ingredients.find(i => i.nameKey === groceryNameKey(part.name));
  return line ? fractionOf(line.quantity, part.recipeYield) : null;
}

/**
 * Whether a typed "Amount used" is one `componentShares` can apply: false when
 * it was typed and can't be compared with what the used recipe makes, so the
 * whole batch is counted instead. True with nothing typed (nothing to drop).
 * The screens that take the amount read this, so the input is never silently
 * ignored. `recipeYield` reads a yield being typed in place of the stored one.
 */
export function amountUsedCounts(
  amount: string,
  part: Recipe | null,
  recipeYield: string | null = part?.recipeYield ?? null,
): boolean {
  if (!amount.trim()) return true;
  if (!part) return false;
  return fractionOf(amount, recipeYield?.trim() || null) !== null;
}

/** The units "makes" is offered in, for an amount measured in each dimension. */
const MAKES_UNITS = {
  volume: ['tsp', 'tbsp', 'cup', 'ml', 'l'],
  mass: ['g', 'kg', 'oz', 'lb'],
} as const;

/**
 * The units a used recipe's "makes" can be picked in so it compares with
 * `amount`, and the one to start on, or null when the amount names no unit
 * to compare (a bare "1/4" needs no yield; "a pinch" can't be measured). Only
 * units of the amount's own dimension are offered, so a filled-in answer always
 * counts. A count ("2 fillets") offers just its own word, written as the
 * amount wrote it, since that is the only thing it compares with.
 */
export function makesUnitsFor(amount: string): { units: string[]; defaultUnit: string } | null {
  const q = parseQuantity(amount);
  if (q.amount === null || !q.unitWritten) return null;
  const measured = measureQuantity(amount);
  if (measured?.dimension === 'volume') {
    return { units: [...MAKES_UNITS.volume], defaultUnit: q.unit === 'ml' || q.unit === 'l' ? 'ml' : 'cup' };
  }
  if (measured?.dimension === 'mass') {
    return { units: [...MAKES_UNITS.mass], defaultUnit: q.unit === 'g' || q.unit === 'kg' ? 'g' : 'oz' };
  }
  if (measured) return null;
  return { units: [q.unitWritten], defaultUnit: q.unitWritten };
}

/** A saved yield read back as a number and one of `units`, or null when it isn't one. */
export function splitMakes(recipeYield: string | null, units: readonly string[]): { number: string; unit: string } | null {
  const text = recipeYield?.trim() ?? '';
  const q = parseQuantity(text);
  if (q.amount === null || !q.unit || q.trailing.trim()) return null;
  const unit = units.find(u => parseQuantity(`1 ${u}`).unit === q.unit);
  if (!unit) return null;
  return { number: text.slice(0, text.length - q.rest.length).trim(), unit };
}

/** The yield a number and a unit write, or null for a number that isn't one. */
export function makesText(number: string, unit: string): string | null {
  const q = parseQuantity(number.trim());
  if (q.amount === null || q.rest || !(rationalToNumber(q.amount) > 0)) return null;
  return `${number.trim()} ${unit}`;
}
