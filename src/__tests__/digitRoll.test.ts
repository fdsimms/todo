import { rollColumns, rollDirection } from '@/utils/digitRoll';

describe('rollColumns', () => {
  it('marks only the digits that changed', () => {
    expect(rollColumns('128', '143')).toEqual([
      { from: '1', to: '1', changed: false },
      { from: '2', to: '4', changed: true },
      { from: '8', to: '3', changed: true },
    ]);
  });

  it('aligns on the right, so a new leading digit arrives on the left', () => {
    expect(rollColumns('99', '100')).toEqual([
      { from: '', to: '1', changed: true },
      { from: '9', to: '0', changed: true },
      { from: '9', to: '0', changed: true },
    ]);
  });

  it('lets a digit leave on the left when the number gets shorter', () => {
    expect(rollColumns('10', '9')).toEqual([
      { from: '1', to: '', changed: true },
      { from: '0', to: '9', changed: true },
    ]);
  });

  it('keeps the unit and separators still when only the count moves', () => {
    const cols = rollColumns('3/8', '4/8');
    expect(cols.map(c => c.changed)).toEqual([true, false, false]);
  });

  it('is all unchanged for the same text', () => {
    expect(rollColumns('7', '7').every(c => !c.changed)).toBe(true);
  });
});

describe('rollDirection', () => {
  it('rolls up for more and down for less', () => {
    expect(rollDirection(3, 4)).toBe(1);
    expect(rollDirection(4, 3)).toBe(-1);
  });

  it('does not roll for the same value or a missing one', () => {
    expect(rollDirection(5, 5)).toBe(0);
    expect(rollDirection(null, 5)).toBe(0);
    expect(rollDirection(5, undefined)).toBe(0);
    expect(rollDirection(NaN, 5)).toBe(0);
  });
});
