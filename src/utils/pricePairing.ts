/**
 * Matching a set of items to a set of prices when nothing connects them.
 *
 * Some registers print every line as "GROCERIES" and a number. The names are
 * gone, so `receiptMatch.ts` has nothing to work with — but the *prices* are
 * still real, and they are the one thing a barcode can never tell you. So the
 * two halves arrive separately: what came home (scanned, or ticked off the
 * list) and what it cost (read off the paper), with no correspondence between
 * them beyond both being true of the same trip.
 *
 * **This does not try to solve the assignment, and that is the design.** With
 * N items and N nameless prices there are N! orderings and no information to
 * choose between them. An app that picked one anyway would be inventing a
 * purchase history, silently, at the exact moment it is meant to be recording
 * one. The screen is two columns and a tap; this module only decides the rare
 * cases where the answer is forced.
 */

export interface PairItem {
  id: string;
  /**
   * What this usually costs here, in minor units, or null when nothing is on
   * record. Passed in rather than computed, so the caller owns the store
   * precedence in `typicalPriceFor` and this stays testable without a catalog.
   */
  baselineMinor: number | null;
}

/** itemId to an index into the price list. Absent means unpaired. */
export type Pairing = Record<string, number>;

/**
 * How far a price can sit from an item's usual price and still be read as that
 * item.
 *
 * The same 4x `receiptMatch.PRICE_CAUTION_FACTOR` uses, and deliberately so:
 * both answer "could this number plausibly be this thing", and two different
 * thresholds for one question is how they would come to disagree about the same
 * receipt. Blunt on purpose — sales, pack sizes and inflation all move a
 * grocery price a long way, so anything tighter would rule out correct pairings
 * and leave the user undoing guesses.
 */
const PAIR_FACTOR = 4;

function comparable(priceMinor: number, baselineMinor: number | null): boolean {
  if (baselineMinor === null || baselineMinor <= 0 || priceMinor <= 0) return false;
  const ratio = priceMinor / baselineMinor;
  return ratio <= PAIR_FACTOR && ratio >= 1 / PAIR_FACTOR;
}

/**
 * The pairing the evidence forces, or an empty one.
 *
 * Three rules, and the empty answer is the common one:
 *
 * - **The counts have to match.** A receipt carries bag fees, deposits and tax,
 *   and a trip carries things bought elsewhere. Unequal counts mean at least
 *   one price belongs to nothing on the list, and there is no way to tell
 *   which, so nothing is assumed.
 * - **One of each is free.** A single item and a single price have exactly one
 *   possible pairing whatever either of them is, so no price history is needed
 *   and none is consulted. This is much the most common small shop.
 * - **Otherwise the assignment has to be unique.** Every price must be
 *   plausible for exactly one item, and every item must be claimed by exactly
 *   one price. Anything short of that is a guess between orderings, which is
 *   the thing this refuses to make.
 *
 * Items with no price history are what usually stops a large receipt
 * auto-pairing, and that is correct rather than a shortcoming: an item nothing
 * is known about is not evidence, it is the absence of it. Same discipline
 * `tripMarkerFor` runs on.
 */
export function autoPairing(
  items: readonly PairItem[],
  prices: readonly number[],
): Pairing {
  if (items.length === 0 || items.length !== prices.length) return {};
  if (items.length === 1) return { [items[0].id]: 0 };

  const pairing: Pairing = {};
  const claimedBy = new Map<string, number>();

  for (let index = 0; index < prices.length; index++) {
    const candidates = items.filter(item => comparable(prices[index], item.baselineMinor));
    // Zero candidates means this price fits nothing known; more than one means
    // it fits several. Either way the ordering isn't forced, so the whole
    // pairing is abandoned rather than partially applied — a half-filled
    // column reads as an answer, and this isn't one.
    if (candidates.length !== 1) return {};
    const item = candidates[0];
    if (claimedBy.has(item.id)) return {};
    claimedBy.set(item.id, index);
    pairing[item.id] = index;
  }

  return Object.keys(pairing).length === items.length ? pairing : {};
}

/**
 * `pairing` with one item moved onto one price, and whatever that displaced
 * cleared.
 *
 * A price belongs to exactly one item and an item to exactly one price, so
 * pairing A to a price B already holds takes it off B. Doing that here rather
 * than in the screen's tap handler is what keeps the invariant true no matter
 * which order the taps come in, which is the thing hand-rolled two-column
 * pickers reliably get wrong.
 */
export function pairWith(pairing: Pairing, itemId: string, priceIndex: number): Pairing {
  const next: Pairing = {};
  for (const [id, index] of Object.entries(pairing)) {
    if (id === itemId || index === priceIndex) continue;
    next[id] = index;
  }
  next[itemId] = priceIndex;
  return next;
}

/** `pairing` with this item's price taken off, for a tap that undoes one. */
export function unpair(pairing: Pairing, itemId: string): Pairing {
  const next = { ...pairing };
  delete next[itemId];
  return next;
}

/** Which price indexes nothing has claimed, in printed order. */
export function unpairedPriceIndexes(pairing: Pairing, priceCount: number): number[] {
  const taken = new Set(Object.values(pairing));
  const out: number[] = [];
  for (let i = 0; i < priceCount; i++) if (!taken.has(i)) out.push(i);
  return out;
}

/**
 * The pairing as the `priceById` map every commit path here already speaks.
 *
 * Deliberately the same shape `ReceiptImportSheet` and `FinishShoppingSheet`
 * pass around, so pairing is an *input method* for recording a trip rather than
 * a second way of recording one. Same call the receipt sheet makes about not
 * being a new place a shop can end.
 */
export function pricesByItemId(
  pairing: Pairing,
  prices: readonly number[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [itemId, index] of Object.entries(pairing)) {
    const price = prices[index];
    if (price !== undefined) out[itemId] = price;
  }
  return out;
}
