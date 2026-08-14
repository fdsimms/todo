import {
  allSectionsOf,
  parseEmptySections,
  sectionsFromMergedOrder,
  sectionsOf,
  type SectionedRow,
  type SectionListEntry,
} from '../utils/recipeSections';

const row = (id: string, section: string | null = null): SectionedRow => ({ id, section });

describe('sectionsFromMergedOrder', () => {
  const cake = 'For the cake';
  const frosting = 'For the frosting';
  const heading = (name: string): SectionListEntry => ({ kind: 'heading', name });
  const item = (id: string): SectionListEntry => ({ kind: 'row', id });

  it('assigns every row the nearest heading before it', () => {
    const entries = [
      heading(cake), item('flour'), item('butter'),
      heading(frosting), item('sugar'), item('cream'),
    ];
    expect(sectionsFromMergedOrder(entries)).toEqual(new Map([
      ['flour', cake], ['butter', cake], ['sugar', frosting], ['cream', frosting],
    ]));
  });

  it('gives rows before the first heading no section', () => {
    const entries = [item('a'), heading(cake), item('b')];
    expect(sectionsFromMergedOrder(entries)).toEqual(new Map([['a', null], ['b', cake]]));
  });

  it('is entirely null when the list has no headings at all', () => {
    const entries = [item('a'), item('b')];
    expect(sectionsFromMergedOrder(entries)).toEqual(new Map([['a', null], ['b', null]]));
  });

  it('files a row after an empty heading exactly like a populated one', () => {
    // A declared-but-empty heading is just another marker in the same list —
    // nothing about the derivation cares whether it started with members.
    const entries = [heading(cake), item('flour'), heading('For serving'), item('candles')];
    expect(sectionsFromMergedOrder(entries).get('candles')).toBe('For serving');
  });

  it('leaves a heading with nothing after it before the next marker unused', () => {
    // Every ingredient moved out from under "For the frosting" — the marker is
    // still in the list (it's up to the caller to decide whether that renders
    // as a heading at all; this function just reports no row claimed it).
    const entries = [heading(cake), item('flour'), heading(frosting), heading('For serving'), item('candles')];
    const result = sectionsFromMergedOrder(entries);
    expect([...result.values()]).not.toContain(frosting);
    expect(result.get('candles')).toBe('For serving');
  });

  it('a row can move between two headings by changing which one precedes it', () => {
    // "cream" reassigned from frosting to cake by nothing but its new position.
    const entries = [heading(cake), item('flour'), item('cream'), heading(frosting), item('sugar')];
    expect(sectionsFromMergedOrder(entries).get('cream')).toBe(cake);
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
