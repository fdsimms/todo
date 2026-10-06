import type { GroceryItem, ItemProduct } from '../types';
import { FROZEN_REASON, RUNNING_LOW_REASON } from '../types';
import { onHandAssertion, probablyHaveReason } from './grocerySuggest';
import type { PantryReviewAnswer } from './pantryReview';

/**
 * Where one item stands in the pantry right now, in the words the pantry
 * answer control shows beside its label.
 *
 * `probablyHaveReason` is still the one owner of the "do I have it" opinion;
 * this only words its result for a control and says which of the three
 * answers, if any, the row already holds. Nothing here decides anything new.
 */
export interface PantryStanding {
  /** One short line: "Running low", "Bought 3× · last on Sep 28", "Nothing recorded". */
  text: string;
  tone: 'good' | 'warn' | 'bad' | 'none';
  /**
   * The answer the row already carries, or null. Only a standing someone *said*
   * counts: running low, out of it, or marked on hand. A guess from purchases,
   * a staple and the freezer are states with no answer of their own, so the
   * control starts with nothing selected and an unchanged control writes
   * nothing.
   */
  answer: PantryReviewAnswer | null;
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function pantryStanding(
  item: GroceryItem,
  now: Date,
  products: readonly ItemProduct[] = []
): PantryStanding {
  const reason = probablyHaveReason(item, now, products);
  const asserted = onHandAssertion(item, now);

  if (!reason) {
    // "Out of it" and "nothing recorded" both read null from the reason; the
    // assertion is what tells them apart.
    return asserted === false
      ? { text: 'Out of it', tone: 'bad', answer: 'out' }
      : { text: 'Nothing recorded', tone: 'none', answer: null };
  }
  if (reason === RUNNING_LOW_REASON) return { text: 'Running low', tone: 'warn', answer: 'low' };
  if (reason === FROZEN_REASON) return { text: 'In the freezer', tone: 'good', answer: null };
  if (item.isStaple) return { text: 'Always have it', tone: 'good', answer: null };
  return {
    text: capitalized(reason),
    tone: 'good',
    answer: asserted === true ? 'have' : null,
  };
}
