/**
 * Tests for src/services/foodSearch.ts.
 *
 * Only the gates in front of the network are pinned here: what a hit is read
 * into lives in `nutritionParse.ts` and `foodSearchMatch.ts`, which have their
 * own tests. Network calls are intercepted with a jest.spyOn on global.fetch,
 * the same way productLookup.test.ts does it.
 */

import {
  describeFoodSearchError,
  fetchFoodPortions,
  foodSearchErrorSettingsEntryId,
  searchFoods,
} from '../services/foodSearch';
import { setDemoModeActive } from '../utils/demoState';

const settings = {
  productLookupEnabled: true,
  fdcApiKey: 'fdc-key',
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));

jest.mock('../db/database', () => ({
  dbGetGtinLookup: jest.fn().mockReturnValue(null),
  dbSetGtinLookup: jest.fn(),
}));

let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  settings.productLookupEnabled = true;
  settings.fdcApiKey = 'fdc-key';
  fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ foods: [] }),
  } as never);
});

afterEach(() => {
  fetchSpy.mockRestore();
  setDemoModeActive(false);
});

describe('demo mode', () => {
  // The owner's FoodData Central key is still in memory while a friend holds
  // the phone, so neither request may leave the device.
  it('refuses a search without reaching the network', async () => {
    setDemoModeActive(true);
    const error = await searchFoods('onion').catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(describeFoodSearchError(error)).toBe('Food lookups are off in demo mode.');
    // Not a Settings problem, so there is no row to send anybody to.
    expect(foodSearchErrorSettingsEntryId(error)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a portion table without reaching the network', async () => {
    setDemoModeActive(true);
    const error = await fetchFoodPortions('170000').catch(e => e);
    expect(describeFoodSearchError(error)).toBe('Food lookups are off in demo mode.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('leaves an ordinary search alone outside it', async () => {
    await expect(searchFoods('onion')).resolves.toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
