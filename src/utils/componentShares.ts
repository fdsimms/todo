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

/**
 * The unit "Amount used" picks for a share of the whole batch: the amount is
 * then a bare number, "1/4", which `fractionOf` reads as a quarter of it and
 * needs no yield to compare with.
 */
export const BATCH_UNIT = 'of the batch';

const AMOUNT_GROUPS = [
  { heading: 'VOLUME', units: ['tsp', 'tbsp', 'fl oz', 'cup', 'pint', 'quart', 'ml', 'liter'] },
  { heading: 'WEIGHT', units: ['g', 'kg', 'oz', 'lb'] },
];

/**
 * The units "Amount used" is picked in: a share of the batch, every volume and
 * weight, and the used recipe's own count word when its yield is a count
 * ("4 fillets" offers "fillets"), which is the only count it compares with.
 * Starts on the share when the part says nothing about what it makes, and on
 * a unit of its yield's own kind when it does.
 */
export function amountUnitsFor(part: Recipe | null): MakesUnits {
  const yieldText = part?.recipeYield?.trim() ?? '';
  const measured = yieldText ? measureQuantity(yieldText) : null;
  const q = yieldText ? parseQuantity(yieldText) : null;
  const countWord = !measured && q?.amount !== null && q?.unitWritten ? q.unitWritten : null;
  const groups = [
    { heading: null, units: [BATCH_UNIT] },
    ...AMOUNT_GROUPS.map(g => ({ heading: g.heading, units: [...g.units] })),
    ...(countWord ? [{ heading: 'COUNT', units: [countWord] }] : []),
  ];
  const defaultUnit = measured?.dimension === 'volume' ? (measured.system === 'metric' ? 'ml' : 'tbsp')
    : measured?.dimension === 'mass' ? (measured.system === 'metric' ? 'g' : 'oz')
    : countWord ?? BATCH_UNIT;
  return { groups, units: groups.flatMap(g => g.units), defaultUnit };
}

/** A saved "Amount used" read back as a number and one of `units`, or null when it isn't one. */
export function splitAmountUsed(amountUsed: string | null, units: readonly string[]): { number: string; unit: string } | null {
  const text = amountUsed?.trim() ?? '';
  const q = parseQuantity(text);
  if (q.amount !== null && q.unit === null && !q.rest && units.includes(BATCH_UNIT)) return { number: text, unit: BATCH_UNIT };
  return splitMakes(text, units.filter(u => u !== BATCH_UNIT));
}

/** The "Amount used" a number and a unit write, or null for a number that isn't one. */
export function amountUsedText(number: string, unit: string): string | null {
  const text = makesText(number, unit);
  return text && unit === BATCH_UNIT ? number.trim() : text;
}
