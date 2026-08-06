import { useCategoryStore } from '../store/useCategoryStore';
import type { Category } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllCategories: jest.fn().mockReturnValue([]),
  dbInsertCategory: jest.fn((name: string) => ({
    id: `c-${name}`,
    name,
    scheduleDays: null,
    scheduleStart: null,
    scheduleEnd: null,
    hideOnVacation: false,
    excludeFromPinSuggestions: false,
    sortOrder: 1,
    emoji: null,
  })),
  dbInsertCategoryRow: jest.fn(),
  dbUpdateCategory: jest.fn(),
  dbDeleteCategory: jest.fn(),
  dbRenameCategory: jest.fn(),
  dbSetCategoryHideOnVacation: jest.fn(),
  dbSetCategoryExcludeFromPinSuggestions: jest.fn(),
  dbSetCategoryEmoji: jest.fn(),
  dbBatchUpdateCategorySortOrders: jest.fn(),
}));

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'c1',
    name: 'Work',
    scheduleDays: null,
    scheduleStart: null,
    scheduleEnd: null,
    hideOnVacation: false,
    excludeFromPinSuggestions: false,
    sortOrder: 1,
    emoji: null,
    ...overrides,
  };
}

const seed = (categories: Category[]) => useCategoryStore.setState({ categories, initialized: true });

// getCategoryByName reads through a name index cached on the categories array's
// identity (it's called per task inside every visibility predicate). These
// cover the thing that caching can get wrong: serving a stale answer after a
// mutation, and disagreeing with the find() it replaced.
describe('getCategoryByName', () => {
  it('finds a category by name and returns null for an unknown one', () => {
    seed([makeCategory({ id: 'c1', name: 'Work' }), makeCategory({ id: 'c2', name: 'Home' })]);
    expect(useCategoryStore.getState().getCategoryByName('Home')?.id).toBe('c2');
    expect(useCategoryStore.getState().getCategoryByName('Nope')).toBeNull();
  });

  it('reflects a rename rather than serving the old name', () => {
    seed([makeCategory({ id: 'c1', name: 'Work' })]);
    expect(useCategoryStore.getState().getCategoryByName('Work')?.id).toBe('c1');
    useCategoryStore.getState().renameCategory('Work', 'Job');
    expect(useCategoryStore.getState().getCategoryByName('Work')).toBeNull();
    expect(useCategoryStore.getState().getCategoryByName('Job')?.id).toBe('c1');
  });

  it('reflects a deletion', () => {
    seed([makeCategory({ id: 'c1', name: 'Work' })]);
    expect(useCategoryStore.getState().getCategoryByName('Work')).not.toBeNull();
    useCategoryStore.getState().deleteCategory('Work');
    expect(useCategoryStore.getState().getCategoryByName('Work')).toBeNull();
  });

  it('reflects a field update on an existing row', () => {
    seed([makeCategory({ id: 'c1', name: 'Work' })]);
    useCategoryStore.getState().setCategoryHideOnVacation('Work', true);
    expect(useCategoryStore.getState().getCategoryByName('Work')?.hideOnVacation).toBe(true);
  });

  it('sees a newly added category', () => {
    seed([]);
    useCategoryStore.getState().addCategory('Errands');
    expect(useCategoryStore.getState().getCategoryByName('Errands')).not.toBeNull();
  });

  // Duplicate names shouldn't exist (addCategory/renameCategory both refuse
  // them), but a legacy row could — first one wins, as find() did.
  it('returns the first of a duplicated name', () => {
    seed([makeCategory({ id: 'first', name: 'Work' }), makeCategory({ id: 'second', name: 'Work' })]);
    expect(useCategoryStore.getState().getCategoryByName('Work')?.id).toBe('first');
  });
});
