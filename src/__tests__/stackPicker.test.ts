import { filterStacks, stackRows, STACK_PICKER_COLLAPSED_ROWS, type StackOption } from '../utils/stackPicker';

const make = (n: number): StackOption[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Stack ${i}`, category: i % 2 ? 'Health' : 'Home' }));

describe('filterStacks', () => {
  const options: StackOption[] = [
    { id: 'a', title: 'Questions for Dr. Zia', category: 'Health' },
    { id: 'b', title: 'Tidy up', category: 'Home' },
    { id: 'c', title: 'Books', category: null },
  ];

  it('returns everything, in order, for an empty query', () => {
    expect(filterStacks(options, '  ')).toEqual(options);
  });

  it('matches the name or the category, ignoring case', () => {
    expect(filterStacks(options, 'ZIA').map(o => o.id)).toEqual(['a']);
    expect(filterStacks(options, 'home').map(o => o.id)).toEqual(['b']);
  });

  it('does not re-rank what is left', () => {
    expect(filterStacks(options, 'o').map(o => o.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('stackRows', () => {
  it('caps the list and says how many are hidden', () => {
    const r = stackRows(make(24), null, '', false);
    expect(r.rows).toHaveLength(STACK_PICKER_COLLAPSED_ROWS);
    expect(r.hidden).toBe(24 - STACK_PICKER_COLLAPSED_ROWS);
  });

  it('shows everything once expanded', () => {
    const r = stackRows(make(24), null, '', true);
    expect(r.rows).toHaveLength(24);
    expect(r.hidden).toBe(0);
  });

  it('pins the chosen stack even when it is past the cap, without listing it twice', () => {
    const r = stackRows(make(24), 's20', '', false);
    expect(r.pinned?.id).toBe('s20');
    expect(r.rows.map(o => o.id)).not.toContain('s20');
    expect(r.rows).toHaveLength(STACK_PICKER_COLLAPSED_ROWS);
    expect(r.hidden).toBe(23 - STACK_PICKER_COLLAPSED_ROWS);
  });

  it('lists every match while searching, with nothing pinned', () => {
    const r = stackRows(make(24), 's3', 'stack', false);
    expect(r.pinned).toBeNull();
    expect(r.rows).toHaveLength(24);
    expect(r.hidden).toBe(0);
  });

  it('hides nothing when the list already fits', () => {
    const r = stackRows(make(STACK_PICKER_COLLAPSED_ROWS), null, '', false);
    expect(r.hidden).toBe(0);
  });
});
