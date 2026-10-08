import type { FoodLogEntry } from '../types';
import {
  describeLimitContributors,
  limitWarningNotes,
  LIMIT_WARNING_NOTES,
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

describe('describeLimitContributors', () => {
  const entry = (label: string, sugarG?: number) =>
    ({ label, nutrition: { amounts: sugarG === undefined ? {} : { sugarG } } }) as unknown as FoodLogEntry;

  it('names the biggest contributors first, merging repeats of one food', () => {
    const entries = [
      entry('Oat milk', 4), entry('Ice cream', 12), entry('Cookie', 9), entry('Ice cream', 6), entry('Banana', 3),
    ];
    expect(describeLimitContributors(entries, 'sugarG'))
      .toBe('Most of it: Ice cream (18g), Cookie (9g), Oat milk (4g).');
  });

  it('leaves out entries that do not state it, and says nothing when none do', () => {
    expect(describeLimitContributors([entry('Restaurant curry'), entry('Cookie', 9)], 'sugarG'))
      .toBe('Most of it: Cookie (9g).');
    expect(describeLimitContributors([entry('Restaurant curry')], 'sugarG')).toBeNull();
  });

  it('puts them ahead of the standing note', () => {
    expect(limitWarningNotes([entry('Cookie', 9)], 'sugarG')).toBe(`Most of it: Cookie (9g).\n\n${LIMIT_WARNING_NOTES}`);
    expect(limitWarningNotes([], 'sugarG')).toBe(LIMIT_WARNING_NOTES);
  });
});
