import type { SavedView } from '../types';
import { useSavedViewStore } from '../store/useSavedViewStore';
import {
  dbBatchUpdateSavedViewSortOrders,
  dbDeleteSavedView,
  dbGetAllSavedViews,
  dbInsertSavedView,
  dbNextSavedViewSortOrder,
  dbUpdateSavedView,
} from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllSavedViews: jest.fn().mockReturnValue([]),
  dbInsertSavedView: jest.fn(),
  dbUpdateSavedView: jest.fn(),
  dbDeleteSavedView: jest.fn(),
  dbNextSavedViewSortOrder: jest.fn().mockReturnValue(1),
  dbBatchUpdateSavedViewSortOrders: jest.fn(),
}));

const view = (id: string, name: string, sortOrder: number): SavedView => ({
  id,
  name,
  icon: 'bookmark-outline',
  clauses: [],
  sortOrder,
  createdAt: '2026-09-15T10:00:00.000Z',
});

function seed(views: SavedView[]) {
  useSavedViewStore.setState({ views, initialized: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  (dbNextSavedViewSortOrder as jest.Mock).mockReturnValue(1);
  useSavedViewStore.setState({ views: [], initialized: false });
});

describe('initialize', () => {
  it('replaces state wholesale, so a database swap cannot leave stale rows', () => {
    seed([view('stale', 'From the real database', 1)]);
    (dbGetAllSavedViews as jest.Mock).mockReturnValue([view('fresh', 'From the demo one', 1)]);
    useSavedViewStore.getState().initialize();
    expect(useSavedViewStore.getState().views.map(v => v.id)).toEqual(['fresh']);
    expect(useSavedViewStore.getState().initialized).toBe(true);
  });
});

describe('createView', () => {
  it('writes the row before the state, and returns what it made', () => {
    (dbNextSavedViewSortOrder as jest.Mock).mockReturnValue(4);
    const created = useSavedViewStore.getState().createView('Quick wins');
    expect(created.name).toBe('Quick wins');
    expect(created.sortOrder).toBe(4);
    expect(dbInsertSavedView).toHaveBeenCalledWith(created);
    expect(useSavedViewStore.getState().views).toEqual([created]);
  });

  it('defaults the icon and starts with no clauses', () => {
    const created = useSavedViewStore.getState().createView('Everything');
    expect(created.icon).toBe('bookmark-outline');
    expect(created.clauses).toEqual([]);
  });

  it('takes the next slot from the database, not from loaded state', () => {
    (dbNextSavedViewSortOrder as jest.Mock).mockReturnValue(9);
    const created = useSavedViewStore.getState().createView('Errands');
    expect(created.sortOrder).toBe(9);
  });
});

describe('updateView', () => {
  it('patches the row and the state together', () => {
    seed([view('v1', 'Errands', 1)]);
    useSavedViewStore.getState().updateView('v1', {
      name: 'Errands nearby',
      clauses: [{ kind: 'tag', values: ['errand'] }],
    });
    expect(dbUpdateSavedView).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'v1', name: 'Errands nearby' })
    );
    expect(useSavedViewStore.getState().views[0].clauses).toEqual([
      { kind: 'tag', values: ['errand'] },
    ]);
  });

  it('does nothing for an id it does not hold', () => {
    seed([view('v1', 'Errands', 1)]);
    useSavedViewStore.getState().updateView('gone', { name: 'Nope' });
    expect(dbUpdateSavedView).not.toHaveBeenCalled();
  });
});

describe('reorderViews', () => {
  it('renumbers from one in the given order, in a single batch', () => {
    seed([view('a', 'A', 1), view('b', 'B', 2), view('c', 'C', 3)]);
    useSavedViewStore.getState().reorderViews(['c', 'a', 'b']);
    expect(dbBatchUpdateSavedViewSortOrders).toHaveBeenCalledWith([
      { id: 'c', sortOrder: 1 },
      { id: 'a', sortOrder: 2 },
      { id: 'b', sortOrder: 3 },
    ]);
    expect(useSavedViewStore.getState().views.map(v => v.id)).toEqual(['c', 'a', 'b']);
    expect(useSavedViewStore.getState().views.map(v => v.sortOrder)).toEqual([1, 2, 3]);
  });

  // A partial order would renumber a subset and leave the rest colliding with
  // it, so it is refused rather than half-applied.
  it('refuses an order that does not name every view', () => {
    seed([view('a', 'A', 1), view('b', 'B', 2)]);
    useSavedViewStore.getState().reorderViews(['a']);
    expect(dbBatchUpdateSavedViewSortOrders).not.toHaveBeenCalled();
    expect(useSavedViewStore.getState().views.map(v => v.id)).toEqual(['a', 'b']);
  });

  it('refuses an order naming a view it does not hold', () => {
    seed([view('a', 'A', 1), view('b', 'B', 2)]);
    useSavedViewStore.getState().reorderViews(['a', 'ghost']);
    expect(dbBatchUpdateSavedViewSortOrders).not.toHaveBeenCalled();
  });
});

describe('removeView and restoreView', () => {
  it('deletes the row and drops it from state', () => {
    seed([view('a', 'A', 1), view('b', 'B', 2)]);
    useSavedViewStore.getState().removeView('a');
    expect(dbDeleteSavedView).toHaveBeenCalledWith('a');
    expect(useSavedViewStore.getState().views.map(v => v.id)).toEqual(['b']);
  });

  it('puts a restored view back in its own slot rather than at the end', () => {
    seed([view('b', 'B', 2)]);
    useSavedViewStore.getState().restoreView(view('a', 'A', 1));
    expect(dbInsertSavedView).toHaveBeenCalled();
    expect(useSavedViewStore.getState().views.map(v => v.id)).toEqual(['a', 'b']);
  });
});

describe('getViewById', () => {
  it('finds a view, and answers null rather than undefined for a miss', () => {
    seed([view('a', 'A', 1)]);
    expect(useSavedViewStore.getState().getViewById('a')?.name).toBe('A');
    expect(useSavedViewStore.getState().getViewById('gone')).toBeNull();
  });
});
