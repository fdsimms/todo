import { positionFraction, ratingFromPosition, restingRatingForSeverity, stepRating } from '../utils/ratingSlider';

describe('ratingFromPosition', () => {
  it('maps a touch along the track to the nearest whole rating', () => {
    expect(ratingFromPosition(0, 200)).toBe(0);
    expect(ratingFromPosition(100, 200)).toBe(5);
    expect(ratingFromPosition(200, 200)).toBe(10);
    expect(ratingFromPosition(29, 200)).toBe(1);
    expect(ratingFromPosition(31, 200)).toBe(2);
  });

  it('holds a touch past either end to the ends', () => {
    expect(ratingFromPosition(-40, 200)).toBe(0);
    expect(ratingFromPosition(900, 200)).toBe(10);
  });

  it('is 0 before the track has been measured, or for a touch with no position', () => {
    expect(ratingFromPosition(50, 0)).toBe(0);
    expect(ratingFromPosition(NaN, 200)).toBe(0);
  });
});

describe('positionFraction and stepRating', () => {
  it('places a rating along the track', () => {
    expect(positionFraction(0)).toBe(0);
    expect(positionFraction(5)).toBe(0.5);
    expect(positionFraction(14)).toBe(1);
  });

  it('steps one at a time and stops at the ends', () => {
    expect(stepRating(4, 1)).toBe(5);
    expect(stepRating(0, -1)).toBe(0);
    expect(stepRating(10, 1)).toBe(10);
  });
});

describe('restingRatingForSeverity', () => {
  it('sits inside the band the level covers', () => {
    expect(restingRatingForSeverity(1)).toBeLessThanOrEqual(3);
    expect(restingRatingForSeverity(2)).toBeGreaterThanOrEqual(4);
    expect(restingRatingForSeverity(2)).toBeLessThanOrEqual(6);
    expect(restingRatingForSeverity(3)).toBeGreaterThanOrEqual(7);
  });
});
