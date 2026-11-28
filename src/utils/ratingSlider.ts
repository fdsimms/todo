import { RATING_MAX } from './moodLog';

/**
 * The arithmetic behind `RatingSlider`: a touch's position along the track to
 * a whole-number rating, and back. Pure so the edges (a touch past either end,
 * a track not measured yet) are pinned by tests rather than by a device.
 */

/** The whole rating 0..`max` nearest to a touch `x` points along a track `width` points wide. */
export function ratingFromPosition(x: number, width: number, max: number = RATING_MAX): number {
  if (!(width > 0) || !Number.isFinite(x)) return 0;
  const fraction = Math.min(1, Math.max(0, x / width));
  return Math.round(fraction * max);
}

/** How far along the track (0..1) a rating sits. */
export function positionFraction(rating: number, max: number = RATING_MAX): number {
  if (!(max > 0)) return 0;
  return Math.min(1, Math.max(0, rating / max));
}

/** A rating one step up or down, held inside 0..`max`. For the accessibility increment and decrement actions. */
export function stepRating(rating: number, direction: 1 | -1, max: number = RATING_MAX): number {
  return Math.min(max, Math.max(0, Math.round(rating) + direction));
}

/**
 * Where the thumb rests for a symptom that has only a Mild/Moderate/Severe
 * level and no rating yet (an entry from before it was rated on a slider, or
 * one set with the three-level tap). The middle of each level's band, so the
 * thumb is drawn near what was recorded without claiming a number that wasn't.
 */
export function restingRatingForSeverity(severity: 1 | 2 | 3): number {
  return severity === 3 ? 8 : severity === 2 ? 5 : 2;
}
