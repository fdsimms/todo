import type { MedicationLog } from '../types';
import {
  SUPPLY_UNITS,
  crossedRefill,
  describeLimit,
  describeSupplyLeft,
  formatHours,
  limitBreaches,
  limitStatus,
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
