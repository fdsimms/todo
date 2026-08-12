import { format } from 'date-fns/format';
import type { GroceryItem, MealPlanEntry, Recipe } from '../types';
import { isKeyInRange } from './mealPlan';
import { dayKeyToDate } from './dateUtils';
import { probablyHaveReason } from './grocerySuggest';
import { flattenRecipeIngredients, type ChoiceResolution } from './recipeComponents';
import {
  formatQuantityAmount,
  inflectUnit,
  normalizeScale,
  quantityAmount,
  scaleQuantity,
  unitKey,
} from './recipeScale';

/**
 * Everything decidable about turning a week plan into a grocery add, kept
 * store-free and node-testable — same discipline mealPlan.ts, recipeUtils.ts
 * and groceryParse.ts follow.
 *
 * This is deliberately not arithmetic on real-world quantities. `quantity` is
 * free text everywhere else in this app (RecipeIngredient, GroceryItem), and
 * nothing does arithmetic on it — this module doesn't either, beyond the one
 * narrow, provably-safe case mergeQuantities describes. It cannot convert
 * between units, understand "a bunch" or "a knob", or know that 3 cloves is a
 * fraction of one bulb.
 *
 * Three modules elsewhere *do* do arithmetic on a quantity, and none of them
 * weakens the above, because each is reached only on an explicit request and
 * each refuses rather than guesses when it can't read a line: recipeScale
 * multiplies through a factor the user picked (a halved recipe, a doubled
 * Sunday), unitConvert converts for display through a setting, and
 * groceryPrice divides to compare two stores' prices per unit — and that last
 * one refuses the whole set unless every quantity in it can be measured.
 */

/** One recipe's ingredient, as it landed on one planned meal. */
export interface PlannedIngredient {
  name: string;
  nameKey: string;
  quantity: string;
  aisle: string | null;
  /** "Tue ragù" — abbreviated weekday plus dish, the row's expandable source. */
  source: string;
  /**
   * The recipe this ingredient came from, carried through to attribute a
   * resulting GroceryItem. Optional so a hand-built fixture in a test doesn't
   * need one; both collectPlannedIngredients and plannedIngredientsForRecipe
   * always set it in real use.
   */
  recipeId?: string;
  recipeTitle?: string;
}

/**
 * Flattens a week's entries into one row per (recipe ingredient, entry) pair.
 *
 * Only entries with a *resolvable* recipe contribute — a free-text meal
 * ("leftovers") has no ingredient list, and a recipeId that no longer
 * resolves is resolve-or-shrug like every other cross-row pointer in this
 * app (same as titleForEntry falling back to the captured title). Neither is
 * an error; both are just meals with nothing here to add.
 *
 * `range` re-filters `entries` by date rather than trusting the caller to
 * have passed exactly the right window — useMealPlanStore's `entries` is
 * range-scoped already, but this stays correct even fed a wider set.
 *
 * A composed recipe contributes its components' ingredients too
 * (flattenRecipeIngredients), and each line is attributed to the recipe it is
 * actually written on: "Tue mash" rather than "Tue steak dinner" for a line
 * that lives on the mash. Same weekday-plus-dish format either way, and it's
 * what keeps two components that both call for butter from collapsing into one
 * indistinguishable pair of sources on the row's breakdown.
 *
 * An entry already marked cooked (`cookedAt` set) is skipped — that meal has
 * already been made, so its ingredients were either already bought or are
 * moot, and suggesting them again reads as the app not knowing what already
 * happened.
 */
export function collectPlannedIngredients(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  range: { startKey: string; endKey: string }
): PlannedIngredient[] {
  const out: PlannedIngredient[] = [];
  for (const entry of entries) {
    if (!isKeyInRange(entry.date, range.startKey, range.endKey)) continue;
    if (!entry.recipeId) continue;
    if (entry.cookedAt) continue;
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue;
    const weekday = format(dayKeyToDate(entry.date), 'EEE');
    // The entry's own scale, so a Sunday cooked double shops for double — and
    // one factor covers the whole tree, components included, because it's
    // applied to every flattened line rather than to the root's own.
    const scale = normalizeScale(entry.recipeScale);
    // The entry's own picks, so a week holding steak-with-mash on Tuesday and
    // steak-with-roast on Friday shops for one side each night rather than both
    // twice. An entry that never answered resolves to the defaults.
    for (const flat of flattenRecipeIngredients(recipe, recipesById, { chosen: entry.recipeChoices })) {
      out.push({
        name: flat.ingredient.name,
        nameKey: flat.ingredient.nameKey,
        quantity: scaleQuantity(flat.ingredient.quantity, scale).text,
        aisle: flat.ingredient.aisle,
        source: `${weekday} ${flat.recipe.name}`,
        recipeId: flat.recipe.id,
        recipeTitle: flat.recipe.name,
      });
    }
  }
  return out;
}

/**
 * One recipe's ingredients, standing alone rather than flattened out of a
 * week — the source a single-recipe "Add ingredients to list" needs to run
 * through the same classifyPlanned pantry-awareness AddWeekToListSheet gets,
 * instead of the blind addFromPlan RecipeDetailScreen used before.
 *
 * `recipesById` is what lets a composed recipe bring its components' lines
 * along; without it (a caller that genuinely only has the one row, and the
 * older tests) the recipe stands for itself, which is exactly what an
 * uncomposed one does anyway.
 *
 * `resolution` carries the choices when there are any to carry — a meal being
 * shopped for one night passes that entry's picks, while the recipe's own "Add
 * ingredients to list" passes the picks made in the sheet, starting from the
 * defaults.
 */
export function plannedIngredientsForRecipe(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe> = new Map([[recipe.id, recipe]]),
  resolution?: ChoiceResolution,
  scale = 1,
): PlannedIngredient[] {
  const factor = normalizeScale(scale);
  return flattenRecipeIngredients(recipe, recipesById, resolution).map(flat => ({
    name: flat.ingredient.name,
    nameKey: flat.ingredient.nameKey,
    quantity: [
      // Scaled before the join, never after: prep and purpose are prose and
      // there is no amount in them to multiply.
      scaleQuantity(flat.ingredient.quantity, factor).text,
      flat.ingredient.prep,
      flat.ingredient.purpose ? `for ${flat.ingredient.purpose}` : null,
    ].filter(Boolean).join(', '),
    aisle: flat.ingredient.aisle,
    // The recipe the line is written on, so a row merged from a parent and one
    // of its parts says which parts want it — see ClassifiedIngredient.sources.
    source: flat.recipe.name,
    recipeId: flat.recipe.id,
    recipeTitle: flat.recipe.name,
  }));
}

// A whole string that is nothing but an amount and an optional unit word. The
// *shape* is as strict as it ever was — anchored at both ends, so "2 14 oz
// cans" and "1 cup, packed" still don't parse and still get listed rather than
// summed. Only the notations for the amount itself widened.
const WHOLE_QUANTITY = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*([a-z%]*)$/i;

/**
 * "2 lb" → `{ amount: 2, unit: 'lb' }`. Null for anything that isn't a bare
 * amount and unit word.
 *
 * **Fractions and mixed numbers parse here now**, where they used to be
 * refused. The original reasoning was that summing them means adding fractions
 * with possibly different denominators, and that this module had no business
 * doing that kind of quiet-but-fragile arithmetic. Recipe scaling changed the
 * arithmetic, not the caution: exact rational addition is in recipeScale (see
 * `quantityAmount`/`formatQuantityAmount`), and it's what makes "1/2 cup" +
 * "1/4 cup" come out as "3/4 cup" rather than "0.75 cup" or a float artefact.
 *
 * Refusing them stopped being tenable anyway the moment a scaled recipe could
 * *produce* one: halving a shopping list would have turned every merged row
 * into mergeQuantities' rule-5 list ("1 1/2 cups · 2 cups"), so the feature
 * would have quietly degraded the thing it was meant to help with.
 */
export function parseQuantityAmount(q: string): { amount: number; unit: string } | null {
  const trimmed = q.trim();
  if (!trimmed) return null;
  const match = WHOLE_QUANTITY.exec(trimmed);
  if (!match) return null;
  const amount = quantityAmount(match[1]);
  if (!amount) return null;
  return { amount: amount.value, unit: match[2].toLowerCase() };
}

/**
 * Combines several sources' quantities for the same ingredient into one
 * display string — by *listing*, not by summing, because `quantity` is free
 * text and nothing does arithmetic on it elsewhere in this app either.
 *
 * Precisely, in order:
 * 1. drop blanks;
 * 2. none left → `''`;
 * 3. one left → return it verbatim;
 * 4. **every** remaining one parses (see parseQuantityAmount) with the
 *    **same** unit (empty unit counts as one) → sum the amounts and
 *    re-render ("1 lb" + "2 lb" → "3 lb");
 * 5. otherwise → `' · '`-joined, verbatim.
 *
 * Rule 4 handles the actual common case — two recipes each wanting 2 onions —
 * and cannot be wrong, because it never crosses units. Rule 5 refuses
 * visibly rather than guess: "2 · 1 bunch · 3" is honest, "6 onions" the
 * moment one source said "a bunch" would be a lie.
 */
export function mergeQuantities(quantities: readonly string[]): string {
  const present = quantities.map(q => q.trim()).filter(Boolean);
  if (present.length === 0) return '';
  if (present.length === 1) return present[0];

  const parsed = present.map(parseQuantityAmount);
  const allParsed = parsed.every((p): p is { amount: number; unit: string } => p !== null);
  if (allParsed) {
    const unit = parsed[0]!.unit;
    // Compared as unit *identities*, so "cup" and "cups" are the same unit and
    // still sum. Scaling generates both forms itself — a halved line says
    // "1/2 cup" where the recipe said "2 cups" — so a raw string comparison
    // would list two measurements of the same thing side by side. Still never
    // across genuinely different units: "g" and "grams" collapse, "g" and "kg"
    // do not (see recipeScale.unitKey).
    const key = unitKey(unit);
    const sameUnit = parsed.every(p => unitKey(p!.unit) === key);
    if (sameUnit) {
      const total = parsed.reduce((sum, p) => sum + p!.amount, 0);
      // Rendered the same way a scaled quantity is, so a list built from
      // fractions reads in fractions ("3/4 cup") — except when a source was
      // written in decimals, which is a notation the person chose and gets kept
      // ("1.1 lb" + "2.2 lb" → "3.3 lb", not "3 3/10 lb").
      const anyDecimal = present.some(q => /\d\.\d/.test(q));
      const amountText = formatQuantityAmount(total, anyDecimal);
      // Agreed with the total rather than copied off the first source, which
      // is the other half of comparing by identity: having decided "1/2 cup"
      // and "2 cups" are addable, the answer has to pick a form, and the one
      // that matches the number it's next to is the only defensible pick.
      return unit ? `${amountText} ${inflectUnit(unit, total)}` : amountText;
    }
  }
  return present.join(' · ');
}

/**
 * The quantity chip's actual display text for a grouped row: mergeQuantities'
 * answer, or `×N` (the source count) when every source left quantity blank —
 * "salt" planned three times over has nothing to merge, and an empty pill
 * would read as a bug rather than as "no amount given, three times".
 */
export function describeQuantities(quantities: readonly string[]): string {
  const merged = mergeQuantities(quantities);
  if (merged) return merged;
  return quantities.length > 1 ? `×${quantities.length}` : '';
}

export type PlanCategory = 'needToBuy' | 'alreadyOnList' | 'inTrolley' | 'probablyHave' | 'staple';

export interface ClassifiedIngredient {
  nameKey: string;
  /** Display name — see classifyPlanned for the precedence. */
  name: string;
  /** A hint for a genuinely new catalog row; ignored for one that already exists. */
  aisle: string | null;
  quantity: string;
  /** Every "Tue ragù"-style source this row came from, for the row's expandable breakdown. */
  sources: string[];
  category: PlanCategory;
  /**
   * Whether a catalog row already exists under this key — i.e. whether the app
   * has ever seen this item before, as opposed to reading it off a recipe for
   * the first time.
   *
   * It only says something useful on a `needToBuy` row, and there it says the
   * one thing that separates "you buy this and you're out" from "this recipe
   * mentions a thing we know nothing about": `needToBuy` deliberately conflates
   * the two (see the table above), and `restockRows` is what splits them.
   */
  known: boolean;
  /** Set only for `probablyHave` — grocerySuggest.probablyHaveReason's "bought 6× · last on 12 Jul". */
  reason: string | null;
  /**
   * The single recipe behind this row, when there is one — null once a row
   * has merged ingredients from more than one recipe, since crediting either
   * one over the other would be a guess. See PlannedRow.sourceRecipeId.
   */
  sourceRecipeId: string | null;
  sourceRecipeTitle: string | null;
}

/**
 * Groups collectPlannedIngredients' flat list back into one row per catalog
 * key, and sorts each into a section:
 *
 * | Category        | Meaning                                    |
 * |------------------|---------------------------------------------|
 * | needToBuy        | no catalog row, or known but off the list    |
 * | alreadyOnList     | on the list, unchecked                       |
 * | inTrolley         | on the list *and* checked                    |
 * | staple            | known, off the list, and marked isStaple —   |
 * |                   | always on hand, unconditionally              |
 * | probablyHave      | known, off the list, and grocerySuggest's    |
 * |                   | pantry guess (or an explicit onHandUntil     |
 * |                   | assertion) says it's probably still around   |
 *
 * `staple` is checked ahead of `probablyHave` — a staple is a standing fact
 * ("I always have salt"), not a guess from recent purchases, and it needs no
 * purchase history to be true. Both are checked only for a row that's known
 * but off the list — never for one already on the list or in the trolley
 * (already on the list this week wins, staple or not), and never for a name
 * with no catalog row at all.
 *
 * Display name, among sources sharing a key: the live catalog row's own name
 * wins — that's what the user themselves typed, and addByName already holds
 * the line that the typed name wins over anything else. Failing that, the
 * shortest source name.
 */
export function classifyPlanned(
  planned: readonly PlannedIngredient[],
  items: readonly GroceryItem[],
  now: Date
): ClassifiedIngredient[] {
  const byKey = new Map<string, GroceryItem>();
  for (const item of items) byKey.set(item.nameKey, item);

  const groups = new Map<string, PlannedIngredient[]>();
  for (const p of planned) {
    const key = p.nameKey || p.name.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }

  const rows: ClassifiedIngredient[] = [];
  for (const [key, group] of groups) {
    const match = byKey.get(key);
    const name = match?.name ?? shortestName(group.map(g => g.name));
    const aisle = group.find(g => g.aisle)?.aisle ?? null;
    // describeQuantities, not the bare mergeQuantities: a group where every
    // source left quantity blank ("salt" planned three times over) still
    // deserves a chip saying so rather than rendering none at all.
    const quantity = describeQuantities(group.map(g => g.quantity));
    const sources = group.map(g => g.source);
    const recipeIds = new Set(group.map(g => g.recipeId));
    const sourceRecipeId = recipeIds.size === 1 ? (group[0]!.recipeId ?? null) : null;
    const sourceRecipeTitle = sourceRecipeId ? (group[0]!.recipeTitle ?? null) : null;

    let category: PlanCategory;
    let reason: string | null = null;
    if (match?.onList) {
      category = match.checked ? 'inTrolley' : 'alreadyOnList';
    } else if (match?.isStaple) {
      category = 'staple';
    } else if (match && (reason = probablyHaveReason(match, now))) {
      category = 'probablyHave';
    } else {
      category = 'needToBuy';
    }

    rows.push({ nameKey: key, name, aisle, quantity, sources, category, known: !!match, reason, sourceRecipeId, sourceRecipeTitle });
  }
  return rows;
}

/**
 * The lines a *restock* can honestly be offered for: known items the app
 * doesn't currently think you have.
 *
 * `needToBuy` is the wrong set to offer after cooking something, and the
 * reason is in its own definition — "no catalog row, **or** known but off the
 * list". The first half is ignorance. A recipe naming an item the app has
 * never seen tells you nothing about whether the cook needs to buy it; on a
 * dish cooked for the first time it is *every* line, which is how a restock
 * offer ends up asking for 1/4 tsp of black pepper. The second half is the
 * real signal, and it's already narrow: anything bought recently enough to
 * still be around has been taken by `probablyHave`, and a standing "always
 * have it" by `staple`, before `needToBuy` sees it.
 *
 * Same restraint as `tripMarkerFor` and `shoppingTrip.ts` — the app says
 * something only where the user's own record backs it, and stays quiet rather
 * than hedging.
 */
export function restockRows(classified: readonly ClassifiedIngredient[]): ClassifiedIngredient[] {
  return classified.filter(r => r.category === 'needToBuy' && r.known);
}

function shortestName(names: readonly string[]): string {
  return names.reduce((shortest, n) => (n.length < shortest.length ? n : shortest));
}
