import { format } from 'date-fns/format';
import type { GroceryItem, ItemProduct } from '../types';
import {
  OUT_OF_IT_UNTIL,
  pantryGuessLapsedDays,
  probablyHaveReason,
} from './grocerySuggest';
import { PANTRY_CHECK_GRACE_DAYS } from './pantryCheckTasks';

/**
 * The pantry review deck — the whole cupboard, one card at a time.
 *
 * `pantryCheck` (see `pantryCheckTasks.ts`) asks "do you still have X" one
 * item at a time, metered to three rows and gated hard, because a question
 * arriving on Today unasked is expensive. This is the same question asked the
 * other way round: the user has opened the deck on purpose, is standing in
 * front of the cupboard, and wants to be asked about everything at once.
 *
 * **It is a correction pass, not an inventory.** `docs/arch/groceries.md` rules
 * out growing a check-in gesture onto `KitchenScreen`'s rows, and that stands —
 * the browsing surface must not become a chore you are behind on. What makes
 * this a different animal is that it is opened deliberately, it is finite, and
 * it writes nothing the two pantry pills could not already write. "Computed
 * first, corrected second" is the rule; this is the second half, in bulk.
 *
 * Three things keep it from turning back into the inventory it must not be:
 *
 * - **The deck ends.** `MAX_PANTRY_REVIEW_CARDS` bounds it and
 *   `PANTRY_CHECK_GRACE_DAYS` bounds what qualifies at all. Without the second
 *   one the qualifying set is most of the catalog, back to the first trip ever
 *   recorded — the same flood that constant was written for, and the reason
 *   it is imported rather than copied: one owner for "how stale a lapse can be
 *   and still be worth asking about", so the drip and the deck can't disagree
 *   about which items are in doubt.
 * - **It is ordered by doubt**, not by name or aisle. A deck that opens on the
 *   things the app is surest about is a deck that wastes the user's first ten
 *   swipes confirming what it already believed.
 * - **It answers with the three assertions that already exist** — `onHandUntil`,
 *   `runningLowAt`, and the "Out of it" sentinel. No quantities, no per-card
 *   expiry, no freezer. Those are the inventory creeping back in.
 */

/**
 * What a swipe says. Deliberately the three states the pantry can already be
 * told about, and deliberately not four: `runningLowAt` is the middle of the
 * scale that "Got it"/"Out of it" was missing (see `docs/arch/groceries.md`),
 * and it is the one answer with an outlet — it puts the row on the shopping
 * list, which is what gives a review pass something to show for itself.
 */
export type PantryReviewAnswer = 'have' | 'low' | 'out';

/**
 * How many cards one session can hold.
 *
 * A pantry is hundreds of rows and a deck that long is the treadmill this
 * feature exists to avoid — twenty is about a minute of swiping, which is a
 * session rather than a chore. What the cap leaves out is reported rather than
 * silently dropped (`omitted` below), and the ordering means what it leaves out
 * is what the app was least unsure about.
 */
export const MAX_PANTRY_REVIEW_CARDS = 20;

/**
 * How sure the app currently is about one row, worst first. The deck's sort
 * key, and the reason a card is in the deck at all.
 *
 * - `lapsed` — the purchase reading's window has run out, so the app has
 *   stopped having an opinion and nothing was written when it did. This is the
 *   one state change in the whole kitchen a person cannot see happen, and the
 *   single most useful thing a review can fix.
 * - `guessed` — still on hand, but only because a purchase says so. Confirming
 *   is not a no-op: it converts a guess with a shelf life into an explicit
 *   assertion, which is why these are in the deck rather than filtered out.
 * - `asserted` — the user has said something about this row (Got it, frozen,
 *   opened, running low). Asked last, because the app has already been told.
 */
export type PantryDoubt = 'lapsed' | 'guessed' | 'asserted';

const DOUBT_ORDER: readonly PantryDoubt[] = ['lapsed', 'guessed', 'asserted'];

export interface PantryReviewCard {
  item: GroceryItem;
  doubt: PantryDoubt;
  /**
   * `probablyHaveReason`'s own words, or null once the guess has lapsed and
   * there is no reason left to give. That function owns this wording — the
   * same line the item sheet, the kitchen row and a week plan already show,
   * and a second phrasing here would be a second thing to keep true.
   */
  reason: string | null;
  /** Days since the purchase window closed, for a `lapsed` card only. */
  lapsedDays: number | null;
}

export interface PantryReviewDeck {
  cards: PantryReviewCard[];
  /**
   * Qualifying rows the cap left out. Rendered in the finished state rather
   * than swallowed: a session that quietly covered a fifth of the cupboard and
   * said "all done" is lying about what it did.
   */
  omitted: number;
}

/**
 * Every row worth asking about, worst doubt first.
 *
 * Three exclusions, each of which would otherwise put a card in the deck that
 * has no honest answer:
 *
 * - **Staples.** "Always have it" is a standing fact rather than a guess, and
 *   the deck's own left swipe contradicts it. `correctableHaveReason` draws the
 *   same line for the same reason.
 * - **Rows already marked "Out of it".** The question has been answered; asking
 *   again is the drip's `pantryCheckDeclinedAt` problem in card form.
 * - **Rows only a box vouches for.** The three answers write the *item's*
 *   columns, and an item on hand solely because one packet is in the freezer is
 *   a claim about that packet — see `ItemProduct`'s four pantry columns. Saying
 *   "out of it" at the item level there would overwrite a box-level fact the
 *   user set deliberately, which is exactly the cascade the per-box actions
 *   refuse to do.
 */
export function buildPantryReviewDeck(
  items: readonly GroceryItem[],
  now: Date,
  products: readonly ItemProduct[] = []
): PantryReviewDeck {
  const candidates: PantryReviewCard[] = [];

  for (const item of items) {
    if (item.isStaple) continue;
    if (item.onHandUntil === OUT_OF_IT_UNTIL) continue;

    // The item's own claim, deliberately read without its boxes. A row a box
    // answers for is skipped below rather than carded, so the products are
    // consulted only to tell "nothing vouches for this" apart from "a packet
    // does" — never to build the card itself.
    const reason = probablyHaveReason(item, now);
    if (reason) {
      candidates.push({
        item,
        // An explicit assertion outranks the purchase reading inside
        // `probablyHaveReason`, so the columns are what decide the tier here
        // rather than the prose it returned — the same "read the columns, not
        // the string" rule `correctableHaveReason` follows.
        doubt: isAsserted(item, now) ? 'asserted' : 'guessed',
        reason,
        lapsedDays: null,
      });
      continue;
    }

    // Nothing at item level. A packet still on hand answers for it, and that
    // is not an item-level question.
    if (probablyHaveReason(item, now, products)) continue;

    const lapsedDays = pantryGuessLapsedDays(item, now);
    if (lapsedDays === null || lapsedDays > PANTRY_CHECK_GRACE_DAYS) continue;
    candidates.push({ item, doubt: 'lapsed', reason: null, lapsedDays });
  }

  candidates.sort(comparePantryReviewCards);
  return {
    cards: candidates.slice(0, MAX_PANTRY_REVIEW_CARDS),
    omitted: Math.max(0, candidates.length - MAX_PANTRY_REVIEW_CARDS),
  };
}

/**
 * Whether the row carries a live claim of its own rather than a purchase guess.
 *
 * Mirrors `probablyHaveReason`'s own precedence for the states that outrank the
 * purchase reading. `onHandUntil` is read as "live assertion" only while it is
 * still in the future: a lapsed "Got it" hands the question back to the guess
 * rather than counting as something the user said (see `onHandAssertion`).
 */
function isAsserted(item: GroceryItem, now: Date): boolean {
  if (item.runningLowAt || item.frozenAt || item.openedAt) return true;
  if (!item.onHandUntil) return false;
  const until = new Date(item.onHandUntil).getTime();
  return !Number.isNaN(until) && until >= now.getTime();
}

/**
 * Worst doubt first, then the most answerable card inside each tier.
 *
 * A fresh lapse beats an old one and an old purchase beats a recent one, which
 * is the same idea twice: ask about the thing whose answer the user can still
 * remember, and about the guess closest to running out.
 */
function comparePantryReviewCards(a: PantryReviewCard, b: PantryReviewCard): number {
  const tier = DOUBT_ORDER.indexOf(a.doubt) - DOUBT_ORDER.indexOf(b.doubt);
  if (tier !== 0) return tier;
  if (a.doubt === 'lapsed') {
    const lapse = (a.lapsedDays ?? 0) - (b.lapsedDays ?? 0);
    if (lapse !== 0) return lapse;
  }
  if (a.doubt === 'guessed') {
    const purchase = (a.item.lastPurchasedAt ?? '').localeCompare(b.item.lastPurchasedAt ?? '');
    if (purchase !== 0) return purchase;
  }
  return a.item.name.localeCompare(b.item.name);
}

/**
 * The card's second line when there is no `reason` to show — a lapsed row has
 * dropped out of the pantry, so `probablyHaveReason` has nothing to say about
 * it and the card would otherwise be a bare name.
 *
 * Same `MMM d` shape the purchase reading itself uses, so the two lines read as
 * one voice rather than as two formats.
 */
export function describeLastPurchase(item: Pick<GroceryItem, 'lastPurchasedAt'>): string | null {
  if (!item.lastPurchasedAt) return null;
  const at = new Date(item.lastPurchasedAt);
  if (Number.isNaN(at.getTime())) return null;
  return `Last bought ${format(at, 'MMM d')}`;
}

/**
 * The doubt pill, or null for a card that hasn't got one.
 *
 * Only a `lapsed` card carries one: it is the reason that card is at the front
 * of the deck, and the one fact about it the app has never had a way to show.
 * A `guessed` card's own reason line already says how sure the app is, and
 * captioning it twice is the noise `tripMarkerFor`'s silence-by-default rule
 * exists to avoid.
 */
export function describePantryDoubt(card: PantryReviewCard): string | null {
  if (card.doubt !== 'lapsed' || card.lapsedDays === null) return null;
  if (card.lapsedDays <= 0) return 'Guess ran out today';
  if (card.lapsedDays === 1) return 'Guess ran out yesterday';
  return `Guess ran out ${card.lapsedDays} days ago`;
}

/**
 * What the finished state says. Names the cap's leftovers rather than letting
 * a capped pass read as having covered the cupboard.
 */
export function describePantryReviewDone(answered: number, omitted: number): string {
  const things = answered === 1 ? '1 thing' : `${answered} things`;
  const head = answered === 0 ? 'Nothing checked' : `Checked ${things}`;
  return omitted > 0 ? `${head}. ${omitted} more to go through next time.` : `${head}.`;
}
