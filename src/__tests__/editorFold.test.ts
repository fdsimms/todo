import { foldRows, moreLabel, moreHint, foldedSummary, type FoldRow } from '../utils/editorFold';

const row = (key: string, opts: { set?: boolean; primary?: boolean } = {}): FoldRow<string> => ({
  key,
  set: opts.set ?? false,
  primary: opts.primary,
  row: key,
});

const keys = (rows: FoldRow<string>[]) => rows.map(r => r.key);

describe('foldRows', () => {
  it('shows primary rows even when empty', () => {
    const { visible, hidden } = foldRows([
      row('date', { primary: true }),
      row('window'),
      row('target'),
    ]);
    expect(keys(visible)).toEqual(['date']);
    expect(keys(hidden)).toEqual(['window', 'target']);
  });

  describe('when only one row would be hidden', () => {
    // "1 more / Stack" costs a row and a tap to conceal a row — strictly worse
    // than just showing it.
    it('shows it instead of putting it behind a "1 more"', () => {
      const { visible, hidden } = foldRows([
        row('category', { primary: true }),
        row('stack'),
      ]);
      expect(keys(visible)).toEqual(['category', 'stack']);
      expect(hidden).toEqual([]);
    });

    it('keeps it in its authored position, not appended', () => {
      const { visible } = foldRows([
        row('stack'),
        row('category', { primary: true }),
        row('tags', { primary: true }),
      ]);
      expect(keys(visible)).toEqual(['stack', 'category', 'tags']);
    });

    it('still hides once there are two', () => {
      const { visible, hidden } = foldRows([
        row('category', { primary: true }),
        row('stack'),
        row('duration'),
      ]);
      expect(keys(visible)).toEqual(['category']);
      expect(keys(hidden)).toEqual(['stack', 'duration']);
    });

    it('counts only rows that would actually be hidden', () => {
      // Two non-primary rows, but one holds a value — so only one would be
      // concealed, and it isn't.
      const { visible, hidden } = foldRows([
        row('category', { primary: true }),
        row('stack', { set: true }),
        row('duration'),
      ]);
      expect(keys(visible)).toEqual(['category', 'stack', 'duration']);
      expect(hidden).toEqual([]);
    });
  });

  it('never hides a row that holds a value', () => {
    // The whole point: a task that uses "Waiting on" shows it without anyone
    // having to remember it's under the fold.
    const { visible, hidden } = foldRows([
      row('date', { primary: true }),
      row('waiting', { set: true }),
      row('window'),
      row('target'),
    ]);
    expect(keys(visible)).toEqual(['date', 'waiting']);
    expect(keys(hidden)).toEqual(['window', 'target']);
  });

  it('keeps the author’s order rather than hoisting set rows', () => {
    const { visible } = foldRows([
      row('date', { primary: true }),
      row('deadline', { primary: true }),
      row('waiting', { set: true }),
      row('repeat', { primary: true }),
    ]);
    expect(keys(visible)).toEqual(['date', 'deadline', 'waiting', 'repeat']);
  });

  it('folds a group where nothing is set', () => {
    expect(foldRows([row('a', { primary: true }), row('b')]).folded).toBe(true);
  });

  it('opens a group as soon as anything is set', () => {
    expect(foldRows([row('a', { primary: true }), row('b', { set: true })]).folded).toBe(false);
  });

  it('opens on a set row even when that row is not primary', () => {
    expect(foldRows([row('a'), row('b', { set: true })]).folded).toBe(false);
  });

  it('handles a group with no primary rows at all', () => {
    // The "More" group: nothing is primary, so an untouched task folds it away
    // completely.
    const result = foldRows([row('pin'), row('link'), row('vacation')]);
    expect(result.visible).toEqual([]);
    expect(keys(result.hidden)).toEqual(['pin', 'link', 'vacation']);
    expect(result.folded).toBe(true);
  });

  it('handles an empty group', () => {
    expect(foldRows([])).toEqual({ visible: [], hidden: [], folded: true });
  });

  it('leaves nothing hidden when every row is primary or set', () => {
    const { hidden } = foldRows([row('a', { primary: true }), row('b', { set: true })]);
    expect(hidden).toEqual([]);
  });
});

describe('moreLabel', () => {
  // foldRows never hands it fewer than two, so "1 more" is unreachable in the
  // app — the formatter is general, the guarantee is upstream.
  it('counts rather than naming, so the control stays one line', () => {
    expect(moreLabel(2)).toBe('2 more');
    expect(moreLabel(5)).toBe('5 more');
  });
});

describe('moreHint', () => {
  it('lists the hidden rows so you needn’t open it to find out', () => {
    expect(moreHint(['More dates', 'Time window', 'Waiting on']))
      .toBe('More dates, time window, waiting on');
  });

  it('leaves a single label alone', () => {
    expect(moreHint(['Stack'])).toBe('Stack');
  });

  it('is empty for no labels', () => {
    expect(moreHint([])).toBe('');
  });

  it('lowercases only after the first, so the line reads as a sentence', () => {
    expect(moreHint(['Pin to Today', 'Link'])).toBe('Pin to Today, link');
  });
});

describe('foldedSummary', () => {
  it('names what a folded group covers', () => {
    expect(foldedSummary(['Category', 'Project', 'Tags'])).toBe('Category, project, tags');
  });
});
