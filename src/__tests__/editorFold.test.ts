import { foldedRowCount, isRowFolded, moreOptionsLabel } from '../utils/editorFold';

const closed = { moreOpen: false, searching: false, revealed: new Set<string>() };

describe('isRowFolded', () => {
  it('never folds a row that is not tagged fold', () => {
    expect(isRowFolded({ key: 'date' }, closed)).toBe(false);
    expect(isRowFolded({ key: 'date', set: false }, closed)).toBe(false);
  });

  it('folds a tagged row with no value', () => {
    expect(isRowFolded({ key: 'phone', fold: true, set: false }, closed)).toBe(true);
    expect(isRowFolded({ key: 'phone', fold: true }, closed)).toBe(true);
  });

  it('keeps a tagged row on show when the task holds a value for it', () => {
    expect(isRowFolded({ key: 'phone', fold: true, set: true }, closed)).toBe(false);
  });

  it('shows everything while More options is open', () => {
    expect(isRowFolded({ key: 'phone', fold: true }, { ...closed, moreOpen: true })).toBe(false);
  });

  it('shows folded rows to a search, which filters them itself', () => {
    expect(isRowFolded({ key: 'phone', fold: true }, { ...closed, searching: true })).toBe(false);
  });

  it('keeps a row that was already on screen this session', () => {
    const revealed = new Set(['phone']);
    expect(isRowFolded({ key: 'phone', fold: true, set: false }, { ...closed, revealed })).toBe(false);
    expect(isRowFolded({ key: 'email', fold: true, set: false }, { ...closed, revealed })).toBe(true);
  });
});

describe('foldedRowCount', () => {
  it('counts only folded rows with nothing in them', () => {
    expect(foldedRowCount([
      { key: 'date' },
      { key: 'phone', fold: true },
      { key: 'email', fold: true, set: true },
      { key: 'link', fold: true, set: false },
    ])).toBe(2);
  });
});

describe('moreOptionsLabel', () => {
  it('says how many are hidden, and flips when open', () => {
    expect(moreOptionsLabel(9, false)).toBe('More options (9 hidden)');
    expect(moreOptionsLabel(1, false)).toBe('More options (1 hidden)');
    expect(moreOptionsLabel(9, true)).toBe('Fewer options');
  });
});
