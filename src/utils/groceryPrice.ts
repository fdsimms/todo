import { format } from 'date-fns/format';
import type { GroceryItem, ItemShopLink, PriceObservation, Shop } from '../types';
import { GROCERY_PRICE_MINOR_MAX } from '../types';
import { isUnavailable } from './groceryShops';
import { parseQuantity, rationalToNumber } from './quantity';
import { measureQuantity, shelfUnit, type Dimension } from './unitConvert';
import { priceBaseline, priceRunForProduct, priceStanding, type PriceStanding } from './priceHistory';

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
 * **Per-unit arithmetic is allowed, and only ever all-or-nothing.** This module
 * used to refuse it outright, on the grounds that a comparison silently
 * dropping the part of a set it can't parse is worse than no comparison. That
 * concern is the design, not the refusal — so nothing is ever dropped: a set is
 * compared per unit only when *every* price in it names a quantity that can be
 * measured, in one dimension. One "a bunch" among them and the whole set falls
 * back to what it always did, which is to state the prices and rank nothing
 * (`unitPricesFor`). The set is small, it's one item's prices, and it's on
 * screen — so the reader can see exactly what was and wasn't answered.
 *
 * The measuring itself is `unitConvert.measureQuantity`, so the units live in
 * one table rather than two.
 *
 * One thing this module still deliberately does not do: **no currency
 * conversion, and no second currency**. There is one symbol, it's a setting,
 * and it's cosmetic — every stored number is minor units of whatever the user
 * shops in.
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
 *
 * A leading decimal point with nothing before it ("`.75`") is read as "0.75",
 * not refused — a decimal-pad keyboard doesn't insert the leading zero for
 * you, so typing anything under $1 naturally lands here.
 */
export function parsePriceInput(raw: string): number | null {
  // A leading currency symbol is dropped; a leading minus is deliberately not,
  // so it survives to fail the test below rather than being stripped into a
  // positive price.
  const trimmed = raw.trim().replace(/^[^\d.,\-]+/, '').trim();
  if (!trimmed) return null;
  // One separator, either convention: "4.50" and "4,50" are the same price.
  let normalized = trimmed.replace(',', '.');
  if (normalized.startsWith('.')) normalized = `0${normalized}`;
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
 * Cents-first price entry, the way a checkout keypad (or YNAB) does it: every
 * digit typed shifts the amount one place, so typing "4", "9", "9" reads
 * "0.04", "0.49", "4.99" in turn. There's no decimal point to type, and typing
 * one does nothing — `raw` is stripped down to its digits before anything
 * else happens, the same first move formatPhoneInput makes.
 *
 * Idempotent like that function too: `raw` is whatever the field already
 * holds (last keystroke's own output, plus whichever key was just pressed),
 * so this rebuilds the amount from scratch every time rather than tracking
 * state of its own, and it's safe to run on every keystroke. Backspacing
 * drops the last digit the same way it dropped the last character, and
 * running out of digits returns '' — an empty field, not "$0.00", same as the
 * clear button next to it and the same call parsePriceInput's own "0" refusal
 * makes: zero is not a price.
 *
 * Clamped to GROCERY_PRICE_MINOR_MAX rather than left to grow past it — typing
 * a ninth digit at the ceiling leaves the field reading the ceiling, not a
 * number nobody meant to enter.
 */
export function formatPriceInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits || digits === '0') return '';
  return priceToInput(Math.min(Number(digits), GROCERY_PRICE_MINOR_MAX));
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
 *
 * **Where the ranking is per unit, the line shows its working**: "Safeway $3.19
 * for 1 lb · Costco $4.29 for 2 lb (≈$2.15/lb, cheapest)". Without it a tag on
 * the larger number reads as a bug — the whole point is that $4.29 beats $3.19
 * here, and a reader can't be asked to take that on faith. A quantity that *is*
 * one display unit says nothing extra, since its per-unit price is the price
 * already printed two words to the left.
 */
export function describeShopPrices(
  prices: readonly ShopPrice[],
  symbol: string,
  cheapestShopId?: string | null
): string | null {
  if (prices.length === 0) return null;
  // Only when they differ: identical quantities are directly comparable, and
  // "$3.19 for 1 lb (≈$3.19/lb)" is the same number twice.
  const quantityKey = (q: string | null) => (q ?? '').trim().toLowerCase();
  const mixed = prices.some(p => quantityKey(p.quantity) !== quantityKey(prices[0].quantity));
  const perUnit = mixed ? unitPricesFor(prices) : null;

  return prices
    .map(p => {
      const amount = formatPrice(p.minor, symbol);
      const head = p.quantity
        ? `${p.shop.name} ${amount} for ${p.quantity}`
        : `${p.shop.name} ${amount}`;
      const rate = perUnit?.find(u => u.shop.id === p.shop.id);
      const clauses = [
        rate && !rate.redundant ? unitPriceText(rate.minorPerUnit, rate.unit, symbol) : null,
        p.shop.id === cheapestShopId ? 'cheapest' : null,
      ].filter(Boolean);
      return clauses.length > 0 ? `${head} (${clauses.join(', ')})` : head;
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

export interface Comparable {
  /** How much: base units for a measurement, its own unit for a count. */
  amount: number;
  /** Two quantities are comparable exactly when these match. */
  key: string;
  /** A measurement, and which units to answer it in. Null for a count. */
  measure: { dimension: Dimension; system: 'metric' | 'us' } | null;
  /** A count's unit word — '' for a bare number ("12"). Empty for a measurement. */
  countUnit: string;
}

/**
 * A quantity string as something two prices can be divided by, or null when it
 * isn't one ("a bunch", "some", an empty quantity).
 *
 * A count is comparable to another count of the same word — "3 cans" against "5
 * cans", "12" against "6" — which is safe *here* in a way it would not be in
 * general: every price in a set is a price for the one item, so its counts are
 * counts of the same thing. That's also why the unit word has to match exactly
 * rather than being coerced: "1 bag" against "6" is two ways of counting one
 * item, and nothing in the app knows how many are in the bag.
 *
 * Exported for recipeCost.ts, which relates a recipe line's quantity to a
 * remembered purchase quantity the same all-or-nothing way unitPricesFor
 * relates two stores' — one gate for "when is it safe to divide one quantity
 * by another", not a second one growing up beside it.
 */
export function comparableQuantity(quantity: string | null): Comparable | null {
  const text = (quantity ?? '').trim();
  if (!text) return null;

  const measured = measureQuantity(text);
  // Prefixed keys so a measurement and a count can never collide on a word.
  if (measured) {
    return {
      amount: measured.base,
      key: `dim:${measured.dimension}`,
      measure: { dimension: measured.dimension, system: measured.system },
      countUnit: '',
    };
  }

  const q = parseQuantity(text);
  if (q.amount === null) return null;
  const value = rationalToNumber(q.amount);
  if (value <= 0) return null;
  // A range ("1 to 2 tbsp") names two amounts; pricing off the low end alone
  // would misreport the per-unit cost.
  if (q.rangeMax) return null;
  // '' for a bare number ("12") and for a counted container ("2 14 oz cans",
  // whose leading amount is followed by a second number rather than a word).
  const unit = q.unit ?? '';
  return { amount: value, key: `unit:${unit}`, measure: null, countUnit: unit };
}

export interface UnitPrice {
  shop: Shop;
  /** Minor units per display unit, rounded — a price is compared as it's shown. */
  minorPerUnit: number;
  /** "kg", "lb", "can" — or '' for a bare count, which reads "each". */
  unit: string;
  /**
   * The quantity is exactly one display unit, so the per-unit price is the
   * price already on screen. Nothing worth saying twice — see describeShopPrices.
   */
  redundant: boolean;
}

/**
 * Every price in a set expressed per unit, or null when the set can't be
 * compared that way.
 *
 * All-or-nothing by design (see the header): one quantity that can't be
 * measured, or two that measure in different dimensions, refuses the set rather
 * than ranking the part of it that happened to parse.
 *
 * **The units are the winner's**, not a fixed canonical pair: a set written in
 * pounds is answered in pounds. Where a set mixes systems, whichever price wins
 * decides, since that's the one the verdict names.
 */
export function unitPricesFor(prices: readonly ShopPrice[]): UnitPrice[] | null {
  if (prices.length < 2) return null;

  const parsed: Comparable[] = [];
  for (const price of prices) {
    const part = comparableQuantity(price.quantity);
    if (!part) return null;
    parsed.push(part);
  }
  const { key } = parsed[0];
  if (parsed.some(p => p.key !== key)) return null;

  // Cheapest per base unit — needed before the display unit can be picked, since
  // it's the winner's own system that gets answered in.
  let best = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i].minor / parsed[i].amount < prices[best].minor / parsed[best].amount) best = i;
  }
  const measure = parsed[best].measure;
  const display = measure
    ? shelfUnit(measure.dimension, measure.system)
    : { unit: parsed[best].countUnit, base: 1 };

  const out: UnitPrice[] = [];
  for (let i = 0; i < prices.length; i++) {
    const minorPerUnit = Math.round((prices[i].minor / parsed[i].amount) * display.base);
    // A price that rounds away to nothing per unit has no comparison to state,
    // and "$0.00/kg" is worse than the silence it would replace.
    if (minorPerUnit <= 0) return null;
    out.push({
      shop: prices[i].shop,
      minorPerUnit,
      unit: display.unit,
      redundant: parsed[i].amount === display.base,
    });
  }
  return out;
}

/** "≈$2.15/lb", or "≈$0.36 each" for a bare count with no unit word to hang on. */
function unitPriceText(minorPerUnit: number, unit: string, symbol: string): string {
  const amount = formatPrice(minorPerUnit, symbol);
  // `≈` for the same reason a converted quantity carries one: it's the app's
  // number, arrived at by dividing and rounding, not one anybody was quoted.
  return unit ? `≈${amount}/${unit}` : `≈${amount} each`;
}

/**
 * The cheapest store for an item, or null when there's nothing to compare.
 *
 * **Two priced stores minimum.** One store with a price is not a comparison —
 * saying "cheapest at Costco" when Costco is the only place you've ever priced
 * it is the app inventing a finding out of a single observation.
 *
 * Prices recorded for the same quantity are compared as they stand. Prices for
 * *different* quantities — "$4.29 for 2 lb" against "$3.19 for 1 lb", a better
 * deal that looks like a worse one — go through unitPricesFor, which answers
 * only when every quantity in the set can be measured. When it declines, so
 * does this: both prices are still shown by shopPricesFor, side by side, where
 * the reader can see exactly what couldn't be compared.
 *
 * **A tie is not a cheapest**, at either resolution. Per unit that's judged on
 * the rounded figures, because those are the ones on screen — naming a winner
 * two stores that both read "≈$2.15/lb" reads as a bug, whichever of them is
 * a hundredth of a penny ahead.
 */
export function cheapestShopFor(
  itemId: string,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): ShopPrice | null {
  const priced = shopPricesFor(itemId, links, shops);
  if (priced.length < 2) return null;

  const quantityKey = (q: string | null) => (q ?? '').trim().toLowerCase();
  const [best, next] = priced;
  if (priced.every(p => quantityKey(p.quantity) === quantityKey(best.quantity))) {
    // Sorted by price already, so the first two are the ones that can tie.
    return best.minor === next.minor ? null : best;
  }

  const perUnit = unitPricesFor(priced);
  if (!perUnit) return null;
  const ranked = [...perUnit].sort((a, b) => a.minorPerUnit - b.minorPerUnit);
  if (ranked[0].minorPerUnit === ranked[1].minorPerUnit) return null;
  return priced.find(p => p.shop.id === ranked[0].shop.id) ?? null;
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
  return lastPricedAmountFor(item, shopId, links)?.minor ?? null;
}

/**
 * The same answer as `lastPriceFor`, carrying the quantity it was the price
 * *of*.
 *
 * A price without its quantity can only be compared against another price for
 * the same size, which is the ambiguity `lastPriceQuantity` exists to close —
 * so anything doing arithmetic across two prices needs both halves, and getting
 * them from two lookups is how the pair comes to disagree about which store's
 * price it's holding. `lastPriceFor` delegates here rather than restating the
 * rule beside it.
 *
 * **Deliberately not scoped to the preferred product**, unlike `typicalPriceFor`
 * and `priceStandingFor` beside it. Those read the *run*, which carries a
 * `productId` per observation; this reads the stored scalar, which is a single
 * fact about the row and is also what `setItemPrice` writes when a price is
 * corrected by hand without appending to the run. Deriving it from the filtered
 * run instead would quietly discard that correction, and "the last price you
 * recorded" is exactly the number a user can point at a receipt for.
 */
export function lastPricedAmountFor(
  item: GroceryItem,
  shopId: string | null,
  links: readonly ItemShopLink[]
): { minor: number; quantity: string | null } | null {
  if (shopId) {
    const link = links.find(l => l.itemId === item.id && l.shopId === shopId);
    if (link?.lastPriceMinor != null) {
      return { minor: link.lastPriceMinor, quantity: link.lastPriceQuantity };
    }
  }
  if (item.lastPriceMinor == null) return null;
  return { minor: item.lastPriceMinor, quantity: item.lastPriceQuantity };
}

/**
 * What this item *usually* costs — the median of the run kept for it, falling
 * back to the last price when there is no run to take one of.
 *
 * The fallback is the whole reason this reads as an improvement rather than a
 * migration: an install with no history behaves exactly as it did, and each
 * trip makes the answer a little better. Same store-then-item precedence
 * `lastPricedAmountFor` uses, and the same return shape, so a caller swaps one
 * for the other and changes nothing else.
 *
 * **For measuring *against*, not for display.** A median is the right thing to
 * ask "is this price odd" and the wrong thing to print as what something costs
 * — that's `lastPriceMinor`, which is a number the user can actually point at a
 * receipt for.
 */
export function typicalPriceFor(
  item: GroceryItem,
  shopId: string | null,
  links: readonly ItemShopLink[]
): { minor: number; quantity: string | null } | null {
  // Scoped to the box the row is asking for, at both levels — the same call
  // the store precedence below makes, one axis over: a median mixing Arnold's
  // whole wheat with the store brand describes neither, exactly as a median
  // mixing Costco with Safeway describes neither. `priceRunForProduct` falls
  // back to the unfiltered run when there isn't enough of the preferred box to
  // be a baseline, so this can never answer with less than it used to.
  const run = (history: readonly PriceObservation[]) =>
    priceRunForProduct(history, item.preferredProductId).history;

  if (shopId) {
    const link = links.find(l => l.itemId === item.id && l.shopId === shopId);
    // A store with a run of its own answers for itself: what Costco charges and
    // what Safeway charges are different numbers, and a median across both
    // describes neither.
    if (link) {
      const fromShop = priceBaseline(run(link.priceHistory));
      if (fromShop) return fromShop;
      if (link.lastPriceMinor != null) {
        return { minor: link.lastPriceMinor, quantity: link.lastPriceQuantity };
      }
    }
  }
  return priceBaseline(run(item.priceHistory)) ?? lastPricedAmountFor(item, shopId, links);
}

/**
 * Where the price on the field stands against the run kept for it — the
 * question "is this a good price, right now" answers arithmetically instead
 * of by feel. Store-first, exactly the run `typicalPriceFor` picks: a store
 * with a run of its own is judged against its own prices, not a blend with
 * everywhere else this item has been bought.
 *
 * Null whenever there's nothing priced yet, or `priceStanding` itself
 * refuses — silence, never a guess, the same discipline `tripMarkerFor` and
 * `describeKitchen` already run on.
 */
export function priceStandingFor(
  item: GroceryItem,
  shopId: string | null,
  links: readonly ItemShopLink[]
): PriceStanding | null {
  // Judged against the box's own run where there is one, for typicalPriceFor's
  // reason: "more than usual" measured against a run that mixed in a cheaper
  // product is a verdict about the wrong thing.
  const run = (history: readonly PriceObservation[]) =>
    priceRunForProduct(history, item.preferredProductId).history;

  if (shopId) {
    const link = links.find(l => l.itemId === item.id && l.shopId === shopId);
    if (link?.lastPriceMinor == null) return null;
    return priceStanding(
      { minor: link.lastPriceMinor, quantity: link.lastPriceQuantity },
      run(link.priceHistory)
    );
  }
  if (item.lastPriceMinor == null) return null;
  return priceStanding(
    { minor: item.lastPriceMinor, quantity: item.lastPriceQuantity },
    run(item.priceHistory)
  );
}

/**
 * The verdict as a caption — never the baseline number itself. A line saying
 * "usually $3.99" beside a field saying "$4.49" reads as a contradiction, not
 * a comparison; stating only the verdict keeps them two different claims.
 */
export function describePriceStanding(standing: PriceStanding | null): string | null {
  switch (standing) {
    case 'lowest': return "The lowest you've paid";
    case 'low': return 'Less than you usually pay';
    case 'usual': return 'About what you usually pay';
    case 'high': return 'More than usual';
    default: return null;
  }
}
