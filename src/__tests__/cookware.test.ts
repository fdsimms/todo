import {
  clampCookwareWeight, parseWeightText, netWeight, COOKWARE_MAX_G, cookwareTypeOf, groupCookwareByType, effectiveCookwareType, isCookwareType,
  filterCookware, pushRecentCookware, recentCookwareItems, parseRecentCookware, RECENT_COOKWARE_LIMIT,
} from '../utils/cookware';

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

  it('refuses a weight that rounds to zero grams', () => {
    expect(clampCookwareWeight(0.4)).toBeNull();
    expect(clampCookwareWeight(0.5)).toBe(1);
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
    ['Large mixing bowl', 'Mixing bowls'],
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

describe('mixing bowls', () => {
  it('sit after Bowls and take a type chosen by hand', () => {
    const groups = groupCookwareByType([
      { name: 'Kitchenaid Bowl', kind: 'Mixing bowls' as const }, { name: 'Cereal bowl' }, { name: 'Dinner plate' },
    ]);
    expect(groups.map(g => g.type)).toEqual(['Bowls', 'Mixing bowls', 'Plates']);
    expect(isCookwareType('Mixing bowls')).toBe(true);
  });
});

describe('filterCookware', () => {
  const items = [
    { name: 'Lodge cast-iron skillet' },
    { name: 'All-Clad Saucier' },
    { name: 'Nordic Ware Half Sheet Pan' },
    { name: 'Kitchenaid Bowl', kind: 'Mixing bowls' as const },
  ];

  it('returns everything for a blank query', () => {
    expect(filterCookware(items, '  ')).toHaveLength(4);
  });

  it('matches any case, and every word has to be found', () => {
    expect(filterCookware(items, 'CLAD').map(i => i.name)).toEqual(['All-Clad Saucier']);
    expect(filterCookware(items, 'sheet half').map(i => i.name)).toEqual(['Nordic Ware Half Sheet Pan']);
    expect(filterCookware(items, 'sheet saucier')).toEqual([]);
  });

  it('matches the type a piece is listed under as well as its name', () => {
    expect(filterCookware(items, 'mixing').map(i => i.name)).toEqual(['Kitchenaid Bowl']);
    expect(filterCookware(items, 'pans').map(i => i.name)).toEqual(['Lodge cast-iron skillet']);
  });
});

describe('recent cookware', () => {
  it('moves a repeat pick to the front and caps the list', () => {
    let recent: string[] = [];
    for (const id of ['a', 'b', 'c', 'd']) recent = pushRecentCookware(recent, id);
    expect(recent).toEqual(['d', 'c', 'b']);
    expect(recent).toHaveLength(RECENT_COOKWARE_LIMIT);
    expect(pushRecentCookware(recent, 'b')).toEqual(['b', 'd', 'c']);
  });

  it('skips an id whose piece was deleted', () => {
    expect(recentCookwareItems(['x', 'a', 'b'], [{ id: 'a' }, { id: 'b' }]).map(i => i.id)).toEqual(['a', 'b']);
  });

  it('reads a stored list back, and treats anything else as empty', () => {
    expect(parseRecentCookware('["a","b"]')).toEqual(['a', 'b']);
    expect(parseRecentCookware('["a",3,null]')).toEqual(['a']);
    expect(parseRecentCookware('{"a":1}')).toEqual([]);
    expect(parseRecentCookware('not json')).toEqual([]);
    expect(parseRecentCookware(null)).toEqual([]);
  });
});
