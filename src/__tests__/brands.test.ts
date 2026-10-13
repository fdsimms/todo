import { brandSummaries, planBrandRename } from '../utils/brands';
import { productKeyFor } from '../utils/groceryProduct';
import { PORTION_PRODUCT_KEY, type ItemProduct } from '../types';

const product = (id: string, itemId: string, brand: string | null, variant: string | null = null): ItemProduct =>
  ({
    id, itemId, brand, variant, productKey: productKeyFor(brand, variant), rating: null, nutrition: null, note: '',
    purchaseCount: 0, lastPurchasedAt: null, gtin: null, onHandUntil: null, expiresAt: null, frozenAt: null,
    openedAt: null, isPortion: false, createdAt: '2026-01-01T00:00:00.000Z',
  }) as ItemProduct;

const items = [
  { id: 'yog', name: 'skyr' },
  { id: 'chips', name: 'protein chips' },
];

describe('brandSummaries', () => {
  it('groups spellings of one brand and lists where it appears, most common spelling first', () => {
    const all = [
      product('a', 'yog', 'Siggi’s', 'plain'),
      product('b', 'yog', "siggi's", 'simple ingredient'),
      product('c', 'yog', 'Siggi’s', 'blueberry'),
      product('d', 'chips', 'Quest', 'nacho'),
      product('e', 'chips', 'QUEST', 'taco'),
      product('f', 'chips', null, 'store brand'),
    ];
    const [siggis, quest] = brandSummaries(all, items);
    expect(siggis).toMatchObject({ name: 'Siggi’s', variants: 3, items: ['skyr'] });
    expect(siggis.spellings).toEqual([{ text: 'Siggi’s', count: 2 }, { text: "siggi's", count: 1 }]);
    expect(quest).toMatchObject({ name: 'Quest', variants: 2, items: ['protein chips'] });
    expect(brandSummaries(all, items)).toHaveLength(2);
  });

  it('skips a frozen portion and a variant with no brand', () => {
    const portion = { ...product('p', 'yog', 'Siggi’s'), productKey: PORTION_PRODUCT_KEY, isPortion: true } as ItemProduct;
    expect(brandSummaries([portion, product('n', 'yog', null, 'low fat')], items)).toEqual([]);
  });
});

describe('planBrandRename', () => {
  it('respells a brand under any of its spellings and leaves every key as it was', () => {
    const all = [product('a', 'chips', 'QUEST', 'taco'), product('b', 'chips', 'Quest', 'nacho'), product('c', 'yog', 'Siggi’s')];
    const plan = planBrandRename(all, 'quest', 'Quest');
    expect(plan).toEqual({ updates: [expect.objectContaining({ id: 'a', brand: 'Quest', productKey: all[0].productKey })] });
  });

  it('moves variants to a different brand and re-keys them', () => {
    const all = [product('a', 'chips', 'Aoodles', 'thrilled cheese')];
    const plan = planBrandRename(all, 'Aoodles', 'Goodles');
    expect(plan).toEqual({ updates: [expect.objectContaining({ brand: 'Goodles', productKey: productKeyFor('Goodles', 'thrilled cheese') })] });
  });

  it('refuses a rename that would give one item two variants with the same key, and a missing or blank brand', () => {
    const all = [product('a', 'chips', 'Aoodles', 'mac'), product('b', 'chips', 'Goodles', 'mac')];
    expect(planBrandRename(all, 'Aoodles', 'Goodles')).toEqual({ refusal: expect.stringMatching(/same variant name/) });
    expect(planBrandRename(all, 'Nobody', 'X')).toEqual({ refusal: expect.stringMatching(/No variant has the brand/) });
    expect(planBrandRename(all, 'Aoodles', '  ')).toEqual({ refusal: expect.stringMatching(/needs a name/) });
  });

  it('reports nothing to do when every variant already has that spelling', () => {
    expect(planBrandRename([product('a', 'chips', 'Quest', 'taco')], 'quest', 'Quest')).toEqual({ updates: [] });
  });
});
