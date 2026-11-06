import { cleanRack, rackAbove, rackBelow, snapToRack } from '../utils/dumbbellRack';
import { unitToKg } from '../utils/weightLog';

const kgRack = { minKg: 2.5, maxKg: 50, stepKg: 2.5 };
const lbRack = { minKg: unitToKg(5, 'lb'), maxKg: unitToKg(100, 'lb'), stepKg: unitToKg(5, 'lb') };

describe('cleanRack', () => {
  it('keeps a full range and drops anything else', () => {
    expect(cleanRack(kgRack)).toEqual(kgRack);
    expect(cleanRack(null)).toBeNull();
    expect(cleanRack({ minKg: 5, maxKg: 50 })).toBeNull();
    expect(cleanRack({ minKg: 5, maxKg: 50, stepKg: 0 })).toBeNull();
    expect(cleanRack({ minKg: 60, maxKg: 50, stepKg: 5 })).toBeNull();
    expect(cleanRack({ minKg: NaN, maxKg: 50, stepKg: 5 })).toBeNull();
  });
});

describe('snapToRack', () => {
  it('lands on the nearest dumbbell, the higher one on a tie', () => {
    expect(snapToRack(11, kgRack, 'kg')).toBe(10);
    expect(snapToRack(11.25, kgRack, 'kg')).toBe(12.5);
    expect(snapToRack(11.3, kgRack, 'kg')).toBe(12.5);
  });

  it('rounds up or down on request', () => {
    expect(snapToRack(11, kgRack, 'kg', 'up')).toBe(12.5);
    expect(snapToRack(11, kgRack, 'kg', 'down')).toBe(10);
    expect(snapToRack(12.5, kgRack, 'kg', 'up')).toBe(12.5);
    expect(snapToRack(12.5, kgRack, 'kg', 'down')).toBe(12.5);
  });

  it('stops at either end of the rack', () => {
    expect(snapToRack(80, kgRack, 'kg')).toBe(50);
    expect(snapToRack(1, kgRack, 'kg', 'down')).toBe(2.5);
  });

  it('counts the heaviest as a dumbbell when the step does not land on it', () => {
    const odd = { minKg: 5, maxKg: 52, stepKg: 5 };
    expect(snapToRack(51, odd, 'kg')).toBe(52);
    expect(snapToRack(48, odd, 'kg', 'up')).toBe(50);
    expect(snapToRack(51, odd, 'kg', 'down')).toBe(50);
    expect(rackAbove(50, odd, 'kg')).toBe(52);
  });

  it('steps in pounds without drifting', () => {
    for (let lb = 5; lb <= 100; lb += 5) {
      expect(snapToRack(unitToKg(lb, 'lb') + 0.01, lbRack, 'lb')).toBeCloseTo(unitToKg(lb, 'lb'), 2);
    }
    expect(snapToRack(unitToKg(62, 'lb'), lbRack, 'lb')).toBeCloseTo(unitToKg(60, 'lb'), 2);
  });
});

describe('rackAbove and rackBelow', () => {
  it('give the neighbouring dumbbell, or null at an end', () => {
    expect(rackAbove(20, kgRack, 'kg')).toBe(22.5);
    expect(rackAbove(21, kgRack, 'kg')).toBe(22.5);
    expect(rackAbove(50, kgRack, 'kg')).toBeNull();
    expect(rackAbove(70, kgRack, 'kg')).toBeNull();
    expect(rackBelow(20, kgRack, 'kg')).toBe(17.5);
    expect(rackBelow(2.5, kgRack, 'kg')).toBeNull();
  });
});
