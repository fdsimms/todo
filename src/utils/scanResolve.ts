import type { GroceryItem } from '../types';
import { GROCERY_NAME_MAX_LENGTH, GROCERY_VARIANT_MAX_LENGTH } from '../types';
import { aisleForProductCategory } from './productCategory';
import { matchReceiptLines, type AliasResolver, type ReceiptMatch } from './receiptMatch';
import type { ReceiptLine } from '../services/aiSuggestions';
import type { ProductRecord } from '../services/productLookup';

/**
 * Reading a scanned barcode against the grocery catalog.
 *
 * **This deliberately reuses `receiptMatch.ts` rather than growing a second
 * matcher.** A scanned product and a printed receipt line are the same shape of
 * problem: a name somebody else chose, which has to be read as one of the rows
 * in your own catalog, with the answer always shown for confirmation. The
 * tiers, the best-line-per-row rule, the off-list second pass and the
 * pre-checking rule are all already argued and tested there. Writing a parallel
 * one here is how the two would come to disagree about the same product.
 *
 * The one honest difference is what `label` means. On a receipt it is the line
 * exactly as printed, checked against the paper in your hand; on a scan it is
 * the product name as the barcode database gives it ("Great Value 2% Reduced
 * Fat Milk, 1 Gallon"), checked against the box in your hand. Both are "the
 * words somebody else used", and both exist so the shopper name below them can
 * be verified rather than trusted.
 */

/**
 * One thing scanned or typed during an unpack, before it is committed.
 *
 * Carries `gtin` where a receipt line carries a price, and for the same
 * purpose: it is the evidence the row rests on. Null for a hand-typed entry,
 * which is the produce and bulk case and is an ordinary state, not a failure.
 */
export interface ScannedItem {
  /** Canonical GTIN-14, or null when this was typed rather than scanned. */
  gtin: string | null;
  /** What the source calls it, shown verbatim so the reading below can be checked. */
  label: string;
  /** The shopping-list name — what a row gets called. Editable before committing. */
  name: string;
  /**
   * Who makes it, when the source said.
   *
   * Shown on the review row via `sourceLabelFor`, and written as the minted
   * row's first `ItemProduct` — a scan is the one input path handed a brand for
   * free, and `ItemProduct` is where a brand already lives.
   */
  brand: string | null;
  /** Pack size as the source printed it. Empty when unstated. */
  quantity: string;
  /**
   * The aisle the source's own category names, or null when it named none the
   * app recognises.
   *
   * A suggestion of last resort, not a decision: the store applies it only
   * where the user's remembered aisle and the name lexicon both come up empty.
   * See `aisleForProductCategory`.
   */
  aisle: string | null;
}

/**
 * One barcode a scan session confirmed against a catalog row, on its way to
 * being remembered. See `linkScannedGtins`.
 *
 * Carries the box's words as well as the row, because a scan resolves to both
 * and the two are written to different places. `brand`/`variant` are how the
 * product is found rather than fields to write: `addProduct` has already
 * decided what boxes exist by the time this is handed over, and a link naming
 * one that isn't there settles for pointing the barcode at the item.
 */
export interface ScannedGtinLink {
  /** Canonical GTIN-14. */
  gtin: string;
  itemId: string;
  brand: string | null;
  variant: string | null;
}

/** Words a brand-stripped name shouldn't be left starting or ending with. */
const EDGE_JUNK = /^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g;

/**
 * A product's full name reduced to something that belongs on a shopping list.
 *
 * Three cuts, in order, each of which is safe on its own and reversible by the
 * user in review: drop a leading brand the source already told us about, drop a
 * trailing size clause, and tidy the punctuation those leave behind.
 *
 * **It refuses to return nothing.** Every cut falls back to the full name if it
 * would empty the string, because a blank row is worse than a verbose one and
 * the user is looking straight at both. This is deliberately a tidy-up and not
 * an attempt to understand the words: knowing that "Great Value 2% Reduced Fat
 * Milk" is "milk" means knowing what the words mean, which is the guess
 * `splitPrep` and `ItemProduct.brand` both already refuse to make offline. The
 * catalog matcher gets the last word anyway, and it reads "2% reduced fat milk"
 * onto an existing "Milk" row perfectly well.
 */
export function shopperNameFor(fullName: string, brand: string | null): string {
  const full = fullName.trim().slice(0, GROCERY_NAME_MAX_LENGTH);
  if (!full) return '';
  let name = full;

  const maker = brand?.trim();
  if (maker && name.toLowerCase().startsWith(maker.toLowerCase())) {
    const stripped = name.slice(maker.length).replace(EDGE_JUNK, '');
    if (stripped) name = stripped;
  }

  // "…Milk, 1 Gallon" — a size clause after the last comma. Only when what
  // follows actually reads as an amount, or this would eat "Beans, black".
  const comma = name.lastIndexOf(',');
  if (comma > 0 && /\d/.test(name.slice(comma + 1))) {
    const stripped = name.slice(0, comma).replace(EDGE_JUNK, '');
    if (stripped) name = stripped;
  }

  const tidied = name.replace(EDGE_JUNK, '').replace(/\s+/g, ' ');
  return tidied || full;
}

/** Separates the maker from the product in the review row's source line. */
const BRAND_SEPARATOR = ' · ';

/**
 * The source's own words for the review row: the product name, with the brand
 * in front of it when the name doesn't already say who makes it.
 *
 * The brand goes *into* this line rather than onto one of its own because the
 * line already means "what the database called this", and the brand is the same
 * kind of fact from the same answer. A row is one to three lines as it is, and
 * the fourth is the one nobody reads (see the note on `rowGtin`).
 *
 * **The prefix is conditional, and that is the whole function.** Half of these
 * names lead with the maker already ("Great Value 2% Reduced Fat Milk"), and
 * `shopperNameFor` strips exactly that prefix off the name above — so pasting
 * the brand back on unconditionally would print "Great Value · Great Value 2%
 * Reduced Fat Milk" under a row whose entire point is checking the words
 * against the box in your hand.
 */
export function sourceLabelFor(label: string, brand: string | null): string {
  const words = label.trim();
  const maker = brand?.trim();
  if (!maker) return words;
  if (!words) return maker;
  if (words.toLowerCase().startsWith(maker.toLowerCase())) return words;
  return `${maker}${BRAND_SEPARATOR}${words}`;
}

/**
 * Which one of the item it is, from what the product name has left over.
 *
 * "Dave's Killer Bread 21 Whole Grains" scanned onto a catalog row called
 * *Bread*, with the maker already named separately, leaves "21 Whole Grains" —
 * and that is exactly `ItemProduct.variant`. Nothing here understands the
 * words: it subtracts two strings the app was *told* (the brand by the source,
 * the item by the matcher) and keeps the remainder.
 *
 * **The item's name must actually appear, or this returns null.** Where it
 * doesn't, the remainder is the whole product name, and calling that a variant
 * files "Sun Sausage Plant-based Links Cajun" as a *kind of* sausage rather
 * than as the thing itself. That's the guess `shopperNameFor` refuses to make
 * one level up, and refusing it here costs only a variant nobody typed.
 */
export function variantFor(
  fullName: string,
  brand: string | null,
  itemName: string
): string | null {
  const withoutBrand = shopperNameFor(fullName, brand);
  const item = itemName.trim();
  if (!withoutBrand || !item) return null;
  const pattern = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  if (!pattern.test(withoutBrand)) return null;
  const residue = withoutBrand
    .replace(pattern, ' ')
    .replace(/\s+/g, ' ')
    .replace(EDGE_JUNK, '')
    .trim();
  return residue ? residue.slice(0, GROCERY_VARIANT_MAX_LENGTH) : null;
}

/** A looked-up product as a row waiting to be reviewed. */
export function scannedItemFor(record: ProductRecord): ScannedItem {
  return {
    gtin: record.gtin,
    label: record.name,
    name: shopperNameFor(record.name, record.brand),
    brand: record.brand,
    quantity: record.quantity ?? '',
    aisle: aisleForProductCategory(record.category),
  };
}

/**
 * A produce sticker as a row.
 *
 * The code goes in `label`, not in `name`, and that placement is the feature:
 * `label` is what an alias is looked up and remembered against, so naming
 * "4159" once teaches it for good. A seeded name arrives as a suggestion in
 * `name`; most codes have none and arrive blank, which is the same row a
 * barcode nobody has heard of produces.
 */
export function pluScannedItem(code: string, suggestedName: string | null): ScannedItem {
  return {
    gtin: null,
    label: code,
    name: suggestedName ?? '',
    brand: null,
    quantity: '',
    aisle: null,
  };
}

/**
 * A barcode nothing could be found for, as a row the user can still name.
 *
 * A miss is not a dead end — the box is in their hand and they know what it is.
 * The row exists with an empty name and the code as its label so it can be
 * typed into, which is also what makes the produce path (no barcode at all) and
 * the unknown-SKU path one flow rather than two.
 */
export function unknownScannedItem(gtin: string): ScannedItem {
  return { gtin, label: '', name: '', brand: null, quantity: '', aisle: null };
}

/**
 * Whether this code is already in the session.
 *
 * **Required, not a nicety.** A camera preview fires its callback on every
 * frame that resolves a code, so one carton held up for a second arrives as
 * dozens of identical scans. Deduping on the canonical GTIN is also right for
 * the case where someone genuinely scans two of the same thing: two identical
 * cartons are one catalog row with a quantity, never two rows.
 */
export function alreadyScanned(scans: readonly ScannedItem[], gtin: string): boolean {
  return scans.some(s => s.gtin === gtin);
}

/**
 * "Which catalog row is this scan?", asked of something that can see the whole
 * scan rather than just its words.
 *
 * `AliasResolver` takes a `ReceiptLine`, which is all a receipt has. A scan
 * additionally carries the barcode, and that is the half worth asking first —
 * so this is the scan-shaped version, and `matchScans` adapts it down to the
 * line-shaped one the matcher speaks.
 */
export type ScanResolver = (scan: ScannedItem) => string | null;

/**
 * Each scan read against the catalog, aligned index for index with `scans`.
 *
 * A scan's alias is looked up with no store, and that is the right shape
 * rather than a limitation: at unpack time nobody has said where the bag came
 * from, and a product name off a barcode database is the same phrase whichever
 * shop it was bought at. A store's *printed* shorthand is the thing that needs
 * scoping, and that only ever comes off a receipt.
 *
 * Rows with no name yet are passed through as empty lines rather than skipped,
 * so the indexes still line up and a row the user is midway through naming
 * simply matches nothing until it says something.
 *
 * **The resolver is handed the scan, not the line, and the map is what makes
 * that work.** `matchReceiptLines` calls back with one of the very line
 * objects built here, so keying on object identity walks back to the scan it
 * came from. Passing an index instead would mean widening `AliasResolver` for
 * every receipt caller to carry a number none of them have any use for.
 */
export function matchScans(
  scans: readonly ScannedItem[],
  items: readonly GroceryItem[],
  resolveScan?: ScanResolver,
): ReceiptMatch[] {
  const scanByLine = new Map<ReceiptLine, ScannedItem>();
  const lines: ReceiptLine[] = scans.map(scan => {
    const line: ReceiptLine = {
      label: scan.label,
      name: scan.name,
      quantity: scan.quantity,
      priceMinor: null,
    };
    scanByLine.set(line, scan);
    return line;
  });
  const aliasFor: AliasResolver | undefined = resolveScan
    ? line => {
        const scan = scanByLine.get(line);
        return scan ? resolveScan(scan) : null;
      }
    : undefined;
  return matchReceiptLines(lines, items, aliasFor);
}
