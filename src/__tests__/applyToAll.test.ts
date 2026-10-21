import { applyTargets, applyToAllLabel } from '../utils/applyToAll';
import {
  clearApplyOffer, getApplyOffer, resetApplyOffer, setApplyOffer, subscribeApplyOffer,
} from '../utils/applyToAllOffer';

describe('applyTargets', () => {
  const all = [0, 1, 2];

  it('offers the sets that differ, the focused one included', () => {
    expect(applyTargets(['95', '90', '85'], all, 0, '95')).toEqual([1, 2]);
    expect(applyTargets(['100', '95', '95'], all, 1, '95')).toEqual([0]);
  });

  it('writes the focused cell too when its draft is the odd one out', () => {
    expect(applyTargets(['95', '95', '95'], all, 2, '100')).toEqual([0, 1, 2]);
  });

  it('offers nothing when every set already matches', () => {
    expect(applyTargets(['95', '95', '95'], all, 1, '95')).toEqual([]);
  });

  it('offers nothing when only the focused set differs', () => {
    // The other sets already hold the value: copying onto the one being typed in is not an apply.
    expect(applyTargets(['95', '95', '8'], all, 2, '95')).toEqual([]);
    expect(applyTargets(['95'], [0], 0, '100')).toEqual([]);
  });

  it('offers nothing for a blank cell', () => {
    expect(applyTargets(['95', '90'], [0, 1], 0, '  ')).toEqual([]);
  });

  it('stays inside the scope it is given', () => {
    expect(applyTargets(['40', '80', '80'], [1, 2], 1, '85')).toEqual([1, 2]);
    expect(applyTargets(['40', '80', '80'], [1, 2], 1, '80')).toEqual([]);
  });

  it('treats surrounding spaces as the same value', () => {
    expect(applyTargets([' 95 ', '95'], [0, 1], 0, '95')).toEqual([]);
  });
});

describe('applyToAllLabel', () => {
  it('names the value and the scope', () => {
    expect(applyToAllLabel('95', 'sets')).toBe('Apply 95 to all sets');
    expect(applyToAllLabel(' 8 ', 'working sets')).toBe('Apply 8 to all working sets');
    expect(applyToAllLabel('40', 'warm-ups')).toBe('Apply 40 to all warm-ups');
  });
});

describe('the offer on the keyboard bar', () => {
  beforeEach(() => resetApplyOffer());

  it('is withdrawn only by the cell that made it', () => {
    setApplyOffer({ key: 'a', label: 'Apply 1 to all sets', apply: () => {} });
    // Focus moved to b before a's blur was handled.
    setApplyOffer({ key: 'b', label: 'Apply 2 to all sets', apply: () => {} });
    clearApplyOffer('a');
    expect(getApplyOffer()?.key).toBe('b');
    clearApplyOffer('b');
    expect(getApplyOffer()).toBeNull();
  });

  it('tells subscribers when it changes', () => {
    const seen = jest.fn();
    subscribeApplyOffer(seen);
    setApplyOffer({ key: 'a', label: 'x', apply: () => {} });
    clearApplyOffer('a');
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
