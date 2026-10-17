import {
  isDownwardDrag,
  overscrollDismisses,
  quickSearchMaxHeight,
  shouldDismissOnSwipe,
  swipeFollowOffset,
} from '../utils/swipeDismiss';

describe('swipeDismiss', () => {
  it('treats only a mostly-vertical downward drag as a swipe', () => {
    expect(isDownwardDrag(0, 20)).toBe(true);
    expect(isDownwardDrag(5, 12)).toBe(true);
    expect(isDownwardDrag(0, 4)).toBe(false);
    expect(isDownwardDrag(30, 30)).toBe(false);
    expect(isDownwardDrag(0, -30)).toBe(false);
  });

  it('closes on a long drag or a fast flick, not a short slow one', () => {
    expect(shouldDismissOnSwipe(80, 0.1)).toBe(true);
    expect(shouldDismissOnSwipe(30, 0.9)).toBe(true);
    expect(shouldDismissOnSwipe(30, 0.2)).toBe(false);
    expect(shouldDismissOnSwipe(10, 2)).toBe(false);
  });

  it('follows the finger down, damped, and never up', () => {
    expect(swipeFollowOffset(100)).toBe(60);
    expect(swipeFollowOffset(-40)).toBe(0);
  });

  it('closes on a deep enough pull past the top of the list', () => {
    expect(overscrollDismisses(-80)).toBe(true);
    expect(overscrollDismisses(-30)).toBe(false);
    expect(overscrollDismisses(40)).toBe(false);
  });

  it('caps the card above the keyboard, or above the bottom inset without one', () => {
    expect(quickSearchMaxHeight(800, 60, 300, 34, 16)).toBe(424);
    expect(quickSearchMaxHeight(800, 60, 0, 34, 16)).toBe(690);
    expect(quickSearchMaxHeight(300, 60, 280, 34, 16)).toBe(160);
  });
});
