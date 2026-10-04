jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: jest.fn(() => ({ dayResetTime: '04:00' })) },
}));

import { buildFoodLogEntry } from '../utils/foodLogEntry';
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

  it('refuses an entry with no name or no figures', () => {
    expect(buildFoodLogEntry({ label: ' ', quantity: '', grams: null, nutrition: panel }, () => [], () => 'x')).toBeNull();
    expect(buildFoodLogEntry({ label: 'Tea', quantity: '', grams: null, nutrition: { ...panel, amounts: {} } }, () => [], () => 'x')).toBeNull();
  });
});
