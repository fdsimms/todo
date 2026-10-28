import { inflectUnit, parseQuantity, rationalToNumber, unitKey } from './quantity';

/**
 * An amount picked as a number and a unit from a menu, read from and written
 * back to the quantity string every reader already parses ("2 cloves",
 * "3/4 cup", "1/4"). `AmountUnitField` is the one control over it.
 *
 * Free text let an amount be typed that the arithmetic behind it (scaling,
 * conversion, nutrition, a substitute's ratio) couldn't read, with nothing on
 * screen to say so. A menu can't be mistyped. It can't hold everything either
 * ("1 14 oz can", "2-3", "to taste"), so it ends in "Something else", which
 * hands back the plain text field, and a saved amount the menu can't read back
 * opens there as written rather than being reshaped.
 */

/** No unit at all: "2" eggs, where the name is the thing counted. */
export const NO_UNIT = 'none';
/** "Something else": the amount is typed whole, as free text. */
export const OTHER_UNIT = 'other';

export interface AmountUnitGroup {
  heading: string | null;
  /** The menu's keys, which are also the unit words written ("tbsp", "clove"). */
  units: string[];
}

export const VOLUME_UNITS = ['tsp', 'tbsp', 'fl oz', 'cup', 'pint', 'quart', 'ml', 'liter'];
export const WEIGHT_UNITS = ['g', 'kg', 'oz', 'lb'];
/** The counted units a recipe line is most often written in. Each inflects ("2 cloves"). */
export const COUNT_UNITS = ['clove', 'can', 'slice', 'bunch', 'head', 'sprig', 'stalk', 'stick', 'jar', 'package'];

/** The menu for an ingredient-like amount: none, volume, weight, counts, then "Something else". */
export function ingredientAmountGroups(): AmountUnitGroup[] {
  return [
    { heading: null, units: [NO_UNIT] },
    { heading: 'VOLUME', units: [...VOLUME_UNITS] },
    { heading: 'WEIGHT', units: [...WEIGHT_UNITS] },
    { heading: 'COUNT', units: [...COUNT_UNITS] },
    { heading: null, units: [OTHER_UNIT] },
  ];
}

/** What the menu shows for a key. */
export function amountUnitLabel(unit: string): string {
  if (unit === NO_UNIT) return 'No unit';
  if (unit === OTHER_UNIT) return 'Something else';
  return unit;
}

/**
 * A saved amount as the menu holds it: a number and one of `units`, or the
 * whole text under "Something else" when the menu can't hold it (or nothing,
 * when the menu has no "Something else"). Empty reads as an empty number with
 * no unit.
 */
export function readAmount(text: string, units: readonly string[]): { number: string; unit: string } {
  const trimmed = text.trim();
  if (!trimmed) return { number: '', unit: units.includes(NO_UNIT) ? NO_UNIT : units[0] };
  const q = parseQuantity(trimmed);
  // A menu without "Something else" (what a used recipe makes, which has to
  // compare) starts empty rather than writing a unit after text it can't hold.
  const other = units.includes(OTHER_UNIT) ? { number: trimmed, unit: OTHER_UNIT } : { number: '', unit: units[0] };
  if (q.amount === null || q.container || q.trailing.trim()) return other;
  if (!q.unit) {
    // "3", or a range of a count, "2-3": the name is the thing counted.
    const bare = !q.rest || (q.rangeMax !== null && !q.trailing.trim());
    return bare && units.includes(NO_UNIT) ? { number: trimmed, unit: NO_UNIT } : other;
  }
  const unit = units.find(u => u !== NO_UNIT && u !== OTHER_UNIT && menuKey(u) === menuKey(q.unit!));
  if (!unit || !q.unitWritten) return other;
  // Everything ahead of the unit word, so a range ("2-3 tbsp") keeps both ends.
  const at = trimmed.toLowerCase().lastIndexOf(q.unitWritten.toLowerCase());
  return { number: trimmed.slice(0, at).trim(), unit };
}

/**
 * The long spellings a recipe, an import or the model writes, read as the menu
 * entry they mean, so "2 tablespoons" opens on tbsp rather than under
 * "Something else". Only how it's read: an amount is rewritten in the menu's
 * spelling only once someone edits it.
 */
const SPELLINGS: Record<string, string> = {
  teaspoon: 'tsp', t: 'tsp', tablespoon: 'tbsp', T: 'tbsp', c: 'cup', pt: 'pint', qt: 'quart',
  milliliter: 'ml', millilitre: 'ml', l: 'liter', litre: 'liter',
  gram: 'g', kilogram: 'kg', ounce: 'oz', pound: 'lb',
};

function menuKey(unit: string): string {
  const key = unitKey(unit);
  return SPELLINGS[key] ?? key;
}

/**
 * The quantity string a number and a unit write, or '' for no number. A count
 * inflects for its amount ("2 cloves", "1 clove"); "Something else" writes the
 * typed text as it is.
 */
export function writeAmount(number: string, unit: string): string {
  const text = number.trim();
  if (!text) return '';
  if (unit === OTHER_UNIT || unit === NO_UNIT) return text;
  const q = parseQuantity(text);
  const value = q.amount ? rationalToNumber(q.rangeMax ?? q.amount) : 1;
  return `${text} ${inflectUnit(unit, value)}`;
}
