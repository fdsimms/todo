import { parsePriceInput } from './groceryPrice';

/**
 * Reading a shelf label's price off the same camera pass that read its barcode.
 *
 * The app scans barcodes and photographs receipts as two separate things, so a
 * shelf label's price and its barcode could not be captured together even
 * though they are two centimetres apart on the same card.
 * `DataScannerViewController` reads both in one pass
 * (`modules/todo-datascanner-bridge`); this decides which of the prices in
 * frame belongs to the code that was just scanned.
 *
 * **It proposes, and the review row is where it is confirmed.** A price this
 * picks lands on an editable row in `BarcodeScanSheet` and is not written
 * anywhere until Add, which is the same guarantee every other scan field has.
 * That is what makes a geometric guess safe to make at all.
 */

/** A normalised box in the camera frame: 0..1, origin top left. */
export interface ScanBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A run of text the scanner recognised, with where it sat in the frame. */
export interface ScanText extends ScanBox {
  text: string;
}

/**
 * How far from the barcode a price can sit and still be the same label, as a
 * fraction of the frame's diagonal.
 *
 * A shelf label is a small card and the code is printed on it, so anything much
 * further away is the next product along. Generous rather than tight because
 * the cost is asymmetric: too far and it offers the neighbour's price, which
 * the user sees on the review row and clears; too tight and the feature
 * silently does nothing and looks broken.
 */
const MAX_LABEL_DISTANCE = 0.35;

/**
 * What a printed price looks like: a separator and exactly two digits.
 *
 * The same rule `receiptOcr` applies, for the same reason — `parsePriceInput`
 * accepts a bare integer, which is right for a typed field and wrong for
 * reading printed amounts, where a product count or a "12" in a pack size would
 * otherwise read as $12.00.
 */
const PRINTED_PRICE = /[.,]\d{2}$/;

/**
 * A per-unit price rather than what the thing costs.
 *
 * Shelf labels print both, and the small one is not the price of the item. Only
 * catches it when the recogniser returned the rate and its unit as one run,
 * which is the common case; when they come back separately the retail price
 * still wins on type size below.
 */
const PER_UNIT = /(\/|\bper\b)\s*(oz|lb|lbs|ct|ea|each|g|kg|ml|l|fl|qt|pt|gal|sheet|sq\s*ft)\b/i;

/** Centre-to-centre distance between two boxes, in frame units. */
function distanceBetween(a: ScanBox, b: ScanBox): number {
  const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
  const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The printed prices among a frame's recognised text, each with its box.
 *
 * A run can hold more than the price ("$3.49 EA"), so this reads the tokens the
 * same way a receipt row is read — from the right, first one that looks like a
 * printed amount — rather than requiring the whole run to be a price.
 */
export function printedPricesIn(texts: readonly ScanText[]): Array<{ priceMinor: number; box: ScanText }> {
  const found: Array<{ priceMinor: number; box: ScanText }> = [];
  for (const item of texts) {
    if (PER_UNIT.test(item.text)) continue;
    const tokens = item.text.trim().split(/\s+/).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (!PRINTED_PRICE.test(tokens[i])) continue;
      const priceMinor = parsePriceInput(tokens[i]);
      if (priceMinor !== null) {
        found.push({ priceMinor, box: item });
        break;
      }
    }
  }
  return found;
}

/**
 * The price on the label the barcode is printed on, or null.
 *
 * Two signals, in this order:
 *
 * 1. **Near the code.** Proximity is what ties a price to *this* product rather
 *    than the one beside it, which is the entire feature.
 * 2. **Set in the largest type.** Within one label a retail price is much
 *    bigger than the unit price above it and the size text below it, so box
 *    height separates them without having to understand any of the words.
 *
 * Distance is the filter and height is the ranking, deliberately in that order:
 * ranking by height first would let a neighbouring label's larger price beat
 * this one's. Two labels genuinely overlapping in frame is the failure this
 * cannot rule out, and it is why the price arrives as a proposal on a review
 * row rather than as a fact.
 */
export function priceNearBarcode(barcode: ScanBox, texts: readonly ScanText[]): number | null {
  const candidates = printedPricesIn(texts)
    .map(found => ({ ...found, distance: distanceBetween(barcode, found.box) }))
    .filter(found => found.distance <= MAX_LABEL_DISTANCE);
  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.box.height > best.box.height) best = candidate;
    else if (candidate.box.height === best.box.height && candidate.distance < best.distance) {
      best = candidate;
    }
  }
  return best.priceMinor;
}
