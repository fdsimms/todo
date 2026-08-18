import type { GroceryItem, ItemSubLink, RecipeIngredient } from '../types';
import { substituteQuantity } from './itemSubs';

/**
 * Standing swaps — "I never buy dairy milk, so every recipe calling for milk
 * reads and shops as oat milk" (#1571).
 *
 * One bit on `ItemSubLink` (`standing`), resolved here at read time. This is
 * the deliberate exception to the rule the rest of the substitute feature
 * obeys — a substitute informs, it never buys — and the exception is earned by
 * the mandate: the user named both items and ticked "always". Everything in
 * this module exists to keep that exception narrow.
 *
 * - **Nothing is written.** A swap rewrites a `RecipeIngredient` on its way out
 *   of `flattenRecipeIngredients`, exactly the way `ChoiceResolution` resolves
 *   an either/or, and the recipe row is untouched. Unticking the bit restores
 *   every recipe at once, and every authoring surface (the ingredient sheet,
 *   the reorder list, the share text) reads the recipe's own words because it
 *   never goes through here.
 * - **One hop, never a chain.** Milk→oat and oat→soy are two rules, each
 *   applied to its own line; a milk line does not become soy. Chaining would
 *   mean the swap you get depends on rules you didn't write about this
 *   ingredient.
 * - **A pair pointing at each other is not a rule.** Both directions marked
 *   standing can only mean the state got there by a restore or a half-applied
 *   sync — `linkItemSub` clears the reverse bit — so both are dropped rather
 *   than picking a winner.
 * - **A ratio that can't be applied refuses the whole swap.** Renaming the line
 *   and leaving an amount the ratio couldn't convert ("1 bulb garlic powder")
 *   is worse than not swapping, which is the same call `substituteQuantity`'s
 *   own unit refusal makes one level down.
 *
 * The per-line exception ("this pastry needs real butter") is
 * `RecipeIngredient.noSwap`, honoured here so no caller has to remember it.
 */

/** One rule, resolved against the catalog. */
export interface StandingSwap {
  link: ItemSubLink;
  /** What recipes call for. */
  from: GroceryItem;
  /** What you actually use. */
  to: GroceryItem;
}

/** `from.nameKey` → the rule. The shape every read here takes. */
export type StandingSwapMap = ReadonlyMap<string, StandingSwap>;

/**
 * The shared empty map, so a caller with nothing to apply doesn't allocate one
 * per render and the default parameter below is stable.
 */
export const NO_STANDING_SWAPS: StandingSwapMap = new Map<string, StandingSwap>();

/**
 * Every standing rule, oldest first — the Settings review list, and the source
 * `standingSwapMap` indexes.
 *
 * Resolve-or-shrug on either half being gone, like `substitutesFor`: the
 * delete cascade already takes those rows, so this covers a restored backup
 * rather than the mechanism.
 */
export function standingSwaps(
  links: readonly ItemSubLink[],
  items: readonly GroceryItem[]
): StandingSwap[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const standing = links.filter(l => l.standing);
  const isStanding = (itemId: string, subItemId: string) =>
    standing.some(l => l.itemId === itemId && l.subItemId === subItemId);

  return standing
    // A pair marked standing in both directions swaps into itself. Dropping
    // both is the refusal; `linkItemSub` is what stops it being reachable.
    .filter(l => !isStanding(l.subItemId, l.itemId))
    .filter(l => byId.has(l.itemId) && byId.has(l.subItemId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(l => ({ link: l, from: byId.get(l.itemId)!, to: byId.get(l.subItemId)! }));
}

/**
 * The rules, indexed by the name a recipe line would carry.
 *
 * At most one rule per item: "what do I always use instead of milk" has one
 * answer, and the oldest wins if two somehow exist — the store keeps it to one
 * (`linkItemSub` clears the bit on the item's other links), so this is the
 * same belt-and-braces the resolve-or-shrug filters above are.
 */
export function standingSwapMap(
  links: readonly ItemSubLink[],
  items: readonly GroceryItem[]
): StandingSwapMap {
  const map = new Map<string, StandingSwap>();
  for (const swap of standingSwaps(links, items)) {
    if (!swap.from.nameKey || map.has(swap.from.nameKey)) continue;
    map.set(swap.from.nameKey, swap);
  }
  return map;
}

/** One ingredient line, after the standing rules have had their say. */
export interface SwappedIngredient {
  /** What to shop for and show. The line itself, untouched, when nothing applied. */
  ingredient: RecipeIngredient;
  /**
   * The recipe's own name for this line, when a swap rewrote it — null the
   * rest of the time. **A swapped line is never rendered without it**: the
   * whole safety argument is that the app's substitution is legible as the
   * app's, the same job `≈` does for a converted amount.
   */
  swappedFrom: string | null;
}

/**
 * Applies whichever standing rule names this line, or hands it back untouched.
 *
 * The refusals, in the order they're checked:
 *
 * - **`noSwap`** — the line's own opt-out, and it outranks everything: a
 *   recipe saying "this one has to be real butter" is more specific than a
 *   standing rule about butter in general.
 * - **No rule for this name**, which is nearly every line.
 * - **A ratio that doesn't apply.** A link carrying one is claiming the
 *   substitute needs a *different* amount, so a line the ratio can't be read
 *   against ("a pinch", or a unit it wasn't written for) has no honest swapped
 *   quantity — and a swapped name over the original amount is the worst of the
 *   three outcomes. The line stays exactly as written.
 *
 * A ratio-less link — the common case, and the dietary one — carries the
 * line's quantity across verbatim. That isn't an assumed 1:1 conversion: it's
 * the user having said "use this instead" without qualifying the amount.
 */
export function applyStandingSwap(
  ingredient: RecipeIngredient,
  swaps: StandingSwapMap = NO_STANDING_SWAPS
): SwappedIngredient {
  const unchanged: SwappedIngredient = { ingredient, swappedFrom: null };
  if (ingredient.noSwap) return unchanged;
  const swap = swaps.get(ingredient.nameKey);
  if (!swap) return unchanged;

  let quantity = ingredient.quantity;
  const { ratioFrom, ratioTo } = swap.link;
  if (ratioFrom && ratioTo) {
    const converted = substituteQuantity(ingredient.quantity, ratioFrom, ratioTo);
    if (!converted.converted) return unchanged;
    quantity = converted.text;
  }

  return {
    ingredient: {
      ...ingredient,
      name: swap.to.name,
      nameKey: swap.to.nameKey,
      quantity,
      // The target's own filing rather than the original's. A link's two halves
      // are both catalog rows (linkItemSub requires it), so this hint is never
      // the one classifyPlanned reads — but a hint that named where *milk*
      // goes, on a line that now says oat milk, would be wrong the one time
      // something did.
      aisle: swap.to.aisle,
    },
    swappedFrom: ingredient.name,
  };
}

/**
 * "instead of milk" — what a swapped line says about itself.
 *
 * One helper because the recipe row, both add-to-list sheets and the item
 * sheet all have to say it, and a second phrasing is a second thing to keep
 * true. Lower-cased and lead-in-less so it drops into a row subtitle beside
 * `describeSubstitutesOnHand`'s "you have margarine".
 */
export function describeStandingSwap(swappedFrom: string): string {
  return `instead of ${swappedFrom.toLowerCase()}`;
}
