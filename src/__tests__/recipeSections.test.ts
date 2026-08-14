import {
  allSectionsOf,
  parseEmptySections,
  resolveSectionDrop,
  sectionsOf,
  type SectionedRow,
} from '../utils/recipeSections';

const row = (id: string, section: string | null = null): SectionedRow => ({ id, section });

/** Moves `id` to `to` (index in the resulting array), the way one drag does. */
function move(rows: readonly SectionedRow[], id: string, to: number): SectionedRow[] {
  const next = rows.filter(r => r.id !== id);
  next.splice(to, 0, rows.find(r => r.id === id)!);
  return next;
}

describe('resolveSectionDrop', () => {
  const cake = 'For the cake';
  const frosting = 'For the frosting';

  // flour, butter | sugar, cream
  const list = [row('flour', cake), row('butter', cake), row('sugar', frosting), row('cream', frosting)];

  it('files a row dragged down into the section it lands in', () => {
    expect(resolveSectionDrop(list, move(list, 'flour', 2))).toEqual({ id: 'flour', section: frosting });
  });

  it('files a row dragged up into the section it lands in', () => {
    expect(resolveSectionDrop(list, move(list, 'cream', 1))).toEqual({ id: 'cream', section: cake });
  });

  it('takes a row dropped at the very top out of every section', () => {
    expect(resolveSectionDrop(list, move(list, 'sugar', 0))).toEqual({ id: 'sugar', section: null });
  });

  it('says nothing for a move inside one section', () => {
    expect(resolveSectionDrop(list, move(list, 'butter', 0))).toBeNull();
  });

  it('keeps a row in its own section when it lands on that section\'s edge', () => {
    // cream above sugar makes cream the *first* frosting row, so the row above
    // it is the cake's — but it's still touching the frosting, and pulling it
    // into the cake is not what reordering two rows means.
    expect(resolveSectionDrop(list, move(list, 'cream', 2))).toBeNull();
    // Same at the top of the list: butter reordered above flour is still cake.
    expect(resolveSectionDrop(list, move(list, 'butter', 0))).toBeNull();
  });

  it('says nothing when the order is unchanged', () => {
    expect(resolveSectionDrop(list, [...list])).toBeNull();
  });

  it('leaves a recipe with no sections alone, whatever is dragged where', () => {
    const plain = [row('a'), row('b'), row('c')];
    expect(resolveSectionDrop(plain, move(plain, 'c', 0))).toBeNull();
    expect(resolveSectionDrop(plain, move(plain, 'a', 2))).toBeNull();
  });

  it('joins the run above when it lands between two sections it is in neither of', () => {
    const withThird = [...list, row('sprinkles', 'To finish')];
    expect(resolveSectionDrop(withThird, move(withThird, 'sprinkles', 2)))
      .toEqual({ id: 'sprinkles', section: cake });
  });

  it('files a row dragged to the very bottom into the last section', () => {
    expect(resolveSectionDrop(list, move(list, 'flour', 3))).toEqual({ id: 'flour', section: frosting });
  });

  it('declines anything that is not a single reinsertion', () => {
    expect(resolveSectionDrop(list, [])).toBeNull();
    expect(resolveSectionDrop(list, list.slice(0, 3))).toBeNull();
    // Two rows swapped at opposite ends is not a drag, and guessing which one
    // was the subject is exactly what this refuses to do.
    const shuffled = [list[3], list[1], list[2], list[0]];
    expect(resolveSectionDrop(list, shuffled)).toBeNull();
  });

  it('declines a one-row list, which has nothing to land under', () => {
    expect(resolveSectionDrop([row('only', cake)], [row('only', cake)])).toBeNull();
  });
});

describe('sectionsOf', () => {
  it('lists each section once, in list order', () => {
    expect(sectionsOf([
      row('a', 'For the cake'),
      row('b', null),
      row('c', 'For the frosting'),
      row('d', 'For the cake'),
    ])).toEqual(['For the cake', 'For the frosting']);
  });

  it('is empty for a recipe with no sections', () => {
    expect(sectionsOf([row('a'), row('b')])).toEqual([]);
  });
});

describe('allSectionsOf', () => {
  it('appends declared-but-empty headings after the ones rows already use', () => {
    const rows = [row('a', 'For the cake'), row('b', null)];
    expect(allSectionsOf(rows, ['For serving', 'For the cake']))
      .toEqual(['For the cake', 'For serving']);
  });

  it('is just the declared list when no row has a section yet', () => {
    expect(allSectionsOf([row('a'), row('b')], ['For serving'])).toEqual(['For serving']);
  });

  it('is just the used sections when nothing is declared', () => {
    const rows = [row('a', 'For the cake')];
    expect(allSectionsOf(rows, [])).toEqual(['For the cake']);
  });
});

describe('parseEmptySections', () => {
  it('parses a stored JSON array', () => {
    expect(parseEmptySections('["For serving","For the cake"]'))
      .toEqual(['For serving', 'For the cake']);
  });

  it('tolerates a null column, garbage, and a non-array shape', () => {
    expect(parseEmptySections(null)).toEqual([]);
    expect(parseEmptySections('not json')).toEqual([]);
    expect(parseEmptySections('{"a":1}')).toEqual([]);
  });

  it('drops non-strings, trims, and dedupes', () => {
    expect(parseEmptySections(JSON.stringify(['  For serving  ', 'For serving', 42, ''])))
      .toEqual(['For serving']);
  });
});
