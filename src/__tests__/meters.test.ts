import type { MeterReading } from '../types';
import {
  meterKey, canFollowMeter, hasMeter, readingsFor, latestReading, meterRatePerDay,
  projectedMeterDay, meterLimitDay, decideMeterHold, meterHoldPatch, nextMeterDueAt,
  formatMeterAmount, parseMeterNumber, meterChipText, describeLatestReading, knownMeterNames,
  METER_CHECK_IN_DAYS, meterInputFromTask, meterFieldsFromInput, meterSetupGap,
} from '../utils/meters';
import { dayKeyOf, dayKeyToDate } from '../utils/dateUtils';

// dateUtils reads the day-reset setting; nothing here depends on it.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

let seq = 0;
const reading = (name: string, value: number, readAt: Date): MeterReading => ({
  id: `r${++seq}`,
  meterKey: meterKey(name),
  meterName: name,
  value,
  readAt: readAt.toISOString(),
  createdAt: readAt.toISOString(),
});

// A car doing 50 miles a day, read on the 1st and the 21st of September.
const sept1 = new Date(2026, 8, 1, 9);
const sept21 = new Date(2026, 8, 21, 9);
const car = [reading('Car', 40000, sept1), reading('car ', 41000, sept21)];

const oilChange = {
  meterName: 'Car',
  meterUnit: 'miles',
  meterEvery: 5000,
  meterDueAt: 45000,
  meterLimitMonths: null,
  recurrenceType: 'none' as const,
  chainEnabled: false,
  createdAt: new Date(2026, 7, 1, 9).toISOString(),
  completed: false,
  archived: false,
};

describe('a meter and its readings', () => {
  it('files readings under a trimmed, lowercased name', () => {
    expect(meterKey('  Car ')).toBe('car');
    expect(readingsFor(car, 'CAR')).toHaveLength(2);
    expect(latestReading(car, 'car')?.value).toBe(41000);
    expect(latestReading(car, 'Mower')).toBeNull();
  });

  it('measures the rate across at least a week', () => {
    expect(meterRatePerDay(car, 'Car')).toBe(50);
    const tooClose = [reading('Bike', 100, sept1), reading('Bike', 160, new Date(2026, 8, 3, 9))];
    expect(meterRatePerDay(tooClose, 'Bike')).toBeNull();
  });

  it('has no rate from one reading, or from a meter that went down', () => {
    expect(meterRatePerDay([car[0]], 'Car')).toBeNull();
    const reset = [reading('Car', 41000, sept1), reading('Car', 200, sept21)];
    expect(meterRatePerDay(reset, 'Car')).toBeNull();
  });

  it('ignores readings older than a year when measuring the rate', () => {
    const old = [reading('Car', 10000, new Date(2024, 0, 1, 9)), reading('Car', 41000, sept21)];
    expect(meterRatePerDay(old, 'Car')).toBeNull();
  });

  it('lists the meters it knows, most recently read first, as last typed', () => {
    const readings = [...car, reading('Espresso', 120, new Date(2026, 8, 25, 9))];
    expect(knownMeterNames(readings)).toEqual(['Espresso', 'car ']);
  });
});

describe('which tasks may follow a meter', () => {
  it('is a plain one-off only', () => {
    expect(canFollowMeter(oilChange)).toBe(true);
    expect(canFollowMeter({ ...oilChange, recurrenceType: 'weekly' })).toBe(false);
    expect(canFollowMeter({ ...oilChange, chainEnabled: true })).toBe(false);
    expect(canFollowMeter({ ...oilChange, seriesId: 's1' })).toBe(false);
    expect(canFollowMeter({ ...oilChange, parentId: 'p1' })).toBe(false);
    expect(canFollowMeter({ ...oilChange, weatherWait: 'sunny' })).toBe(false);
    expect(canFollowMeter({ ...oilChange, polarity: 'negative' })).toBe(false);
  });

  it('needs a name, a positive interval and a reading to be due at', () => {
    expect(hasMeter(oilChange)).toBe(true);
    expect(hasMeter({ ...oilChange, meterName: '  ' })).toBe(false);
    expect(hasMeter({ ...oilChange, meterEvery: 0 })).toBe(false);
    expect(hasMeter({ ...oilChange, meterDueAt: null })).toBe(false);
  });
});

describe('when a meter task is due', () => {
  it('projects the day from the rate', () => {
    // 4,000 miles to go at 50 a day is 80 days after Sept 21.
    expect(projectedMeterDay(oilChange, car)).toBe('2026-12-10');
    expect(projectedMeterDay(oilChange, [car[0]])).toBeNull();
  });

  it('counts a time limit from when the task was made', () => {
    expect(meterLimitDay({ ...oilChange, meterLimitMonths: 6 })).toBe('2027-02-01');
    expect(meterLimitDay(oilChange)).toBeNull();
  });

  it('releases once a reading reaches it', () => {
    const reached = [...car, reading('Car', 45010, new Date(2026, 9, 1, 9))];
    expect(decideMeterHold(oilChange, reached, '2026-10-01')).toEqual({ kind: 'release', reason: 'reached' });
  });

  it('holds until the projected day, or the time limit when that comes first', () => {
    expect(decideMeterHold(oilChange, car, '2026-10-08'))
      .toEqual({ kind: 'defer', dayKey: '2026-12-10', reason: 'projected' });
    expect(decideMeterHold({ ...oilChange, meterLimitMonths: 3 }, car, '2026-10-08'))
      .toEqual({ kind: 'defer', dayKey: '2026-11-01', reason: 'limit' });
  });

  it('surfaces on the estimate even with no reading to prove it', () => {
    expect(decideMeterHold(oilChange, car, '2026-12-10')).toEqual({ kind: 'release', reason: 'projected' });
  });

  it('asks for a reading after a while when there is nothing to estimate from', () => {
    const lastRead = dayKeyOf(new Date(2026, 8, 1 + METER_CHECK_IN_DAYS));
    expect(decideMeterHold(oilChange, [car[0]], '2026-09-10'))
      .toEqual({ kind: 'defer', dayKey: lastRead, reason: 'checkIn' });
    expect(decideMeterHold(oilChange, [], '2026-08-10'))
      .toEqual({ kind: 'defer', dayKey: '2026-08-31', reason: 'checkIn' });
  });

  it('decides nothing for a finished task or one that may not follow a meter', () => {
    expect(decideMeterHold({ ...oilChange, completed: true }, car, '2026-10-08')).toEqual({ kind: 'none' });
    expect(decideMeterHold({ ...oilChange, recurrenceType: 'daily' }, car, '2026-10-08')).toEqual({ kind: 'none' });
  });
});

describe('what the pass writes', () => {
  const today = '2026-10-08';
  const iso = (key: string) => dayKeyToDate(key).toISOString();

  it('writes a hold and marks it as its own', () => {
    expect(meterHoldPatch({ deferUntil: null }, { kind: 'defer', dayKey: '2026-12-10', reason: 'projected' }, today))
      .toEqual({ deferUntil: iso('2026-12-10'), meterHeldUntil: '2026-12-10' });
  });

  it('moves its own hold, and writes nothing when it is already there', () => {
    const held = { deferUntil: iso('2026-12-10'), meterHeldUntil: '2026-12-10' };
    expect(meterHoldPatch(held, { kind: 'defer', dayKey: '2026-12-10', reason: 'projected' }, today)).toBeNull();
    expect(meterHoldPatch(held, { kind: 'defer', dayKey: '2026-11-20', reason: 'projected' }, today))
      .toEqual({ deferUntil: iso('2026-11-20'), meterHeldUntil: '2026-11-20' });
  });

  it('releases its own hold onto today rather than clearing the date', () => {
    const held = { deferUntil: iso('2026-12-10'), meterHeldUntil: '2026-12-10' };
    expect(meterHoldPatch(held, { kind: 'release', reason: 'reached' }, today))
      .toEqual({ deferUntil: iso(today), meterHeldUntil: today });
    expect(meterHoldPatch({ deferUntil: null }, { kind: 'release', reason: 'reached' }, today))
      .toEqual({ deferUntil: iso(today), meterHeldUntil: today });
  });

  it('leaves a released task alone', () => {
    const out = { deferUntil: iso('2026-10-05'), meterHeldUntil: '2026-10-05' };
    expect(meterHoldPatch(out, { kind: 'release', reason: 'projected' }, today)).toBeNull();
  });

  it('never moves the user\'s own snooze', () => {
    const snoozed = { deferUntil: iso('2026-10-10'), meterHeldUntil: today };
    expect(meterHoldPatch(snoozed, { kind: 'release', reason: 'reached' }, today)).toBeNull();
    expect(meterHoldPatch(snoozed, { kind: 'defer', dayKey: '2026-12-10', reason: 'projected' }, today)).toBeNull();
  });

  it('takes over a snooze that has already run out', () => {
    const lapsed = { deferUntil: iso('2026-10-01'), meterHeldUntil: null };
    expect(meterHoldPatch(lapsed, { kind: 'defer', dayKey: '2026-12-10', reason: 'projected' }, today))
      .toEqual({ deferUntil: iso('2026-12-10'), meterHeldUntil: '2026-12-10' });
  });
});

describe('the next occurrence', () => {
  it('counts on from a reading logged the day it was done', () => {
    const atService = [...car, reading('Car', 44800, new Date(2026, 9, 8, 17))];
    expect(nextMeterDueAt(oilChange, atService, '2026-10-08')).toBe(49800);
  });

  it('otherwise counts on from where it was due', () => {
    expect(nextMeterDueAt(oilChange, car, '2026-10-08')).toBe(50000);
  });

  it('counts from the latest reading when the meter ran past it', () => {
    const late = [...car, reading('Car', 46200, new Date(2026, 9, 1, 9))];
    expect(nextMeterDueAt(oilChange, late, '2026-10-08')).toBe(51200);
  });
});

describe('saying it', () => {
  it('formats and reads amounts', () => {
    expect(formatMeterAmount(45000, 'miles')).toBe('45,000 miles');
    expect(formatMeterAmount(1234.5, null)).toBe('1,234.5');
    expect(parseMeterNumber('45,120')).toBe(45120);
    expect(parseMeterNumber(' 1234.5 ')).toBe(1234.5);
    expect(parseMeterNumber('12a')).toBeNull();
    expect(parseMeterNumber('-3')).toBeNull();
    expect(parseMeterNumber('')).toBeNull();
  });

  it('gives the row what the app knows', () => {
    expect(meterChipText(oilChange, [])).toBe('Due at 45,000 miles · log a reading');
    expect(meterChipText(oilChange, car)).toBe('Due at 45,000 miles · est. Dec 10');
    expect(meterChipText(oilChange, [car[0]])).toBe('Due at 45,000 miles');
    const reached = [...car, reading('Car', 45120, new Date(2026, 9, 1, 9))];
    expect(meterChipText(oilChange, reached)).toBe('Due at 45,000 miles · now 45,120');
    expect(meterChipText({ ...oilChange, meterName: null }, car)).toBeNull();
  });

  it('describes the last reading', () => {
    expect(describeLatestReading(car, 'Car', 'miles')).toBe('Last read 41,000 miles on Sep 21');
    expect(describeLatestReading(car, 'Mower', 'hours')).toBeNull();
  });
});

describe('the editor\'s fields', () => {
  const blank = { name: '', unit: '', everyText: '', dueText: '', limitMonths: null };

  it('reads a blank name as no meter', () => {
    expect(meterFieldsFromInput({ ...blank, everyText: '5000' }, car)).toEqual({
      meterName: null, meterUnit: null, meterEvery: null, meterDueAt: null, meterLimitMonths: null,
    });
  });

  it('keeps what was typed, commas and all', () => {
    expect(meterFieldsFromInput({ name: ' Car ', unit: ' miles ', everyText: '5,000', dueText: '45,000', limitMonths: 6 }, [])).toEqual({
      meterName: 'Car', meterUnit: 'miles', meterEvery: 5000, meterDueAt: 45000, meterLimitMonths: 6,
    });
  });

  it('fills the due reading from the latest reading when it was left empty', () => {
    expect(meterFieldsFromInput({ ...blank, name: 'Car', everyText: '5000' }, car).meterDueAt).toBe(46000);
  });

  it('says what is still missing instead of dropping it', () => {
    const noDue = meterFieldsFromInput({ ...blank, name: 'Mower', everyText: '50' }, []);
    expect(noDue.meterName).toBe('Mower');
    expect(meterSetupGap(noDue)).toMatch(/next due at/);
    expect(meterSetupGap(meterFieldsFromInput({ ...blank, name: 'Mower' }, []))).toMatch(/between times/);
    expect(meterSetupGap(meterFieldsFromInput({ ...blank, name: 'Car', everyText: '5000' }, car))).toBeNull();
  });

  it('round-trips a saved task', () => {
    const input = meterInputFromTask({ ...oilChange, meterLimitMonths: 6 });
    expect(input).toEqual({ name: 'Car', unit: 'miles', everyText: '5,000', dueText: '45,000', limitMonths: 6 });
    expect(meterFieldsFromInput(input, car)).toEqual({
      meterName: 'Car', meterUnit: 'miles', meterEvery: 5000, meterDueAt: 45000, meterLimitMonths: 6,
    });
  });
});
