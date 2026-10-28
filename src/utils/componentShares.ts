import type { Recipe, RecipeComponent } from '../types';
import { activeComponents, type ChoiceResolution } from './recipeComponents';
import { groceryNameKey } from './groceryParse';
import { parseQuantity, rationalToNumber } from './quantity';
import { measureQuantity } from './unitConvert';
import { NO_UNIT, OTHER_UNIT, VOLUME_UNITS, WEIGHT_UNITS } from './amountUnit';

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

/** The units "makes" is offered in, grouped by system, for an amount measured in each dimension. */
const MAKES_UNITS = {
  volume: [
    { heading: 'US', units: ['tsp', 'tbsp', 'fl oz', 'cup', 'pint', 'quart'] },
    { heading: 'METRIC', units: ['ml', 'liter'] },
  ],
  mass: [
    { heading: 'METRIC', units: ['g', 'kg'] },
    { heading: 'US', units: ['oz', 'lb'] },
  ],
} as const;

export interface MakesUnits {
  /** For the menu; a count's one word has no heading and needs no menu. */
  groups: { heading: string | null; units: string[] }[];
  units: string[];
  defaultUnit: string;
}

/**
 * The units a used recipe's "makes" can be picked in so it compares with
 * `amount`, and the one to start on, or null when the amount names no unit
 * to compare (a bare "1/4" needs no yield; "a pinch" can't be measured). Only
 * units of the amount's own dimension are offered, so a filled-in answer always
 * counts. A count ("2 fillets") offers just its own word, written as the
 * amount wrote it, since that is the only thing it compares with.
 */
export function makesUnitsFor(amount: string): MakesUnits | null {
  const q = parseQuantity(amount);
  if (q.amount === null || !q.unitWritten) return null;
  const measured = measureQuantity(amount);
  const of = (groups: readonly { heading: string; units: readonly string[] }[], defaultUnit: string): MakesUnits => ({
    groups: groups.map(g => ({ heading: g.heading, units: [...g.units] })),
    units: groups.flatMap(g => g.units),
    defaultUnit,
  });
  if (measured?.dimension === 'volume') return of(MAKES_UNITS.volume, measured.system === 'metric' ? 'ml' : 'cup');
  if (measured?.dimension === 'mass') return of(MAKES_UNITS.mass, measured.system === 'metric' ? 'g' : 'oz');
  if (measured) return null;
  return { groups: [{ heading: null, units: [q.unitWritten] }], units: [q.unitWritten], defaultUnit: q.unitWritten };
}

/** What "Amount used" calls a bare number: a share of everything the used recipe makes. */
export const BATCH_LABEL = 'of the batch';

/**
 * The units "Amount used" is picked in, for `AmountUnitField`: a share of the
 * batch (`NO_UNIT`, a bare "1/4" that `fractionOf` reads as a quarter of it,
 * labelled `BATCH_LABEL`), every volume and weight, the used recipe's own count
 * word when its yield is a count ("4 fillets" offers "fillets"), which is the
 * only count it compares with, and "Something else" for an amount saved before
 * the menu existed. Starts on the share when the part says nothing about what it
 * makes, and on a unit of its yield's own kind when it does.
 */
export function amountUnitsFor(part: Recipe | null): MakesUnits {
  const yieldText = part?.recipeYield?.trim() ?? '';
  const measured = yieldText ? measureQuantity(yieldText) : null;
  const q = yieldText ? parseQuantity(yieldText) : null;
  const countWord = !measured && q?.amount !== null && q?.unitWritten ? q.unitWritten : null;
  const groups = [
    { heading: null, units: [NO_UNIT] },
    { heading: 'VOLUME', units: [...VOLUME_UNITS] },
    { heading: 'WEIGHT', units: [...WEIGHT_UNITS] },
    ...(countWord ? [{ heading: 'COUNT', units: [countWord] }] : []),
    { heading: null, units: [OTHER_UNIT] },
  ];
  const defaultUnit = measured?.dimension === 'volume' ? (measured.system === 'metric' ? 'ml' : 'tbsp')
    : measured?.dimension === 'mass' ? (measured.system === 'metric' ? 'g' : 'oz')
    : countWord ?? NO_UNIT;
  return { groups, units: groups.flatMap(g => g.units), defaultUnit };
}
