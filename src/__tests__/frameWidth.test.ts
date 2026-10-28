import {
  MAX_CONTENT_WIDTH,
  MAX_DRAWER_WIDTH,
  OVERLAY_CARD_MAX_WIDTH,
  OVERLAY_SEARCH_MAX_WIDTH,
  OVERLAY_SHEET_MAX_WIDTH,
  SIDEBAR_MIN_WINDOW_WIDTH,
  SIDEBAR_WIDTH,
  drawerWidthFor,
  frameLeftFor,
  frameWidthFor,
  monthCellSizeFor,
  pickerCardWidthFor,
  sidebarWidthFor,
} from '../utils/frameWidth';

describe('frameWidthFor', () => {
  it('is the whole window on a phone', () => {
    expect(frameWidthFor(393)).toBe(393);
    expect(frameWidthFor(MAX_CONTENT_WIDTH)).toBe(MAX_CONTENT_WIDTH);
  });

  it('stops at the cap on anything wider', () => {
    expect(frameWidthFor(834)).toBe(MAX_CONTENT_WIDTH);
    expect(frameWidthFor(1440)).toBe(MAX_CONTENT_WIDTH);
  });

  it('is what the sidebar leaves once there is one', () => {
    expect(frameWidthFor(SIDEBAR_MIN_WINDOW_WIDTH)).toBe(SIDEBAR_MIN_WINDOW_WIDTH - SIDEBAR_WIDTH);
  });
});

describe('sidebarWidthFor', () => {
  it('is nothing below the breakpoint, so a phone and an upright iPad keep the drawer', () => {
    expect(sidebarWidthFor(393)).toBe(0);
    expect(sidebarWidthFor(834)).toBe(0);
    expect(sidebarWidthFor(SIDEBAR_MIN_WINDOW_WIDTH - 1)).toBe(0);
  });

  it('is a fixed strip from the breakpoint up', () => {
    expect(sidebarWidthFor(SIDEBAR_MIN_WINDOW_WIDTH)).toBe(SIDEBAR_WIDTH);
    expect(sidebarWidthFor(1440)).toBe(SIDEBAR_WIDTH);
  });

  it('never leaves the column narrower than a phone', () => {
    expect(frameWidthFor(SIDEBAR_MIN_WINDOW_WIDTH)).toBeGreaterThan(393);
  });
});

describe('frameLeftFor', () => {
  it('is zero when the column fills the window', () => {
    expect(frameLeftFor(393)).toBe(0);
    expect(frameLeftFor(MAX_CONTENT_WIDTH)).toBe(0);
  });

  it('centers the column in a wider window', () => {
    expect(frameLeftFor(834)).toBe(57);
  });

  it('starts after the sidebar, and centers in what it leaves', () => {
    expect(frameLeftFor(SIDEBAR_MIN_WINDOW_WIDTH)).toBe(SIDEBAR_WIDTH);
    expect(frameLeftFor(1440)).toBe(SIDEBAR_WIDTH + (1440 - SIDEBAR_WIDTH - MAX_CONTENT_WIDTH) / 2);
  });

  it('rounds down on an odd gutter so the column is never pushed off the window', () => {
    expect(frameLeftFor(MAX_CONTENT_WIDTH + 1)).toBe(0);
    expect(frameLeftFor(MAX_CONTENT_WIDTH + 3)).toBe(1);
  });
});

describe('drawerWidthFor', () => {
  it('is 85% of a phone, as it always was', () => {
    expect(drawerWidthFor(393)).toBe(334);
  });

  it('stops at a fixed strip on a wide window', () => {
    expect(drawerWidthFor(834)).toBe(MAX_DRAWER_WIDTH);
    expect(drawerWidthFor(1440)).toBe(MAX_DRAWER_WIDTH);
  });
});

describe('monthCellSizeFor', () => {
  it('is seven columns across a phone, less the margins', () => {
    expect(monthCellSizeFor(393, 16)).toBe(51);
  });

  it('is measured against the column, not the window', () => {
    expect(monthCellSizeFor(1440, 16)).toBe(monthCellSizeFor(MAX_CONTENT_WIDTH, 16));
    expect(monthCellSizeFor(1440, 16)).toBe(98);
  });
});

describe('overlay caps', () => {
  // A cap that bound on a phone would change a layout that has always been right.
  // 430 is the widest phone window; a card sits inside a 24pt gutter at the least.
  const WIDEST_PHONE = 430;

  it('never bind on a phone', () => {
    expect(OVERLAY_CARD_MAX_WIDTH).toBeGreaterThanOrEqual(WIDEST_PHONE - 24 * 2);
    expect(OVERLAY_SHEET_MAX_WIDTH).toBeGreaterThanOrEqual(WIDEST_PHONE - 16 * 2);
    expect(OVERLAY_SEARCH_MAX_WIDTH).toBeGreaterThanOrEqual(WIDEST_PHONE - 16 * 2);
  });

  it('rank a prompt under a sheet under a list of results', () => {
    expect(OVERLAY_CARD_MAX_WIDTH).toBeLessThan(OVERLAY_SHEET_MAX_WIDTH);
    expect(OVERLAY_SHEET_MAX_WIDTH).toBeLessThan(OVERLAY_SEARCH_MAX_WIDTH);
  });

  it('stay inside the content column, so an overlay is never wider than the page behind it', () => {
    expect(OVERLAY_SEARCH_MAX_WIDTH).toBeLessThanOrEqual(MAX_CONTENT_WIDTH);
  });
});

describe('pickerCardWidthFor', () => {
  it('leaves a margin on a narrow window and caps at 380 on a wide one', () => {
    expect(pickerCardWidthFor(360)).toBe(328);
    expect(pickerCardWidthFor(393)).toBe(361);
    expect(pickerCardWidthFor(1440)).toBe(380);
  });
});
