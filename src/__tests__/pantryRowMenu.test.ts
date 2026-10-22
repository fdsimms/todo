import { pantryRowChip, pantryRowMenu, type PantryRowFacts } from '../utils/pantryRowMenu';

const item = (over: Partial<PantryRowFacts> = {}): PantryRowFacts => ({
  kind: 'grocery', portion: false, low: false, opened: false, frozen: false, ...over,
});

describe('pantryRowChip', () => {
  it('reads Low for an item running low and Have it otherwise', () => {
    expect(pantryRowChip(item())).toBe('have');
    expect(pantryRowChip(item({ low: true }))).toBe('low');
  });

  it('never reads Low for a box, whatever the flag says', () => {
    expect(pantryRowChip(item({ kind: 'product', low: true }))).toBe('have');
  });
});

describe('pantryRowMenu', () => {
  const keys = (f: PantryRowFacts) => pantryRowMenu(f).map(e => e.key);

  it('splits out of it into used it up and went bad for an item', () => {
    expect(keys(item())).toEqual([
      'have', 'low', 'usedUp', 'spoiled', 'boughtMore', 'opened', 'freeze',
    ]);
  });

  it('offers the way back for whatever is already set', () => {
    expect(keys(item({ low: true, opened: true, frozen: true }))).toEqual([
      'have', 'clearLow', 'usedUp', 'spoiled', 'boughtMore', 'unopened', 'thaw',
    ]);
  });

  it('gives a box one plain out, with no answer it would drop', () => {
    expect(keys(item({ kind: 'product' }))).toEqual(['opened', 'freeze', 'out']);
  });

  it('gives a portion only the one way to finish it', () => {
    expect(pantryRowMenu(item({ kind: 'product', portion: true }))).toEqual([
      { key: 'out', label: 'Used up' },
    ]);
  });
});
