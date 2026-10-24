import type { MedicationLog } from '../types';
import {
  SUPPLY_UNITS,
  crossedRefill,
  describeLimit,
  describeSupplyLeft,
  doseOverMax,
  formatHours,
  limitBreaches,
  limitStatus,
  MAX_USUAL_DOSES,
  defaultUsualDose,
  parseMedicationSettings,
  prefsFor,
  refilledSupply,
  supplyRemaining,
  supplyUseOf,
  wantsRefill,
  withPrefs,
  type MedicationLimit,
  type MedicationSupply,
} from '../utils/medicationSettings';

let seq = 0;

function dose(at: string, overrides: Partial<MedicationLog> = {}): MedicationLog {
  seq++;
  return {
    id: `d-${seq}`,
    name: 'Ibuprofen',
    takenAt: new Date(at).toISOString(),
    dayKey: at.slice(0, 10),
    amount: 400,
    unit: 'mg',
    asNeeded: true,
    taskId: null,
    note: null,
    ...overrides,
  };
}

const limit = (overrides: Partial<MedicationLimit> = {}): MedicationLimit => ({
  minHours: 6,
  maxPer24h: 4,
  notify: false,
  since: new Date('2026-01-01T00:00').toISOString(),
  ...overrides,
});

const supply = (overrides: Partial<MedicationSupply> = {}): MedicationSupply => ({
  count: 20,
  unit: 'tablet',
  refillCount: 30,
  reorderAt: 5,
  since: new Date('2026-09-01T00:00').toISOString(),
  declinedAt: null,
  ...overrides,
});

describe('parseMedicationSettings', () => {
  it('reads back a well-formed map', () => {
    const map = { ibuprofen: { limit: limit(), supply: supply() } };
    expect(parseMedicationSettings(JSON.stringify(map))).toEqual(map);
  });

  it('reads a panel that lists ingredients only, and drops a malformed ingredient', () => {
    const raw = JSON.stringify({
      stress: {
        nutrition: {
          servingAmount: 1,
          servingUnit: 'capsule',
          amounts: {},
          others: [
            { name: ' Ashwagandha ', amount: 80, unit: 'mg' },
            { name: '', amount: 5, unit: 'mg' },
            { name: 'Bad unit', amount: 5, unit: 'oz' },
            { name: 'Zero', amount: 0, unit: 'mg' },
          ],
        },
      },
    });
    expect(parseMedicationSettings(raw).stress.nutrition).toEqual({
      servingAmount: 1, servingUnit: 'capsule', amounts: {}, others: [{ name: 'Ashwagandha', amount: 80, unit: 'mg' }],
    });
    const none = JSON.stringify({ x: { nutrition: { servingAmount: 1, servingUnit: 'capsule', amounts: {}, others: [{ name: 'Zero', amount: 0, unit: 'mg' }] } } });
    expect(parseMedicationSettings(none)).toEqual({});
  });

  it('reads a schedule back, and keeps a medicine that has nothing else', () => {
    const map = { vitaminc: { limit: null, supply: null, schedule: { kind: 'interval', everyDays: 2 } } };
    expect(parseMedicationSettings(JSON.stringify(map))).toEqual(map);
    const bad = JSON.stringify({ x: { schedule: { kind: 'interval', everyDays: 99 } } });
    expect(parseMedicationSettings(bad)).toEqual({});
  });

  it('tolerates junk', () => {
    expect(parseMedicationSettings(null)).toEqual({});
    expect(parseMedicationSettings('nope')).toEqual({});
    expect(parseMedicationSettings('[1,2]')).toEqual({});
    expect(parseMedicationSettings(JSON.stringify({ a: 3 }))).toEqual({});
  });

  it('drops a limit with neither cap, and a supply with no anchor', () => {
    const raw = JSON.stringify({
      a: { limit: { minHours: null, maxPer24h: 0, since: '2026-01-01T00:00:00.000Z' } },
      b: { supply: { count: 4, unit: 'tablet' } },
    });
    expect(parseMedicationSettings(raw)).toEqual({});
  });

  it('falls back to doses for an unknown supply unit and a threshold of 1', () => {
    const raw = JSON.stringify({ a: { supply: { ...supply(), unit: 'mg', reorderAt: 0 } } });
    const parsed = parseMedicationSettings(raw).a.supply!;
    expect(parsed.unit).toBe('dose');
    expect(parsed.reorderAt).toBe(1);
  });
});

describe('prefsFor / withPrefs', () => {
  it('keys by medicationKey, and drops an emptied entry', () => {
    const map = withPrefs({}, '  IBUPROFEN ', { limit: limit(), supply: null });
    expect(Object.keys(map)).toEqual(['ibuprofen']);
    expect(prefsFor(map, 'ibuprofen').limit).not.toBeNull();
    expect(withPrefs(map, 'Ibuprofen', { limit: null, supply: null })).toEqual({});
  });
});

describe('SUPPLY_UNITS', () => {
  it('holds only countable units plus dose', () => {
    expect(SUPPLY_UNITS).toContain('dose');
    expect(SUPPLY_UNITS).toContain('tablet');
    expect(SUPPLY_UNITS).not.toContain('mg');
  });
});

describe('describeLimit', () => {
  it('states either cap or both', () => {
    expect(describeLimit(limit())).toBe('At least 6 hours apart, at most 4 in 24 hours');
    expect(describeLimit(limit({ maxPer24h: null, minHours: 1 }))).toBe('At least 1 hour apart');
    expect(describeLimit(limit({ minHours: null }))).toBe('At most 4 in 24 hours');
    expect(describeLimit(null)).toBeNull();
  });

  it('formats fractional hours', () => {
    expect(formatHours(1.5)).toBe('1.5 hours');
  });
});

describe('limitStatus', () => {
  const now = new Date('2026-09-14T15:00');

  it('is clear with no limit, but still counts', () => {
    const logs = [dose('2026-09-14T14:00')];
    const status = limitStatus(logs, 'Ibuprofen', null, now);
    expect(status.inLast24h).toBe(1);
    expect(status.nextOkAt).toBeNull();
  });

  it('holds a dose back until the spacing has passed', () => {
    const logs = [dose('2026-09-14T11:00')];
    const status = limitStatus(logs, 'Ibuprofen', limit(), now);
    expect(status.reason).toBe('spacing');
    expect(status.nextOkAt).toEqual(new Date('2026-09-14T17:00'));
  });

  it('is clear once the spacing has passed', () => {
    const logs = [dose('2026-09-14T08:00')];
    expect(limitStatus(logs, 'Ibuprofen', limit(), now).nextOkAt).toBeNull();
  });

  it('holds at the 24-hour cap until the oldest dose ages out', () => {
    const logs = [
      dose('2026-09-13T16:00'),
      dose('2026-09-13T22:00'),
      dose('2026-09-14T04:00'),
      dose('2026-09-14T10:00'),
    ];
    const status = limitStatus(logs, 'Ibuprofen', limit({ minHours: null }), now);
    expect(status.inLast24h).toBe(4);
    expect(status.reason).toBe('max');
    expect(status.nextOkAt).toEqual(new Date('2026-09-14T16:00'));
  });

  it('crosses the logical day, since the cap is rolling', () => {
    const logs = [dose('2026-09-13T23:00'), dose('2026-09-14T01:00')];
    const status = limitStatus(logs, 'Ibuprofen', limit({ minHours: null, maxPer24h: 2 }), now);
    expect(status.nextOkAt).toEqual(new Date('2026-09-14T23:00'));
  });

  it('ignores other medications', () => {
    const logs = [dose('2026-09-14T14:00', { name: 'Paracetamol' })];
    expect(limitStatus(logs, 'Ibuprofen', limit(), now).nextOkAt).toBeNull();
  });
});

describe('limitBreaches', () => {
  it('reports doses taken too soon, oldest first', () => {
    const logs = [
      dose('2026-09-14T08:00'),
      dose('2026-09-14T11:00'),
      dose('2026-09-14T20:00'),
    ];
    const breaches = limitBreaches(logs, 'Ibuprofen', limit());
    expect(breaches.map(b => b.reason)).toEqual(['spacing']);
    expect(breaches[0].log.takenAt).toBe(new Date('2026-09-14T11:00').toISOString());
  });

  it('reports a dose past the 24-hour cap', () => {
    const logs = [
      dose('2026-09-14T06:00'),
      dose('2026-09-14T09:00'),
      dose('2026-09-14T12:00'),
    ];
    const breaches = limitBreaches(logs, 'Ibuprofen', limit({ minHours: null, maxPer24h: 2 }));
    expect(breaches).toHaveLength(1);
    expect(breaches[0].reason).toBe('max');
  });

  it('never judges a dose from before the limit was set', () => {
    const logs = [dose('2026-09-14T08:00'), dose('2026-09-14T09:00')];
    const set = limit({ since: new Date('2026-09-15T00:00').toISOString() });
    expect(limitBreaches(logs, 'Ibuprofen', set)).toEqual([]);
  });
});

describe('supply', () => {
  it('uses the stated amount in the supply unit, one otherwise', () => {
    expect(supplyUseOf(dose('2026-09-02T09:00', { amount: 2, unit: 'tablet' }), supply())).toBe(2);
    expect(supplyUseOf(dose('2026-09-02T09:00'), supply())).toBe(1);
    expect(supplyUseOf(dose('2026-09-02T09:00', { amount: null, unit: null }), supply())).toBe(1);
    expect(supplyUseOf(dose('2026-09-02T09:00', { amount: 2, unit: 'tablet' }), supply({ unit: 'dose' }))).toBe(1);
  });

  it('derives what is left from the doses since the count was set', () => {
    const logs = [
      dose('2026-08-30T09:00', { amount: 2, unit: 'tablet' }),
      dose('2026-09-02T09:00', { amount: 2, unit: 'tablet' }),
      dose('2026-09-03T09:00', { amount: 1, unit: 'tablet' }),
      // Scheduled: spent from its task's own supply, never this one.
      dose('2026-09-04T09:00', { amount: 1, unit: 'tablet', taskId: 't1' }),
      dose('2026-09-04T09:00', { name: 'Other', amount: 1, unit: 'tablet' }),
    ];
    expect(supplyRemaining(logs, 'Ibuprofen', supply())).toBe(17);
    expect(supplyRemaining(logs, 'Ibuprofen', null)).toBeNull();
  });

  it('never goes below zero', () => {
    const logs = [dose('2026-09-02T09:00', { amount: 50, unit: 'tablet' })];
    expect(supplyRemaining(logs, 'Ibuprofen', supply())).toBe(0);
  });

  it('offers a refill at the threshold unless declined at this count or lower', () => {
    expect(wantsRefill(6, supply())).toBe(false);
    expect(wantsRefill(5, supply())).toBe(true);
    expect(wantsRefill(5, supply({ declinedAt: 5 }))).toBe(false);
    expect(wantsRefill(4, supply({ declinedAt: 5 }))).toBe(true);
    expect(wantsRefill(null, supply())).toBe(false);
  });

  it('crossedRefill is true only on the dose that reached the threshold', () => {
    expect(crossedRefill(6, 5, supply())).toBe(true);
    expect(crossedRefill(5, 4, supply())).toBe(false);
    expect(crossedRefill(9, 8, supply())).toBe(false);
  });

  it('a refill adds to what is left and re-anchors', () => {
    const now = new Date('2026-09-10T12:00');
    const next = refilledSupply(supply({ declinedAt: 4 }), 3, 30, now);
    expect(next.count).toBe(33);
    expect(next.since).toBe(now.toISOString());
    expect(next.declinedAt).toBeNull();
  });

  it('describes what is left', () => {
    expect(describeSupplyLeft(12, 'tablet')).toBe('12 tablets left');
    expect(describeSupplyLeft(1, 'dose')).toBe('1 dose left');
    expect(describeSupplyLeft(0, 'tablet')).toBe('None left');
  });
});

describe('a supplement panel', () => {
  const panel = { servingAmount: 2, servingUnit: 'tablet', amounts: { vitaminCMg: 90, zincMg: 0 } };

  it('round-trips through the stored map, a stated zero included', () => {
    const map = withPrefs({}, 'Multivitamin', { limit: null, supply: null, nutrition: panel });
    const back = parseMedicationSettings(JSON.stringify(map));
    expect(prefsFor(back, 'multivitamin').nutrition).toEqual(panel);
  });

  it('is enough on its own to keep an entry', () => {
    const map = withPrefs({}, 'Multivitamin', { limit: null, supply: null, nutrition: panel });
    expect(Object.keys(map)).toEqual(['multivitamin']);
    expect(withPrefs(map, 'Multivitamin', { limit: null, supply: null, nutrition: null })).toEqual({});
  });

  it('leaves the key off a map that has none, so older maps read unchanged', () => {
    const raw = JSON.stringify({ ibuprofen: { limit: { minHours: 6, maxPer24h: null, notify: false, since: '2026-09-01T00:00:00.000Z' } } });
    expect(parseMedicationSettings(raw).ibuprofen).not.toHaveProperty('nutrition');
  });

  it('drops a panel that cannot be read whole', () => {
    const bad = (nutrition: unknown) =>
      parseMedicationSettings(JSON.stringify({ x: { nutrition } }));
    expect(bad({ servingAmount: 0, servingUnit: 'tablet', amounts: { zincMg: 1 } })).toEqual({});
    expect(bad({ servingAmount: 1, servingUnit: 'mg', amounts: { zincMg: 1 } })).toEqual({});
    expect(bad({ servingAmount: 1, servingUnit: 'tablet', amounts: {} })).toEqual({});
    expect(bad({ servingAmount: 1, servingUnit: 'tablet', amounts: { zincMg: -1, omega3G: 3 } })).toEqual({});
    expect(bad('lots')).toEqual({});
  });

  it('keeps the readable figures and drops the rest', () => {
    const back = parseMedicationSettings(JSON.stringify({
      x: { nutrition: { servingAmount: 1, servingUnit: 'capsule', amounts: { zincMg: 5, ironMg: -2, omega3G: 1, copperMg: 'x' } } },
    }));
    expect(prefsFor(back, 'x').nutrition?.amounts).toEqual({ zincMg: 5 });
  });
});

describe('asNeeded and usualDoses', () => {
  it('round-trip through the stored map and keep an entry that holds only them', () => {
    const map = parseMedicationSettings(JSON.stringify({
      zinc: { limit: null, supply: null, asNeeded: false, usualDoses: [{ amount: 50, unit: 'mg' }, { amount: 25, unit: 'mg' }] },
    }));
    expect(map.zinc).toMatchObject({ asNeeded: false, usualDoses: [{ amount: 50, unit: 'mg' }, { amount: 25, unit: 'mg' }] });
  });

  it('drop a malformed usual dose and a non-boolean answer', () => {
    const map = parseMedicationSettings(JSON.stringify({
      zinc: { asNeeded: 'yes', usualDoses: [{ amount: -1, unit: 'mg' }] },
      iron: { usualDoses: [{ amount: 5, unit: 'furlongs' }] },
    }));
    expect(map).toEqual({});
  });

  it('withPrefs drops an entry once nothing is set', () => {
    const map = withPrefs({}, 'Zinc', { limit: null, supply: null, asNeeded: true });
    expect(map.zinc.asNeeded).toBe(true);
    expect(withPrefs(map, 'Zinc', { limit: null, supply: null, asNeeded: null })).toEqual({});
  });
});

describe('usual amounts', () => {
  it('reads the single usualDose an earlier build wrote as a list of one', () => {
    const map = parseMedicationSettings(JSON.stringify({ zinc: { usualDose: { amount: 50, unit: 'mg' } } }));
    expect(map.zinc.usualDoses).toEqual([{ amount: 50, unit: 'mg' }]);
  });

  it('folds repeats, drops bad entries and stops at the maximum', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ amount: i + 1, unit: 'mg' }));
    const map = parseMedicationSettings(JSON.stringify({
      zinc: { usualDoses: [{ amount: 5, unit: 'mg' }, { amount: 5, unit: 'mg' }, { amount: 0, unit: 'mg' }, ...many] },
    }));
    expect(map.zinc.usualDoses).toHaveLength(MAX_USUAL_DOSES);
    expect(map.zinc.usualDoses![0]).toEqual({ amount: 5, unit: 'mg' });
    expect(map.zinc.usualDoses!.filter(d => d.amount === 5)).toHaveLength(1);
  });

  it('names the first as the default', () => {
    expect(defaultUsualDose({ usualDoses: [{ amount: 2, unit: 'tablet' }, { amount: 1, unit: 'tablet' }] })).toEqual({ amount: 2, unit: 'tablet' });
    expect(defaultUsualDose({ usualDoses: [] })).toBeNull();
    expect(defaultUsualDose(undefined)).toBeNull();
  });
});

describe('a limit on a total amount', () => {
  const now = new Date('2026-09-14T15:00');
  const cap = (amount = 1200) => limit({ minHours: null, maxPer24h: null, maxAmount24h: { amount, unit: 'mg' } });

  it('is a limit on its own, and is stated', () => {
    const parsed = parseMedicationSettings(JSON.stringify({
      ibuprofen: { limit: { maxAmount24h: { amount: 1200, unit: 'mg' }, since: '2026-09-01T00:00:00.000Z' } },
    }));
    expect(parsed.ibuprofen.limit?.maxAmount24h).toEqual({ amount: 1200, unit: 'mg' });
    expect(describeLimit(cap())).toBe('At most 1,200 mg in 24 hours');
    expect(describeLimit(limit({ maxAmount24h: { amount: 1200, unit: 'mg' } })))
      .toBe('At least 6 hours apart, at most 4 in 24 hours, at most 1,200 mg in 24 hours');
  });

  it('adds up doses of different strengths, which a count cap cannot', () => {
    const logs = [
      dose('2026-09-14T06:00', { amount: 400 }),
      dose('2026-09-14T09:00', { amount: 200 }),
      dose('2026-09-14T12:00', { amount: 600 }),
    ];
    const status = limitStatus(logs, 'Ibuprofen', cap(), now);
    expect(status.amountInLast24h).toBe(1200);
    expect(status.inLast24h).toBe(3);
    expect(status.reason).toBe('amount');
    // Dropping the 06:00 dose leaves 800, which fits under 1200 with room.
    expect(status.nextOkAt).toEqual(new Date('2026-09-15T06:00'));
  });

  it('has room until the total is reached, and asks whether a planned dose fits', () => {
    const logs = [dose('2026-09-14T06:00', { amount: 400 }), dose('2026-09-14T09:00', { amount: 400 })];
    expect(limitStatus(logs, 'Ibuprofen', cap(), now).nextOkAt).toBeNull();
    expect(limitStatus(logs, 'Ibuprofen', cap(), now, { amount: 400, unit: 'mg' }).nextOkAt).toBeNull();
    const big = limitStatus(logs, 'Ibuprofen', cap(), now, { amount: 800, unit: 'mg' });
    expect(big.nextOkAt).toEqual(new Date('2026-09-15T06:00'));
    expect(big.reason).toBe('amount');
  });

  it('does not count a dose with no amount or in another unit, and says how many', () => {
    const logs = [
      dose('2026-09-14T06:00', { amount: 800 }),
      dose('2026-09-14T09:00', { amount: null, unit: null }),
      dose('2026-09-14T10:00', { amount: 2, unit: 'tablet' }),
    ];
    const status = limitStatus(logs, 'Ibuprofen', cap(), now);
    expect(status.amountInLast24h).toBe(800);
    expect(status.unmeasuredInLast24h).toBe(2);
    expect(status.nextOkAt).toBeNull();
  });

  it('ignores a planned dose in another unit', () => {
    const logs = [dose('2026-09-14T06:00', { amount: 1100 })];
    expect(limitStatus(logs, 'Ibuprofen', cap(), now, { amount: 5, unit: 'tablet' }).nextOkAt).toBeNull();
  });

  it('forgets doses older than 24 hours', () => {
    const logs = [dose('2026-09-13T10:00', { amount: 1200 })];
    expect(limitStatus(logs, 'Ibuprofen', cap(), now).amountInLast24h).toBe(0);
  });

  it('reports the doses that took the total past the cap', () => {
    const logs = [
      dose('2026-09-14T06:00', { amount: 600 }),
      dose('2026-09-14T09:00', { amount: 600 }),
      dose('2026-09-14T12:00', { amount: 200 }),
    ];
    const breaches = limitBreaches(logs, 'Ibuprofen', cap());
    expect(breaches.map(b => b.reason)).toEqual(['amount']);
    expect(breaches[0].log.takenAt).toBe(new Date('2026-09-14T12:00').toISOString());
  });
});

describe('a limit on one dose', () => {
  const alone = (maxDose: { amount: number; unit: string }) => limit({ minHours: null, maxPer24h: null, maxDose });
  const tablets = { amount: 2, unit: 'tablet' };

  it('is a limit on its own, is stated in the unit the label uses, and survives a reload', () => {
    const parsed = parseMedicationSettings(JSON.stringify({
      ibuprofen: { limit: { maxDose: tablets, since: '2026-09-01T00:00:00.000Z' } },
    }));
    expect(parsed.ibuprofen.limit?.maxDose).toEqual(tablets);
    expect(describeLimit(alone(tablets))).toBe('At most 2 tablets in one dose');
    expect(describeLimit(alone({ amount: 1, unit: 'tablet' }))).toBe('At most 1 tablet in one dose');
    expect(describeLimit(limit({ maxDose: { amount: 400, unit: 'mg' } })))
      .toBe('At least 6 hours apart, at most 400 mg in one dose, at most 4 in 24 hours');
  });

  it('reads a dose in the cap unit, or through its stamped strength', () => {
    expect(doseOverMax(alone(tablets), { amount: 2, unit: 'tablet', strength: null })).toBeNull();
    expect(doseOverMax(alone(tablets), { amount: 3, unit: 'tablet', strength: null }))
      .toEqual({ max: tablets, amount: 3 });
    const mg = alone({ amount: 400, unit: 'mg' });
    expect(doseOverMax(mg, { amount: 2, unit: 'tablet', strength: { amount: 200, unit: 'mg' } })).toBeNull();
    expect(doseOverMax(mg, { amount: 3, unit: 'tablet', strength: { amount: 200, unit: 'mg' } }))
      .toEqual({ max: { amount: 400, unit: 'mg' }, amount: 600 });
  });

  it('does not call a dose over that it cannot measure', () => {
    expect(doseOverMax(alone(tablets), { amount: null, unit: null, strength: null })).toBeNull();
    expect(doseOverMax(alone(tablets), { amount: 800, unit: 'mg', strength: null })).toBeNull();
    expect(doseOverMax(null, { amount: 9, unit: 'tablet', strength: null })).toBeNull();
  });

  it('reports a dose that was larger than the cap, once, and never holds the next dose back', () => {
    const logs = [
      dose('2026-09-14T06:00', { amount: 2, unit: 'tablet' }),
      dose('2026-09-14T15:00', { amount: 3, unit: 'tablet' }),
    ];
    const breaches = limitBreaches(logs, 'Ibuprofen', alone(tablets));
    expect(breaches.map(b => b.reason)).toEqual(['dose']);
    expect(breaches[0].log.takenAt).toBe(new Date('2026-09-14T15:00').toISOString());
    expect(limitStatus(logs, 'Ibuprofen', alone(tablets), new Date('2026-09-14T15:30')).nextOkAt).toBeNull();
  });

  it('only judges doses from when the limit was set', () => {
    const late = limit({ minHours: null, maxPer24h: null, maxDose: tablets, since: new Date('2026-09-14T12:00').toISOString() });
    const logs = [dose('2026-09-14T06:00', { amount: 5, unit: 'tablet' })];
    expect(limitBreaches(logs, 'Ibuprofen', late)).toEqual([]);
  });
});

describe('strength', () => {
  const capsules =(at: string, amount: number, strength?: { amount: number; unit: string }): MedicationLog => ({
    id: at, name: 'Vitamin D', takenAt: new Date(at).toISOString(), dayKey: at.slice(0, 10),
    amount, unit: 'capsule', asNeeded: false, taskId: null, note: null, ...(strength ? { strength } : {}),
  });
  const cap = { minHours: null, maxPer24h: null, maxAmount24h: { amount: 300, unit: 'mcg' }, notify: false, since: '2026-09-01T00:00:00.000Z' };
  const now = new Date('2026-09-14T15:00');

  it('reads a stored strength back, and drops one that is not a measured unit', () => {
    const map = parseMedicationSettings(JSON.stringify({
      a: { strength: { amount: 125, unit: 'mcg' } },
      b: { strength: { amount: 1, unit: 'capsule' } },
      c: { strength: { amount: -5, unit: 'mg' } },
    }));
    expect(map.a.strength).toEqual({ amount: 125, unit: 'mcg' });
    expect(map.b).toBeUndefined();
    expect(map.c).toBeUndefined();
  });

  it('adds a stamped capsule dose to a total in the strength unit', () => {
    const logs = [capsules('2026-09-14T09:00', 1, { amount: 125, unit: 'mcg' }), capsules('2026-09-14T12:00', 1, { amount: 125, unit: 'mcg' })];
    const status = limitStatus(logs, 'Vitamin D', cap, now);
    expect(status.amountInLast24h).toBe(250);
    expect(status.unmeasuredInLast24h).toBe(0);
  });

  it('still calls a capsule dose with no strength unmeasured', () => {
    const status = limitStatus([capsules('2026-09-14T09:00', 1)], 'Vitamin D', cap, now);
    expect(status.amountInLast24h).toBe(0);
    expect(status.unmeasuredInLast24h).toBe(1);
  });

  it('judges the dose about to be taken by its total', () => {
    const logs = [capsules('2026-09-14T09:00', 2, { amount: 125, unit: 'mcg' })];
    const planned = { amount: 1, unit: 'capsule', strength: { amount: 125, unit: 'mcg' } };
    expect(limitStatus(logs, 'Vitamin D', cap, now, planned).reason).toBe('amount');
    expect(limitStatus(logs, 'Vitamin D', { ...cap, maxAmount24h: { amount: 400, unit: 'mcg' } }, now, planned).reason).toBeNull();
  });

  it('reports a breach from capsule doses', () => {
    const logs = [capsules('2026-09-14T09:00', 2, { amount: 125, unit: 'mcg' }), capsules('2026-09-14T12:00', 1, { amount: 125, unit: 'mcg' })];
    expect(limitBreaches(logs, 'Vitamin D', cap).map(b => b.reason)).toEqual(['amount']);
  });
});
