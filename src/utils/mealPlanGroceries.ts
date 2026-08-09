import { format } from 'date-fns/format';
import type { GroceryItem, MealPlanEntry, Recipe } from '../types';
import { isKeyInRange } from './mealPlan';
import { dayKeyToDate } from './dateUtils';

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
 */

/** One recipe's ingredient, as it landed on one planned meal. */
export interface PlannedIngredient {
  name: string;
  nameKey: string;
  quantity: string;
  aisle: string | null;
  /** "Tue ragù" — abbreviated weekday plus dish, the row's expandable source. */
  source: string;
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
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue;
    const source = `${format(dayKeyToDate(entry.date), 'EEE')} ${recipe.name}`;
    for (const ingredient of recipe.ingredients) {
      out.push({
        name: ingredient.name,
        nameKey: ingredient.nameKey,
        quantity: ingredient.quantity,
        aisle: ingredient.aisle,
        source,
      });
    }
  }
  return out;
}

/** "2 lb" → `{ amount: 2, unit: 'lb' }`. Null for anything that isn't a bare number and unit word. */
export function parseQuantityAmount(q: string): { amount: number; unit: string } | null {
  const trimmed = q.trim();
  if (!trimmed) return null;
  // Deliberately does not accept a fraction or mixed number ("1/2", "1 1/2")
  // — parseGroceryInput produces those for a single ingredient line, but
  // summing them means adding fractions with possibly different
  // denominators, which is exactly the kind of quiet-but-fragile arithmetic
  // this module exists to avoid. A quantity written that way just doesn't
  // parse here, and mergeQuantities' rule 5 lists it instead of guessing.
  const match = /^(\d+(?:\.\d+)?)\s*([a-z%]*)$/i.exec(trimmed);
  if (!match) return null;
  return { amount: Number(match[1]), unit: match[2].toLowerCase() };
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
    const sameUnit = parsed.every(p => p!.unit === unit);
    if (sameUnit) {
      const total = parsed.reduce((sum, p) => sum + p!.amount, 0);
      // Integral totals render without a decimal; a fractional one keeps at
      // most two places rather than trailing float noise like "3.30".
      const amountText = Number.isInteger(total)
        ? String(total)
        : String(Math.round(total * 100) / 100);
      return unit ? `${amountText} ${unit}` : amountText;
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

export type PlanCategory = 'needToBuy' | 'alreadyOnList' | 'inTrolley' | 'probablyHave';

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
 * | probablyHave      | known, recently bought, not on the list      |
 *
 * `probablyHave` never classifies here — it needs the purchase-cadence
 * inference that hasn't shipped yet. Nothing is silently dropped in the
 * meantime: a name that would eventually land there instead falls into
 * `needToBuy`, exactly like the table says for "known but off-list", which is
 * the correct default until the inference exists. `now` is accepted and
 * unused for the same reason — the signature is already right for when that
 * inference arrives, rather than changing again then.
 *
 * Display name, among sources sharing a key: the live catalog row's own name
 * wins (`itemByNameKey`-equivalent lookup by nameKey) — that's what the user
 * themselves typed, and addByName already holds the line that the typed name
 * wins over anything else. Failing that, the shortest source name.
 */
export function classifyPlanned(
  planned: readonly PlannedIngredient[],
  items: readonly GroceryItem[],
  _now: Date
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

    let category: PlanCategory;
    if (!match || !match.onList) {
      category = 'needToBuy';
    } else if (match.checked) {
      category = 'inTrolley';
    } else {
      category = 'alreadyOnList';
    }

    rows.push({ nameKey: key, name, aisle, quantity, sources, category });
  }
  return rows;
}

function shortestName(names: readonly string[]): string {
  return names.reduce((shortest, n) => (n.length < shortest.length ? n : shortest));
}
