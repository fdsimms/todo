import { format } from 'date-fns/format';
import type { GroceryItem, ItemShopLink, Shop } from '../types';
import { GROCERY_PRICE_MINOR_MAX } from '../types';
import { isUnavailable } from './groceryShops';

/**
 * What things cost — parsing a typed price, rendering one, and the one
 * comparison worth making across stores.
 *
 * **A price is a remembered observation, never a ledger.** Same principle the
 * pantry is built on: nobody maintains a price book, so every number here is
 * something the app watched happen (a finished trip) or something the user
 * corrected by hand, and it is always rendered with its age. See
 * GroceryItem.lastPriceMinor for the storage rules.
 *
 * Two things this module deliberately does not do:
 *
 * - **No arithmetic on `quantity`.** A per-unit price ("$0.21/oz") needs a
 *   parsed, normalised unit, so it would inherit every refusal
 *   parseQuantityAmount makes — and a comparison that silently drops the third
 *   of a catalog it can't parse is worse than no comparison. The quantity a
 *   price was for is carried as a verbatim string and shown next to it; the
 *   reader does the comparing.
 * - **No currency conversion, and no second currency.** There is one symbol,
 *   it's a setting, and it's cosmetic — every stored number is minor units of
 *   whatever the user shops in.
 */

/** Money is integers here — see the note on GroceryItem.lastPriceMinor. */
const MINOR_PER_MAJOR = 100;

/**
 * A typed price → minor units, or null if it isn't one.
 *
 * Deliberately forgiving about what a person types at a checkout: a bare
 * "4" is £4.00, "4.5" is £4.50, and a leading symbol or stray space is
 * ignored. Deliberately unforgiving about everything else — "a fiver" and
 * "4.99 each" are refusals, not guesses, the same call scaleQuantity makes
 * about an amount it can't read.
 *
 * More than two decimal places is a refusal rather than a rounding, because
 * the only way to type one is by accident and quietly turning 4.999 into 5.00
 * is how a number nobody checked ends up in a total.
 */
export function parsePriceInput(raw: string): number | null {
  // A leading currency symbol is dropped; a leading minus is deliberately not,
  // so it survives to fail the test below rather than being stripped into a
  // positive price.
  const trimmed = raw.trim().replace(/^[^\d.,\-]+/, '').trim();
  if (!trimmed) return null;
  // One separator, either convention: "4.50" and "4,50" are the same price.
  const normalized = trimmed.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const minor = Math.round(value * MINOR_PER_MAJOR);
  if (minor <= 0 || minor > GROCERY_PRICE_MINOR_MAX) return null;
  return minor;
}

/**
 * Minor units → what a person would read, always with both decimal places
 * ("$4.00", never "$4"). A price with a bare major unit reads as an estimate,
 * and these are the opposite — they're what the receipt said.
 */
export function formatPrice(minor: number, symbol: string): string {
  // Non-negative by construction — parsePriceInput refuses a negative and
  // nothing here subtracts — so there's no sign to render.
  const whole = Math.max(0, Math.round(minor));
  const major = Math.floor(whole / MINOR_PER_MAJOR);
  const rest = whole % MINOR_PER_MAJOR;
  return `${symbol}${major}.${String(rest).padStart(2, '0')}`;
}

/**
 * Minor units → an editable field's value ("4.29"), with no symbol and no
 * padding beyond the cents. What a price field is seeded with, so what comes
 * back out of parsePriceInput is what went in.
 */
export function priceToInput(minor: number): string {
  return (minor / MINOR_PER_MAJOR).toFixed(2);
}

/**
 * How stale a price is, in the app's usual shorthand: "today", "Mar", "Mar
 * 2024". A month rather than a day because nobody needs the date they bought
 * milk — they need to know whether the number is worth trusting, and the month
 * is what answers that. The year appears only once it isn't this one.
 */
export function describePriceAge(pricedAt: string, now: Date): string | null {
  const then = new Date(pricedAt);
  if (Number.isNaN(then.getTime())) return null;
  const sameMonth =
    then.getFullYear() === now.getFullYear() && then.getMonth() === now.getMonth();
  if (sameMonth) return 'this month';
  return format(then, then.getFullYear() === now.getFullYear() ? 'MMM' : 'MMM yyyy');
}

/**
 * The caption under the item sheet's price field: what that price was *for*,
 * and how old it is. Deliberately without the number — the field beside it is
 * already showing that, and a caption repeating it reads as a second, possibly
 * different price.
 *
 * Null when nothing has ever been priced: the sheet shows no caption rather
 * than "no price yet", which is furniture saying nothing.
 */
export function describePriceContext(item: GroceryItem, now: Date): string | null {
  if (item.lastPriceMinor === null) return null;
  const age = item.lastPricedAt ? describePriceAge(item.lastPricedAt, now) : null;
  const head = item.lastPriceQuantity ? `Last paid for ${item.lastPriceQuantity}` : 'Last paid';
  return age ? `${head} · ${age}` : head;
}

/**
 * The store-by-store line: "Costco $3.19 (cheapest) · Safeway $4.29", cheapest
 * first.
 *
 * Every priced store is listed rather than only the winner, because the reason
 * cheapestShopFor refuses an answer is usually visible in the list itself — two
 * prices for different quantities sit side by side with their quantities, and
 * the reader can see in one line what no comparison could safely conclude.
 *
 * **The verdict is a tag inside the list, not a sentence after it.** A separate
 * "Cheapest at Costco." line repeats a name the list already leads with, and
 * three grey captions under one field is furniture. As a tag it also can't
 * drift from the data it's labelling: pass `cheapestShopId` only from
 * cheapestShopFor, and where that refuses, the list simply carries no tag and
 * claims nothing.
 */
export function describeShopPrices(
  prices: readonly ShopPrice[],
  symbol: string,
  cheapestShopId?: string | null
): string | null {
  if (prices.length === 0) return null;
  return prices
    .map(p => {
      const amount = formatPrice(p.minor, symbol);
      const head = p.quantity
        ? `${p.shop.name} ${amount} for ${p.quantity}`
        : `${p.shop.name} ${amount}`;
      return p.shop.id === cheapestShopId ? `${head} (cheapest)` : head;
    })
    .join(' · ');
}

export interface ShopPrice {
  shop: Shop;
  minor: number;
  pricedAt: string | null;
  quantity: string | null;
}

/**
 * Every store that has a price for this item, cheapest first — the "where is
 * it cheaper" read, and the reason prices live on ItemShopLink at all.
 *
 * A store the user has said doesn't stock the item is not one of them,
 * whatever price it last had: the negative claim is the current answer and a
 * price is history, exactly as shopsForItem already has it. A store whose link
 * carries no price is simply absent — an unpriced store is not a cheap one.
 *
 * `excludeFromSuggestions` stores stay in, unlike primaryShopFor: this is a
 * comparison the user asked to see, not a recommendation the app is making,
 * and "Amazon had it for less" is a fact worth reading even when Amazon should
 * never be suggested.
 */
export function shopPricesFor(
  itemId: string,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): ShopPrice[] {
  const byId = new Map(shops.map(s => [s.id, s]));
  const out: ShopPrice[] = [];
  for (const link of links) {
    if (link.itemId !== itemId || link.lastPriceMinor === null || isUnavailable(link)) continue;
    const shop = byId.get(link.shopId);
    // Resolve-or-shrug, like every other cross-row pointer here.
    if (!shop) continue;
    out.push({
      shop,
      minor: link.lastPriceMinor,
      pricedAt: link.lastPricedAt,
      quantity: link.lastPriceQuantity,
    });
  }
  return out.sort((a, b) => a.minor - b.minor || a.shop.name.localeCompare(b.shop.name));
}

/**
 * The cheapest store for an item, or null when there's nothing to compare.
 *
 * **Two priced stores minimum.** One store with a price is not a comparison —
 * saying "cheapest at Costco" when Costco is the only place you've ever priced
 * it is the app inventing a finding out of a single observation.
 *
 * Prices for different quantities are not compared either: "$4.29 for 2 lb"
 * against "$3.19 for 1 lb" is a worse deal dressed as a better one, and
 * normalising them means dividing by a parsed unit, which this module doesn't
 * do (see the header). Unequal quantity strings therefore mean no answer —
 * both prices are still shown by shopPricesFor, side by side, where the reader
 * can see exactly why.
 */
export function cheapestShopFor(
  itemId: string,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): ShopPrice | null {
  const priced = shopPricesFor(itemId, links, shops);
  if (priced.length < 2) return null;
  const [best, next] = priced;
  // A tie is not a cheapest.
  if (best.minor === next.minor) return null;
  const quantityKey = (q: string | null) => (q ?? '').trim().toLowerCase();
  if (priced.some(p => quantityKey(p.quantity) !== quantityKey(best.quantity))) return null;
  return best;
}

export interface ListEstimate {
  /** The sum of what's known, in minor units. */
  totalMinor: number;
  /** How many rows contributed a price… */
  priced: number;
  /** …out of how many are on the list. Never render one without the other. */
  total: number;
}

/**
 * What the list is likely to cost, and — inseparably — how much of the list
 * that number actually covers.
 *
 * The two travel together because a total built from 9 of 14 rows, rendered
 * bare, reads as the price of the shop. Same failure describeRecipe's
 * "· 1 component" clause exists to prevent, and the reason estimateListTotal
 * hands back a count rather than a formatted string.
 *
 * A staple contributes nothing and isn't counted against the total either:
 * salt is on the list because the recipe named it, not because anyone is
 * buying salt today, and letting it drag the coverage fraction down would make
 * a fully-priced trip look half-known.
 *
 * The stored price is used as-is, with no attempt to scale it by this week's
 * quantity — see the header. It's an estimate, it's marked as one, and the
 * arithmetic that would make it look precise is the arithmetic this module
 * refuses to do.
 */
export function estimateListTotal(items: readonly GroceryItem[]): ListEstimate {
  let totalMinor = 0;
  let priced = 0;
  let total = 0;
  for (const item of items) {
    if (!item.onList || item.isStaple) continue;
    total += 1;
    if (item.lastPriceMinor === null) continue;
    totalMinor += item.lastPriceMinor;
    priced += 1;
  }
  return { totalMinor, priced, total };
}

/**
 * The estimate as the list header says it: "≈ $47.30 · 9 of 14 priced".
 *
 * `≈` for the same reason a converted quantity carries one — it's the app's
 * number rather than a figure anyone was quoted — and null until at least one
 * row has a price, since "≈ $0.00 · 0 of 14 priced" is a header telling you
 * nothing in more words than silence.
 */
export function describeListEstimate(estimate: ListEstimate, symbol: string): string | null {
  if (estimate.priced === 0) return null;
  const total = formatPrice(estimate.totalMinor, symbol);
  return estimate.priced === estimate.total
    ? `≈ ${total}`
    : `≈ ${total} · ${estimate.priced} of ${estimate.total} priced`;
}

/**
 * The one place the "which price do I seed a field with" rule lives: what this
 * item cost at *this* store if it's been priced there, else what it cost
 * anywhere. Standing in Costco, last week's Costco price is the number worth
 * showing; with no Costco price, the last one you paid is still a better
 * starting point than an empty field.
 */
export function lastPriceFor(
  item: GroceryItem,
  shopId: string | null,
  links: readonly ItemShopLink[]
): number | null {
  if (shopId) {
    const link = links.find(l => l.itemId === item.id && l.shopId === shopId);
    if (link?.lastPriceMinor != null) return link.lastPriceMinor;
  }
  return item.lastPriceMinor;
}
