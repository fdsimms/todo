import type { PlateInventory } from '../types';
import {
  DEFAULT_PLATE_INVENTORY_LB,
  barKgFor,
  describePlateLoad,
  effectivePlateInventory,
  plateLoad,
  platesOnSide,
  warmupRamp,
} from '../utils/plateMath';
import { DEFAULT_PLATE_INVENTORY, weightFromDisplay } from '../utils/workoutData';
import { unitToKg } from '../utils/weightLog';

const kgPlates = (...plates: [number, number][]): PlateInventory => ({
  barsKg: [20],
  plates: plates.map(([kg, count]) => ({ kg, count })),
});

describe('plateLoad, kilograms', () => {
  it('puts the fewest plates on each side, heaviest first', () => {
    const load = plateLoad(100, 20, DEFAULT_PLATE_INVENTORY, 'kg')!;
    expect(load.perSide).toEqual([{ kg: 25, count: 1 }, { kg: 15, count: 1 }]);
    expect(load).toMatchObject({ loadedKg: 100, exact: true, barOnly: false, barKg: 20, targetKg: 100 });
  });

  it('builds a load from small plates', () => {
    expect(platesOnSide(plateLoad(82.5, 20, DEFAULT_PLATE_INVENTORY, 'kg')!)).toEqual([25, 5, 1.25]);
  });

  it('uses two of a size where one side needs them', () => {
    const load = plateLoad(140, 20, DEFAULT_PLATE_INVENTORY, 'kg')!;
    expect(load.exact).toBe(true);
    expect(load.perSide.reduce((n, s) => n + s.kg * s.count, 0)).toBe(60);
  });

  it('finds a combination a greedy pass would miss', () => {
    // 30 a side from 20s and 15s: greedy takes a 20 and is stuck at 10 left.
    const load = plateLoad(80, 20, kgPlates([20, 4], [15, 4]), 'kg')!;
    expect(load.exact).toBe(true);
    expect(platesOnSide(load)).toEqual([15, 15]);
  });

  it('is the bare bar at the bar weight', () => {
    expect(plateLoad(20, 20, DEFAULT_PLATE_INVENTORY, 'kg')).toMatchObject({ barOnly: true, exact: true, loadedKg: 20, perSide: [] });
  });

  it('is the bar, not exact, under the bar weight', () => {
    expect(plateLoad(15, 20, DEFAULT_PLATE_INVENTORY, 'kg')).toMatchObject({ barOnly: true, exact: false, loadedKg: 20 });
  });

  it('returns the nearest load it can make and says it is not exact', () => {
    const load = plateLoad(83, 20, DEFAULT_PLATE_INVENTORY, 'kg')!;
    expect(load.exact).toBe(false);
    expect(load.loadedKg).toBe(82.5);
  });

  it('goes to the lighter load on a tie', () => {
    // 2.5 a side wanted, only 5s: 0 and 5 are equally far, and the bar is lighter.
    expect(plateLoad(25, 20, kgPlates([5, 4]), 'kg')).toMatchObject({ barOnly: true, loadedKg: 20, exact: false });
  });

  it('can go over when over is closer', () => {
    const load = plateLoad(29, 20, kgPlates([5, 4]), 'kg')!;
    expect(load.loadedKg).toBe(30);
    expect(load.exact).toBe(false);
  });

  it('respects how many plates there are: a count is both sides together', () => {
    // One pair of 10s: 20 a side is out of reach, the nearest is 10 a side.
    const load = plateLoad(80, 20, kgPlates([10, 2]), 'kg')!;
    expect(load.loadedKg).toBe(40);
    expect(load.exact).toBe(false);
    // A single plate of a size cannot go on both sides.
    expect(plateLoad(60, 20, kgPlates([10, 1]), 'kg')).toMatchObject({ barOnly: true, loadedKg: 20 });
  });

  it('is the bare bar when there are no plates at all', () => {
    expect(plateLoad(60, 20, kgPlates(), 'kg')).toMatchObject({ barOnly: true, exact: false, loadedKg: 20 });
  });

  it('is null for a target that is not a positive number', () => {
    expect(plateLoad(null, 20, DEFAULT_PLATE_INVENTORY, 'kg')).toBeNull();
    expect(plateLoad(0, 20, DEFAULT_PLATE_INVENTORY, 'kg')).toBeNull();
    expect(plateLoad(Number.NaN, 20, DEFAULT_PLATE_INVENTORY, 'kg')).toBeNull();
  });

  it('works on a bar that is not 20 kg', () => {
    expect(plateLoad(35, 15, DEFAULT_PLATE_INVENTORY, 'kg')).toMatchObject({ perSide: [{ kg: 10, count: 1 }], loadedKg: 35, exact: true });
  });
});

describe('plateLoad, pounds', () => {
  const lbKg = (lb: number) => weightFromDisplay(lb, 'lb');
  const bar = unitToKg(45, 'lb');

  it('loads 135 lb as a 45 lb bar and one 45 lb plate a side, exactly', () => {
    const load = plateLoad(lbKg(135), bar, DEFAULT_PLATE_INVENTORY_LB, 'lb')!;
    expect(load.exact).toBe(true);
    expect(load.perSide).toHaveLength(1);
    expect(load.perSide[0].count).toBe(1);
    expect(load.perSide[0].kg).toBeCloseTo(unitToKg(45, 'lb'), 6);
  });

  it('loads 225 lb with two 45s a side', () => {
    const load = plateLoad(lbKg(225), bar, DEFAULT_PLATE_INVENTORY_LB, 'lb')!;
    expect(load.exact).toBe(true);
    expect(load.perSide[0].count).toBe(2);
  });

  it('builds 185 lb from a 45 and a 25 a side, the fewest plates', () => {
    const load = plateLoad(lbKg(185), bar, DEFAULT_PLATE_INVENTORY_LB, 'lb')!;
    expect(load.exact).toBe(true);
    expect(platesOnSide(load).map(kg => Math.round(kg / 0.45359237))).toEqual([45, 25]);
  });

  it('reaches 5 lb steps with the 2.5 lb plates, and not the 2.5 lb between them', () => {
    expect(plateLoad(lbKg(140), bar, DEFAULT_PLATE_INVENTORY_LB, 'lb')!.exact).toBe(true);
    expect(plateLoad(lbKg(142.5), bar, DEFAULT_PLATE_INVENTORY_LB, 'lb')!.exact).toBe(false);
  });

  it('says so when a pound load needs a plate nobody owns', () => {
    expect(plateLoad(lbKg(136), bar, DEFAULT_PLATE_INVENTORY_LB, 'lb')!.exact).toBe(false);
  });
});

describe('the inventory in use', () => {
  it('swaps the untouched metric default for the pound one when the unit is pounds', () => {
    expect(effectivePlateInventory(DEFAULT_PLATE_INVENTORY, 'lb')).toBe(DEFAULT_PLATE_INVENTORY_LB);
    expect(effectivePlateInventory(DEFAULT_PLATE_INVENTORY, 'kg')).toBe(DEFAULT_PLATE_INVENTORY);
  });

  it('keeps an inventory the person set, in either unit', () => {
    const own = kgPlates([20, 2]);
    expect(effectivePlateInventory(own, 'lb')).toBe(own);
    expect(effectivePlateInventory(own, 'kg')).toBe(own);
  });

  it('takes an exercise\'s own bar, else the inventory\'s heaviest, else 20 kg', () => {
    expect(barKgFor(15, DEFAULT_PLATE_INVENTORY)).toBe(15);
    expect(barKgFor(null, DEFAULT_PLATE_INVENTORY)).toBe(20);
    expect(barKgFor(undefined, { barsKg: [], plates: [] })).toBe(20);
    expect(barKgFor(0, { barsKg: [25], plates: [] })).toBe(25);
  });
});

describe('describePlateLoad', () => {
  it('names the bar and each side', () => {
    expect(describePlateLoad(plateLoad(82.5, 20, DEFAULT_PLATE_INVENTORY, 'kg')!, 'kg'))
      .toBe('20 kg bar, then 25, 5 and 1.25 on each side');
    expect(describePlateLoad(plateLoad(100, 20, DEFAULT_PLATE_INVENTORY, 'kg')!, 'kg'))
      .toBe('20 kg bar, then 25 and 15 on each side');
  });

  it('says what the plates make when it is not the target', () => {
    expect(describePlateLoad(plateLoad(83, 20, DEFAULT_PLATE_INVENTORY, 'kg')!, 'kg'))
      .toBe('20 kg bar, then 25, 5 and 1.25 on each side. That makes 82.5 kg, the closest load to 83 kg');
  });

  it('handles the bare bar and a load under it', () => {
    expect(describePlateLoad(plateLoad(20, 20, DEFAULT_PLATE_INVENTORY, 'kg')!, 'kg')).toBe('Just the 20 kg bar');
    expect(describePlateLoad(plateLoad(15, 20, DEFAULT_PLATE_INVENTORY, 'kg')!, 'kg')).toBe('Lighter than the 20 kg bar');
    expect(describePlateLoad(plateLoad(21, 20, kgPlates([5, 4]), 'kg')!, 'kg')).toBe('Just the 20 kg bar, the closest load to 21 kg');
  });

  it('names pound plates in pounds', () => {
    const load = plateLoad(weightFromDisplay(135, 'lb'), unitToKg(45, 'lb'), DEFAULT_PLATE_INVENTORY_LB, 'lb')!;
    expect(describePlateLoad(load, 'lb')).toBe('45 lb bar, then 45 on each side');
  });
});

describe('warmupRamp', () => {
  it('ramps 40, 60 and 80 percent of the working weight in loads the plates can make', () => {
    const ramp = warmupRamp(100, 20, DEFAULT_PLATE_INVENTORY, 'kg');
    expect(ramp.map(s => [s.kg, s.reps, s.fraction])).toEqual([[40, 8, 0.4], [60, 5, 0.6], [80, 3, 0.8]]);
  });

  it('rounds each step to a load that can be made', () => {
    const ramp = warmupRamp(40, 20, DEFAULT_PLATE_INVENTORY, 'kg');
    expect(ramp.map(s => s.kg)).toEqual([20, 25, 32.5]);
  });

  it('drops a step that lands on the same load as the one before', () => {
    expect(warmupRamp(30, 20, DEFAULT_PLATE_INVENTORY, 'kg').map(s => s.kg)).toEqual([20, 25]);
  });

  it('never suggests a load at or above the working weight', () => {
    const ramp = warmupRamp(22.5, 20, DEFAULT_PLATE_INVENTORY, 'kg');
    expect(ramp.every(s => s.kg < 22.5)).toBe(true);
  });

  it('is empty when the working weight is the bar or less', () => {
    expect(warmupRamp(20, 20, DEFAULT_PLATE_INVENTORY, 'kg')).toEqual([]);
    expect(warmupRamp(10, 20, DEFAULT_PLATE_INVENTORY, 'kg')).toEqual([]);
  });

  it('ramps in pounds, to pound loads', () => {
    const ramp = warmupRamp(weightFromDisplay(225, 'lb'), unitToKg(45, 'lb'), DEFAULT_PLATE_INVENTORY_LB, 'lb');
    expect(ramp.map(s => Math.round(s.kg / 0.45359237))).toEqual([90, 135, 180]);
  });

  it('takes its own ramp', () => {
    expect(warmupRamp(100, 20, DEFAULT_PLATE_INVENTORY, 'kg', [{ fraction: 0.5, reps: 6 }]).map(s => [s.kg, s.reps])).toEqual([[50, 6]]);
  });
});
