import type { DishRating, DishVerdict } from '../types';
import { groceryNameKey } from './groceryParse';

/**
 * Rating a restaurant dish: the rules, with no store and no database in them.
 * `DishRating` (types/index.ts) says why this is its own record.
 *
 * Three rules hold it in place. A verdict is only ever what a person chose, so
 * null is no opinion and nothing here fills one in. A dish is the pair (place,
 * name) after `groceryNameKey`, so a retyped dish is the same dish. And a
 * dish with no place is a dish with no place: it never borrows one from
 * another row of the same name.
 */

/** The words for each answer, in the order the controls show them. */
export const DISH_VERDICT_LABELS: Record<DishVerdict, string> = {
  loved: 'Loved it',
  fine: 'It was fine',
  avoid: 'Never again',
};

export const DISH_VERDICTS: DishVerdict[] = ['loved', 'fine', 'avoid'];

export interface DishInput {
  name: string;
  place?: string | null;
  verdict?: DishVerdict | null;
  note?: string | null;
  lastHadAt?: Date | null;
  /** A stored file name in the dish-photos folder, or null for none. */
  photo?: string | null;
}

/**
 * The key for a dish or place name. `groceryNameKey` turns every character
 * outside Latin letters and digits into a space, so a name written in another
 * script ("寿司") keys to '' and a restaurant in one would collide with "no
 * place". The letters it would drop are kept after the Latin part instead. A
 * name that is Latin throughout keys exactly as `groceryNameKey` has it.
 */
export function dishTextKey(text: string): string {
  const latin = groceryNameKey(text);
  const other = Array.from(text.toLowerCase()).filter(c => {
    const code = c.codePointAt(0)!;
    // Latin and its extensions (diacritics are stripped by groceryNameKey), combining marks.
    if (code <= 0x024f || (code >= 0x0300 && code <= 0x036f) || (code >= 0x1e00 && code <= 0x1eff)) return false;
    return /\p{L}/u.test(c);
  });
  return [latin, other.join('')].filter(Boolean).join(' ');
}

/** The two keys a dish is told apart by. A blank place keys as ''. */
export function dishKeys(name: string, place: string | null | undefined): { nameKey: string; placeKey: string } {
  return {
    nameKey: dishTextKey(name),
    placeKey: place ? dishTextKey(place) : '',
  };
}

function trimmedOrNull(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  return t ? t : null;
}

/** Noon on a day, the anchor `Milestone.date` uses so DST can't move it a day. */
export function noonOf(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).toISOString();
}

/**
 * A new row from what the sheet collected, or null for a blank name (the
 * sheet's Save is the only way in, so a blank one is refused rather than
 * stored).
 */
export function buildDishRating(
  input: DishInput,
  id: string,
  now: Date,
): DishRating | null {
  const name = input.name.trim();
  if (!name) return null;
  const place = trimmedOrNull(input.place);
  const { nameKey, placeKey } = dishKeys(name, place);
  if (!nameKey) return null;
  return {
    id,
    name,
    nameKey,
    place,
    placeKey,
    verdict: input.verdict ?? null,
    note: trimmedOrNull(input.note),
    lastHadAt: input.lastHadAt ? noonOf(input.lastHadAt) : null,
    photo: trimmedOrNull(input.photo),
    createdAt: now.toISOString(),
  };
}

/** What an edit may change. `lastHadAt` takes a Date and is stored as noon. */
export type DishPatch = Partial<Pick<DishInput, 'name' | 'place' | 'verdict' | 'note' | 'lastHadAt' | 'photo'>>;

/**
 * The row after an edit, re-keyed when the name or place changed. Returns the
 * row unchanged for a blank name, so a half-typed edit can't blank a dish.
 */
export function applyDishPatch(existing: DishRating, patch: DishPatch): DishRating {
  const next: DishRating = { ...existing };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    // A name that keys to '' (punctuation only) can never match a food log label.
    if (name && dishTextKey(name)) next.name = name;
  }
  if (patch.place !== undefined) next.place = trimmedOrNull(patch.place);
  if (patch.verdict !== undefined) next.verdict = patch.verdict;
  if (patch.note !== undefined) next.note = trimmedOrNull(patch.note);
  if (patch.photo !== undefined) next.photo = trimmedOrNull(patch.photo);
  if (patch.lastHadAt !== undefined) {
    next.lastHadAt = patch.lastHadAt ? noonOf(patch.lastHadAt) : null;
  }
  const { nameKey, placeKey } = dishKeys(next.name, next.place);
  next.nameKey = nameKey;
  next.placeKey = placeKey;
  return next;
}

/**
 * Two rows that an edit has made the same dish, as one. `kept` is the row the
 * person edited and wins wherever it says something; what it leaves empty is
 * filled from `other`, and "last had" is the later of the two.
 */
export function mergeDishes(kept: DishRating, other: DishRating): DishRating {
  const lastHadAt = [kept.lastHadAt, other.lastHadAt].filter((d): d is string => !!d).sort().pop() ?? null;
  return {
    ...kept,
    verdict: kept.verdict ?? other.verdict,
    note: kept.note ?? other.note,
    photo: kept.photo ?? other.photo,
    lastHadAt,
  };
}

/** The other saved row with the same name and place as `dish`, if an edit made one. */
export function dishCollision(dishes: DishRating[], dish: DishRating): DishRating | null {
  return dishes.find(d => d.id !== dish.id && d.nameKey === dish.nameKey && d.placeKey === dish.placeKey) ?? null;
}

/** The dish already saved under this name and place, if any. */
export function findDish(
  dishes: DishRating[],
  name: string,
  place: string | null | undefined,
): DishRating | null {
  const { nameKey, placeKey } = dishKeys(name, place);
  if (!nameKey) return null;
  return dishes.find(d => d.nameKey === nameKey && d.placeKey === placeKey) ?? null;
}

/** Loved first, then fine, then no opinion, then avoid: the order a menu reads in. */
function verdictRank(v: DishVerdict | null): number {
  if (v === 'loved') return 0;
  if (v === 'fine') return 1;
  if (v === null) return 2;
  return 3;
}

function compareDishes(a: DishRating, b: DishRating): number {
  const byVerdict = verdictRank(a.verdict) - verdictRank(b.verdict);
  if (byVerdict !== 0) return byVerdict;
  return a.nameKey.localeCompare(b.nameKey);
}

export interface DishPlaceGroup {
  /** The place as first typed in this group, or null for dishes with none. */
  place: string | null;
  placeKey: string;
  dishes: DishRating[];
}

/**
 * Dishes grouped under their place for the list. Places run alphabetically and
 * the no-place group comes last, so a typo'd place doesn't float to the top.
 * `verdict` narrows the list; null shows everything.
 */
export function groupDishesByPlace(
  dishes: DishRating[],
  verdict: DishVerdict | null = null,
): DishPlaceGroup[] {
  const groups = new Map<string, DishPlaceGroup>();
  for (const dish of dishes) {
    if (verdict !== null && dish.verdict !== verdict) continue;
    let group = groups.get(dish.placeKey);
    if (!group) {
      group = { place: dish.place, placeKey: dish.placeKey, dishes: [] };
      groups.set(dish.placeKey, group);
    }
    group.dishes.push(dish);
  }
  const out = [...groups.values()];
  for (const g of out) g.dishes.sort(compareDishes);
  out.sort((a, b) => {
    if (a.placeKey === '' && b.placeKey !== '') return 1;
    if (b.placeKey === '' && a.placeKey !== '') return -1;
    return a.placeKey.localeCompare(b.placeKey);
  });
  return out;
}

/**
 * The saved dish a food log label names, for the recall row and the rating
 * offer. Matches on the name alone, because an eaten-out entry carries no
 * place. When several places serve a dish of that name, one that has a verdict
 * wins, then the most recently had, so the answer is stable. A dish with no
 * verdict is returned too: the caller decides whether that is worth showing.
 */
export function dishForLabel(dishes: DishRating[], label: string): DishRating | null {
  const key = dishTextKey(label);
  if (!key) return null;
  const matches = dishes.filter(d => d.nameKey === key);
  if (matches.length === 0) return null;
  // Unlike the menu order above, any answer beats none, "avoid" included, so a
  // dish already marked never-again isn't asked about again from another place.
  const answered = (d: DishRating) => (d.verdict === null ? 1 : 0);
  return [...matches].sort((a, b) => {
    const byVerdict = answered(a) - answered(b) || verdictRank(a.verdict) - verdictRank(b.verdict);
    if (byVerdict !== 0) return byVerdict;
    return (b.lastHadAt ?? '').localeCompare(a.lastHadAt ?? '');
  })[0];
}

/** The parts of a food log draft that say whether it was food somebody else made. */
export interface EatenOutProbe {
  recipeId?: string | null;
  itemId?: string | null;
  productId?: string | null;
  mealPlanEntryId?: string | null;
  savedMealId?: string | null;
  taskId?: string | null;
  nutrition: { source?: string | null };
}

/**
 * Whether a logged meal reads as one eaten out: described in words and
 * estimated, with nothing in the app behind it (no recipe, catalog item,
 * product, planned meal, saved meal or task). It is the one case with no
 * database to answer, which is why a rating has nowhere else to come from.
 * A guess, so it only decides whether to *ask*: nothing is rated on its say.
 */
export function isEatenOutDraft(draft: EatenOutProbe): boolean {
  if (draft.nutrition.source !== 'estimated') return false;
  return !(draft.recipeId || draft.itemId || draft.productId || draft.mealPlanEntryId || draft.savedMealId || draft.taskId);
}

/**
 * The dish to ask about after logging `label`, or null when there is nothing
 * to ask: a blank label, or a dish that already has an answer. A saved dish
 * with no answer yet is asked about again, since that is the question it is
 * missing.
 */
export function dishOfferFor(dishes: DishRating[], label: string): { name: string } | null {
  const name = label.trim();
  if (!dishTextKey(name)) return null;
  const known = dishForLabel(dishes, name);
  if (known && known.verdict !== null) return null;
  return { name };
}
