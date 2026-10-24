import { getDayStart } from './dateUtils';
import { isEatenOutDraft, type EatenOutProbe } from './dishRating';
import { useDishRatingStore } from '../store/useDishRatingStore';

/**
 * Raises "Would you order it again?" for a meal just logged, when it reads as
 * one eaten out (`isEatenOutDraft`). **Every path that writes a described meal
 * calls this**, because the question is about the meal and not about the
 * screen it was logged from: the food log sheet's own save, the Describe
 * panel's Log, a recalled food, and a queued estimate that is confirmed
 * (`usePendingEstimateStore.log`). Wiring only the first meant the question
 * never came after the way most restaurant meals are logged.
 *
 * The dish is dated by the logical day of the meal's own moment, never "now":
 * lunch logged at 1:30 AM under a 2 AM day start belongs to the day before,
 * and a meal logged at bedtime for earlier is dated for when it was eaten.
 */
export function offerDishRating(meal: EatenOutProbe & { label: string; at: Date }): void {
  if (!isEatenOutDraft(meal)) return;
  useDishRatingStore.getState().offerRating(meal.label, getDayStart(meal.at));
}
