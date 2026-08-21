import { dbGetGtinLookup, dbSetGtinLookup } from '../db/database';
import { isCacheEntryFresh } from '../utils/gtin';
import { useSettingsStore } from '../store/useSettingsStore';
import { GROCERY_NAME_MAX_LENGTH, GROCERY_QUANTITY_MAX_LENGTH } from '../types';

/**
 * Turning a barcode into a product, over the network, once per barcode ever.
 *
 * The second network call in the app, and the first that isn't the user's own
 * Anthropic key talking to Anthropic — see the note on `productLookupEnabled`
 * in `useSettingsStore` for what that costs and why there's a switch.
 *
 * **Everything decidable offline is decided elsewhere.** `gtin.ts` validates
 * and canonicalizes the code, `scanResolve.ts` reads a record against the
 * catalog; this module only asks the question and remembers the answer. Same
 * split `extractReceipt` and `receiptMatch.ts` already make, and for the same
 * reason: this half can't be tested and the other half must be.
 */

/**
 * Open Food Facts, and only it, for now.
 *
 * The plan this was built from named USDA FoodData Central as the primary
 * source. FDC needs an API key, and a lookup that can't run until someone
 * pastes one is not a lookup that can be on by default — which is the whole
 * shape of this feature: you unpack a bag and it works. So OFF, which needs no
 * key, is what ships first. FDC belongs behind an optional key, ranked ahead of
 * this when one exists, and which of the two is actually better on a real
 * kitchen's barcodes is a question to answer with twenty real scans rather than
 * with catalog sizes on paper.
 */
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product';

/**
 * Open Food Facts asks every client to identify itself, and blocks the ones
 * that don't. Note React Native's fetch may drop this on some platforms; it is
 * sent because the policy asks for it, not because anything here depends on it
 * arriving.
 */
const USER_AGENT = 'dundundun/1.0 (grocery barcode scanning)';

/**
 * Shorter than the Anthropic calls' 15s. This one runs while someone is
 * standing over a bag holding the next item, so the cost of waiting is a queue
 * of things they can't scan yet — and unlike a receipt read, a slow answer has
 * a cheap fallback: type the name. Failing fast and letting them move on beats
 * being right a few seconds later.
 */
const REQUEST_TIMEOUT_MS = 8_000;

export interface ProductRecord {
  /** Canonical GTIN-14. */
  gtin: string;
  /** The product as the source names it, full and unabbreviated. */
  name: string;
  brand: string | null;
  /** Pack size as printed ("1 gal", "500 g"), null when the source doesn't say. */
  quantity: string | null;
  source: string;
}

/** Why a lookup produced nothing, which is not the same as the barcode being unknown. */
export class ProductLookupError extends Error {}

/**
 * Maps a lookup failure to copy safe to show a user, mirroring
 * `describeAIError`. Every branch ends in the same advice because there is only
 * one thing to do about any of them, and it always works: type the name.
 */
export function describeLookupError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Request timed out') return 'The lookup took too long. Type the name instead.';
  if (message === 'Lookups are off') return 'Barcode lookups are off. Turn them on in Settings, or type the name.';
  if (message.startsWith('Lookup failed')) return 'Couldn\'t reach the barcode database. Type the name instead.';
  return 'Couldn\'t look that barcode up. Type the name instead.';
}

function trimField(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Reads OFF's payload into a record, or null when it answered but knew nothing
 * useful.
 *
 * A row with no name is treated as a miss rather than as a hit with an empty
 * name: OFF holds skeleton entries created by a scan nobody filled in, and one
 * of those has strictly less to offer than the barcode itself. Caching it as a
 * hit would make it permanent (hits never expire), which is exactly the wrong
 * answer for a record that is waiting to be filled in.
 */
function readOffProduct(gtin: string, payload: unknown): ProductRecord | null {
  const product = (payload as { product?: Record<string, unknown> })?.product;
  if (!product) return null;
  // `generic_name` is what the thing *is* ("semi-skimmed milk") where
  // `product_name` is what's on the front of the box, so it is the better
  // starting point for a shopping-list name. Often absent, hence the fallback.
  const generic = trimField(product.generic_name, GROCERY_NAME_MAX_LENGTH);
  const branded = trimField(product.product_name, GROCERY_NAME_MAX_LENGTH);
  const name = generic || branded;
  if (!name) return null;
  // OFF stores brands as a comma-separated list; the first is the maker.
  const brands = trimField(product.brands, GROCERY_NAME_MAX_LENGTH);
  return {
    gtin,
    name,
    brand: brands ? brands.split(',')[0].trim() || null : null,
    quantity: trimField(product.quantity, GROCERY_QUANTITY_MAX_LENGTH) || null,
    source: 'openfoodfacts',
  };
}

/** One GET, with a timeout, distinguishing "no such product" from "couldn't ask". */
async function fetchFromOff(gtin: string): Promise<ProductRecord | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `${OFF_URL}/${encodeURIComponent(gtin)}.json?fields=product_name,generic_name,brands,quantity`,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: controller.signal }
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new ProductLookupError('Request timed out');
    throw new ProductLookupError('Lookup failed');
  } finally {
    clearTimeout(timeout);
  }

  // A 404 is a real answer — OFF has never heard of this code — and is the one
  // failure worth remembering. Anything else is the network or the service
  // having a bad moment, which says nothing about the barcode.
  if (response.status === 404) return null;
  if (!response.ok) throw new ProductLookupError(`Lookup failed ${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProductLookupError('Lookup failed');
  }
  if ((payload as { status?: number })?.status === 0) return null;
  return readOffProduct(gtin, payload);
}

/**
 * What this barcode is, from the cache when it can be and the network when it
 * can't. Null means the databases genuinely don't know it, which is an answer;
 * a throw means nobody could be asked, which isn't.
 *
 * **A miss is only ever cached when a source actually said so.** A timeout or a
 * 500 leaves the cache untouched, because writing one would turn a bad minute
 * on the train into a barcode this app refuses to look up again for a month.
 */
export async function lookupGtin(gtin: string, now: Date = new Date()): Promise<ProductRecord | null> {
  const cached = dbGetGtinLookup(gtin);
  if (cached && isCacheEntryFresh(cached, now)) {
    if (!cached.found) return null;
    return {
      gtin: cached.gtin,
      name: cached.name,
      brand: cached.brand,
      quantity: cached.quantity,
      source: cached.source,
    };
  }

  if (!useSettingsStore.getState().productLookupEnabled) {
    throw new ProductLookupError('Lookups are off');
  }

  const record = await fetchFromOff(gtin);
  dbSetGtinLookup({
    gtin,
    found: record !== null,
    name: record?.name ?? '',
    brand: record?.brand ?? null,
    quantity: record?.quantity ?? null,
    source: record?.source ?? '',
    fetchedAt: now.toISOString(),
  });
  return record;
}
