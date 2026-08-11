import { activeChainStep, parseChainItems, chainPreview, isChainFinish } from '../utils/chain';
import type { ChainItem } from '../types';

const step = (title: string, estimatedMinutes: number | null = null): ChainItem =>
  ({ id: title, title, estimatedMinutes });

describe('activeChainStep', () => {
  const items = [step('Warm up', 5), step('Main set', 45), step('Cool down')];

  it('returns the step at chainIndex', () => {
    expect(activeChainStep({ chainEnabled: true, chainIndex: 1, chainItems: items })?.title).toBe('Main set');
  });

  it('wraps past the end, the way a repeating chain resets', () => {
    expect(activeChainStep({ chainEnabled: true, chainIndex: 3, chainItems: items })?.title).toBe('Warm up');
    expect(activeChainStep({ chainEnabled: true, chainIndex: 7, chainItems: items })?.title).toBe('Main set');
  });

  it('is null when the chain is off', () => {
    expect(activeChainStep({ chainEnabled: false, chainIndex: 1, chainItems: items })).toBeNull();
  });

  it('is null for a single-item chain — it reads as a plain task everywhere else', () => {
    expect(activeChainStep({ chainEnabled: true, chainIndex: 0, chainItems: [step('Only')] })).toBeNull();
  });

  it('is null for an empty chain, and for a caller carrying no chain fields at all', () => {
    expect(activeChainStep({ chainEnabled: true, chainIndex: 0, chainItems: [] })).toBeNull();
    expect(activeChainStep({})).toBeNull();
  });

  it('defaults a missing index to the first step', () => {
    expect(activeChainStep({ chainEnabled: true, chainItems: items })?.title).toBe('Warm up');
  });
});

describe('chainPreview', () => {
  const items = [step('Put laundry in washers'), step('Remove non-dry items'), step('Fold laundry')];

  it('leads with the current step and previews the next one', () => {
    expect(chainPreview({ chainIndex: 1, chainItems: items })).toEqual({
      currentIdx: 1,
      total: 3,
      currentTitle: 'Remove non-dry items',
      nextTitle: 'Fold laundry',
    });
  });

  it('has no next title when the current step is the last one', () => {
    expect(chainPreview({ chainIndex: 2, chainItems: items })).toEqual({
      currentIdx: 2,
      total: 3,
      currentTitle: 'Fold laundry',
      nextTitle: null,
    });
  });

  it('never surfaces a step before the current one, finished or not', () => {
    const preview = chainPreview({ chainIndex: 1, chainItems: items });
    expect(preview?.currentTitle).not.toBe('Put laundry in washers');
    expect(preview?.nextTitle).not.toBe('Put laundry in washers');
  });

  it('wraps the index past the end, the way a repeating chain resets', () => {
    expect(chainPreview({ chainIndex: 3, chainItems: items })?.currentTitle).toBe('Put laundry in washers');
  });

  it('is null for an empty chain', () => {
    expect(chainPreview({ chainIndex: 0, chainItems: [] })).toBeNull();
  });

  it('defaults a missing index to the first step', () => {
    expect(chainPreview({ chainItems: items })?.currentTitle).toBe('Put laundry in washers');
  });
});

describe('isChainFinish', () => {
  const items = [step('Warm up'), step('Main set'), step('Cool down')];

  it('is true on the last step of a chain with no Repeat', () => {
    expect(isChainFinish({ chainEnabled: true, chainIndex: 2, chainItems: items, recurrenceType: 'none' })).toBe(true);
  });

  it('is false mid-chain — that step spawns the next one, it does not finish anything', () => {
    expect(isChainFinish({ chainEnabled: true, chainIndex: 0, chainItems: items, recurrenceType: 'none' })).toBe(false);
    expect(isChainFinish({ chainEnabled: true, chainIndex: 1, chainItems: items, recurrenceType: 'none' })).toBe(false);
  });

  it('is false on the last step when Repeat is set — the chain loops instead of ending', () => {
    expect(isChainFinish({ chainEnabled: true, chainIndex: 2, chainItems: items, recurrenceType: 'daily' })).toBe(false);
  });

  it('is false when the chain is off, or carries no items', () => {
    expect(isChainFinish({ chainEnabled: false, chainIndex: 2, chainItems: items, recurrenceType: 'none' })).toBe(false);
    expect(isChainFinish({ chainEnabled: true, chainIndex: 0, chainItems: [], recurrenceType: 'none' })).toBe(false);
    expect(isChainFinish({})).toBe(false);
  });

  it('defaults a missing recurrenceType to none, like a task carrying no chain fields at all would read', () => {
    expect(isChainFinish({ chainEnabled: true, chainIndex: 2, chainItems: items })).toBe(true);
  });
});

describe('parseChainItems', () => {
  it('fills in a null estimate for rows stored before the field existed', () => {
    expect(parseChainItems([{ id: 'c1', title: 'Stretch' }])).toEqual([
      { id: 'c1', title: 'Stretch', estimatedMinutes: null },
    ]);
  });

  it('keeps a stored estimate', () => {
    expect(parseChainItems([{ id: 'c1', title: 'Stretch', estimatedMinutes: 5 }])).toEqual([
      { id: 'c1', title: 'Stretch', estimatedMinutes: 5 },
    ]);
  });

  it('coerces a non-numeric estimate to null rather than passing it through', () => {
    expect(parseChainItems([{ id: 'c1', title: 'Stretch', estimatedMinutes: '5' }])[0].estimatedMinutes).toBeNull();
  });

  it('returns an empty list for anything that is not an array', () => {
    expect(parseChainItems(undefined)).toEqual([]);
    expect(parseChainItems(null)).toEqual([]);
    expect(parseChainItems('[]')).toEqual([]);
  });
});
