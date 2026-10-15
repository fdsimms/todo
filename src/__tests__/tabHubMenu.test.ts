import {
  HUB_MENU_ARROW_SIZE, HUB_MENU_ARROW_TIP, HUB_MENU_EDGE, HUB_MENU_PADDING, HUB_MENU_ROW_HEIGHT,
  HUB_MENU_TIP_GAP, HUB_MENU_WIDTH, hubMenuIndexAt, hubMenuItems, hubMenuLayout, hubMenuRelease, isOverButton,
} from '../utils/tabHubMenu';

const FULL = { kitchenEnabled: true, simpleMode: false, screenTimeSupported: true, counts: { stacks: 3, templates: 2, people: 4, mood: 5, medications: 2, foodLog: 6 } };
const routes = (items: ReturnType<typeof hubMenuItems>) => (items ?? []).map(d => d.route);

describe('hubMenuItems', () => {
  it('lists the hub in reverse pill order, so the first screen is nearest the thumb', () => {
    expect(routes(hubMenuItems('Groceries', FULL))).toEqual(['FoodLog', 'Kitchen', 'MealPlan', 'Recipes', 'Groceries']);
  });

  it('gives every tab of a hub the same list in the same order', () => {
    expect(routes(hubMenuItems('Recipes', FULL))).toEqual(routes(hubMenuItems('Groceries', FULL)));
  });

  it('offers nothing for a screen that is in no hub', () => {
    expect(hubMenuItems('Today', FULL)).toBeNull();
    expect(hubMenuItems('Projects', FULL)).toBeNull();
  });

  it('offers nothing once the hub is down to one screen', () => {
    // The kitchen switch takes the whole hub away.
    expect(hubMenuItems('Groceries', { ...FULL, kitchenEnabled: false })).toBeNull();
  });

  it('leaves out a member the menu is hiding', () => {
    const items = routes(hubMenuItems('Groceries', { ...FULL, counts: { ...FULL.counts, foodLog: 0 }, simpleMode: true }));
    expect(items).not.toContain('FoodLog');
  });
});

describe('hubMenuLayout', () => {
  const base = { buttonTop: 700, screenWidth: 390, itemCount: 5 };

  it('centres the card over the button and points the arrow at its centre', () => {
    const layout = hubMenuLayout({ ...base, buttonCenterX: 195 });
    expect(layout.left + layout.width / 2).toBe(195);
    expect(layout.left + layout.arrowLeft).toBe(195);
  });

  it('keeps the arrow on the button when the card has to slide in from an edge', () => {
    for (const buttonCenterX of [40, 70, 320, 350]) {
      const layout = hubMenuLayout({ ...base, buttonCenterX });
      expect(layout.left).toBeGreaterThanOrEqual(HUB_MENU_EDGE);
      expect(layout.left + layout.width).toBeLessThanOrEqual(390 - HUB_MENU_EDGE);
      expect(layout.left + layout.arrowLeft).toBeCloseTo(buttonCenterX, 5);
    }
  });

  it('keeps the arrow off the card corners for a button right at the edge', () => {
    const layout = hubMenuLayout({ ...base, buttonCenterX: 4 });
    expect(layout.arrowLeft).toBe(HUB_MENU_ARROW_SIZE);
  });

  it('puts the arrow point a fixed gap above the button', () => {
    const layout = hubMenuLayout({ ...base, buttonCenterX: 195 });
    expect(layout.top + layout.height + HUB_MENU_ARROW_TIP + HUB_MENU_TIP_GAP).toBe(700);
  });

  it('sizes the card to its rows', () => {
    expect(hubMenuLayout({ ...base, buttonCenterX: 195, itemCount: 3 }).height)
      .toBe(3 * HUB_MENU_ROW_HEIGHT + HUB_MENU_PADDING * 2);
    expect(hubMenuLayout({ ...base, buttonCenterX: 195 }).width).toBe(HUB_MENU_WIDTH);
  });
});

describe('hubMenuIndexAt', () => {
  const layout = hubMenuLayout({ buttonCenterX: 195, buttonTop: 700, screenWidth: 390, itemCount: 5 });
  const rowsTop = layout.top + HUB_MENU_PADDING;
  const mid = (row: number) => rowsTop + row * HUB_MENU_ROW_HEIGHT + HUB_MENU_ROW_HEIGHT / 2;

  it('resolves each row from its own band', () => {
    for (let row = 0; row < 5; row++) expect(hubMenuIndexAt(layout, 5, 195, mid(row))).toBe(row);
  });

  it('holds the top row for a finger a little above the card', () => {
    expect(hubMenuIndexAt(layout, 5, 195, rowsTop - 10)).toBe(0);
  });

  it('lets go of the selection well above, beside, or below the card', () => {
    expect(hubMenuIndexAt(layout, 5, 195, rowsTop - 100)).toBeNull();
    expect(hubMenuIndexAt(layout, 5, layout.left - 60, mid(2))).toBeNull();
    expect(hubMenuIndexAt(layout, 5, layout.left + layout.width + 60, mid(2))).toBeNull();
    expect(hubMenuIndexAt(layout, 5, 195, layout.top + layout.height + 20)).toBeNull();
  });

  it('answers null for an empty list', () => {
    expect(hubMenuIndexAt(layout, 0, 195, mid(0))).toBeNull();
  });
});

describe('isOverButton', () => {
  const frame = { x: 100, y: 700, width: 60, height: 49 };

  it('is true on the button and a little around it', () => {
    expect(isOverButton(frame, 130, 720)).toBe(true);
    expect(isOverButton(frame, 90, 690)).toBe(true);
  });

  it('is false once the finger is well away', () => {
    expect(isOverButton(frame, 130, 600)).toBe(false);
    expect(isOverButton(frame, 300, 720)).toBe(false);
  });
});

describe('hubMenuRelease', () => {
  const items = hubMenuItems('Groceries', FULL)!;

  it('opens the row under the finger', () => {
    expect(hubMenuRelease(items, 1, false)).toEqual({ kind: 'open', route: 'Kitchen' });
  });

  it('keeps the card open for a long press that never left the button', () => {
    expect(hubMenuRelease(items, null, true)).toEqual({ kind: 'stay' });
  });

  it('closes with nothing chosen anywhere else', () => {
    expect(hubMenuRelease(items, null, false)).toEqual({ kind: 'close' });
  });

  it('ignores a stale index that no longer names a row', () => {
    expect(hubMenuRelease(items, 9, false)).toEqual({ kind: 'close' });
  });
});
