import type { GroceryItem } from '../types';
import { saveScanToCatalog, type ScanCatalogDraft } from '../utils/scanCatalogWrite';

function setup(minting: Record<string, string | null> = {}) {
  const calls: string[] = [];
  const actions = {
    ensureCatalogItem: jest.fn((name: string) => {
      calls.push(`ensure:${name}`);
      const id = name in minting ? minting[name] : `id-${name}`;
      return id === null ? null : ({ id, name } as GroceryItem);
    }),
    addProduct: jest.fn((itemId: string, product: { brand: string | null; variant: string | null }) => {
      calls.push(`product:${itemId}:${product.brand ?? ''}:${product.variant ?? ''}`);
    }),
    linkScannedGtins: jest.fn((links: readonly { gtin: string }[]) => {
      calls.push(`link:${links.map(l => l.gtin).join(',')}`);
    }),
  };
  return { actions, calls };
}

function draft(over: Partial<ScanCatalogDraft> = {}): ScanCatalogDraft {
  return { existingItemId: null, name: 'Chips', brand: 'Biena', variant: null, gtin: '0123456789012', ...over };
}

describe('saveScanToCatalog', () => {
  it('files boxes before the barcode links, so a link finds its box', () => {
    const { actions, calls } = setup();
    saveScanToCatalog(
      actions,
      [draft()],
      [{ itemId: 'known', brand: 'Great Value', variant: null }],
      [{ gtin: '999', itemId: 'known', brand: 'Great Value', variant: null }]
    );
    expect(calls).toEqual([
      'ensure:Chips',
      'product:id-Chips:Biena:',
      'product:known:Great Value:',
      'link:999,0123456789012',
    ]);
  });

  it('records a box without making it the preference', () => {
    const { actions } = setup();
    saveScanToCatalog(actions, [draft()], [{ itemId: 'k', brand: 'B', variant: 'V' }], []);
    for (const call of actions.addProduct.mock.calls) {
      expect((call as unknown[])[2]).toEqual({ promote: false });
    }
  });

  it('mints a row for a new draft and flags a name nobody edited', () => {
    const { actions } = setup();
    const result = saveScanToCatalog(actions, [draft({ nameFromScan: true })], [], []);
    expect(actions.ensureCatalogItem).toHaveBeenCalledWith('Chips', { nameFromScan: true });
    expect(result.minted.map(m => m.item.id)).toEqual(['id-Chips']);
    expect(result.mintedLinks).toEqual([{ gtin: '0123456789012', itemId: 'id-Chips', brand: 'Biena', variant: null }]);
  });

  it('does not flag a name the person typed', () => {
    const { actions } = setup();
    saveScanToCatalog(actions, [draft()], [], []);
    expect(actions.ensureCatalogItem).toHaveBeenCalledWith('Chips', { nameFromScan: false });
  });

  it('leaves a draft that matched an existing item to the sheet, which already supplied its box and link', () => {
    const { actions, calls } = setup();
    const result = saveScanToCatalog(actions, [draft({ existingItemId: 'existing' })], [], []);
    expect(actions.ensureCatalogItem).not.toHaveBeenCalled();
    expect(result.minted).toEqual([]);
    expect(calls).toEqual(['link:']);
  });

  it('writes no box for a minted row with no brand or variant, but still links the barcode', () => {
    const { actions, calls } = setup();
    saveScanToCatalog(actions, [draft({ brand: null, variant: null })], [], []);
    expect(calls).toEqual(['ensure:Chips', 'link:0123456789012']);
  });

  it('writes no link for a typed row that has no barcode', () => {
    const { actions, calls } = setup();
    const result = saveScanToCatalog(actions, [draft({ gtin: null })], [], []);
    expect(result.mintedLinks).toEqual([]);
    expect(calls).toEqual(['ensure:Chips', 'link:']);
  });

  it('skips a name that resolves to nothing', () => {
    const { actions } = setup({ Chips: null });
    const result = saveScanToCatalog(actions, [draft()], [], []);
    expect(result.minted).toEqual([]);
    expect(result.mintedLinks).toEqual([]);
  });

  it('keeps drafts in the order they were given', () => {
    const { actions } = setup();
    const result = saveScanToCatalog(actions, [draft({ name: 'A', gtin: null }), draft({ name: 'B', gtin: null })], [], []);
    expect(result.minted.map(m => m.item.name)).toEqual(['A', 'B']);
  });
});
