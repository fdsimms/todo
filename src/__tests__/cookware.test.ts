import { clampCookwareWeight, parseWeightText, netWeight, COOKWARE_MAX_G } from '../utils/cookware';

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
      "That's less than the pot weighs (280 g). Check the reading or pick a different pot.",
    );
    expect(plate.ok || plate.reason).toBe(
      "That's less than the plate weighs (280 g). Check the reading or pick a different plate.",
    );
  });
});
