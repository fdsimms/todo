import {
  TWO_PANE_MIN_WINDOW_WIDTH,
  TWO_PANE_ROUTES,
  columnUncappedFor,
  twoPaneFor,
} from '../utils/twoPane';
import { SIDEBAR_WIDTH } from '../utils/frameWidth';
import { TWO_PANE_LIST_MAX_WIDTH, TWO_PANE_LIST_WIDTH, twoPaneListWidthFor } from '../utils/twoPane';

describe('twoPaneFor', () => {
  it('is false on a phone, an upright iPad and a window that only fits the sidebar', () => {
    expect(twoPaneFor(393)).toBe(false);
    expect(twoPaneFor(834)).toBe(false);
    expect(twoPaneFor(TWO_PANE_MIN_WINDOW_WIDTH - 1)).toBe(false);
  });

  it('is true from the breakpoint up', () => {
    expect(twoPaneFor(TWO_PANE_MIN_WINDOW_WIDTH)).toBe(true);
    expect(twoPaneFor(1440)).toBe(true);
  });

  it('leaves the page at least a phone wide once the sidebar and the list are taken', () => {
    expect(TWO_PANE_MIN_WINDOW_WIDTH - SIDEBAR_WIDTH - TWO_PANE_LIST_WIDTH).toBeGreaterThan(393);
  });
});

describe('columnUncappedFor', () => {
  it('lifts the cap on a two-pane screen in a wide window', () => {
    expect(columnUncappedFor(1440, 'Recipes')).toBe(true);
    expect(columnUncappedFor(1440, 'Projects')).toBe(true);
    expect(columnUncappedFor(1440, 'Today')).toBe(true);
    expect(columnUncappedFor(1440, 'Groceries')).toBe(true);
  });

  it('keeps the cap on every other screen', () => {
    expect(columnUncappedFor(1440, 'Stats')).toBe(false);
    expect(columnUncappedFor(1440, null)).toBe(false);
    expect(columnUncappedFor(1440, undefined)).toBe(false);
  });

  it('keeps the cap in a window too narrow for two panes', () => {
    expect(columnUncappedFor(1000, 'Recipes')).toBe(false);
  });

  it('keeps the cap on a page pushed over a two-pane screen', () => {
    expect(TWO_PANE_ROUTES.has('RecipeDetail')).toBe(false);
    expect(columnUncappedFor(1440, 'RecipeDetail')).toBe(false);
  });
});

describe('twoPaneListWidthFor', () => {
  it('is the narrowest width at the breakpoint', () => {
    expect(twoPaneListWidthFor(TWO_PANE_MIN_WINDOW_WIDTH)).toBe(TWO_PANE_LIST_WIDTH);
  });

  it('grows with a wider window, up to its cap', () => {
    const laptop = twoPaneListWidthFor(1512);
    expect(laptop).toBeGreaterThan(TWO_PANE_LIST_WIDTH);
    expect(laptop).toBeLessThan(TWO_PANE_LIST_MAX_WIDTH);
    expect(twoPaneListWidthFor(2560)).toBe(TWO_PANE_LIST_MAX_WIDTH);
  });

  it('always leaves the page at least a phone wide', () => {
    for (let w = TWO_PANE_MIN_WINDOW_WIDTH; w <= 2560; w += 10) {
      expect(w - SIDEBAR_WIDTH - twoPaneListWidthFor(w)).toBeGreaterThan(393);
    }
  });
});
