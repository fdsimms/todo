import type { FoodLogEntry, FoodNutrition, NutrientKey } from '../types';

/**
 * Alcohol, counted in standard drinks.
 *
 * **The record holds grams of pure ethanol (`alcoholG`) and everything a person
 * reads is drinks.** Grams are the one figure every source can state (a
 * database row, a model's estimate, a label's ABV and volume), and a drink is
 * what somebody actually thinks in. The conversion is the only thing in this
 * file, which is why it is here rather than in each screen: a count worked out
 * twice with two different drink sizes is a total that disagrees with its own
 * entries.
 */

/** A US standard drink, in grams of ethanol. */
export const US_STANDARD_DRINK_G = 14;

/** What the person chooses between. The label is the country whose size it is. */
export const STANDARD_DRINK_SIZES: ReadonlyArray<{ grams: number; label: string }> = [
  { grams: 14, label: 'US' },
  { grams: 10, label: 'Australia' },
  { grams: 8, label: 'UK' },
];

/**
 * The size the person's figures are shown in, for text built far from any
 * component (a limit's "2 drinks left", the widget, a warning task).
 *
 * A module-level value rather than a parameter on every one of those
 * functions: a limit's wording is assembled in five places that have no store
 * to read, and threading the size through all of them is how one of them ends
 * up still saying grams. The settings store is the only writer
 * (`setStandardDrinkGrams` and its load), so this never disagrees with the
 * setting; a test that changes it puts it back.
 */
let displayDrinkGrams = US_STANDARD_DRINK_G;

export function setDisplayDrinkGrams(grams: number): void {
  displayDrinkGrams = normalizeStandardDrinkGrams(grams);
}

export function getDisplayDrinkGrams(): number {
  return displayDrinkGrams;
}

/** A stored size that is not one of the choices reads as the US one. */
export function normalizeStandardDrinkGrams(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return STANDARD_DRINK_SIZES.some(s => s.grams === n) ? (n as number) : US_STANDARD_DRINK_G;
}

/**
 * The drink types the entry form offers when nothing knows what was drunk.
 * Each is a count of standard drinks, in the US size every one of them is
 * defined against (a 12 oz beer, a 5 oz glass of wine, a 1.5 oz shot), so the
 * count does not move when the person's own drink size does: it is how many
 * drinks, and the size only decides how many grams that is.
 *
 * "Pint" and "Big pour" are rounded up on purpose. A pint of beer is about 1.3
 * and a restaurant's wine pour about 1.5 to 2, and a figure that errs low is
 * the worse mistake for a person who is watching their intake.
 */
export const DRINK_PRESETS: ReadonlyArray<{ key: string; label: string; drinks: number }> = [
  { key: 'beer', label: 'Beer', drinks: 1 },
  { key: 'wine', label: 'Wine', drinks: 1 },
  { key: 'spirits', label: 'Spirits', drinks: 1 },
  { key: 'cocktail', label: 'Cocktail', drinks: 1.5 },
  { key: 'pint', label: 'Pint', drinks: 1.5 },
  { key: 'bigPour', label: 'Big pour', drinks: 2 },
];

/** The smallest step of the form's stepper, in drinks. */
export const DRINK_STEP = 0.5;

/** The most one entry can state, in drinks. A bottle of wine is about five. */
export const MAX_ENTRY_DRINKS = 20;

/** Grams of ethanol in `drinks` drinks of the person's size. Rounded to a tenth of a gram. */
export function gramsFromDrinks(drinks: number, drinkGrams: number): number {
  return Math.round(drinks * drinkGrams * 10) / 10;
}

/** Drinks in `grams` of ethanol at the person's size. Not rounded. */
export function drinksFromGrams(grams: number, drinkGrams: number): number {
  return grams / drinkGrams;
}

/** `1`, `1.5`, `0.3`: a tenth of a drink, with no trailing `.0`. */
function tenths(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "1 drink", "1.5 drinks", "0.3 drinks". Zero reads as "No drinks". */
export function describeDrinks(grams: number, drinkGrams: number): string {
  const drinks = drinksFromGrams(grams, drinkGrams);
  if (!(drinks > 0)) return 'No drinks';
  const text = tenths(drinks);
  return text === '1' ? '1 drink' : `${text} drinks`;
}

/** The grams as the second line under a drinks figure: "14 g of alcohol". */
export function describeAlcoholGrams(grams: number): string {
  return `${Math.round(grams * 10) / 10} g of alcohol`;
}

/**
 * The alcohol an entry states, in grams, or 0.
 *
 * Zero is not "unknown" here and doesn't need to be kept apart: nothing sums an
 * absent alcohol figure into a comparison (it is not in
 * `NUTRIENT_INSIGHT_KEYS`), so for a drinks total a missing figure and a stated
 * zero read the same, which is no drinks.
 */
export function alcoholGramsOf(nutrition: FoodNutrition | null | undefined): number {
  const value = nutrition?.amounts.alcoholG;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A day's alcohol, in grams, over every entry the day holds. */
export function dayAlcoholGrams(entries: readonly FoodLogEntry[]): number {
  let total = 0;
  for (const entry of entries) total += alcoholGramsOf(entry.nutrition);
  return Math.round(total * 10) / 10;
}

/**
 * What Apple Health is told, as a count of drinks. **Always the US size**,
 * whatever the person chose to display, because the Health type is "standard
 * drinks" as Apple defines one (a beer, a glass of wine or a mixed drink) and
 * has no way to carry a size. Rounded to two places so a half drink stays one.
 */
export function healthDrinkCount(grams: number): number {
  return Math.round((grams / US_STANDARD_DRINK_G) * 100) / 100;
}

/**
 * The preset whose drinks count matches, for the form to highlight, or null
 * when the stepper has been moved off every one of them.
 */
export function presetForDrinks(drinks: number): string | null {
  return DRINK_PRESETS.find(p => p.drinks === drinks)?.key ?? null;
}

/**
 * Drops a stated zero for alcohol from a model's amounts.
 *
 * The estimate asks for every nutrient and a model answers zero for the ones a
 * food plainly lacks, which for alcohol is nearly every meal. Kept, that zero
 * would put an Alcohol line on every estimate and write a zero-drink sample to
 * Health for a sandwich. Absent and zero read the same everywhere alcohol is
 * shown (see `alcoholGramsOf`), so nothing is lost by dropping it.
 */
export function stripZeroAlcohol(amounts: Partial<Record<NutrientKey, number>>): void {
  if (amounts.alcoholG === 0) delete amounts.alcoholG;
}

/**
 * `nutrition` with its alcohol set to `grams`, or with none when `grams` is
 * zero. Returns the same object when nothing would change, so a memo keyed on
 * it does not re-run for a food with no alcohol.
 */
export function withAlcoholG(nutrition: FoodNutrition, grams: number): FoodNutrition {
  const current = nutrition.amounts.alcoholG;
  if (grams > 0) {
    if (current === grams) return nutrition;
    return { ...nutrition, amounts: { ...nutrition.amounts, alcoholG: grams } };
  }
  if (current === undefined) return nutrition;
  const { alcoholG: _removed, ...rest } = nutrition.amounts;
  return { ...nutrition, amounts: rest };
}

// A name that is a drink with alcohol in it, by how many standard drinks one
// of it usually is. Whole words only, so "ale" is not "scale" or "kale".
const ONE_DRINK_WORDS = [
  'beer', 'lager', 'ale', 'ipa', 'stout', 'porter', 'pilsner', 'cider', 'hard seltzer',
  'wine', 'prosecco', 'champagne', 'sake', 'merlot', 'chardonnay', 'pinot',
  'whiskey', 'whisky', 'bourbon', 'scotch', 'vodka', 'gin', 'rum', 'tequila', 'mezcal', 'brandy', 'cognac', 'shot',
];
const COCKTAIL_WORDS = [
  'cocktail', 'margarita', 'martini', 'mojito', 'cosmopolitan', 'old fashioned', 'negroni', 'daiquiri',
  'spritz', 'mimosa', 'sangria', 'manhattan', 'mai tai', 'pina colada', 'paloma', 'bloody mary',
  'gin and tonic', 'moscow mule', 'whiskey sour', 'espresso martini',
];
// Names that contain one of those words and are not a drink with alcohol in it.
const NOT_ALCOHOLIC = /\b(non[- ]?alcoholic|alcohol[- ]?free|root beer|ginger beer|ginger ale|vinegar|extract|batter|battered|sauce|raisin|cake|ice cream|0\.0|zero)\b/;

function hasWord(text: string, words: readonly string[]): boolean {
  return words.some(word => new RegExp(`\\b${word}\\b`).test(text));
}

/**
 * How many drinks a food's name suggests, or null when it suggests none.
 *
 * Used only to open the form's alcohol row already switched on for something
 * called "Margarita", where the person would otherwise have to find the switch.
 * It never writes anything by itself: the row is on screen with its count, and
 * the entry is only saved when the person taps Log.
 */
export function suggestDrinksForName(name: string): number | null {
  const text = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (NOT_ALCOHOLIC.test(text)) return null;
  if (hasWord(text, COCKTAIL_WORDS)) return 1.5;
  if (hasWord(text, ONE_DRINK_WORDS)) return 1;
  return null;
}
