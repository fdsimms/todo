import type { FoodLogEntry } from '../types';
import {
  LIMIT_WARNING_NOTES,
  describeLimitContributors,
  limitReadings,
  limitWarningKeyOf,
  limitWarningNotes,
  limitWarningTitle,
  parseAutoSlips,
  shouldAutoSlip,
  shouldTakeBackAutoSlip,
  type LimitReading,
} from '../utils/limitWarningTasks';

const targets = { satFatG: 16, sugarG: 35, proteinG: 150 };

describe('limitReadings', () => {
  it('reads each limit against today, goals left out, in label order', () => {
    expect(limitReadings({ sugarG: 40, satFatG: 12, proteinG: 200 }, targets, ['sugarG', 'satFatG'], 75)).toEqual([
      { key: 'satFatG', total: 12, target: 16, status: 'near' },
      { key: 'sugarG', total: 40, target: 35, status: 'over' },
    ]);
  });

  it('reads a limit nothing logged states as zero, so the task is there from the start of the day', () => {
    expect(limitReadings({}, targets, ['satFatG'], 75)).toEqual([
      { key: 'satFatG', total: 0, target: 16, status: 'within' },
    ]);
  });
});

describe('limitWarningKeyOf', () => {
  it('reads the nutrient a task is keyed by, and nothing else', () => {
    expect(limitWarningKeyOf('satFatG')).toBe('satFatG');
    expect(limitWarningKeyOf('2026-10-08:satFatG')).toBeNull();
    expect(limitWarningKeyOf(null)).toBeNull();
  });
});

describe('limitWarningTitle', () => {
  const reading = (total: number): LimitReading => ({ key: 'sugarG', total, target: 35, status: 'within' });

  it('names the limit, then the day so far once anything states it', () => {
    expect(limitWarningTitle(reading(0))).toBe('Stay under 35g sugar');
    expect(limitWarningTitle(reading(28.04))).toBe('Stay under 35g sugar · 28g so far');
    expect(limitWarningTitle({ key: 'cholesterolMg', total: 1250, target: 300, status: 'over' }))
      .toBe('Stay under 300mg cholesterol · 1,250mg so far');
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

  it('opens the notes with where the day stands', () => {
    const reading: LimitReading = { key: 'sugarG', total: 9, target: 35, status: 'within' };
    expect(limitWarningNotes([entry('Cookie', 9)], reading))
      .toBe(`Today: 9 of 35g, 26g left.\n\nMost of it: Cookie (9g).\n\n${LIMIT_WARNING_NOTES}`);
    expect(limitWarningNotes([], { ...reading, total: 0 })).toBe(`Today: 0 of 35g, 35g left.\n\n${LIMIT_WARNING_NOTES}`);
    expect(limitWarningNotes([], { ...reading, total: 41, status: 'over' })).toMatch(/^Today: 41 of 35g, 6g over\./);
  });
});

describe('the automatic slip', () => {
  const over: LimitReading = { key: 'sugarG', total: 40, target: 35, status: 'over' };
  const back: LimitReading = { ...over, total: 30, status: 'near' };

  it('slips once, the moment the day goes over, and never on top of the person\'s own slip', () => {
    expect(shouldAutoSlip(over, 0, false)).toBe(true);
    expect(shouldAutoSlip(over, 0, true)).toBe(false);
    expect(shouldAutoSlip(over, 1, false)).toBe(false);
    expect(shouldAutoSlip(back, 0, false)).toBe(false);
  });

  it('takes back only its own slip, once the day is within the limit again', () => {
    expect(shouldTakeBackAutoSlip(back, 1, true)).toBe(true);
    expect(shouldTakeBackAutoSlip(back, 2, true)).toBe(false);
    expect(shouldTakeBackAutoSlip(back, 1, false)).toBe(false);
    expect(shouldTakeBackAutoSlip(over, 1, true)).toBe(false);
  });

  it('reads the stored record, dropping anything malformed', () => {
    expect(parseAutoSlips('{"sugarG":"2026-10-08","nope":"2026-10-08","satFatG":5}')).toEqual({ sugarG: '2026-10-08' });
    expect(parseAutoSlips('[')).toEqual({});
    expect(parseAutoSlips(null)).toEqual({});
  });
});
