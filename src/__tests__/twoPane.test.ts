import {
  TWO_PANE_MIN_WINDOW_WIDTH,
  TWO_PANE_ROUTES,
  columnUncappedFor,
  floatingLayerInsetFor,
  nextLayoutHold,
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

describe('nextLayoutHold', () => {
  it('keeps nothing while no editor is open, however the window moves', () => {
    expect(nextLayoutHold(null, true, false, false)).toBeNull();
    expect(nextLayoutHold(null, false, true, false)).toBeNull();
    expect(nextLayoutHold(null, true, true, false)).toBeNull();
  });

  it('keeps the pane when the window narrows under an open editor', () => {
    expect(nextLayoutHold(null, true, false, true)).toBe(true);
  });

  it('keeps the sheet when the window widens over an open one', () => {
    expect(nextLayoutHold(null, false, true, true)).toBe(false);
  });

  it('starts nothing when an editor is open but the window did not cross the breakpoint', () => {
    expect(nextLayoutHold(null, true, true, true)).toBeNull();
    expect(nextLayoutHold(null, false, false, true)).toBeNull();
  });

  it('holds until the window comes back to the layout it is holding', () => {
    // Pane held, window still narrow.
    expect(nextLayoutHold(true, false, false, true)).toBe(true);
    // Back across the breakpoint: the pane is the window's own layout again.
    expect(nextLayoutHold(true, false, true, true)).toBeNull();
    // Sheet held, window still wide, then back below.
    expect(nextLayoutHold(false, true, true, true)).toBe(false);
    expect(nextLayoutHold(false, true, false, true)).toBeNull();
  });

  it('holds through further resizing on the same side', () => {
    expect(nextLayoutHold(true, false, false, true)).toBe(true);
    expect(nextLayoutHold(false, true, true, true)).toBe(false);
  });
});

describe('floatingLayerInsetFor', () => {
  it('is nothing on a screen with one pane, so the bars span the column as they always did', () => {
    expect(floatingLayerInsetFor(393, 'Today')).toBe(0);
    expect(floatingLayerInsetFor(1400, 'Stats')).toBe(0);
    expect(floatingLayerInsetFor(1400, null)).toBe(0);
  });

  it('is nothing in a window too narrow for two panes', () => {
    expect(floatingLayerInsetFor(TWO_PANE_MIN_WINDOW_WIDTH - 1, 'Today')).toBe(0);
  });

  it('ends the layer at the list pane on a two-pane screen', () => {
    const window = 1600;
    const column = window - SIDEBAR_WIDTH;
    expect(floatingLayerInsetFor(window, 'Today')).toBe(column - twoPaneListWidthFor(window));
    // The layer is then exactly as wide as the list, where the add button sits.
    expect(column - floatingLayerInsetFor(window, 'Today')).toBe(twoPaneListWidthFor(window));
  });

  it('covers every screen that has a second pane', () => {
    for (const route of TWO_PANE_ROUTES) {
      expect(floatingLayerInsetFor(1600, route)).toBeGreaterThan(0);
    }
  });
});
