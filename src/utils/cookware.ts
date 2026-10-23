import { COOKED_WEIGHT_MAX_G } from './mealLog';
import type { CookwareType } from '../types';

/**
 * Pots, pans, lids and tubs, kept so a dish can be weighed with its pot.
 *
 * The scale reads the pot and the food together, and a hot pot is the part
 * nobody wants to handle, so the app holds each piece's empty weight and takes
 * it off. Only the number typed changes: `Recipe.cookedWeightG` and
 * `Leftover.weightG` still hold the food alone, and nothing remembers which pot
 * a dish was weighed in, so deleting or reweighing a pot rewrites no history.
 */

/** Heavier than any kitchen scale reads and any pot a person owns. */
export const COOKWARE_MAX_G = COOKED_WEIGHT_MAX_G;

/**
 * A pot's empty weight, whole grams, or null when it isn't a weight at all.
 * Zero is refused because a pot that weighs nothing subtracts nothing, which is
 * what "No pot" is for.
 */
export function clampCookwareWeight(grams: number | null): number | null {
  if (grams === null || !Number.isFinite(grams) || grams <= 0) return null;
  return Math.min(COOKWARE_MAX_G, Math.round(grams));
}

/** What a typed weight field holds, as a number. Accepts a decimal comma. */
export function parseWeightText(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** What a piece of cookware is called where it is picked. */
export type CookwareNoun = 'pot' | 'plate' | 'cookware';

export type NetWeight =
  | { ok: true; grams: number }
  | { ok: false; reason: string };

/**
 * The food's weight, given what the scale read and the pieces on it.
 *
 * A reading at or under the pieces' own weight is refused with the reason
 * rather than clamped to something small: it means the wrong pot is picked or
 * the pot was weighed empty, and a dish of 1 g would pass every later check.
 * With nothing picked it passes the reading through unchanged, which is how
 * the field behaved before cookware existed. `noun` is what the picked piece is
 * called where the reading was typed ("pot" over a dish, "plate" over a meal).
 */
export function netWeight(
  scaleGrams: number,
  tares: readonly number[],
  noun: CookwareNoun = 'pot',
): NetWeight {
  const tare = tares.reduce((sum, g) => sum + g, 0);
  const net = scaleGrams - tare;
  if (!(net > 0)) {
    return {
      ok: false,
      reason: `That’s less than the ${noun} weighs (${tare.toLocaleString('en-US')} g). Check the reading or pick ${noun === 'cookware' ? 'other cookware' : `a different ${noun}`}.`,
    };
  }
  return { ok: true, grams: Math.round(net) };
}

/** The kinds cookware is shown under, in the order the sheet lists them. */
export const COOKWARE_TYPES: readonly CookwareType[] = ['Pots', 'Pans', 'Baking', 'Bowls', 'Mixing bowls', 'Plates', 'Glasses', 'Other'];

export function isCookwareType(value: unknown): value is CookwareType {
  return typeof value === 'string' && (COOKWARE_TYPES as readonly string[]).includes(value);
}

// Order matters: the first match wins, so "sheet pan" is Baking before "pan"
// is Pans, "saucier" is a pot before "pan" could claim it, and "glass tub" is
// a container (Other) rather than a glass.
const TYPE_RULES: readonly [CookwareType, RegExp][] = [
  ['Other', /\b(tub|container|jar|lid only)\b/i],
  ['Mixing bowls', /\bmixing\b/i],
  ['Baking', /\b(sheet pan|baking|cookie sheet|loaf|muffin|casserole)\b/i],
  ['Pots', /\b(pot|crock|crockpot|oven|saucier|saucepan|stockpot|kettle|lid)\b/i],
  ['Pans', /\b(pan|skillet|wok|griddle)\b/i],
  ['Glasses', /\b(glass|glasses|mug|cup|tumbler)\b/i],
  ['Bowls', /\b(bowl|ramekin|dish)\b/i],
  ['Plates', /\b(plate|platter|saucer)\b/i],
];

/**
 * Which kind a piece of cookware looks like from its name alone; a name that
 * matches nothing is Other. This is the guess a piece with no chosen type is
 * listed under, so every piece saved before types existed still sorts.
 */
export function cookwareTypeOf(name: string): CookwareType {
  for (const [type, pattern] of TYPE_RULES) if (pattern.test(name)) return type;
  return 'Other';
}

/** The type a piece is listed under: the one chosen for it, else the name's guess. */
export function effectiveCookwareType(item: { name: string; kind?: CookwareType | null }): CookwareType {
  return item.kind ?? cookwareTypeOf(item.name);
}

/** Cookware split by type in `COOKWARE_TYPES` order, empty types left out. Keeps each group's incoming order. */
export function groupCookwareByType<T extends { name: string; kind?: CookwareType | null }>(
  items: readonly T[],
): { type: CookwareType; items: T[] }[] {
  const buckets = new Map<CookwareType, T[]>();
  for (const item of items) {
    const type = effectiveCookwareType(item);
    const list = buckets.get(type);
    if (list) list.push(item); else buckets.set(type, [item]);
  }
  return COOKWARE_TYPES.filter(t => buckets.has(t)).map(type => ({ type, items: buckets.get(type)! }));
}

/** Past this many pieces the menu grows a search field and a Recent group. */
export const COOKWARE_MENU_SEARCH_MIN = 8;

/** How many recently picked pieces the menu lists above the types. */
export const RECENT_COOKWARE_LIMIT = 3;

/**
 * Pieces whose name or type holds every word of the query, in their incoming
 * order. A type counts so "bowl" finds a mixing bowl whose name never says it.
 * A blank query matches everything.
 */
export function filterCookware<T extends { name: string; kind?: CookwareType | null }>(
  items: readonly T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter(item => {
    const haystack = `${item.name} ${effectiveCookwareType(item)}`.toLowerCase();
    return words.every(w => haystack.includes(w));
  });
}

/** The recent list after `id` is picked: it moves to the front, and the list is capped. */
export function pushRecentCookware(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter(x => x !== id)].slice(0, RECENT_COOKWARE_LIMIT);
}

/** The pieces behind a recent list, newest first. An id whose piece was deleted is skipped. */
export function recentCookwareItems<T extends { id: string }>(recent: readonly string[], items: readonly T[]): T[] {
  return recent.flatMap(id => items.find(c => c.id === id) ?? []);
}

/** Reads the stored recent list back; anything that isn't a list of strings is an empty one. */
export function parseRecentCookware(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_COOKWARE_LIMIT);
  } catch {
    return [];
  }
}
