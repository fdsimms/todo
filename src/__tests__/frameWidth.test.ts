import {
  MAX_CONTENT_WIDTH,
  MAX_DRAWER_WIDTH,
  drawerWidthFor,
  frameLeftFor,
  frameWidthFor,
  monthCellSizeFor,
  pickerCardWidthFor,
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
});

describe('frameLeftFor', () => {
  it('is zero when the column fills the window', () => {
    expect(frameLeftFor(393)).toBe(0);
    expect(frameLeftFor(MAX_CONTENT_WIDTH)).toBe(0);
  });

  it('centers the column in a wider window', () => {
    expect(frameLeftFor(1440)).toBe(360);
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

describe('pickerCardWidthFor', () => {
  it('leaves a margin on a narrow window and caps at 380 on a wide one', () => {
    expect(pickerCardWidthFor(360)).toBe(328);
    expect(pickerCardWidthFor(393)).toBe(361);
    expect(pickerCardWidthFor(1440)).toBe(380);
  });
});
