import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { dayKeyOf, dayKeyToDate } from './dateUtils';
import { describeUseBy } from './freshness';
import { groceryNameKey } from './groceryParse';
import { GROCERY_EXPIRY_DAYS_MAX } from '../types';
import type { GroceryItem } from '../types';

/**
 * How long a thing keeps, so an item bought today can be given a day to be
 * used up by.
 *
 * Offline and always present, exactly like the aisle lexicon next door: the
 * whole feature has to work with no Anthropic API key, and nothing here is
 * ever filled in by asking a model. It is the same shape for the same reason —
 * a literal object keyed by `groceryNameKey`, so a cold start pays no parse
 * cost for a table the grocery store imports at startup.
 *
 * **It is a whitelist of things that actually go off, and that restraint is
 * the feature.** An unrecognised name gets no date, which means no task —
 * so rice, tinned tomatoes, washing-up liquid and every other thing in a
 * catalog of hundreds stay silent, and only the fridge and the fruit bowl
 * ever speak up. Widening this table is how the feature would turn into the
 * spam the issue was worried about; a name is worth adding only if forgetting
 * it in the back of the fridge is a real way to waste money.
 *
 * The numbers are days from *purchase*, and are deliberately the cautious end
 * of the usual advice: this drives a nudge, not a food-safety verdict, and the
 * user moves it with one stepper the moment it's wrong for their kitchen.
 */
export const SHELF_LIFE_LEXICON: Record<string, number> = {
  // ─── Leafy and soft produce — the classic back-of-the-drawer waste ───
  arugula: 5, basil: 5, berries: 4, blackberries: 4, blueberries: 7,
  'bok choy': 6, broccoli: 6, cauliflower: 7, celery: 10, chard: 5,
  cilantro: 6, coriander: 6, cucumber: 7, dill: 6, eggplant: 6,
  'green beans': 6, herbs: 6, kale: 6, lettuce: 6, mint: 6,
  mushroom: 6, mushrooms: 6, parsley: 7, 'romaine lettuce': 6,
  salad: 4, scallions: 7, 'green onion': 7, 'green onions': 7,
  spinach: 5, 'spring onions': 7, sprouts: 4, strawberries: 4,
  raspberries: 3, tomato: 6, tomatoes: 6, zucchini: 6,

  // ─── Fruit that ripens then goes ───
  avocado: 5, avocados: 5, banana: 5, bananas: 5, cherries: 5,
  grapes: 8, kiwi: 8, mango: 6, nectarines: 5, peach: 5, peaches: 5,
  pear: 6, pears: 6, plums: 6, pineapple: 5, watermelon: 6,

  // ─── Dairy and eggs ───
  buttermilk: 10, cream: 7, 'cream cheese': 14, 'cottage cheese': 10,
  'creme fraiche': 14, 'half and half': 10, 'heavy cream': 10,
  milk: 7, 'oat milk': 7, 'almond milk': 7, 'soy milk': 7,
  'ricotta': 7, 'sour cream': 14, yogurt: 14, yoghurt: 14,
  'greek yogurt': 14, eggs: 21, egg: 21,

  // ─── Meat, seafood and deli — the short ones, on purpose ───
  bacon: 7, beef: 3, 'ground beef': 2, 'ground turkey': 2, chicken: 2,
  'chicken breast': 2, 'chicken thighs': 2, 'cold cuts': 5, cod: 2,
  fish: 2, ham: 5, lamb: 3, mince: 2, pork: 3, prawns: 2,
  salmon: 2, sausages: 3, scallops: 2, shrimp: 2, 'sliced turkey': 5,
  steak: 3, tilapia: 2, tuna: 2, turkey: 3,

  // ─── Prepared and bakery ───
  bagels: 5, baguette: 2, bread: 6, 'bread rolls': 5, brioche: 5,
  croissants: 3, hummus: 7, guacamole: 3, 'fresh pasta': 5,
  'pizza dough': 5, salsa: 7, tofu: 7, tortillas: 10,
};

/**
 * How long this name keeps, or null for something the lexicon doesn't claim to
 * know about — which is most of a catalog, and is meant to be.
 *
 * Matched on `groceryNameKey`, so it's the same identity the aisle lexicon and
 * the catalog itself use: "Baby Spinach" and "spinach" are not the same key,
 * and only the second one is claimed. Guessing across near-misses is
 * deliberately not attempted — a wrong shelf life spawns a task about food
 * that's fine, which is the failure mode that gets a feature turned off.
 */
export function shelfLifeDaysFor(name: string): number | null {
  const key = groceryNameKey(name);
  if (!key) return null;
  return SHELF_LIFE_LEXICON[key] ?? null;
}

/** A use-by count forced into the sayable range, mirroring clampKeepDays. */
export function clampExpiryDays(days: number): number {
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, Math.min(GROCERY_EXPIRY_DAYS_MAX, Math.round(days)));
}

/** The `expiresAt` day key for "bought on `from`, keeps `days` days". */
export function expiryKeyFor(from: Date, days: number): string {
  return dayKeyOf(addDays(from, clampExpiryDays(days)));
}

/**
 * The use-by day a just-bought item should carry, or null if the lexicon has
 * nothing to say about it.
 *
 * Used by `finishShopping` for every row in the trolley, which is what makes
 * the feature need no data entry at all in the ordinary case. Every purchase
 * re-stamps: a second bag of spinach is fresh spinach, and inheriting the old
 * bag's day would have the app nagging about food bought this afternoon.
 */
export function defaultExpiresAt(name: string, now: Date): string | null {
  const days = shelfLifeDaysFor(name);
  return days === null ? null : expiryKeyFor(now, days);
}

/**
 * The use-by day a just-bought item should carry, preferring the shopper's
 * own correction over the lexicon guess.
 *
 * `finishShopping` calls this instead of `defaultExpiresAt` for exactly the
 * reason `GroceryItem.shelfLifeDays` exists: once someone has told the app
 * "this one keeps 5 days" — whether the lexicon had an opinion or not — every
 * later purchase should count from that, not silently fall back to a generic
 * guess (or to nothing, for a name the lexicon has never heard of).
 */
export function expiresAtForPurchase(item: GroceryItem, now: Date): string | null {
  if (item.shelfLifeDays !== null) return expiryKeyFor(now, item.shelfLifeDays);
  return defaultExpiresAt(item.name, now);
}

/**
 * The days-from-today a stored use-by day is expressing — the inverse of
 * `expiryKeyFor`, for seeding the item sheet's stepper.
 *
 * Not stored, for the same reason `keepDaysBetween` isn't: the day key already
 * says it, and a second column would be a second thing to keep in step. A day
 * already past clamps to 0, so the stepper opens on a number it can hold.
 */
export function expiryDaysFromNow(expiresAt: string, now: Date): number {
  return clampExpiryDays(differenceInCalendarDays(dayKeyToDate(expiresAt), now));
}

/**
 * "Use by today", "Use by tomorrow", "3 days left", "2 days past".
 *
 * This and `describeKeepUntil` were word-for-word the same four lines, which
 * is what #1670 read as the two features having one question between them:
 * both are one `freshness.describeUseBy` now. Kept as its own name because
 * that's the vocabulary here — the catalog says "use by", the fridge says
 * "keep until", and they mean the same day.
 */
export function describeExpiry(expiresAt: string, now: Date = new Date()): string {
  return describeUseBy(expiresAt, now);
}
