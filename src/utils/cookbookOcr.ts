import type { RecognizedLine } from 'todo-vision-bridge';
import { groupRecognizedRows } from './receiptOcr';

/**
 * Turning a photographed table of contents into the text `extractCookbookChecklist`
 * reads, the same split `receiptOcr.ts` makes for a receipt: this reassembles
 * printed rows from Vision's text runs and decides nothing about what any of
 * them mean. A table-of-contents row is "Title …… 42" or "Title    42" — a dot
 * leader or a run of spaces, then a page number — but unlike a receipt's price
 * column this doesn't try to split the two apart. Where the price matters
 * (`splitRowPrice`), the page number here is exactly the noise the model
 * already knows to discard, and a false split would risk taking a trailing
 * digit off a title that happens to end in one ("Dinner for 2").
 *
 * Nothing here touches the network or the database. The photo is one the user
 * just took and the reading is thrown away as soon as the sheet closes, so
 * there is no demo-mode gate to add.
 */

/** Rows below this and the read is too thin to be a table of contents — see `shouldUseOcrText`. */
const MIN_TOC_ROWS = 4;

export interface OcrTocReading {
  /** One printed row per line, in reading order. */
  rows: string[];
  /** What `extractCookbookChecklist` sends in place of the photo. */
  text: string;
}

/** Recognized lines → the table of contents they were printed as. */
export function reconstructToc(lines: readonly RecognizedLine[]): OcrTocReading {
  const rows = groupRecognizedRows(lines)
    .map(fragments => fragments.map(f => f.text.trim()).filter(Boolean).join(' ').trim())
    .filter(Boolean);
  return { rows, text: rows.join('\n') };
}

/**
 * Whether this reading is worth sending instead of the photo.
 *
 * Same reasoning as `receiptOcr.ts`'s `shouldUseOcrText`: a photo Vision found
 * three rows in is a failed read — out of focus, the wrong page, a photo of
 * something else — and sending those rows would spend the request to learn
 * nothing.
 */
export function shouldUseOcrText(reading: OcrTocReading): boolean {
  return reading.rows.length >= MIN_TOC_ROWS;
}

/**
 * Strips a table of contents row down to something closer to a bare title —
 * the trailing dot leader and page number, or a run of spaces and a page
 * number.
 *
 * Only used for the no-key fallback (see `CookbookChecklistSheet`), where
 * there is no model to read the row for what it plainly is and the raw OCR
 * text is what the user edits by hand. It is deliberately not run on what
 * reaches `extractCookbookChecklist` — the model reads the noise better than
 * a regex can, and stripping it first would throw away the very thing that
 * tells the model where a row ends.
 */
export function stripTocNoise(row: string): string {
  // Two or more dot/space characters before the trailing digits, never one —
  // a single space before a trailing number is an ordinary word break
  // ("Dinner for 2"), and only a run of them is a column separator.
  return row.replace(/[.\s]{2,}\d+\s*$/, '').trim();
}

/**
 * The bridge is `require`d at call site, never imported — same rule
 * `receiptOcr.ts` follows, and for the same reason: a module-scope import
 * pulls `expo-modules-core` into Jest's `node` environment, which throws on
 * sight.
 */
function visionBridge(): typeof import('todo-vision-bridge') {
  return require('todo-vision-bridge');
}

/**
 * Reads the table of contents at `uri` on device, or null when there's
 * nothing worth having.
 *
 * Null is the answer for every kind of not-working — no bridge, an unreadable
 * file, a read too thin to be a table of contents — because the caller's
 * branch is the same in all of them: with a key, send the photo instead; without
 * one, offer the empty manual fallback. Nothing here is allowed to throw.
 */
export async function readCookbookPhoto(uri: string): Promise<OcrTocReading | null> {
  try {
    const lines = await visionBridge().recognizeText(uri);
    const reading = reconstructToc(lines);
    return shouldUseOcrText(reading) ? reading : null;
  } catch (error) {
    console.warn('[cookbookOcr] on-device read failed', error);
    return null;
  }
}
