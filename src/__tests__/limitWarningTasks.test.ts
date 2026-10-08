import {
  limitWarningDayOf,
  limitWarningKeyOf,
  limitWarningSourceId,
  limitWarningTitle,
  limitWarningsFor,
} from '../utils/limitWarningTasks';

const targets = { satFatG: 16, sugarG: 35, proteinG: 150 };

describe('limitWarningsFor', () => {
  it('lists the limits the day is close to or past, in label order', () => {
    expect(limitWarningsFor({ sugarG: 40, satFatG: 12, proteinG: 200 }, targets, ['sugarG', 'satFatG'], 75))
      .toEqual([
        { key: 'satFatG', total: 12, target: 16, status: 'near' },
        { key: 'sugarG', total: 40, target: 35, status: 'over' },
      ]);
  });

  it('ignores a goal, a limit with room left, and one nothing logged states', () => {
    expect(limitWarningsFor({ proteinG: 200, satFatG: 5 }, targets, ['satFatG', 'sugarG'], 75)).toEqual([]);
  });

  it('moves with the close share', () => {
    expect(limitWarningsFor({ satFatG: 12 }, targets, ['satFatG'], 90)).toEqual([]);
  });
});

describe('source ids', () => {
  it('round-trip the day and the nutrient', () => {
    const id = limitWarningSourceId('2026-10-08', 'satFatG');
    expect(limitWarningDayOf(id)).toBe('2026-10-08');
    expect(limitWarningKeyOf(id)).toBe('satFatG');
    expect(limitWarningKeyOf(null)).toBeNull();
    expect(limitWarningDayOf('nonsense')).toBeNull();
  });
});

describe('limitWarningTitle', () => {
  it('states the total against the limit, and says when it is past it', () => {
    expect(limitWarningTitle({ key: 'satFatG', total: 12.04, target: 16, status: 'near' }))
      .toBe('Saturated fat at 12 of 16g today');
    expect(limitWarningTitle({ key: 'cholesterolMg', total: 1250, target: 300, status: 'over' }))
      .toBe('Cholesterol at 1,250 of 300mg today, over the limit');
  });
});
