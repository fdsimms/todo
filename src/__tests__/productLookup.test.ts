/**
 * Tests for src/services/productLookup.ts.
 *
 * Network calls are intercepted with a jest.spyOn on global.fetch, the same way
 * aiSuggestions.test.ts does it — no real keys, no real requests. What is worth
 * pinning here is not the parsing so much as the *chain*: which sources get
 * asked, in what order, and above all when a miss is allowed to be cached.
 */

import { describeLookupError, lookupGtin } from '../services/productLookup';
import { dbGetGtinLookup, dbSetGtinLookup } from '../db/database';

const settings = {
  productLookupEnabled: true,
  fdcApiKey: '',
  goUpcApiKey: '',
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));

jest.mock('../db/database', () => ({
  dbGetGtinLookup: jest.fn().mockReturnValue(null),
  dbSetGtinLookup: jest.fn(),
}));

const GTIN = '00036000291452';
const NOW = new Date('2026-08-21T12:00:00Z');

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function offHit(name: string) {
  return jsonResponse({ status: 1, product: { product_name: name, brands: 'Great Value', quantity: '1 gal' } });
}

let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  settings.productLookupEnabled = true;
  settings.fdcApiKey = '';
  settings.goUpcApiKey = '';
  (dbGetGtinLookup as jest.Mock).mockReturnValue(null);
  fetchSpy = jest.spyOn(global, 'fetch' as never);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('the cache', () => {
  it('answers a stored hit without asking anyone', async () => {
    (dbGetGtinLookup as jest.Mock).mockReturnValue({
      gtin: GTIN, found: true, name: 'Milk', brand: 'Great Value',
      quantity: '1 gal', source: 'openfoodfacts', fetchedAt: '2019-01-01T00:00:00Z',
    });

    await expect(lookupGtin(GTIN, NOW)).resolves.toMatchObject({ name: 'Milk' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers a fresh stored miss without asking anyone', async () => {
    (dbGetGtinLookup as jest.Mock).mockReturnValue({
      gtin: GTIN, found: false, name: '', brand: null,
      quantity: null, source: '', fetchedAt: '2026-08-20T12:00:00Z',
    });

    await expect(lookupGtin(GTIN, NOW)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('re-asks once a stored miss has aged out', async () => {
    (dbGetGtinLookup as jest.Mock).mockReturnValue({
      gtin: GTIN, found: false, name: '', brand: null,
      quantity: null, source: '', fetchedAt: '2026-01-01T00:00:00Z',
    });
    fetchSpy.mockResolvedValue(offHit('Milk'));

    await expect(lookupGtin(GTIN, NOW)).resolves.toMatchObject({ name: 'Milk' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses to reach the network while lookups are off', async () => {
    settings.productLookupEnabled = false;
    await expect(lookupGtin(GTIN, NOW)).rejects.toThrow('Lookups are off');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the source chain', () => {
  it('asks only Open Food Facts when no keys are set', async () => {
    fetchSpy.mockResolvedValue(offHit('Milk'));

    const record = await lookupGtin(GTIN, NOW);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('openfoodfacts.org');
    expect(record?.source).toBe('openfoodfacts');
  });

  it('asks FoodData Central first when a key is set, and stops there on a hit', async () => {
    settings.fdcApiKey = 'fdc-key';
    fetchSpy.mockResolvedValue(jsonResponse({
      foods: [{ description: 'Milk, 2%', brandName: 'Great Value', gtinUpc: '036000291452' }],
    }));

    const record = await lookupGtin(GTIN, NOW);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.nal.usda.gov');
    expect(record).toMatchObject({ name: 'Milk, 2%', source: 'usda' });
  });

  it('refuses a FoodData Central result whose own barcode is a different product', async () => {
    // It is a *search* endpoint, so an unknown code comes back as whatever the
    // index thought was closest rather than as nothing.
    settings.fdcApiKey = 'fdc-key';
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        foods: [{ description: 'Something else entirely', gtinUpc: '099999999999' }],
      }))
      .mockResolvedValueOnce(offHit('Milk'));

    const record = await lookupGtin(GTIN, NOW);

    expect(record).toMatchObject({ source: 'openfoodfacts' });
  });

  it('reaches the paid source only after both free ones miss', async () => {
    settings.goUpcApiKey = 'go-key';
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ status: 0 }))
      .mockResolvedValueOnce(jsonResponse({ product: { name: 'Milk', brand: 'Great Value' } }));

    const record = await lookupGtin(GTIN, NOW);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('openfoodfacts.org');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('go-upc.com');
    expect(record?.source).toBe('go-upc');
  });

  it('never reaches the paid source when a free one answered', async () => {
    settings.goUpcApiKey = 'go-key';
    fetchSpy.mockResolvedValue(offHit('Milk'));

    await lookupGtin(GTIN, NOW);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('caching an answer', () => {
  it('stores a hit', async () => {
    fetchSpy.mockResolvedValue(offHit('Milk'));
    await lookupGtin(GTIN, NOW);
    expect(dbSetGtinLookup).toHaveBeenCalledWith(expect.objectContaining({ gtin: GTIN, found: true }));
  });

  it('stores a miss every source actually confirmed', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, 404));
    await expect(lookupGtin(GTIN, NOW)).resolves.toBeNull();
    expect(dbSetGtinLookup).toHaveBeenCalledWith(expect.objectContaining({ found: false }));
  });

  it('stores nothing when the only source could not be reached', async () => {
    // The barcode is not unknown; the train went into a tunnel. Writing a miss
    // would refuse this code for a month on that evidence.
    fetchSpy.mockRejectedValue(new Error('network down'));
    await expect(lookupGtin(GTIN, NOW)).rejects.toThrow();
    expect(dbSetGtinLookup).not.toHaveBeenCalled();
  });

  it('stores nothing when one source missed and another failed', async () => {
    settings.goUpcApiKey = 'go-key';
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockRejectedValueOnce(new Error('network down'));

    await expect(lookupGtin(GTIN, NOW)).rejects.toThrow();
    expect(dbSetGtinLookup).not.toHaveBeenCalled();
  });

  it('still stores a hit found after an earlier source failed', async () => {
    settings.fdcApiKey = 'fdc-key';
    fetchSpy
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(offHit('Milk'));

    await expect(lookupGtin(GTIN, NOW)).resolves.toMatchObject({ name: 'Milk' });
    expect(dbSetGtinLookup).toHaveBeenCalledWith(expect.objectContaining({ found: true }));
  });
});

describe('reading Open Food Facts', () => {
  it('prefers the generic name, which is what a shopper would write', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      status: 1,
      product: { product_name: 'Great Value 2% Milk', generic_name: 'milk', brands: 'Great Value' },
    }));
    await expect(lookupGtin(GTIN, NOW)).resolves.toMatchObject({ name: 'milk' });
  });

  it('takes the first brand off the comma-separated list', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      status: 1, product: { product_name: 'Milk', brands: 'Great Value, Walmart' },
    }));
    await expect(lookupGtin(GTIN, NOW)).resolves.toMatchObject({ brand: 'Great Value' });
  });

  it('treats a skeleton entry with no name as a miss rather than an empty hit', async () => {
    // Caching it as a hit would make it permanent, which is the wrong answer
    // for a record that is waiting to be filled in.
    fetchSpy.mockResolvedValue(jsonResponse({ status: 1, product: { brands: 'Great Value' } }));
    await expect(lookupGtin(GTIN, NOW)).resolves.toBeNull();
  });
});

describe('describeLookupError', () => {
  it('always ends in the one thing that works', () => {
    // Every branch, however it failed, points at the fallback that always
    // works. Case-insensitive because one of them says it mid-sentence.
    for (const message of ['Request timed out', 'Lookups are off', 'Lookup failed 500', 'who knows']) {
      expect(describeLookupError(new Error(message)).toLowerCase()).toContain('type the name');
    }
  });
});
