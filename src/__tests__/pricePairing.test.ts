import {
  autoPairing,
  pairWith,
  pricesByItemId,
  unpair,
  unpairedPriceIndexes,
  type PairItem,
} from '../utils/pricePairing';

const item = (id: string, baselineMinor: number | null = null): PairItem => ({ id, baselineMinor });

describe('autoPairing', () => {
  it('pairs the one-of-each case without consulting any history', () => {
    expect(autoPairing([item('a')], [418])).toEqual({ a: 0 });
  });

  it('answers nothing when the counts differ', () => {
    // A bag fee, a deposit, or something bought elsewhere. Which one is
    // unknowable, so nothing is assumed.
    expect(autoPairing([item('a', 400), item('b', 900)], [418, 880, 10])).toEqual({});
  });

  it('answers nothing for an empty trip', () => {
    expect(autoPairing([], [])).toEqual({});
  });

  it('pairs when every price is plausible for exactly one item', () => {
    const items = [item('milk', 400), item('steak', 2200)];
    expect(autoPairing(items, [2350, 418])).toEqual({ steak: 0, milk: 1 });
  });

  it('refuses when two items could both take a price', () => {
    // Two things that cost about the same is the ordinary case, and it is
    // exactly the one where a guess would be a coin flip.
    expect(autoPairing([item('a', 400), item('b', 420)], [418, 405])).toEqual({});
  });

  it('refuses when an item has no history to judge against', () => {
    expect(autoPairing([item('a', 400), item('b', null)], [418, 900])).toEqual({});
  });

  it('refuses rather than pairing only the half it is sure about', () => {
    const result = autoPairing([item('a', 400), item('b', 2200), item('c', null)], [418, 2350, 700]);
    expect(result).toEqual({});
  });

  it('refuses a price that fits nothing on the trip', () => {
    expect(autoPairing([item('a', 400), item('b', 2200)], [418, 99999])).toEqual({});
  });
});

describe('pairWith', () => {
  it('pairs an item to a price', () => {
    expect(pairWith({}, 'a', 2)).toEqual({ a: 2 });
  });

  it('moves an item rather than letting it hold two prices', () => {
    expect(pairWith({ a: 1 }, 'a', 3)).toEqual({ a: 3 });
  });

  it('takes a price off whoever held it, so one price has one owner', () => {
    expect(pairWith({ a: 1, b: 2 }, 'b', 1)).toEqual({ b: 1 });
  });

  it('leaves other pairs alone', () => {
    expect(pairWith({ a: 0, b: 1 }, 'c', 2)).toEqual({ a: 0, b: 1, c: 2 });
  });
});

describe('unpair', () => {
  it('takes one item back off', () => {
    expect(unpair({ a: 0, b: 1 }, 'a')).toEqual({ b: 1 });
  });

  it('shrugs at an item that was never paired', () => {
    expect(unpair({ a: 0 }, 'zzz')).toEqual({ a: 0 });
  });
});

describe('unpairedPriceIndexes', () => {
  it('lists what nothing has claimed, in printed order', () => {
    expect(unpairedPriceIndexes({ a: 1 }, 4)).toEqual([0, 2, 3]);
  });

  it('is empty once everything is spoken for', () => {
    expect(unpairedPriceIndexes({ a: 0, b: 1 }, 2)).toEqual([]);
  });
});

describe('pricesByItemId', () => {
  it('speaks the priceById shape the commit paths already use', () => {
    expect(pricesByItemId({ a: 0, b: 2 }, [418, 500, 2350])).toEqual({ a: 418, b: 2350 });
  });

  it('drops a pair whose price is gone rather than writing undefined', () => {
    expect(pricesByItemId({ a: 9 }, [418])).toEqual({});
  });
});
