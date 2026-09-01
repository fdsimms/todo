import type { RecognizedLine } from 'todo-vision-bridge';
import { parsePriceInput } from './groceryPrice';

/**
 * Turning Vision's recognized lines back into a receipt.
 *
 * `VNRecognizeTextRequest` returns text runs, not printed lines: "GV MLK 2%
 * GAL" and "3.48" come back as two separate observations that happen to sit at
 * the same height. Reassembling them is the whole job here, and it is the piece
 * that plain "send the photo" never had — the vision API is handed a picture and
 * has to infer which price belongs to which item from how the columns look,
 * where this reads it off the geometry directly.
 *
 * **This extracts nothing and decides nothing.** It produces the text a receipt
 * would have if you could copy and paste it; `extractReceipt` still names the
 * store, expands the shorthand and throws out the lines that aren't purchases,
 * and `receiptMatch.ts` still does the matching. The split is the same one the
 * image path already makes, and keeping it means the OCR path can be wrong
 * about a row without being wrong about a *decision*.
 *
 * Nothing here touches the network or the database, and nothing reaches outside
 * SQLite, so there is no demo-mode gate to add: the photo is one the user just
 * picked and the reading is thrown away as soon as the sheet closes.
 */

/**
 * How much two lines' vertical extents must overlap to be the same printed row,
 * as a fraction of the shorter of the two.
 *
 * Measured against the row's *first* line rather than the row's growing span:
 * a header sets in 20pt type beside 8pt body text would otherwise stretch the
 * span until everything below joined it.
 */
const ROW_OVERLAP = 0.5;

/**
 * A token that may sit to the right of the price without being part of the
 * label — a register's tax flag ("3.48 T", "12.99 TF").
 *
 * One or two capitals, which is what every flag is and what almost no word on
 * a receipt is. Deliberately case-sensitive: a lowercase "lb" trailing a
 * "1.32 lb @ 2.99/lb" sub-line is a unit rather than a flag, and stopping there
 * is how that line comes back with no price instead of with the price *per
 * pound* — which is the misread this whole rule exists to prevent, and the one
 * the prompt already warns the model about on the image path.
 */
const TAX_FLAG = /^[A-Z]{1,2}$/;

/**
 * What a *printed* price looks like: a separator and exactly two digits.
 *
 * `parsePriceInput` accepts a bare integer, because someone typing "4" into a
 * price field means $4.00 — right for a field, wrong for a column of printed
 * amounts, where nothing is ever set without its cents. Without this
 * precondition a store's own header reads as a charge: "TRADER JOE'S #453"
 * loses its "#" to that parser's leading-symbol strip and comes back as
 * $453.00, and every "ITEM 2" style line does the same.
 *
 * This is a precondition on the *shape* of a printed price, not a second
 * opinion about what a price is — `parsePriceInput` still does the parsing, so
 * a negative discount line and an over-ceiling amount are refused there, once.
 */
const PRINTED_PRICE = /[.,]\d{2}$/;

/** Rows below this and the read is too thin to be a receipt — see `shouldUseOcrText`. */
const MIN_OCR_ROWS = 5;

/** Priced rows below this and the same. */
const MIN_OCR_PRICED_ROWS = 2;

export interface OcrReceiptRow {
  /** The printed line with its price fragment removed, fragments joined by a space. */
  label: string;
  /**
   * Minor units, or null when nothing in the row's last few tokens read as a
   * price. Parsed with `parsePriceInput` — the same reader a hand-typed price
   * and the model's own answer both go through, so a discount line's negative
   * is refused here for exactly the reason it's refused there rather than by a
   * second opinion about what a price is.
   */
  priceMinor: number | null;
  /** Normalized y of the row's top edge, 0 at the top of the photo. Printed order. */
  y: number;
}

export interface OcrReceipt {
  rows: OcrReceiptRow[];
  /** What `extractReceipt` sends in place of the photo. One printed row per line. */
  text: string;
}

/** Bottom edge of a recognized line, in the top-left-origin space the bridge returns. */
function bottomOf(line: RecognizedLine): number {
  return line.y + line.height;
}

/**
 * Whether `line` sits on the same printed row as `anchor`.
 *
 * Vertical overlap rather than a comparison of centres: a price is often set in
 * a slightly smaller face than the item name beside it, which moves the centres
 * apart without the two ceasing to be one line.
 */
function sharesRow(anchor: RecognizedLine, line: RecognizedLine): boolean {
  const overlap = Math.min(bottomOf(anchor), bottomOf(line)) - Math.max(anchor.y, line.y);
  if (overlap <= 0) return false;
  const shorter = Math.min(anchor.height, line.height);
  if (shorter <= 0) return false;
  return overlap / shorter >= ROW_OVERLAP;
}

/**
 * Groups recognized lines into printed rows, top to bottom, each row's
 * fragments left to right.
 *
 * Exported for its own tests: this is the step everything below depends on, and
 * the one whose failure is silent — a mis-grouped row doesn't error, it just
 * files a price against the wrong item.
 */
export function groupRecognizedRows(lines: readonly RecognizedLine[]): RecognizedLine[][] {
  const usable = lines.filter(line => line.text.trim().length > 0 && line.height > 0);
  const byY = [...usable].sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: RecognizedLine[][] = [];
  for (const line of byY) {
    // Only the most recent row can still be open: the list is sorted by y, so
    // once a line clears a row's anchor nothing later can rejoin it.
    const current = rows[rows.length - 1];
    if (current && sharesRow(current[0], line)) current.push(line);
    else rows.push([line]);
  }

  return rows.map(row => [...row].sort((a, b) => a.x - b.x));
}

/**
 * Splits a printed row's text into what it says and what it charged.
 *
 * **A price is the last thing on its line**, which is the one structural fact
 * about a receipt worth relying on, so this reads from the right and stops at
 * the first token that is neither a price nor a tax flag. Scanning further left
 * is what would turn a store's street number into a charge: "STORE #453 1234
 * MAIN ST" has a token that parses perfectly well as $1,234.00, and the only
 * thing that says it isn't one is that two words follow it.
 *
 * A column threshold — take the price only from fragments right of where the
 * price column starts — was the obvious next refinement and is deliberately not
 * here. It buys accuracy on rows this already reads correctly, and its failure
 * mode is much worse than the one it fixes: a threshold placed a few percent
 * wrong on a narrow or skewed photo drops the price off *every* row at once,
 * where a mis-split single row is one line for the user to correct.
 */
export function splitRowPrice(fragments: readonly string[]): { label: string; priceMinor: number | null } {
  const tokens = fragments.join(' ').split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const priceMinor = PRINTED_PRICE.test(tokens[i]) ? parsePriceInput(tokens[i]) : null;
    if (priceMinor !== null) return { label: tokens.slice(0, i).join(' '), priceMinor };
    // Everything to the right of a price is a flag about the line, so it is
    // dropped rather than kept in the label.
    if (!TAX_FLAG.test(tokens[i])) break;
  }
  return { label: tokens.join(' '), priceMinor: null };
}

/**
 * Renders the rows as the text `extractReceipt` reads.
 *
 * Tab-separated rather than aligned with spaces: the columns are the one thing
 * this knows that the model would otherwise have to infer, so they're marked
 * with a character that can't occur inside a recognized fragment. A row whose
 * price didn't parse is sent as a bare label — most of those are the header,
 * the footer and the survey blurb, which the prompt already knows to discard.
 */
function renderReceiptText(rows: readonly OcrReceiptRow[]): string {
  return rows
    .map(row => (row.priceMinor === null
      ? row.label
      : `${row.label}\t${(row.priceMinor / 100).toFixed(2)}`))
    .filter(line => line.trim().length > 0)
    .join('\n');
}

/** Recognized lines → the receipt they were printed as. */
export function reconstructReceipt(lines: readonly RecognizedLine[]): OcrReceipt {
  const rows: OcrReceiptRow[] = groupRecognizedRows(lines).map(fragments => {
    const { label, priceMinor } = splitRowPrice(fragments.map(f => f.text.trim()));
    return { label, priceMinor, y: fragments[0].y };
  });
  return { rows, text: renderReceiptText(rows) };
}

/**
 * Whether this reading is worth sending instead of the photo.
 *
 * The bar is deliberately low but not absent. A photo Vision found six words in
 * is a failed read — out of focus, a receipt face down, a photo of something
 * else — and sending those six words would spend the request to learn nothing,
 * where the image path at least gets to see what happened. Falling back costs
 * the upload this feature exists to avoid, which is the cheaper mistake of the
 * two.
 */
export function shouldUseOcrText(receipt: OcrReceipt): boolean {
  if (receipt.rows.length < MIN_OCR_ROWS) return false;
  const priced = receipt.rows.filter(row => row.priceMinor !== null).length;
  return priced >= MIN_OCR_PRICED_ROWS;
}

/**
 * The bridge is `require`d at call site, never imported: this module is
 * reachable from `ReceiptImportSheet` and, through it, from screens Jest
 * renders nothing of but does typecheck — and a module-scope import pulls
 * `expo-modules-core` into Jest's `node` environment, which throws on sight.
 * Same rule `recipePhoto.ts`, `backupFile.ts` and `secureApiKey.ts` follow.
 *
 * Everything above this line is pure and tested; everything below is the thin
 * orchestration around a native call, which is not.
 */
function visionBridge(): typeof import('todo-vision-bridge') {
  return require('todo-vision-bridge');
}

/**
 * Reads the receipt at `uri` on device and returns the text to send in place of
 * the photo, or null to send the photo instead.
 *
 * Null is the answer for every kind of not-working — no bridge, an unreadable
 * file, a read too thin to be a receipt — because the caller's branch is the
 * same in all of them, and because the fallback is the path that works today.
 * Nothing here is allowed to fail a scan: the worst outcome is spending the
 * upload this exists to avoid.
 */
export async function readReceiptText(uri: string): Promise<string | null> {
  try {
    const lines = await visionBridge().recognizeText(uri);
    const receipt = reconstructReceipt(lines);
    return shouldUseOcrText(receipt) ? receipt.text : null;
  } catch (error) {
    console.warn('[receiptOcr] on-device read failed; falling back to the photo', error);
    return null;
  }
}
