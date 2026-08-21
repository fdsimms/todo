import type { GroceryItem, ItemProduct, ItemShopLink, ItemSubLink, Shop } from '../types';
import { exclusiveShopFor, isUnavailable, lacksWantedProduct, primaryShopFor } from './groceryShops';
import { describePreferredProduct } from './groceryProduct';
import { substitutesFor } from './itemSubs';

/**
 * The trip you are on right now — "I'm at this store".
 *
 * `shoppingTrip.ts` is the other half and answers a different question: which
 * stores *would* cover the list, before you've gone anywhere. That one is
 * planning and holds no state. This one is the trip actually happening, and
 * it's the first piece of state this app has ever had that means "right now".
 *
 * **Stored as a shop id plus a start stamp, and everything else is derived.**
 * There is no `isActive` boolean and no timer that ends a trip. The same call
 * `timer.ts` makes about a countdown and `visibilityUtils`' `isDismissedToday`
 * makes about a dismissal: a stored flag has to be cleared by something, and
 * whatever that something is won't be running while the app is closed. A stamp
 * compared against the clock is right on the next read with nothing to run.
 *
 * That matters here more than usual, because the failure this design rules out
 * is specific and bad: a trip started on Saturday evening still marking rows up
 * on Sunday morning, telling you that you don't usually buy this at a store you
 * are not standing in.
 */

/**
 * How long a trip can stay live.
 *
 * A shop is at most a couple of hours, so six is generous enough that a slow
 * one is never cut off mid-aisle, and short enough that a trip abandoned in the
 * evening is gone by morning. It is deliberately not the logical-day rollover
 * that `isDismissedToday` uses: an 11pm shop is a real thing, and a day reset
 * would end it twenty minutes in.
 */
export const TRIP_MAX_MS = 6 * 60 * 60 * 1000;

/**
 * Is a trip that started at `startedAt` still running?
 *
 * A stamp in the future counts as live rather than expired — the clock moving
 * backwards (a timezone change, a manual set) shouldn't silently end a trip
 * someone is in the middle of, and the same clamp is what `timerElapsed` does
 * with a negative elapsed. The way out of a trip stuck live is the one the user
 * already has: Clear, or finishing the shop.
 */
export function isTripLive(startedAt: string | null, now: Date): boolean {
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  const elapsed = now.getTime() - started;
  if (elapsed < 0) return true;
  return elapsed < TRIP_MAX_MS;
}

/**
 * How long a trip runs before it's plausibly been left running rather than
 * actively shopped — the persistent trip bar's cue to switch from a plain
 * status ("Shopping at Costco") to a nudge ("Still at Costco?"). Well under
 * `TRIP_MAX_MS`: the bar is meant to catch a trip on reopen, before it ages
 * out on its own with nobody having seen it.
 */
export const TRIP_STALE_MS = 45 * 60 * 1000;

/**
 * Has a live trip run long enough to nudge about? Callers are expected to
 * have already checked `isTripLive` (or gone through `resolveActiveTrip`) —
 * this only answers the "how long" half, same split `isTripLive` itself
 * keeps from `resolveActiveTrip`.
 */
export function isTripStale(startedAt: string | null, now: Date): boolean {
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started >= TRIP_STALE_MS;
}

/**
 * "24 min" / "1h 42m" — how long a trip has been running, for the persistent
 * trip bar. Same Xh/Ym shape `formatWindowRemaining` (dateUtils.ts) renders,
 * without its "left" suffix: that one counts down to a clock time, this
 * counts up from a start stamp.
 */
export function describeTripElapsed(startedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(startedAt)) / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins} min`;
}

/**
 * The store you're at, or null — the one read every caller should use.
 *
 * Resolve-or-shrug on both halves, and both matter: the shop can have been
 * deleted since the trip started (same reason `initialize` re-checks
 * `lastShopId` against live rows rather than trusting it), and the trip can
 * have aged out. A caller that checked only the id would mark rows up against
 * a store the user left hours ago.
 */
export function resolveActiveTrip(
  shopId: string | null,
  startedAt: string | null,
  shops: readonly Shop[],
  now: Date
): Shop | null {
  if (!shopId || !isTripLive(startedAt, now)) return null;
  return shops.find(s => s.id === shopId) ?? null;
}

/**
 * What the row has to say about this item at the store you're standing in.
 *
 * `kind` is the whole vocabulary, and every one of them is backed by something
 * the user themselves recorded:
 *
 * - `unavailable` — they marked this store as not stocking it. The hardest
 *   negative, and it outranks everything below.
 * - `withoutProduct` — the user has said this store hasn't got the product the
 *   item insists on. The store has the thing; it hasn't got *your* thing. Like
 *   every other kind here it's their own claim, never an inference from a
 *   product observed on a past purchase — a store carries several versions of a
 *   thing, so having got another one here says nothing (lacksWantedProduct).
 * - `only` — every store on record for it is one other store. Includes a
 *   hand-assertion, because "I get this at Costco" is exactly that claim.
 * - `usually` — they've *bought* it somewhere else more than anywhere else.
 *
 * `withoutProduct` is the one kind that speaks about a store the row already
 * has a link for, and it's why the early return below is no longer a bare "we
 * know this store, say nothing". A link used to mean the store covers the row;
 * with a product rule in play it can instead carry the exact refusal the
 * shopper is standing in front of.
 *
 * **Silence is the default and it is load-bearing.** A row this store has any
 * link for says nothing, and so does a row nothing is known about — the app not
 * having watched you buy tahini anywhere is ignorance, not evidence that this
 * store lacks it. Marking those up would put a grey caption on most of the list
 * on the first trip anyone ever takes, which is how the whole feature would
 * come to be read as noise. Same discipline as `shoppingTrip.ts`, where the
 * only line allowed to assert an absence is the one the user asserted first.
 */
export type TripMarkerKind = 'unavailable' | 'withoutProduct' | 'only' | 'usually';

export interface TripMarker {
  kind: TripMarkerKind;
  /**
   * For `unavailable` and `withoutProduct` this is the store you're at;
   * otherwise the other one.
   */
  shop: Shop;
  /** `withoutProduct` only: the product the item insists on, in its own words. */
  wantedProduct?: string;
  /**
   * `unavailable` only: the oldest substitute on record for this item, if any
   * (see itemSubs.substitutesFor). This is the highest-value moment for a
   * substitute link — you're standing in front of the empty shelf — so the
   * marker rides the clause rather than the row growing a fourth caption; see
   * describeTripMarker and GroceryRow's tap-to-swap.
   */
  substitute?: GroceryItem;
}

export function tripMarkerFor(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[],
  trip: Shop,
  subLinks: readonly ItemSubLink[] = [],
  items: readonly GroceryItem[] = [],
  products: readonly ItemProduct[] = []
): TripMarker | null {
  const here = links.find(l => l.itemId === item.id && l.shopId === trip.id);
  if (here) {
    // Not stocking it at all outranks not having your product — it's the
    // stronger claim, and both are the user's own.
    if (isUnavailable(here)) {
      const substitute = substitutesFor(item.id, subLinks, items)[0]?.item;
      return { kind: 'unavailable', shop: trip, substitute };
    }
    if (lacksWantedProduct(here, item)) {
      const wantedProduct = describePreferredProduct(item, products);
      // A claim can only be in force while it names a product that resolves,
      // so this is non-null in practice — but the caption reads the words, and
      // a marker that can't say which box it means is worse than silence.
      if (wantedProduct) return { kind: 'withoutProduct', shop: trip, wantedProduct };
    }
    // Otherwise this store covers the row, so say nothing.
    return null;
  }

  // Nothing on record here. Anything to say now has to come from a link naming
  // a *different* store — and `exclusiveShopFor` before `primaryShopFor`
  // because "only" is the stronger claim when both would answer. Both already
  // drop the stores said to lack your product, so on a strict item "Only at
  // Costco" means Costco is the one place left you can get yours.
  const only = exclusiveShopFor(item, links, shops);
  if (only && only.id !== trip.id) return { kind: 'only', shop: only };

  const usually = primaryShopFor(item, links, shops);
  if (usually && usually.id !== trip.id) return { kind: 'usually', shop: usually };

  return null;
}

/**
 * The caption itself. One function so the row, and anything that later wants to
 * summarise the same set, can't come to word it differently — the reason
 * `describeShops` exists next door, and the reason "usually" is spelled the
 * same way here as it is there.
 */
export function describeTripMarker(marker: TripMarker): string {
  switch (marker.kind) {
    case 'unavailable':
      // Rides inside the marker that's already there rather than adding a
      // line — a fourth caption is how the row becomes unreadable while
      // walking. Only ever the one substitute TripMarker carries; naming a
      // second here would say more than tapping the caption can act on.
      //
      // Drops the shop's name once a substitute joins the clause, same
      // reasoning `withoutProduct` already runs on below: you're standing in
      // it, so naming it is the one fact on the row you don't need — and
      // "Not at Trader Joe's · or margarine" was two facts stapled into one
      // line before the swap could even happen. "Not here" names the same
      // shop with a third the words, leaving room for the one that matters:
      // what to grab instead.
      return marker.substitute
        ? `Not here · or ${marker.substitute.name}`
        : `Not at ${marker.shop.name}`;
    // Names the product rather than the store: you're standing in the store, so
    // its name is the one fact on the row you don't need. It deliberately
    // doesn't name what this shop *does* carry — the app only knows what you
    // last got here, which on a shelf holding several versions is a fact about
    // one purchase and not about today.
    case 'withoutProduct':
      return `No ${marker.wantedProduct} here`;
    case 'only':
      return `Only at ${marker.shop.name}`;
    case 'usually':
      return `Usually ${marker.shop.name}`;
  }
}

/**
 * The caption for an `unavailable` marker once its row sits under its
 * aisle's own "Not here" group instead of inline (see GroceryScreen) — a
 * second-generation version of the same problem `describeTripMarker`'s
 * `unavailable` case already solved once: restating the store's own
 * negative claim on every row under a header that already said it once is
 * exactly the over-stuffed caption that case was shortened to avoid.
 *
 * Every row under that header is `unavailable` by construction, so there is
 * nothing left to say beyond the one thing the header doesn't know: what to
 * grab instead. Empty when there's no substitute on record — the row says
 * nothing at all, same silence rule as everywhere else in this module.
 */
export function describeGroupedUnavailable(marker: TripMarker): string {
  return marker.substitute ? `or ${marker.substitute.name}` : '';
}
