/**
 * Barcodes: reading one, checking it, and keying a cache on it.
 *
 * Pure and offline. The network half is `src/services/productLookup.ts`, and
 * the split is the one `receiptMatch.ts` already makes against `extractReceipt`:
 * the lookup is unrepeatable and untestable, so every judgement that decides
 * what gets written lives here instead, where a test can pin it.
 *
 * **Everything is normalized to GTIN-14 before it is used as a key.** The same
 * carton of milk scans as a 12-digit UPC-A in one reader and as a 13-digit
 * EAN-13 (the UPC with a leading zero) in another, and both are the same
 * product — a cache keyed on the raw string would pay for the same SKU twice
 * and then disagree with itself about the answer. Zero-padding to 14 is the
 * standard way to make those one key, and it is also what lets a GTIN-8 and a
 * GTIN-14 case code share one column without a second `format` field to keep
 * in step.
 *
 * A GTIN is globally unique, which is exactly what `ItemProduct.productKey`
 * deliberately is not (see `docs/arch/groceries.md`: two items may each have a
 * "store brand" product and those are different boxes). So the two identities
 * stay in two places: this keys the shared cache of what a barcode *is*, and
 * the catalog keys what you buy.
 */

/** The lengths a real barcode comes in: GTIN-8, UPC-A, EAN-13, GTIN-14. */
const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * The GS1 mod-10 check digit for a body of digits (the code without its own
 * final digit).
 *
 * Weights alternate 3 and 1 from the *right*, which is why this walks the
 * string backwards rather than keying the weight off the index's parity: the
 * same body is weighted differently at 12 digits than at 13, and reading right
 * to left is what makes one function cover every length.
 */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * A scanned or typed barcode as a canonical GTIN-14, or null if it isn't one.
 *
 * Refuses rather than guesses, and the asymmetry is the reason: an unrecognized
 * code asks the user to type a name, while a silently mangled one looks up
 * somebody else's product and files it in the pantry as theirs. A scanner
 * misreading one digit produces a code that fails the check digit essentially
 * always, so this is most of what stops a bad read reaching the network at all.
 */
export function normalizeGtin(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!VALID_LENGTHS.has(digits.length)) return null;
  const body = digits.slice(0, -1);
  if (gtinCheckDigit(body) !== Number(digits[digits.length - 1])) return null;
  return digits.padStart(14, '0');
}

/** Whether a string reads as a barcode at all. */
export function isGtin(raw: string): boolean {
  return normalizeGtin(raw) !== null;
}

/**
 * A GTIN-14 back in its shortest standard form, for showing to a person.
 *
 * Nobody reads their milk as `00000012345678`, and the digits printed under the
 * bars are what someone checks a row against — the same job `ReceiptLine.label`
 * does for a receipt. Trims to the next standard length up from the significant
 * digits rather than stripping every leading zero, since a code genuinely
 * beginning with `0` is ordinary.
 */
export function formatGtin(gtin14: string): string {
  const trimmed = gtin14.replace(/^0+/, '');
  const length = VALID_LENGTHS.has(trimmed.length)
    ? trimmed.length
    : [8, 12, 13, 14].find(n => n >= trimmed.length) ?? 14;
  return gtin14.slice(-length);
}

/**
 * How long a *miss* is worth remembering, in days.
 *
 * Hits are cached for ever: a barcode is a permanent fact about a box, so
 * paying for one twice is pure waste. A miss is not the same kind of fact — it
 * says the databases hadn't heard of this SKU yet, and Open Food Facts is
 * crowd-maintained and grows every day, so a permanent miss would mean a
 * product someone added last month is one this app can never learn. A month is
 * long enough that a genuinely obscure item isn't re-queried on every unpack,
 * short enough that the catalog catching up actually reaches you.
 */
export const GTIN_MISS_TTL_DAYS = 30;

/**
 * Whether a cached row still answers, or should be asked again.
 *
 * Takes the row rather than reading the clock itself, so the staleness rule is
 * testable without faking time at the module level.
 */
export function isCacheEntryFresh(
  entry: { found: boolean; fetchedAt: string },
  now: Date,
): boolean {
  if (entry.found) return true;
  const fetched = new Date(entry.fetchedAt).getTime();
  if (Number.isNaN(fetched)) return false;
  return now.getTime() - fetched < GTIN_MISS_TTL_DAYS * 24 * 60 * 60 * 1000;
}
