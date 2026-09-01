import { GROCERY_NAME_MAX_LENGTH, SHOP_NAME_MAX_LENGTH } from '../types';
import type { ExtractedReceipt, ReceiptLine } from '../services/aiSuggestions';
import type { OcrReceipt, OcrReceiptRow } from './receiptOcr';

/**
 * Reading a receipt with no API key at all.
 *
 * `extractReceipt` is the good path and stays the good path. This is what the
 * scanner offers when there is no key to spend — every AI feature in this app
 * is inert without one, and once Vision is reading the paper anyway, "what did
 * this cost" is answerable on device even though "what is it" isn't.
 *
 * **It is honestly worse, and the sheet says so.** Two things the model does
 * are not attempted here:
 *
 * - **Expanding the shorthand.** `ReceiptLine.name` settled this: a receipt's
 *   abbreviations are store-specific, unbounded and drift, so an offline
 *   lexicon of them "would be a guess-machine we'd be maintaining for ever".
 *   Nothing here guesses. `name` is set to the printed text, so the matcher
 *   works on the shorthand itself — which is enough for the many lines printed
 *   in plain words ("BANANAS"), enough for anything the user has already taught
 *   this store via `storeAliases`, and not enough for "BNLS SKNLS CHKN BRST".
 *   Those come back unmatched for the user to file by hand, which is a row of
 *   work rather than a wrong answer.
 * - **Reading quantity.** A weight or a count is printed in a different place
 *   on every register, and unlike the price it has no column to sit in. Left
 *   empty rather than guessed.
 *
 * What *is* attempted is the bounded half: which rows aren't purchases at all.
 * That is a different problem from expanding shorthand and the reason it's
 * allowed here is that its vocabulary is finite and store-independent — every
 * register in the country prints SUBTOTAL, TAX, CHANGE and VISA, and none of
 * them are a product. The list below is that vocabulary and nothing more; when
 * a line isn't on it, it counts as an item and the user unticks it.
 */

/**
 * Words that mean a row is the till talking rather than a thing that was
 * bought. Matched against whole words, so "TOTAL" catches a line and
 * "TOTALLY NUTS GRANOLA" does not.
 *
 * The same ground the prompt covers on the model path, kept in step with it
 * deliberately: totals, tax, tender, change, card and authorization details,
 * loyalty and membership numbers, address and phone, cashier and register
 * numbers, surveys, coupons and discounts, bag fees and bottle deposits.
 */
const NON_ITEM_WORDS = [
  'subtotal', 'total', 'tax', 'vat', 'balance', 'due',
  'cash', 'change', 'tender', 'debit', 'credit', 'visa', 'mastercard', 'amex',
  'discover', 'card', 'chip', 'contactless', 'account', 'auth', 'authorization',
  'approval', 'approved', 'ref', 'reference', 'terminal', 'merchant', 'trace',
  'loyalty', 'member', 'membership', 'rewards', 'points', 'savings', 'saved',
  'coupon', 'discount', 'promo', 'manager',
  'bag', 'deposit', 'crv', 'donation', 'round',
  'cashier', 'register', 'lane', 'store', 'tel', 'phone', 'survey', 'void',
  'refund', 'return', 'items', 'qty', 'count',
] as const;

const NON_ITEM = new RegExp(`\\b(${NON_ITEM_WORDS.join('|')})\\b`, 'i');

/** A row that names the grand total rather than a subtotal or a tax line. */
const GRAND_TOTAL = /\btotal\b/i;
const SUBTOTAL = /\bsub\s*total\b/i;

/**
 * `MM/DD/YY`, `MM/DD/YYYY` and `MM-DD-YYYY`, anywhere in a row.
 *
 * American order only, because that is the order every register this app is
 * used at prints in and because the two are indistinguishable up to the 12th of
 * a month — a guess that is right 60% of the time and silently dates a whole
 * trip wrong the rest is worse than the model path's read. `isPlausibleReceiptDate`
 * is still the gate downstream, same as for a model-read date.
 */
const PRINTED_DATE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/;

/** Whether this row is the till talking rather than something that was bought. */
export function isNonItemRow(label: string): boolean {
  return NON_ITEM.test(label);
}

/**
 * The date printed anywhere on the receipt, as `YYYY-MM-DD`, or null.
 *
 * Read from the whole reading rather than a nominated row, because registers
 * print it in the header, in the footer, and occasionally beside the
 * transaction number. The first one found wins; a receipt printing two
 * different dates is a receipt with a "valid until" on it, and the earlier one
 * is the shop.
 */
export function findPrintedDate(rows: readonly OcrReceiptRow[]): string | null {
  for (const row of rows) {
    const match = PRINTED_DATE.exec(row.label);
    if (!match) continue;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const rawYear = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const year = match[3].length === 2 ? 2000 + rawYear : rawYear;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Same round-trip check the model path's date goes through: a well-formed
    // "02-31" is not a day.
    const parsed = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(parsed.getTime()) || parsed.getDate() !== day) continue;
    return iso;
  }
  return null;
}

/**
 * The grand total, or null.
 *
 * The *last* row saying "total" without saying "subtotal", because a receipt
 * prints its subtotal above its total and often a "total savings" below both —
 * and of those, the one that is the amount charged is the last one that has a
 * price on it.
 */
export function findPrintedTotal(rows: readonly OcrReceiptRow[]): number | null {
  let found: number | null = null;
  for (const row of rows) {
    if (row.priceMinor === null) continue;
    if (!GRAND_TOTAL.test(row.label) || SUBTOTAL.test(row.label)) continue;
    if (/\bsavings?\b|\bsaved\b/i.test(row.label)) continue;
    found = row.priceMinor;
  }
  return found;
}

/** How far down the paper a store name can still be the store's name. */
const STORE_NAME_SEARCH_ROWS = 6;

/**
 * The store's name, guessed from the top of the receipt, or an empty string.
 *
 * Registers print the store's name first and in the largest type on the paper,
 * so this takes the first row that has no price, is not the till talking, and
 * reads like a name rather than an address. It is a guess and it is allowed to
 * be one: `matchReceiptShop` refuses anything it doesn't recognise outright
 * rather than picking the nearest store, so a wrong guess here costs the user
 * one tap to name the store and cannot file a trip against the wrong one.
 */
export function guessStoreName(rows: readonly OcrReceiptRow[]): string {
  for (const row of rows.slice(0, STORE_NAME_SEARCH_ROWS)) {
    const label = row.label.trim();
    if (!label || row.priceMinor !== null) continue;
    // An address line, a phone number, or a row that is mostly digits.
    if (/\d{3}[-.\s]?\d{4}/.test(label)) continue;
    if (/^\d/.test(label)) continue;
    if (isNonItemRow(label)) continue;
    if (!/[A-Za-z]{2}/.test(label)) continue;
    return label.slice(0, SHOP_NAME_MAX_LENGTH);
  }
  return '';
}

/**
 * An on-device reading → the same `ExtractedReceipt` the model path returns.
 *
 * Deliberately the same type: everything downstream — `matchReceiptLines`,
 * `receiptCautionsFor`, the review sheet, `finishShopping` — must not be able
 * to tell which path read the paper, or the offline mode becomes a second
 * pipeline to keep in step with the first. What differs is only how good the
 * fields are, and the sheet is where the user is told that.
 */
export function extractReceiptOffline(receipt: OcrReceipt): ExtractedReceipt {
  const lines: ReceiptLine[] = [];
  for (const row of receipt.rows) {
    // A row with no price is the header, the footer or a line whose amount was
    // missed. None of the three is something to tick a purchase off against.
    if (row.priceMinor === null) continue;
    const label = row.label.trim();
    if (!label || isNonItemRow(label)) continue;
    lines.push({
      label: label.slice(0, GROCERY_NAME_MAX_LENGTH),
      // The printed text, not a guess at what it stands for — see the note at
      // the top of this file.
      name: label.slice(0, GROCERY_NAME_MAX_LENGTH),
      quantity: '',
      priceMinor: row.priceMinor,
    });
  }

  return {
    storeName: guessStoreName(receipt.rows),
    lines,
    totalMinor: findPrintedTotal(receipt.rows),
    date: findPrintedDate(receipt.rows),
  };
}
