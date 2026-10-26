import { auditCatalog, auditTokens, suggestedName, type AuditFinding } from '../utils/catalogAudit';
import { newItemRow } from '../utils/groceryAdd';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem, ItemProduct } from '../types';

const item = (name: string, over: Partial<GroceryItem> = {}): GroceryItem => ({
  ...newItemRow({
    name,
    nameKey: groceryNameKey(name),
    aisle: 'Pantry',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    onList: false,
  }),
  // The factory title-cases a shouted name; a legacy row still holds it as saved.
  name,
  ...over,
});

const product = (itemId: string, brand: string | null, variant: string | null = null): ItemProduct =>
  ({ id: `${itemId}-${brand}-${variant}`, itemId, brand, variant, productKey: `${brand}|${variant}` }) as ItemProduct;

const kinds = (found: AuditFinding[], kind: AuditFinding['kind']) =>
  found.filter(f => f.kind === kind).map(f => f.items.map(i => i.name));

describe('auditTokens', () => {
  it('sets aside case, plurals, filler words and folds synonyms', () => {
    expect(auditTokens('Fresh Cilantro Leaves')).toEqual(['cilantro']);
    expect(auditTokens('ginger powder')).toEqual(auditTokens('ground ginger').reverse());
    expect(auditTokens('vegetable stock')).toEqual(auditTokens('vegetable broth'));
  });
});

describe('auditCatalog: names', () => {
  it('flags a shouted name, but not a short acronym', () => {
    const found = auditCatalog([item('MILK CHOCOLATE PEANUT BUTTER CUPS'), item('MSG')], []);
    expect(kinds(found, 'all_caps')).toEqual([['MILK CHOCOLATE PEANUT BUTTER CUPS']]);
  });

  it('flags a size left in the name', () => {
    const found = auditCatalog([item('Mac & Cheese Smokey Dokey -- 6 oz'), item('Vitamin B 12')], []);
    expect(kinds(found, 'size_in_name')).toEqual([['Mac & Cheese Smokey Dokey -- 6 oz']]);
  });

  it('flags a name that is a brand the catalog holds on a variant, with high confidence', () => {
    const tofurky = item('tofurky');
    const found = auditCatalog([tofurky, item('tofu')], [product(tofurky.id, 'Tofurky')]);
    const hit = found.find(f => f.kind === 'brand_in_name');
    expect(hit?.items[0].name).toBe('tofurky');
    expect(hit?.confidence).toBe('high');
  });

  it('flags a brand inside a longer name with low confidence', () => {
    const cleanser = item('CeraVe Foaming Facial Cleanser');
    const found = auditCatalog([cleanser], [product(cleanser.id, 'CeraVe')]);
    expect(found.find(f => f.kind === 'brand_in_name')?.confidence).toBe('low');
  });

  it("catches a scan's longer brand through the row's own variant", () => {
    const sausage = item('Beyond Sausage Plant-Based Links Brat Original');
    const found = auditCatalog([sausage], [product(sausage.id, 'Beyond Meat')]);
    expect(kinds(found, 'brand_in_name')).toEqual([['Beyond Sausage Plant-Based Links Brat Original']]);
  });

  it('leaves a generic name that is only the start of its own brand', () => {
    const pb = item('peanut butter');
    const found = auditCatalog([pb], [product(pb.id, 'Peanut Butter & Co')]);
    expect(kinds(found, 'brand_in_name')).toEqual([]);
  });

  it('does not match a brand on part of a word', () => {
    const bar = item('protein bar');
    const found = auditCatalog([item('bearing'), bar], [product(bar.id, 'Bear')]);
    expect(kinds(found, 'brand_in_name')).toEqual([]);
  });

  it('flags a name copied off a package when no brand explains it', () => {
    const found = auditCatalog([item('0% Milkfat Strained Non- Fat Strawberry Yogurt'), item('chipotle peppers in adobo')], []);
    expect(kinds(found, 'package_title')).toEqual([['0% Milkfat Strained Non- Fat Strawberry Yogurt']]);
  });
});

describe('auditCatalog: pairs', () => {
  it('finds two rows that use the same words', () => {
    const found = auditCatalog(
      [item('ground ginger'), item('ginger powder'), item('vegetable stock'), item('vegetable broth'), item('cilantro'), item('fresh cilantro leaves')],
      []
    );
    expect(kinds(found, 'same_words')).toEqual([
      ['ground ginger', 'ginger powder'],
      ['vegetable stock', 'vegetable broth'],
      ['cilantro', 'fresh cilantro leaves'],
    ]);
  });

  it('offers the shorter name as the generic of a longer one, with low confidence', () => {
    const found = auditCatalog([item('onion'), item('white onion')], []);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'maybe_kind_of', confidence: 'low' });
    expect(found[0].items.map(i => i.name)).toEqual(['onion', 'white onion']);
  });

  it('leaves a pair alone once the person has declared how they relate', () => {
    const kind = auditCatalog([item('onion'), item('white onion', { varietyOfKey: 'onion' })], []);
    expect(kind).toEqual([]);
    const alias = auditCatalog([item('mayonnaise', { otherNames: ['mayo'] }), item('mayo')], []);
    expect(alias.filter(f => f.kind !== 'maybe_kind_of')).toEqual([]);
  });

  it('does not pair unrelated names', () => {
    expect(auditCatalog([item('salt'), item('olive oil'), item('rice vinegar')], [])).toEqual([]);
  });
});

describe('suggestedName', () => {
  const only = (rows: GroceryItem[], products: ItemProduct[], kind: AuditFinding['kind']) =>
    auditCatalog(rows, products).find(f => f.kind === kind)!;

  it('title-cases a shouted name, drops a size and takes a brand out', () => {
    expect(suggestedName(only([item('PEANUT BUTTER CUPS')], [], 'all_caps'))).toBe('Peanut Butter Cups');
    expect(suggestedName(only([item('Smokey Dokey -- 6 oz')], [], 'size_in_name'))).toBe('Smokey Dokey');
    const cleanser = item('CeraVe Foaming Facial Cleanser');
    expect(suggestedName(only([cleanser], [product(cleanser.id, 'CeraVe')], 'brand_in_name'))).toBe('Foaming Facial Cleanser');
  });

  it('starts a package title from the name as it stands', () => {
    expect(suggestedName(only([item('0% Milkfat Strained Non- Fat Strawberry Yogurt')], [], 'package_title'))).toBe('0% Milkfat Strained Non- Fat Strawberry Yogurt');
  });

  it('leaves nothing when the whole name is the brand', () => {
    const t = item('tofurky');
    expect(suggestedName(only([t], [product(t.id, 'Tofurky')], 'brand_in_name'))).toBe('');
  });
});
