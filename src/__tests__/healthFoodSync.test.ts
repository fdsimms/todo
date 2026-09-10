let mockSettings: { healthWriteEnabled: boolean } = { healthWriteEnabled: false };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

const mockWriteFoodSamples = jest.fn();
const mockDeleteHealthSamples = jest.fn();
let mockBridge: {
  writeFoodSamples: (label: string, atISO: string, amounts: Record<string, number>) => Promise<string[]>;
  deleteHealthSamples: (ids: readonly string[]) => Promise<boolean>;
} | null = null;
jest.mock('../utils/healthBridge', () => ({
  healthBridge: () => mockBridge,
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import {
  logFoodEntryToHealth,
  retractFoodEntryFromHealth,
  writableFoodAmounts,
} from '../utils/healthFoodSync';
import type { FoodLogEntry, FoodNutrition, NutrientKey } from '../types';

function nutrition(amounts: Partial<Record<NutrientKey, number>>): FoodNutrition {
  return {
    basis: 'perServing',
    servingGrams: null,
    servingText: null,
    amounts,
    source: 'manual',
    sourceId: null,
    portions: [],
    recordedAt: '2026-09-10T12:00:00.000Z',
  };
}

function entry(amounts: Partial<Record<NutrientKey, number>>, label = 'Chicken burrito'): FoodLogEntry {
  return {
    id: 'e1',
    dayKey: '2026-09-10',
    atISO: '2026-09-10T12:47:00.000Z',
    slot: 'lunch',
    label,
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 serving',
    grams: 420,
    nutrition: nutrition(amounts),
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-09-10T12:47:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = { healthWriteEnabled: true };
  mockDemoActive = false;
  mockBridge = {
    writeFoodSamples: mockWriteFoodSamples,
    deleteHealthSamples: mockDeleteHealthSamples,
  };
  mockWriteFoodSamples.mockResolvedValue(['corr-1', 'sample-1']);
  mockDeleteHealthSamples.mockResolvedValue(true);
});

describe('writableFoodAmounts', () => {
  it('passes through every figure the entry states', () => {
    expect(writableFoodAmounts(nutrition({ calorieKcal: 640, proteinG: 32, sodiumMg: 1100 })))
      .toEqual({ calorieKcal: 640, proteinG: 32, sodiumMg: 1100 });
  });

  it('leaves out a nutrient the entry does not state', () => {
    // The rule the whole tree is built on, at its highest stakes: writing a 0
    // would put into a medical record a claim that a meal contained none of
    // something nobody measured.
    const amounts = writableFoodAmounts(nutrition({ calorieKcal: 640 }));
    expect(amounts.fiberG).toBeUndefined();
    expect(Object.keys(amounts)).toEqual(['calorieKcal']);
  });

  it('writes a stated zero, which is a real thing for a label to say', () => {
    expect(writableFoodAmounts(nutrition({ calorieKcal: 90, fatG: 0 })).fatG).toBe(0);
  });

  it('drops a negative figure, which is a broken row rather than a small one', () => {
    expect(writableFoodAmounts(nutrition({ calorieKcal: 90, fatG: -4 })).fatG).toBeUndefined();
  });

  it('drops a non-finite figure', () => {
    const amounts = writableFoodAmounts(nutrition({ calorieKcal: Number.NaN, proteinG: 12 }));
    expect(amounts.calorieKcal).toBeUndefined();
    expect(amounts.proteinG).toBe(12);
  });

  it('does not refuse an unusually large figure', () => {
    // A second opinion here would be this module deciding which real meals are
    // too unusual to record; the parse side already refused the impossible.
    expect(writableFoodAmounts(nutrition({ sodiumMg: 9000 })).sodiumMg).toBe(9000);
  });
});

describe('logFoodEntryToHealth', () => {
  it('writes the entry and hands back the sample ids', async () => {
    const result = await logFoodEntryToHealth(entry({ calorieKcal: 640, proteinG: 32 }));
    expect(result).toEqual({ outcome: 'written', sampleIds: ['corr-1', 'sample-1'] });
    expect(mockWriteFoodSamples).toHaveBeenCalledWith(
      'Chicken burrito',
      '2026-09-10T12:47:00.000Z',
      { calorieKcal: 640, proteinG: 32 },
    );
  });

  it('sends the entry own instant, not its logical day', async () => {
    // HealthKit buckets by wall clock and the day key is this app's idea; the
    // two are allowed to disagree. See FoodLogEntry.atISO.
    await logFoodEntryToHealth(entry({ calorieKcal: 640 }));
    expect(mockWriteFoodSamples.mock.calls[0][1]).toBe('2026-09-10T12:47:00.000Z');
  });

  it('refuses in demo mode before anything else', async () => {
    mockDemoActive = true;
    expect(await logFoodEntryToHealth(entry({ calorieKcal: 640 })))
      .toEqual({ outcome: 'unavailable', sampleIds: [] });
    expect(mockWriteFoodSamples).not.toHaveBeenCalled();
  });

  it('refuses in demo mode even with the switch on and a bridge present', async () => {
    // Belt and braces with healthBridge()'s own gate: a write leak puts a real
    // sample in a real record, sourced from fiction.
    mockDemoActive = true;
    mockSettings = { healthWriteEnabled: true };
    expect((await logFoodEntryToHealth(entry({ calorieKcal: 640 }))).outcome).toBe('unavailable');
  });

  it('writes nothing when the switch is off', async () => {
    mockSettings = { healthWriteEnabled: false };
    expect(await logFoodEntryToHealth(entry({ calorieKcal: 640 })))
      .toEqual({ outcome: 'off', sampleIds: [] });
    expect(mockWriteFoodSamples).not.toHaveBeenCalled();
  });

  it('writes nothing for an entry stating no usable figure', async () => {
    expect((await logFoodEntryToHealth(entry({ fatG: -1 }))).outcome).toBe('nothingToWrite');
    expect(mockWriteFoodSamples).not.toHaveBeenCalled();
  });

  it('reports unavailable with no bridge', async () => {
    mockBridge = null;
    expect((await logFoodEntryToHealth(entry({ calorieKcal: 640 }))).outcome).toBe('unavailable');
  });

  it('reports refused when the save comes back with no ids', async () => {
    mockWriteFoodSamples.mockResolvedValue([]);
    expect(await logFoodEntryToHealth(entry({ calorieKcal: 640 })))
      .toEqual({ outcome: 'refused', sampleIds: [] });
  });
});

describe('retractFoodEntryFromHealth', () => {
  it('deletes the samples it is given', async () => {
    expect(await retractFoodEntryFromHealth(['corr-1', 'sample-1'])).toBe(true);
    expect(mockDeleteHealthSamples).toHaveBeenCalledWith(['corr-1', 'sample-1']);
  });

  it('succeeds with nothing to retract, without reaching the bridge', async () => {
    expect(await retractFoodEntryFromHealth([])).toBe(true);
    expect(mockDeleteHealthSamples).not.toHaveBeenCalled();
  });

  it('retracts even with the write switch off', async () => {
    // The one guard deliberately not shared with the write: somebody who turned
    // writing off has asked more clearly, not less, for their samples to go.
    mockSettings = { healthWriteEnabled: false };
    expect(await retractFoodEntryFromHealth(['corr-1'])).toBe(true);
    expect(mockDeleteHealthSamples).toHaveBeenCalled();
  });

  it('refuses in demo mode', async () => {
    mockDemoActive = true;
    expect(await retractFoodEntryFromHealth(['corr-1'])).toBe(false);
    expect(mockDeleteHealthSamples).not.toHaveBeenCalled();
  });

  it('reports a failed delete', async () => {
    mockDeleteHealthSamples.mockResolvedValue(false);
    expect(await retractFoodEntryFromHealth(['corr-1'])).toBe(false);
  });
});
