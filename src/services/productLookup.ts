import { dbGetGtinLookup, dbSetGtinLookup } from '../db/database';
import { isCacheEntryFresh, normalizeGtin } from '../utils/gtin';
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
 * Three sources, asked in order, each one skipped when it has no key.
 *
 * **Open Food Facts is the one that needs no key, and that is why it can never
 * be dropped from the chain.** The shape of this feature is that you unpack a
 * bag and it works, so the fallback has to be the keyless one. The other two
 * rank around it by what they cost to ask:
 *
 * 1. **FoodData Central** — free but keyed. First when a key is set: a
 *    government dataset of US branded foods is a better first answer than a
 *    crowd-maintained one where both know the product.
 * 2. **Open Food Facts** — always. Better raw GTIN coverage, messier names, and
 *    the only source that answers for non-food grocery at all.
 * 3. **Go-UPC** — paid, so last, and only asked once both free sources have
 *    said they don't know.
 *
 * That ordering is a reasonable default and not a measured one. Which source is
 * actually better on a real kitchen's barcodes is #1853, and the answer may
 * well reorder this.
 */
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product';
const FDC_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const GO_UPC_URL = 'https://go-upc.com/api/v1/code';

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
 * A source's answer: the record, or `null` for "asked, and it doesn't know".
 * A throw means nobody could be asked, which is a different thing entirely and
 * is what stops a miss being cached — see `lookupGtin`.
 */
type SourceFetch = (gtin: string) => Promise<ProductRecord | null>;

/** Shared GET, with the timeout and the abort mapping every source wants. */
async function getJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new ProductLookupError('Request timed out');
    throw new ProductLookupError('Lookup failed');
  } finally {
    clearTimeout(timeout);
  }

  // A 404 is a real answer. Anything else is the network or the service having
  // a bad moment, which says nothing about the barcode.
  if (response.status === 404) return null;
  if (!response.ok) throw new ProductLookupError(`Lookup failed ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new ProductLookupError('Lookup failed');
  }
}

/**
 * FoodData Central's Branded dataset.
 *
 * **The returned food's own GTIN is checked against the one asked for**, which
 * is not optional here: this is a *search* endpoint, so a barcode it has never
 * seen comes back as whatever the full-text index thought was closest rather
 * than as an empty result. Without the check, an unknown code would confidently
 * resolve to an unrelated product.
 */
function fdcSource(apiKey: string): SourceFetch {
  return async gtin => {
    const url = `${FDC_URL}?query=${encodeURIComponent(gtin)}&dataType=Branded&pageSize=1`
      + `&api_key=${encodeURIComponent(apiKey)}`;
    const payload = await getJson(url, {});
    const food = (payload as { foods?: Array<Record<string, unknown>> })?.foods?.[0];
    if (!food) return null;
    if (normalizeGtin(String(food.gtinUpc ?? '')) !== gtin) return null;
    const name = trimField(food.description, GROCERY_NAME_MAX_LENGTH);
    if (!name) return null;
    const brand = trimField(food.brandName, GROCERY_NAME_MAX_LENGTH)
      || trimField(food.brandOwner, GROCERY_NAME_MAX_LENGTH);
    return {
      gtin,
      name,
      brand: brand || null,
      quantity: trimField(food.packageWeight, GROCERY_QUANTITY_MAX_LENGTH) || null,
      source: 'usda',
    };
  };
}

/** Go-UPC. Paid per call, so it is only ever reached after both free sources miss. */
function goUpcSource(apiKey: string): SourceFetch {
  return async gtin => {
    const payload = await getJson(`${GO_UPC_URL}/${encodeURIComponent(gtin)}`, {
      Authorization: `Bearer ${apiKey}`,
    });
    const product = (payload as { product?: Record<string, unknown> })?.product;
    if (!product) return null;
    const name = trimField(product.name, GROCERY_NAME_MAX_LENGTH);
    if (!name) return null;
    return {
      gtin,
      name,
      brand: trimField(product.brand, GROCERY_NAME_MAX_LENGTH) || null,
      quantity: null,
      source: 'go-upc',
    };
  };
}

/** The chain, in ask order, with keyless sources always present. */
function sourcesFor(fdcApiKey: string, goUpcApiKey: string): SourceFetch[] {
  const chain: SourceFetch[] = [];
  if (fdcApiKey) chain.push(fdcSource(fdcApiKey));
  chain.push(fetchFromOff);
  if (goUpcApiKey) chain.push(goUpcSource(goUpcApiKey));
  return chain;
}

/**
 * What this barcode is, from the cache when it can be and the network when it
 * can't. Null means the databases genuinely don't know it, which is an answer;
 * a throw means nobody could be asked, which isn't.
 *
 * **A miss is only ever cached when every source actually said so.** A timeout
 * or a 500 anywhere in the chain leaves the cache untouched, because writing a
 * miss would turn a bad minute on the train into a barcode this app refuses to
 * look up again for a month. A *hit* is cached even if an earlier source failed
 * on the way — the answer is right regardless of who couldn't be reached.
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

  const { productLookupEnabled, fdcApiKey, goUpcApiKey } = useSettingsStore.getState();
  if (!productLookupEnabled) throw new ProductLookupError('Lookups are off');

  let record: ProductRecord | null = null;
  /**
   * Whether every source in the chain gave a real answer.
   *
   * This is what decides whether a miss is written, and it has to be all of
   * them: caching "not found" after one source 404'd and another timed out
   * would refuse the barcode for a month on the strength of a bad minute on the
   * train. A source that threw is a source that was never asked.
   */
  let definitive = true;
  let lastError: unknown = null;

  for (const source of sourcesFor(fdcApiKey, goUpcApiKey)) {
    try {
      record = await source(gtin);
    } catch (e) {
      definitive = false;
      lastError = e;
      continue;
    }
    if (record) break;
  }

  // Nothing found and nobody could be reached: an error, not an answer.
  if (!record && !definitive) throw lastError ?? new ProductLookupError('Lookup failed');

  if (record || definitive) {
    dbSetGtinLookup({
      gtin,
      found: record !== null,
      name: record?.name ?? '',
      brand: record?.brand ?? null,
      quantity: record?.quantity ?? null,
      source: record?.source ?? '',
      fetchedAt: now.toISOString(),
    });
  }
  return record;
}
