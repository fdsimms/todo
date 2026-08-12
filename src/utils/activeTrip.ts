import type { ItemShopLink, Shop } from '../types';
import { exclusiveShopFor, isUnavailable, primaryShopFor } from './groceryShops';

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
 * `kind` is the whole vocabulary, and there are only three because every one of
 * them is backed by something the user themselves recorded:
 *
 * - `unavailable` — they marked this store as not stocking it. The only hard
 *   negative, and it outranks everything below.
 * - `only` — every store on record for it is one other store. Includes a
 *   hand-assertion, because "I get this at Costco" is exactly that claim.
 * - `usually` — they've *bought* it somewhere else more than anywhere else.
 *
 * **Silence is the default and it is load-bearing.** A row this store has any
 * link for says nothing, and so does a row nothing is known about — the app not
 * having watched you buy tahini anywhere is ignorance, not evidence that this
 * store lacks it. Marking those up would put a grey caption on most of the list
 * on the first trip anyone ever takes, which is how the whole feature would
 * come to be read as noise. Same discipline as `shoppingTrip.ts`, where the
 * only line allowed to assert an absence is the one the user asserted first.
 */
export type TripMarkerKind = 'unavailable' | 'only' | 'usually';

export interface TripMarker {
  kind: TripMarkerKind;
  /** For `unavailable` this is the store you're at; otherwise the other one. */
  shop: Shop;
}

export function tripMarkerFor(
  itemId: string,
  links: readonly ItemShopLink[],
  shops: readonly Shop[],
  trip: Shop
): TripMarker | null {
  const here = links.find(l => l.itemId === itemId && l.shopId === trip.id);
  if (here) {
    return isUnavailable(here) ? { kind: 'unavailable', shop: trip } : null;
  }

  // Nothing on record here. Anything to say now has to come from a link naming
  // a *different* store — and `exclusiveShopFor` before `primaryShopFor`
  // because "only" is the stronger claim when both would answer.
  const only = exclusiveShopFor(itemId, links, shops);
  if (only && only.id !== trip.id) return { kind: 'only', shop: only };

  const usually = primaryShopFor(itemId, links, shops);
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
      return `Not at ${marker.shop.name}`;
    case 'only':
      return `Only at ${marker.shop.name}`;
    case 'usually':
      return `Usually ${marker.shop.name}`;
  }
}
