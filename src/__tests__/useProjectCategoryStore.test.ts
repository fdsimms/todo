import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import {
  dbGetAllProjectCategories,
  dbInsertProjectCategory,
  dbInsertProjectCategoryRow,
  dbDeleteProjectCategory,
  dbRenameProjectCategory,
  dbBatchUpdateProjectCategorySortOrders,
} from '../db/database';
import type { ProjectCategory } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllProjectCategories: jest.fn().mockReturnValue([]),
  dbInsertProjectCategory: jest.fn(),
  dbInsertProjectCategoryRow: jest.fn(),
  dbDeleteProjectCategory: jest.fn(),
  dbRenameProjectCategory: jest.fn(),
  dbBatchUpdateProjectCategorySortOrders: jest.fn(),
}));

const cat = (name: string, sortOrder: number, id = `c-${name}`): ProjectCategory => ({ id, name, sortOrder });

const seed = (...categories: ProjectCategory[]) => {
  useProjectCategoryStore.setState({ categories, initialized: true });
};

beforeEach(() => {
  jest.clearAllMocks();
  useProjectCategoryStore.setState({ categories: [], initialized: false });
});

describe('addCategory', () => {
  it('inserts a new name and keeps the row it is handed back', () => {
    (dbInsertProjectCategory as jest.Mock).mockReturnValue(cat('Travel', 1));
    const created = useProjectCategoryStore.getState().addCategory('Travel');
    expect(created.name).toBe('Travel');
    expect(useProjectCategoryStore.getState().categories.map(c => c.name)).toEqual(['Travel']);
  });

  it('is a no-op on a name that already exists', () => {
    seed(cat('Travel', 1));
    const existing = useProjectCategoryStore.getState().addCategory('Travel');
    expect(existing.id).toBe('c-Travel');
    expect(dbInsertProjectCategory).not.toHaveBeenCalled();
    expect(useProjectCategoryStore.getState().categories).toHaveLength(1);
  });
});

describe('renameCategory', () => {
  it('renames the row and reports success', () => {
    seed(cat('Trvael', 1));
    expect(useProjectCategoryStore.getState().renameCategory('Trvael', 'Travel')).toBe(true);
    expect(dbRenameProjectCategory).toHaveBeenCalledWith('c-Trvael', 'Trvael', 'Travel');
    expect(useProjectCategoryStore.getState().categories[0].name).toBe('Travel');
  });

  it('trims before writing', () => {
    seed(cat('Travel', 1));
    useProjectCategoryStore.getState().renameCategory('Travel', '  Trips  ');
    expect(dbRenameProjectCategory).toHaveBeenCalledWith('c-Travel', 'Travel', 'Trips');
  });

  // Project.category stores the *name*, so a collision would silently merge two
  // sections into one rather than rename either. The caller keeps its field
  // open on a false and says the name is taken.
  it('refuses a name another category already has', () => {
    seed(cat('Travel', 1), cat('Home', 2));
    expect(useProjectCategoryStore.getState().renameCategory('Home', 'Travel')).toBe(false);
    expect(dbRenameProjectCategory).not.toHaveBeenCalled();
    expect(useProjectCategoryStore.getState().categories.map(c => c.name)).toEqual(['Travel', 'Home']);
  });

  it('refuses a blank name, an unchanged one, and one that is not there', () => {
    seed(cat('Travel', 1));
    expect(useProjectCategoryStore.getState().renameCategory('Travel', '   ')).toBe(false);
    expect(useProjectCategoryStore.getState().renameCategory('Travel', 'Travel')).toBe(false);
    expect(useProjectCategoryStore.getState().renameCategory('Missing', 'Travel')).toBe(false);
    expect(dbRenameProjectCategory).not.toHaveBeenCalled();
  });
});

describe('removeCategoryRow / restoreCategory', () => {
  it('drops the row, and the db call unfiles the projects in it', () => {
    seed(cat('Travel', 1), cat('Home', 2));
    useProjectCategoryStore.getState().removeCategoryRow('Travel');
    expect(dbDeleteProjectCategory).toHaveBeenCalledWith('Travel');
    expect(useProjectCategoryStore.getState().categories.map(c => c.name)).toEqual(['Home']);
  });

  it('restores a snapshot back into its own place in the order', () => {
    const travel = cat('Travel', 1);
    seed(cat('Home', 2), cat('Ideas', 3));
    useProjectCategoryStore.getState().restoreCategory(travel);
    expect(dbInsertProjectCategoryRow).toHaveBeenCalledWith(travel);
    // Not appended: the snapshot carries the sortOrder it had, so an undo puts
    // the section back where it was rather than at the bottom.
    expect(useProjectCategoryStore.getState().categories.map(c => c.name)).toEqual(['Travel', 'Home', 'Ideas']);
  });
});

describe('reorderCategories', () => {
  it('renumbers to the given order and re-sorts the store', () => {
    seed(cat('Travel', 1), cat('Home', 2), cat('Ideas', 3));
    useProjectCategoryStore.getState().reorderCategories(['Ideas', 'Travel', 'Home']);
    expect(dbBatchUpdateProjectCategorySortOrders).toHaveBeenCalledWith([
      { id: 'c-Ideas', sortOrder: 0 },
      { id: 'c-Travel', sortOrder: 1 },
      { id: 'c-Home', sortOrder: 2 },
    ]);
    expect(useProjectCategoryStore.getState().categories.map(c => c.name)).toEqual(['Ideas', 'Travel', 'Home']);
  });

  it('ignores a name with no row behind it rather than writing a gap', () => {
    seed(cat('Travel', 1), cat('Home', 2));
    useProjectCategoryStore.getState().reorderCategories(['Home', 'Ghost', 'Travel']);
    expect(dbBatchUpdateProjectCategorySortOrders).toHaveBeenCalledWith([
      { id: 'c-Home', sortOrder: 0 },
      { id: 'c-Travel', sortOrder: 2 },
    ]);
    expect(useProjectCategoryStore.getState().categories.map(c => c.name)).toEqual(['Home', 'Travel']);
  });

  it('writes nothing when none of the names resolve', () => {
    seed(cat('Travel', 1));
    useProjectCategoryStore.getState().reorderCategories(['Ghost']);
    expect(dbBatchUpdateProjectCategorySortOrders).not.toHaveBeenCalled();
  });
});

describe('initialize', () => {
  it('loads whatever the db hands back', () => {
    (dbGetAllProjectCategories as jest.Mock).mockReturnValue([cat('Travel', 1)]);
    useProjectCategoryStore.getState().initialize();
    expect(useProjectCategoryStore.getState().categories.map(c => c.name)).toEqual(['Travel']);
    expect(useProjectCategoryStore.getState().initialized).toBe(true);
  });
});

describe('getCategoryByName', () => {
  it('finds a row by name, and answers null for one that is not there', () => {
    seed(cat('Travel', 1));
    expect(useProjectCategoryStore.getState().getCategoryByName('Travel')?.id).toBe('c-Travel');
    expect(useProjectCategoryStore.getState().getCategoryByName('Missing')).toBeNull();
  });
});
