import { clampCookwareWeight, parseWeightText, netWeight, COOKWARE_MAX_G, cookwareTypeOf, groupCookwareByType, effectiveCookwareType, isCookwareType } from '../utils/cookware';

describe('clampCookwareWeight', () => {
  it('rounds to the gram', () => {
    expect(clampCookwareWeight(4310.4)).toBe(4310);
  });

  it('refuses what is not a weight', () => {
    expect(clampCookwareWeight(null)).toBeNull();
    expect(clampCookwareWeight(0)).toBeNull();
    expect(clampCookwareWeight(-5)).toBeNull();
    expect(clampCookwareWeight(NaN)).toBeNull();
  });

  it('caps an absurd weight rather than refusing it', () => {
    expect(clampCookwareWeight(999999)).toBe(COOKWARE_MAX_G);
  });
});

describe('parseWeightText', () => {
  it('reads a decimal comma', () => {
    expect(parseWeightText('1450,5')).toBe(1450.5);
  });

  it('answers null for blank or non-numeric text', () => {
    expect(parseWeightText('  ')).toBeNull();
    expect(parseWeightText('abc')).toBeNull();
  });
});

describe('netWeight', () => {
  it('takes every picked piece off the reading', () => {
    expect(netWeight(6450, [4310])).toEqual({ ok: true, grams: 2140 });
    expect(netWeight(7600, [4310, 1150])).toEqual({ ok: true, grams: 2140 });
  });

  it('passes the reading through when nothing is picked', () => {
    expect(netWeight(1450, [])).toEqual({ ok: true, grams: 1450 });
  });

  it('refuses a reading at or under the cookware, with the reason', () => {
    const lighter = netWeight(4000, [4310]);
    expect(lighter.ok).toBe(false);
    if (!lighter.ok) expect(lighter.reason).toContain('4,310 g');
    expect(netWeight(4310, [4310]).ok).toBe(false);
  });

  it('names the piece the way the field it was typed in does', () => {
    const pot = netWeight(250, [280]);
    const plate = netWeight(250, [280], 'plate');
    expect(pot.ok || pot.reason).toBe(
      "That’s less than the pot weighs (280 g). Check the reading or pick a different pot.",
    );
    expect(plate.ok || plate.reason).toBe(
      "That’s less than the plate weighs (280 g). Check the reading or pick a different plate.",
    );
    const any = netWeight(250, [280], 'cookware');
    expect(any.ok || any.reason).toBe(
      "That’s less than the cookware weighs (280 g). Check the reading or pick other cookware.",
    );
  });
});

describe('cookwareTypeOf / groupCookwareByType', () => {
  const cases: [string, string][] = [
    ['Staub crockpot (no lid)', 'Pots'],
    ['Stainless steel crock pot', 'Pots'],
    ['All-Clad Saucier', 'Pots'],
    ['Dutch oven lid', 'Pots'],
    ['Lodge cast-iron skillet', 'Pans'],
    ['All-Clad 12” frying pan', 'Pans'],
    ['Nordic Ware Half Sheet Pan', 'Baking'],
    ['Smallest Pyrex bowl', 'Bowls'],
    ['Ramekin', 'Bowls'],
    ['Ice cream dish', 'Bowls'],
    ['Dinner plate', 'Plates'],
    ['Rocks glass', 'Glasses'],
    ['Glass tub', 'Other'],
    ['Mystery thing', 'Other'],
  ];
  it.each(cases)('files %s under %s', (name, type) => {
    expect(cookwareTypeOf(name)).toBe(type);
  });

  it('groups in type order, drops empty types and keeps incoming order', () => {
    const groups = groupCookwareByType([
      { name: 'Dinner plate' }, { name: 'Wok' }, { name: 'Rocks glass' }, { name: 'Skillet' },
    ]);
    expect(groups.map(g => g.type)).toEqual(['Pans', 'Plates', 'Glasses']);
    expect(groups[0].items.map(i => i.name)).toEqual(['Wok', 'Skillet']);
  });
});

describe('a chosen type', () => {
  it('overrides what the name reads as, and null falls back to the name', () => {
    expect(effectiveCookwareType({ name: 'Ramekin', kind: 'Baking' })).toBe('Baking');
    expect(effectiveCookwareType({ name: 'Ramekin', kind: null })).toBe('Bowls');
    expect(effectiveCookwareType({ name: 'Ramekin' })).toBe('Bowls');
  });

  it('groups by the chosen type', () => {
    const groups = groupCookwareByType([{ name: 'Ramekin', kind: 'Baking' as const }, { name: 'Cereal bowl', kind: null }]);
    expect(groups.map(g => g.type)).toEqual(['Baking', 'Bowls']);
  });

  it('knows which strings are types', () => {
    expect(isCookwareType('Pots')).toBe(true);
    expect(isCookwareType('pots')).toBe(false);
    expect(isCookwareType(null)).toBe(false);
  });
});
