import {
  filterCategories,
  optionLabel,
  resolveCategorySubmit,
  type CategoryOption,
} from '../utils/categoryPicker';

const opts = (...names: string[]): CategoryOption[] =>
  names.map(name => ({ name, emoji: null }));

const named = (os: CategoryOption[]) => os.map(o => o.name);

describe('optionLabel', () => {
  it('prefixes the emoji when there is one', () => {
    expect(optionLabel({ name: 'Leftovers', emoji: '🍕' })).toBe('🍕 Leftovers');
  });

  it('is just the name otherwise', () => {
    expect(optionLabel({ name: 'Work', emoji: null })).toBe('Work');
  });
});

describe('filterCategories', () => {
  const all = [
    { name: 'Calendar Events', emoji: '📅' },
    { name: 'Leftovers', emoji: '🍕' },
    { name: 'Expiring Groceries', emoji: '🥕' },
    { name: 'Work', emoji: null },
    { name: 'Homework', emoji: null },
  ];

  it('lists everything, in the given order, with no query', () => {
    const r = filterCategories(all, '');
    expect(named(r.matches)).toEqual([
      'Calendar Events', 'Leftovers', 'Expiring Groceries', 'Work', 'Homework',
    ]);
    expect(r.exact).toBeNull();
    expect(r.noMatches).toBe(false);
  });

  it('treats whitespace as no query', () => {
    expect(filterCategories(all, '   ').matches).toHaveLength(all.length);
  });

  it('matches anywhere in the name, case-insensitively', () => {
    expect(named(filterCategories(all, 'work').matches)).toEqual(['Work', 'Homework']);
    expect(named(filterCategories(all, 'GROCER').matches)).toEqual(['Expiring Groceries']);
  });

  it('keeps the original order rather than ranking matches', () => {
    expect(named(filterCategories(all, 'e').matches)).toEqual([
      'Calendar Events', 'Leftovers', 'Expiring Groceries', 'Homework',
    ]);
  });

  it('matches the emoji as well as the name', () => {
    expect(named(filterCategories(all, '🍕').matches)).toEqual(['Leftovers']);
  });

  it('reports an exact name match so creating a duplicate can be refused', () => {
    expect(filterCategories(all, 'work').exact?.name).toBe('Work');
    // A substring of a longer name is not exact, even though both match.
    expect(filterCategories(all, 'home')?.exact).toBeNull();
  });

  it('flags a query that matched nothing', () => {
    const r = filterCategories(all, 'Garden');
    expect(r.matches).toEqual([]);
    expect(r.noMatches).toBe(true);
  });

  it('handles an empty set', () => {
    const r = filterCategories([], 'anything');
    expect(r.matches).toEqual([]);
    expect(r.exact).toBeNull();
    expect(r.noMatches).toBe(true);
  });
});

describe('resolveCategorySubmit', () => {
  const submit = (all: CategoryOption[], text: string, canCreate = true) =>
    resolveCategorySubmit(filterCategories(all, text), { text, canCreate });

  it('does nothing on an empty field', () => {
    expect(submit(opts('Work'), '')).toEqual({ action: 'none' });
    expect(submit(opts('Work'), '  ')).toEqual({ action: 'none' });
  });

  it('picks the exact match ahead of creating a duplicate', () => {
    expect(submit(opts('Work', 'Homework'), 'Work')).toEqual({ action: 'pick', name: 'Work' });
  });

  it('picks the only match', () => {
    expect(submit(opts('Work', 'Home'), 'ho')).toEqual({ action: 'pick', name: 'Home' });
  });

  it('waits while several still match', () => {
    expect(submit(opts('Work', 'Homework'), 'wo')).toEqual({ action: 'none' });
  });

  it('creates when nothing matches', () => {
    expect(submit(opts('Work'), 'Garden')).toEqual({ action: 'create', name: 'Garden' });
  });

  it('creates the trimmed name', () => {
    expect(submit(opts('Work'), '  Garden  ')).toEqual({ action: 'create', name: 'Garden' });
  });

  it('does nothing when the host does not allow creating', () => {
    expect(submit(opts('Work'), 'Garden', false)).toEqual({ action: 'none' });
  });
});
