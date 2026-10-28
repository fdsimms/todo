import { columnCapFor, dashboardColumnsFor, DASHBOARD_ROUTES, UNCAPPED_WIDTH, WIDE_LIST_ROUTES } from '../utils/columnCap';
import {
  DASHBOARD_CONTENT_WIDTH,
  LIST_CONTENT_WIDTH,
  MAX_CONTENT_WIDTH,
  SIDEBAR_MIN_WINDOW_WIDTH,
} from '../utils/frameWidth';
import { TWO_PANE_ROUTES } from '../utils/twoPane';

describe('columnCapFor', () => {
  it('keeps every screen at one column below the sidebar, so a phone and an upright iPad do not change', () => {
    for (const route of ['Stats', 'People', 'Today', 'Calendar']) {
      expect(columnCapFor(390, route)).toBe(MAX_CONTENT_WIDTH);
      expect(columnCapFor(SIDEBAR_MIN_WINDOW_WIDTH - 1, route)).toBe(MAX_CONTENT_WIDTH);
    }
  });

  it('widens a list screen once the sidebar shows', () => {
    expect(columnCapFor(1200, 'People')).toBe(LIST_CONTENT_WIDTH);
    expect(columnCapFor(SIDEBAR_MIN_WINDOW_WIDTH, 'Logbook')).toBe(LIST_CONTENT_WIDTH);
  });

  it('widens a dashboard only when it has room for two columns', () => {
    expect(columnCapFor(1512, 'Stats')).toBe(DASHBOARD_CONTENT_WIDTH);
    // 1000pt less the sidebar is 764pt, which is one column: wider than 720 only stretches a chart.
    expect(columnCapFor(1000, 'Stats')).toBe(MAX_CONTENT_WIDTH);
  });

  it('leaves a two-pane screen uncapped once there is room for both panes, and the cap otherwise', () => {
    for (const route of TWO_PANE_ROUTES) {
      expect(columnCapFor(1512, route)).toBe(UNCAPPED_WIDTH);
      expect(columnCapFor(1000, route)).toBe(MAX_CONTENT_WIDTH);
    }
  });

  it('keeps a screen on neither list at one column, and a sheet\'s own frame (no route) too', () => {
    expect(columnCapFor(1512, 'Calendar')).toBe(MAX_CONTENT_WIDTH);
    expect(columnCapFor(1512, 'MealPlan')).toBe(MAX_CONTENT_WIDTH);
    expect(columnCapFor(1512, null)).toBe(MAX_CONTENT_WIDTH);
    expect(columnCapFor(1512, undefined)).toBe(MAX_CONTENT_WIDTH);
  });

  it('names no route twice, since the first list it is on would win silently', () => {
    for (const route of DASHBOARD_ROUTES) {
      expect(WIDE_LIST_ROUTES.has(route)).toBe(false);
      expect(TWO_PANE_ROUTES.has(route)).toBe(false);
    }
    for (const route of WIDE_LIST_ROUTES) expect(TWO_PANE_ROUTES.has(route)).toBe(false);
  });
});

describe('dashboardColumnsFor', () => {
  it('is one column until the window leaves 880pt beside the sidebar', () => {
    expect(dashboardColumnsFor(390)).toBe(1);
    expect(dashboardColumnsFor(1115)).toBe(1);
    expect(dashboardColumnsFor(1116)).toBe(2);
  });

  it('stays at two however wide the window gets', () => {
    expect(dashboardColumnsFor(2560)).toBe(2);
  });
});
