import type { GroceryItem, Shop } from '../types';
import { groceryNameKey } from './groceryParse';
import { matchWeight } from './grocerySuggest';
import type { ReceiptLine } from '../services/aiSuggestions';

/**
 * Deciding which rows on the shopping list a photographed receipt is talking
 * about — offline, pure, and always as a proposal.
 *
 * `extractReceipt` reads the paper; this reads the extraction against the list.
 * The split is the point: the network half is unrepeatable and untestable, and
 * *every* judgement that decides what gets written lives here instead, where it
 * can be pinned by a test.
 *
 * **Nothing this module returns is an answer — it's a draft of one.** The thing
 * waiting on the other side of the confirm is `finishShopping`, which takes a
 * whole list off in one pass and stamps a price on every row it touches. So the
 * confidence tiers below are not a ranking for its own sake: they decide what
 * arrives pre-checked and what arrives merely *offered*, which is the only
 * safety this feature has. Same discipline `classifyPlanned` follows in
 * refusing to pre-check a row a substitute merely covers.
 *
 * **A receipt is evidence of a purchase, never of an absence.** What it doesn't
 * mention is not a claim that the store lacked it — the usual reason something
 * is missing from a receipt is that you didn't get to it, which is the exact
 * call `FinishShoppingSheet` already makes about an unticked row. So nothing
 * here ever produces an `unavailableAt`, and an unmatched line is reported as a
 * line nobody claimed rather than as a fact about anything.
 */

/**
 * How far the match got, and so how much the UI is entitled to assume.
 *
 * Three tiers rather than a score, for the reason `matchWeight` gives for its
 * own 3/2/1: the number would imply a precision that a bag of abbreviations
 * read off a photo does not have, and the only decision anyone makes with it is
 * which of these three buckets it's in.
 */
export type ReceiptMatchConfidence =
  /** The names agree once keyed, plurals apart. Pre-checked. */
  | 'exact'
  /** One name starts or contains the other at a word boundary. Pre-checked. */
  | 'likely'
  /** They share a significant word and nothing more. Shown, flagged, NOT pre-checked. */
  | 'weak';

export interface ReceiptMatch {
  line: ReceiptLine;
  /** The list row this line was read as, null when nothing claimed it. */
  itemId: string | null;
  /** Null exactly when `itemId` is. */
  confidence: ReceiptMatchConfidence | null;
  /**
   * A second (or third) line landing on a row another line already claimed.
   *
   * Deliberately surfaced rather than summed. Two "MILK 3.48" lines is someone
   * who bought two gallons, and adding them into one 6.96 would put a number on
   * the row that no line of the receipt says and that `lastPriceQuantity` — a
   * single row's single quantity — has no way to qualify. The user is holding
   * the receipt; they can see there are two.
   */
  duplicateOf: string | null;
}

/** Rows a line is allowed to claim, and what came back for each. */
export interface ReceiptMatchResult {
  matches: ReceiptMatch[];
  /** Ids that arrive pre-checked — the `exact` and `likely` ones. */
  confidentIds: string[];
}

/**
 * Words too short or too common to mean a match on their own.
 *
 * Length is doing most of the work (see `sharesSignificantWord`); this list
 * only catches the short words that survive it and would otherwise marry
 * "whole milk" to "whole wheat bread".
 */
const WEAK_WORDS = new Set([
  'the', 'and', 'with', 'for', 'plus', 'pack', 'size', 'each', 'large', 'small',
  'organic', 'fresh', 'free', 'whole', 'baby', 'mini', 'value', 'brand',
]);

/** Crude, and deliberately the same crudeness `matchWeight` already tolerates. */
function singular(key: string): string {
  return key.length > 3 && key.endsWith('s') && !key.endsWith('ss') ? key.slice(0, -1) : key;
}

/** Every word worth matching on, singularized so "eggs" meets "egg". */
function significantWords(key: string): string[] {
  return key
    .split(' ')
    .filter(w => w.length >= 4 && !WEAK_WORDS.has(w))
    .map(singular);
}

function sharesSignificantWord(a: string, b: string): boolean {
  const words = new Set(significantWords(a));
  return significantWords(b).some(w => words.has(w));
}

/**
 * How well one receipt line matches one list row, or null for not at all.
 *
 * Both directions of `matchWeight` are consulted because neither name is a
 * query here: the list says "chicken" and the receipt says "chicken breast" as
 * readily as the reverse, and a one-way test would answer only half of those.
 * That reuse is also what buys the plural tolerance for free rather than
 * restating it.
 */
export function receiptMatchConfidence(
  itemKey: string,
  lineKey: string,
): ReceiptMatchConfidence | null {
  if (!itemKey || !lineKey) return null;
  if (itemKey === lineKey || singular(itemKey) === singular(lineKey)) return 'exact';
  // Weight 2 is `matchWeight`'s word-start tier — "chicken breast" for a
  // "chicken" query. Weight 3 is a bare prefix. Either way round is a real
  // reading of the same shelf item.
  if (matchWeight(itemKey, lineKey) >= 2 || matchWeight(lineKey, itemKey) >= 2) return 'likely';
  if (sharesSignificantWord(itemKey, lineKey)) return 'weak';
  return null;
}

const TIER_RANK: Record<ReceiptMatchConfidence, number> = { exact: 3, likely: 2, weak: 1 };

/**
 * Reads a receipt's lines against the rows currently on the list.
 *
 * **Only rows on the list are candidates**, and that bound is deliberate. A
 * receipt line for something nobody planned is a real purchase and its price is
 * real, but it has no row to be checked off and `finishShopping` only ever
 * touches what was ticked *on the list* — so claiming it here would mean
 * inventing a row and marking it bought in the same breath. Those lines come
 * back unclaimed instead, and the sheet says so.
 *
 * Ties are broken toward the row whose name is closest in length, then
 * alphabetically, so the result is stable rather than dependent on list order:
 * a receipt read twice must propose the same thing twice.
 */
export function matchReceiptLines(
  lines: readonly ReceiptLine[],
  items: readonly GroceryItem[],
): ReceiptMatchResult {
  const candidates = items.filter(i => i.onList);
  // Best line per row rather than best row per line: two lines reading as
  // "milk" must not both claim it, and the one that claims it should be the
  // better read of the two regardless of which is printed first.
  const claimed = new Map<string, { lineIndex: number; rank: number }>();
  const best: Array<{ itemId: string; confidence: ReceiptMatchConfidence } | null> = [];

  lines.forEach((line, index) => {
    const lineKey = groceryNameKey(line.name);
    type Candidate = { itemId: string; confidence: ReceiptMatchConfidence; key: string };

    /** Higher tier first, then the name closest in length, then alphabetically. */
    const beats = (a: Candidate, b: Candidate): boolean => {
      if (TIER_RANK[a.confidence] !== TIER_RANK[b.confidence]) {
        return TIER_RANK[a.confidence] > TIER_RANK[b.confidence];
      }
      const near = Math.abs(a.key.length - lineKey.length) - Math.abs(b.key.length - lineKey.length);
      return near !== 0 ? near < 0 : a.key.localeCompare(b.key) < 0;
    };

    let winner: Candidate | null = null;
    for (const item of candidates) {
      const confidence = receiptMatchConfidence(item.nameKey, lineKey);
      if (!confidence) continue;
      const candidate: Candidate = { itemId: item.id, confidence, key: item.nameKey };
      if (!winner || beats(candidate, winner)) winner = candidate;
    }
    best.push(winner ? { itemId: winner.itemId, confidence: winner.confidence } : null);
    if (winner) {
      const held = claimed.get(winner.itemId);
      const rank = TIER_RANK[winner.confidence];
      if (!held || rank > held.rank) claimed.set(winner.itemId, { lineIndex: index, rank });
    }
  });

  const matches: ReceiptMatch[] = lines.map((line, index) => {
    const winner = best[index];
    if (!winner) return { line, itemId: null, confidence: null, duplicateOf: null };
    const holder = claimed.get(winner.itemId);
    // The row is this line's only if this line is the one holding the claim.
    const mine = holder?.lineIndex === index;
    return {
      line,
      itemId: mine ? winner.itemId : null,
      confidence: mine ? winner.confidence : null,
      duplicateOf: mine ? null : winner.itemId,
    };
  });

  return {
    matches,
    confidentIds: matches
      .filter(m => m.itemId && m.confidence !== 'weak')
      .map(m => m.itemId as string),
  };
}

/**
 * The store the receipt's header names, as one of the user's own stores.
 *
 * Returns null rather than the closest thing when nothing matches well, because
 * the cost of the two mistakes is nowhere near symmetric: an unrecognized name
 * asks a question the user answers in one tap, while a wrong one files a whole
 * trip's prices and purchase counts against a store they never went to — and
 * `ItemShopLink` is exactly the record that has no way to notice it's wrong
 * later.
 *
 * The comparison is the same keying the catalog uses, so "Trader Joes" and
 * "Trader Joe's" are one store without a second normalizer to keep in step.
 */
/**
 * A store name with its spaces closed up, for the equality test only.
 *
 * `groceryNameKey` turns an apostrophe into a space, so the user's "Trader
 * Joe's" keys as `trader joe s` while the receipt's own "TRADER JOES" keys as
 * `trader joes` — two spellings of one store that would otherwise never meet.
 * Possessive store names are common enough (Trader Joe's, Sam's Club, Lowe's)
 * that this is the normal case rather than an edge one.
 *
 * Used for equality and nothing else: closing the spaces also destroys the word
 * boundaries the containment test below depends on to refuse "Met" for "Metro".
 */
function compactShopKey(name: string): string {
  return groceryNameKey(name).replace(/ /g, '');
}

export function matchReceiptShop(storeName: string, shops: readonly Shop[]): Shop | null {
  const key = groceryNameKey(storeName);
  if (!key) return null;
  const exact = shops.find(s => compactShopKey(s.name) === compactShopKey(storeName));
  if (exact) return exact;
  // A header routinely carries a branch or a legal suffix the user's own name
  // doesn't ("Safeway Store 1234"), so containment either way is still a
  // confident read — but only on a whole word, or "Met" would claim "Metro".
  return shops.find(s => {
    const shopKey = groceryNameKey(s.name);
    if (!shopKey) return false;
    return key === shopKey
      || key.startsWith(`${shopKey} `)
      || shopKey.startsWith(`${key} `);
  }) ?? null;
}
