jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: jest.fn(() => ({ dayResetTime: '04:00' })) },
}));

import { buildFoodLogEntry } from '../utils/foodLogEntry';
import { HELD_RELEASE_HOURS, heldEntryDue, heldUntilFor } from '../utils/foodHold';
import type { FoodLogEntry, FoodNutrition } from '../types';

const panel: FoodNutrition = {
  basis: 'perServing', servingGrams: null, servingText: '1 bowl', amounts: { calorieKcal: 500 },
  source: 'estimated', sourceId: null, portions: [], recordedAt: '2026-10-04T12:00:00.000Z',
};

describe('buildFoodLogEntry', () => {
  it('stamps the logical day, appends to that day\'s order, and starts with no Health samples', () => {
    const siblingsOn = jest.fn(() => [{ sortOrder: 4 } as FoodLogEntry]);
    // 2am under a 4am reset is still the day before.
    const at = new Date(2026, 9, 5, 2, 0);
    const entry = buildFoodLogEntry({ label: ' Burrito ', quantity: '1', grams: null, nutrition: panel, at }, siblingsOn, () => 'id1');
    expect(siblingsOn).toHaveBeenCalledWith('2026-10-04');
    expect(entry).toMatchObject({ id: 'id1', dayKey: '2026-10-04', label: 'Burrito', sortOrder: 5, healthSampleIds: [] });
  });

  it('keeps the answers to an either-one pair only when there are some', () => {
    const picks = [{ pair: 'butter|vegan butter', use: 'vegan butter' }];
    expect(buildFoodLogEntry({ label: 'Loaf', quantity: '1', grams: null, nutrition: panel, itemPicks: picks }, () => [], () => 'a')?.itemPicks).toEqual(picks);
    expect(buildFoodLogEntry({ label: 'Loaf', quantity: '1', grams: null, nutrition: panel, itemPicks: [] }, () => [], () => 'b')).not.toHaveProperty('itemPicks');
  });

  it('refuses an entry with no name or no figures', () => {
    expect(buildFoodLogEntry({ label: ' ', quantity: '', grams: null, nutrition: panel }, () => [], () => 'x')).toBeNull();
    expect(buildFoodLogEntry({ label: 'Tea', quantity: '', grams: null, nutrition: { ...panel, amounts: {} } }, () => [], () => 'x')).toBeNull();
  });
});

describe('held entries', () => {
  const now = new Date(2026, 9, 5, 19, 0);

  it('holds an entry only when the draft asks, until HELD_RELEASE_HOURS after it was logged', () => {
    const held = buildFoodLogEntry({ label: 'Burger', quantity: '1', grams: null, nutrition: panel, holdFromHealth: true }, () => [], () => 'h', now);
    expect(held?.healthHeldUntil).toBe(heldUntilFor(now));
    expect(new Date(held?.healthHeldUntil as string).getTime() - now.getTime()).toBe(HELD_RELEASE_HOURS * 3_600_000);
    const plain = buildFoodLogEntry({ label: 'Burger', quantity: '1', grams: null, nutrition: panel }, () => [], () => 'p', now);
    expect(plain).not.toHaveProperty('healthHeldUntil');
  });

  it('is due once its wait is over, never for an entry that is not held', () => {
    const entry = { healthHeldUntil: heldUntilFor(now) } as FoodLogEntry;
    expect(heldEntryDue(entry, new Date(now.getTime() + 3_600_000))).toBe(false);
    expect(heldEntryDue(entry, new Date(now.getTime() + HELD_RELEASE_HOURS * 3_600_000))).toBe(true);
    expect(heldEntryDue({} as FoodLogEntry, now)).toBe(false);
    expect(heldEntryDue({ healthHeldUntil: null } as FoodLogEntry, now)).toBe(false);
  });

  it('releases a hold whose time will not parse rather than holding it forever', () => {
    expect(heldEntryDue({ healthHeldUntil: 'garbage' } as FoodLogEntry, now)).toBe(true);
  });
});
