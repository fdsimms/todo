import { useMealPlanStore } from '../store/useMealPlanStore';
import {
  dbGetMealPlanEntries,
  dbInsertMealPlanEntry,
  dbUpdateMealPlanEntry,
  dbDeleteMealPlanEntry,
  dbPurgeOldMealPlanEntries,
  dbGetMealPlanAddedToList,
  dbSetMealPlanAddedToList,
} from '../db/database';
import type { MealPlanEntry, MealSlot } from '../types';

jest.mock('../db/database', () => ({
  dbGetMealPlanEntries: jest.fn().mockReturnValue([]),
  dbInsertMealPlanEntry: jest.fn(),
  dbUpdateMealPlanEntry: jest.fn(),
  dbDeleteMealPlanEntry: jest.fn(),
  dbPurgeOldMealPlanEntries: jest.fn().mockReturnValue(0),
  dbGetMealPlanAddedToList: jest.fn().mockReturnValue({}),
  dbSetMealPlanAddedToList: jest.fn(),
}));

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
function entry(
  date: string,
  slot: MealSlot,
  overrides: Partial<MealPlanEntry> = {}
): MealPlanEntry {
  seq += 1;
  return {
    id: `m-${seq}`,
    date,
    slot,
    recipeId: null,
    title: `Meal ${seq}`,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    recipeScale: 1,
    ...overrides,
  };
}

const getEntries = () => useMealPlanStore.getState().entries;

/** Loads the week of 3–9 Aug 2026 with whatever rows the db is pretending to hold. */
function loadWeek(rows: MealPlanEntry[] = []) {
  (dbGetMealPlanEntries as jest.Mock).mockReturnValue(rows);
  useMealPlanStore.getState().loadRange('2026-08-03', '2026-08-09');
  (dbGetMealPlanEntries as jest.Mock).mockReturnValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  (dbGetMealPlanEntries as jest.Mock).mockReturnValue([]);
  (dbPurgeOldMealPlanEntries as jest.Mock).mockReturnValue(0);
  (dbGetMealPlanAddedToList as jest.Mock).mockReturnValue({});
  useMealPlanStore.setState({
    entries: [], rangeStart: null, rangeEnd: null, addedToListAt: {}, initialized: false,
    lastAction: null,
  });
});

describe('loadRange', () => {
  it('reads only the window asked for', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);

    expect(dbGetMealPlanEntries).toHaveBeenCalledWith('2026-08-03', '2026-08-09');
    expect(getEntries()).toHaveLength(1);
    expect(useMealPlanStore.getState().rangeStart).toBe('2026-08-03');
    expect(useMealPlanStore.getState().rangeEnd).toBe('2026-08-09');
  });

  it('puts what it loaded into reading order', () => {
    loadWeek([
      entry('2026-08-05', 'dinner'),
      entry('2026-08-05', 'breakfast'),
      entry('2026-08-04', 'dinner'),
    ]);

    expect(getEntries().map(e => [e.date, e.slot])).toEqual([
      ['2026-08-04', 'dinner'],
      ['2026-08-05', 'breakfast'],
      ['2026-08-05', 'dinner'],
    ]);
  });

  it('replaces the previous window rather than accumulating', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-12', 'dinner')]);
    useMealPlanStore.getState().loadRange('2026-08-10', '2026-08-16');

    expect(getEntries().map(e => e.date)).toEqual(['2026-08-12']);
  });
});

describe('initialize', () => {
  it('reloads whatever window is loaded, so a database swap is picked up', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-06', 'lunch')]);

    useMealPlanStore.getState().initialize();

    expect(dbGetMealPlanEntries).toHaveBeenLastCalledWith('2026-08-03', '2026-08-09');
    expect(getEntries().map(e => e.date)).toEqual(['2026-08-06']);
    expect(useMealPlanStore.getState().initialized).toBe(true);
  });

  it('holds nothing when no window has been asked for yet', () => {
    useMealPlanStore.getState().initialize();

    expect(dbGetMealPlanEntries).not.toHaveBeenCalled();
    expect(getEntries()).toEqual([]);
    expect(useMealPlanStore.getState().initialized).toBe(true);
  });

  it('loads addedToListAt from the database, same as any other database swap', () => {
    (dbGetMealPlanAddedToList as jest.Mock).mockReturnValue({ '2026-08-09': '2026-08-09T00:00:00.000Z' });
    useMealPlanStore.getState().initialize();
    expect(useMealPlanStore.getState().addedToListAt).toEqual({ '2026-08-09': '2026-08-09T00:00:00.000Z' });
  });
});

describe('planMeal', () => {
  it('writes the row and shows it on the week', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: '  Sausage   ragù ',
    })!;

    expect(planned.title).toBe('Sausage ragù');
    expect(planned.recipeId).toBe('r1');
    expect(dbInsertMealPlanEntry).toHaveBeenCalledWith(planned);
    expect(getEntries()).toEqual([planned]);
  });

  it('carries a tracked leftover, and touches nothing about the leftover itself', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', leftoverId: 'lo-1', title: 'Chilli (2 days old)',
    })!;

    expect(planned.leftoverId).toBe('lo-1');
    expect(planned.recipeId).toBeNull();
  });

  it('leaves leftoverId null for an ordinary plan', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragù',
    })!;

    expect(planned.leftoverId).toBeNull();
  });

  // "Leftovers" is a plan, not a skipped step.
  it('accepts a meal with no recipe at all', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Leftovers',
    })!;

    expect(planned.recipeId).toBeNull();
    expect(getEntries()).toEqual([planned]);
  });

  it('refuses a blank title', () => {
    loadWeek();
    expect(useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: '   ',
    })).toBeNull();
    expect(dbInsertMealPlanEntry).not.toHaveBeenCalled();
    expect(getEntries()).toEqual([]);
  });

  // Two things on one dinner is real — chicken *and* a salad.
  it('lets a slot hold more than one thing, ordered behind what is there', () => {
    loadWeek();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-08-05', 'dinner', { sortOrder: 3 }),
    ]);
    const second = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Green salad',
    })!;

    expect(second.sortOrder).toBe(4);
  });

  /**
   * The invariant that makes this store range-scoped rather than a partial copy
   * of the table that grows every time something is planned offscreen.
   */
  it('writes a row outside the loaded window without holding it in memory', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-09-20', slot: 'dinner', title: 'Roast',
    })!;

    expect(dbInsertMealPlanEntry).toHaveBeenCalledWith(planned);
    expect(getEntries()).toEqual([]);
  });

  it('holds nothing before a window has been loaded', () => {
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Roast',
    })!;

    expect(dbInsertMealPlanEntry).toHaveBeenCalledWith(planned);
    expect(getEntries()).toEqual([]);
  });

  it('registers an undo that removes the planned meal again', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Roast',
    })!;

    expect(useMealPlanStore.getState().lastAction?.label).toBe('Planned "Roast"');
    useMealPlanStore.getState().undoLastAction();

    expect(dbDeleteMealPlanEntry).toHaveBeenCalledWith(planned.id);
    expect(getEntries()).toEqual([]);
  });
});

describe('moveEntry', () => {
  it('moves a meal to another day', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { date: '2026-08-07' });

    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, date: '2026-08-07', slot: 'dinner' })
    );
    expect(getEntries().map(e => e.date)).toEqual(['2026-08-07']);
  });

  it('changes the slot without touching the day', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { slot: 'lunch' });

    expect(getEntries()[0]).toEqual(expect.objectContaining({
      date: '2026-08-05', slot: 'lunch',
    }));
  });

  it('re-orders to the end of where it lands', () => {
    const moving = entry('2026-08-05', 'dinner', { sortOrder: 1 });
    loadWeek([moving]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-08-07', 'dinner', { sortOrder: 5 }),
    ]);

    useMealPlanStore.getState().moveEntry(moving.id, { date: '2026-08-07' });

    expect(getEntries()[0].sortOrder).toBe(6);
  });

  it('drops a meal moved out of the loaded window from memory', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { date: '2026-10-01' });

    expect(dbUpdateMealPlanEntry).toHaveBeenCalledTimes(1);
    expect(getEntries()).toEqual([]);
  });

  it('does nothing when the move changes nothing', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { date: '2026-08-05', slot: 'dinner' });

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('shrugs at an id it does not hold', () => {
    loadWeek();
    useMealPlanStore.getState().moveEntry('gone', { date: '2026-08-07' });
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('registers an undo that moves the meal back to its original day and slot', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { date: '2026-08-07', slot: 'lunch' });
    expect(useMealPlanStore.getState().lastAction?.label).toBe(`Moved "${dinner.title}"`);
    useMealPlanStore.getState().undoLastAction();

    expect(dbUpdateMealPlanEntry).toHaveBeenLastCalledWith(dinner);
    expect(getEntries()[0]).toEqual(expect.objectContaining({ date: '2026-08-05', slot: 'dinner' }));
  });
});

describe('removeEntry', () => {
  it('deletes the row and takes it off the week', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().removeEntry(dinner.id);

    expect(dbDeleteMealPlanEntry).toHaveBeenCalledWith(dinner.id);
    expect(getEntries()).toEqual([]);
  });

  it('registers an undo that re-inserts the removed meal', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().removeEntry(dinner.id);
    expect(useMealPlanStore.getState().lastAction?.label).toBe(`Removed "${dinner.title}"`);
    useMealPlanStore.getState().undoLastAction();

    expect(dbInsertMealPlanEntry).toHaveBeenCalledWith(dinner);
    expect(getEntries()).toEqual([dinner]);
  });

  it('does not register an undo for an id it does not hold', () => {
    loadWeek();
    useMealPlanStore.getState().removeEntry('gone');
    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });
});

describe('renameEntry', () => {
  it('rewrites a free-text entry title and writes it back', () => {
    const dinner = entry('2026-08-05', 'dinner', { title: 'Eating out' });
    loadWeek([dinner]);

    useMealPlanStore.getState().renameEntry(dinner.id, '  Takeout night  ');

    const updated = getEntries().find(e => e.id === dinner.id)!;
    expect(updated.title).toBe('Takeout night');
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, title: 'Takeout night' })
    );
  });

  it('refuses a blank title', () => {
    const dinner = entry('2026-08-05', 'dinner', { title: 'Eating out' });
    loadWeek([dinner]);

    useMealPlanStore.getState().renameEntry(dinner.id, '   ');

    expect(getEntries()[0].title).toBe('Eating out');
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('is a no-op on a recipe-backed entry', () => {
    const dinner = entry('2026-08-05', 'dinner', { title: 'Sausage ragù', recipeId: 'r1' });
    loadWeek([dinner]);

    useMealPlanStore.getState().renameEntry(dinner.id, 'Something else');

    expect(getEntries()[0].title).toBe('Sausage ragù');
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('is a no-op on a leftover-backed entry — the title carries its age', () => {
    const dinner = entry('2026-08-05', 'dinner', { title: 'Chilli (2 days old)', leftoverId: 'lo-1' });
    loadWeek([dinner]);

    useMealPlanStore.getState().renameEntry(dinner.id, 'Something else');

    expect(getEntries()[0].title).toBe('Chilli (2 days old)');
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('shrugs at an unknown id', () => {
    loadWeek([]);
    expect(() => useMealPlanStore.getState().renameEntry('gone', 'New title')).not.toThrow();
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });
});

describe('setRecipeChoices', () => {
  it('records the pick and writes it back', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeChoices(dinner.id, ['c-roast']);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeChoices).toEqual(['c-roast']);
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, recipeChoices: ['c-roast'] })
    );
  });

  it('replaces rather than merges, so going back to the default clears it', () => {
    const dinner = entry('2026-08-05', 'dinner', { recipeChoices: ['c-roast'] });
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeChoices(dinner.id, []);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeChoices).toEqual([]);
  });

  it('shrugs at an unknown entry', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbUpdateMealPlanEntry as jest.Mock).mockClear();

    useMealPlanStore.getState().setRecipeChoices('gone', ['c-roast']);

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });
});

describe('setRecipeScale', () => {
  it('records the factor and writes it back', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeScale(dinner.id, 2);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeScale).toBe(2);
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, recipeScale: 2 })
    );
  });

  it('goes back to as-written', () => {
    const dinner = entry('2026-08-05', 'dinner', { recipeScale: 0.5 });
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeScale(dinner.id, 1);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeScale).toBe(1);
  });

  it('clamps a nonsense factor to as-written rather than storing it', () => {
    const dinner = entry('2026-08-05', 'dinner', { recipeScale: 2 });
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeScale(dinner.id, 0);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeScale).toBe(1);
  });

  it('skips the write when the factor is unchanged', () => {
    const dinner = entry('2026-08-05', 'dinner', { recipeScale: 2 });
    loadWeek([dinner]);
    (dbUpdateMealPlanEntry as jest.Mock).mockClear();

    useMealPlanStore.getState().setRecipeScale(dinner.id, 2);

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('is allowed on an already-cooked entry, same as a pick', () => {
    const dinner = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeScale(dinner.id, 2);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeScale).toBe(2);
  });

  it('shrugs at an unknown entry', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbUpdateMealPlanEntry as jest.Mock).mockClear();

    useMealPlanStore.getState().setRecipeScale('gone', 2);

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });
});

describe('markCooked', () => {
  it('stamps cookedAt and writes it back', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().markCooked(dinner.id);

    const updated = getEntries().find(e => e.id === dinner.id)!;
    expect(updated.cookedAt).not.toBeNull();
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(expect.objectContaining({ id: dinner.id, cookedAt: expect.any(String) }));
  });

  it('is a no-op on an entry already marked cooked', () => {
    const dinner = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    loadWeek([dinner]);

    useMealPlanStore.getState().markCooked(dinner.id);

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('shrugs at an unknown id', () => {
    loadWeek([]);
    expect(() => useMealPlanStore.getState().markCooked('gone')).not.toThrow();
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });
});

describe('purgeOldEntries', () => {
  it('reports what the delete took', () => {
    (dbPurgeOldMealPlanEntries as jest.Mock).mockReturnValue(4);
    expect(useMealPlanStore.getState().purgeOldEntries()).toBe(4);
  });

  it('passes a day key 180 days back', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 8));
    useMealPlanStore.getState().purgeOldEntries();
    expect(dbPurgeOldMealPlanEntries).toHaveBeenCalledWith('2026-02-09');
    jest.useRealTimers();
  });

  // The loaded window can overlap the horizon — someone paging back through
  // spring — so memory has to follow the delete rather than wait for a reload.
  it('drops purged days from the loaded window too', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 8));
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-02-08', 'dinner'),
      entry('2026-02-10', 'dinner'),
    ]);
    useMealPlanStore.getState().loadRange('2026-02-08', '2026-02-14');
    (dbPurgeOldMealPlanEntries as jest.Mock).mockReturnValue(1);

    useMealPlanStore.getState().purgeOldEntries();

    expect(getEntries().map(e => e.date)).toEqual(['2026-02-10']);
    jest.useRealTimers();
  });

  it('leaves the window alone when nothing was old enough', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    useMealPlanStore.getState().purgeOldEntries();
    expect(getEntries()).toHaveLength(1);
  });

  it('trims addedToListAt stamps past the same horizon', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 8));
    useMealPlanStore.setState({
      addedToListAt: { '2026-02-08': '2026-02-08T00:00:00.000Z', '2026-08-03': '2026-08-03T00:00:00.000Z' },
    });

    useMealPlanStore.getState().purgeOldEntries();

    expect(useMealPlanStore.getState().addedToListAt).toEqual({
      '2026-08-03': '2026-08-03T00:00:00.000Z',
    });
    expect(dbSetMealPlanAddedToList).toHaveBeenCalledWith({ '2026-08-03': '2026-08-03T00:00:00.000Z' });
    jest.useRealTimers();
  });

  it('does not touch storage when no stamp was old enough to trim', () => {
    useMealPlanStore.setState({ addedToListAt: { '2026-08-03': '2026-08-03T00:00:00.000Z' } });
    useMealPlanStore.getState().purgeOldEntries();
    expect(dbSetMealPlanAddedToList).not.toHaveBeenCalled();
  });
});

describe('undoLastAction', () => {
  it('is a no-op with nothing to undo', () => {
    loadWeek();
    expect(() => useMealPlanStore.getState().undoLastAction()).not.toThrow();
  });

  it('clears lastAction after undoing, so a second shake finds nothing', () => {
    loadWeek();
    useMealPlanStore.getState().planMeal({ date: '2026-08-05', slot: 'dinner', title: 'Roast' });
    useMealPlanStore.getState().undoLastAction();
    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });
});

describe('stampAddedToList', () => {
  it('records now against the week key and persists it', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 12, 9, 30));
    useMealPlanStore.getState().stampAddedToList('2026-08-09');

    expect(useMealPlanStore.getState().addedToListAt['2026-08-09']).toBe(
      new Date(2026, 7, 12, 9, 30).toISOString()
    );
    expect(dbSetMealPlanAddedToList).toHaveBeenCalledWith(
      expect.objectContaining({ '2026-08-09': expect.any(String) })
    );
    jest.useRealTimers();
  });

  it('keeps stamps for other weeks rather than replacing the whole map', () => {
    useMealPlanStore.setState({ addedToListAt: { '2026-08-02': '2026-08-02T00:00:00.000Z' } });
    useMealPlanStore.getState().stampAddedToList('2026-08-09');

    const stamps = useMealPlanStore.getState().addedToListAt;
    expect(Object.keys(stamps).sort()).toEqual(['2026-08-02', '2026-08-09']);
  });
});

// Bulk selection (#1110).

describe('bulkDeleteEntries', () => {
  it('deletes every named row and drops it from the week', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-06', 'lunch');
    const untouched = entry('2026-08-07', 'dinner');
    loadWeek([a, b, untouched]);

    useMealPlanStore.getState().bulkDeleteEntries([a.id, b.id]);

    expect(dbDeleteMealPlanEntry).toHaveBeenCalledWith(a.id);
    expect(dbDeleteMealPlanEntry).toHaveBeenCalledWith(b.id);
    expect(dbDeleteMealPlanEntry).toHaveBeenCalledTimes(2);
    expect(getEntries().map(e => e.id)).toEqual([untouched.id]);
  });

  it('does nothing for an empty selection', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    useMealPlanStore.getState().bulkDeleteEntries([]);
    expect(dbDeleteMealPlanEntry).not.toHaveBeenCalled();
  });

  // The confirm dialog tells the user this can't be undone — see the store's
  // doc comment. It must not register a lastAction that would quietly
  // contradict that.
  it('does not register an undo — the confirm dialog promises it cannot be undone', () => {
    const a = entry('2026-08-05', 'dinner');
    loadWeek([a]);
    useMealPlanStore.getState().bulkDeleteEntries([a.id]);
    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });

  // Not registering one isn't enough on its own: the queue outlives the action
  // that filled it (UNDO_ACTION_MAX_AGE_MS), so a delete that only declined to
  // set a lastAction would leave the *previous* one armed — and a shake right
  // after "This can't be undone" would offer to undo something else entirely.
  it('clears an undo left by an earlier action rather than leaving it armed', () => {
    const a = entry('2026-08-05', 'dinner');
    loadWeek([a]);
    useMealPlanStore.getState().planMeal({ date: '2026-08-06', slot: 'dinner', title: 'Chilli' });
    expect(useMealPlanStore.getState().lastAction).not.toBeNull();

    useMealPlanStore.getState().bulkDeleteEntries([a.id]);

    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });
});

describe('bulkMoveEntries', () => {
  it('moves every named entry to the new day', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-05', 'lunch');
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkMoveEntries([a.id, b.id], { date: '2026-08-07' });

    expect(getEntries().map(e => [e.date, e.slot]).sort()).toEqual([
      ['2026-08-07', 'dinner'],
      ['2026-08-07', 'lunch'],
    ]);
  });

  it('orders two moved entries landing on the same slot against each other, not just against the table', () => {
    const a = entry('2026-08-05', 'dinner', { sortOrder: 1 });
    const b = entry('2026-08-06', 'lunch', { sortOrder: 1 });
    loadWeek([a, b]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-08-07', 'dinner', { sortOrder: 5 }),
    ]);

    useMealPlanStore.getState().bulkMoveEntries([a.id, b.id], { date: '2026-08-07', slot: 'dinner' });

    const sortOrders = getEntries().map(e => e.sortOrder).sort((x, y) => x - y);
    expect(sortOrders).toEqual([6, 7]);
  });

  it('drops an entry moved out of the loaded window from memory', () => {
    const a = entry('2026-08-05', 'dinner');
    loadWeek([a]);

    useMealPlanStore.getState().bulkMoveEntries([a.id], { date: '2026-10-01' });

    expect(getEntries()).toEqual([]);
  });

  it('skips an entry that would land exactly where it already is', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-05', 'lunch');
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkMoveEntries([a.id, b.id], { date: '2026-08-05', slot: 'dinner' });

    // Only b (lunch → dinner) actually moves; a is already there.
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledTimes(1);
    expect(getEntries().find(e => e.id === b.id)!.slot).toBe('dinner');
  });

  it('does nothing for an empty selection or an unchanged target', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    useMealPlanStore.getState().bulkMoveEntries([], { date: '2026-08-07' });
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('registers an undo that moves every entry back to its own original day and slot', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-06', 'lunch');
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkMoveEntries([a.id, b.id], { date: '2026-08-07' });
    useMealPlanStore.getState().undoLastAction();

    expect(getEntries().map(e => [e.id, e.date, e.slot]).sort()).toEqual([
      [a.id, '2026-08-05', 'dinner'],
      [b.id, '2026-08-06', 'lunch'],
    ]);
  });
});

describe('bulkReplaceItem', () => {
  it('swaps the recipe and title on every named entry', () => {
    const a = entry('2026-08-05', 'dinner', { recipeId: 'old-recipe', title: 'Old ragù' });
    const b = entry('2026-08-06', 'dinner', { recipeId: 'old-recipe', title: 'Old ragù' });
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkReplaceItem([a.id, b.id], { recipeId: 'new-recipe', title: 'New ragù' });

    for (const e of getEntries()) {
      expect(e.recipeId).toBe('new-recipe');
      expect(e.title).toBe('New ragù');
    }
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledTimes(2);
  });

  it('accepts a free-text replacement with no recipe', () => {
    const a = entry('2026-08-05', 'dinner', { recipeId: 'r1', title: 'Sausage ragù' });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: null, title: 'Takeout' });

    const updated = getEntries().find(e => e.id === a.id)!;
    expect(updated.recipeId).toBeNull();
    expect(updated.title).toBe('Takeout');
  });

  it('clears recipeChoices and leftoverId — a different item carries neither over', () => {
    const a = entry('2026-08-05', 'dinner', {
      recipeId: 'r1', recipeChoices: ['c-roast'], leftoverId: 'lo-1',
    });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: 'r2', title: 'New dish' });

    const updated = getEntries().find(e => e.id === a.id)!;
    expect(updated.recipeChoices).toEqual([]);
    expect(updated.leftoverId).toBeNull();
  });

  it('leaves cookedAt untouched — relabelling a past night does not un-cook it', () => {
    const a = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: null, title: 'New name' });

    expect(getEntries().find(e => e.id === a.id)!.cookedAt).toBe('2026-08-05T18:00:00.000Z');
  });

  it('refuses a blank title', () => {
    const a = entry('2026-08-05', 'dinner', { title: 'Original' });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: null, title: '   ' });

    expect(getEntries()[0].title).toBe('Original');
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('registers an undo that restores every entry to its original recipe and title', () => {
    const a = entry('2026-08-05', 'dinner', {
      recipeId: 'old-recipe', title: 'Old ragù', recipeChoices: ['c-roast'], leftoverId: 'lo-1',
    });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: 'new-recipe', title: 'New ragù' });
    useMealPlanStore.getState().undoLastAction();

    expect(getEntries()[0]).toEqual(a);
  });
});

describe('bulkSetCooked', () => {
  it('stamps cookedAt on every named entry not already cooked', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-06', 'lunch');
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkSetCooked([a.id, b.id], true);

    for (const e of getEntries()) expect(e.cookedAt).not.toBeNull();
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledTimes(2);
  });

  it('clears cookedAt on every named entry that has one', () => {
    const a = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    loadWeek([a]);

    useMealPlanStore.getState().bulkSetCooked([a.id], false);

    expect(getEntries()[0].cookedAt).toBeNull();
  });

  it('is idempotent — an entry already at the target state is not rewritten', () => {
    const alreadyCooked = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    const alreadyRaw = entry('2026-08-06', 'lunch');
    loadWeek([alreadyCooked, alreadyRaw]);

    useMealPlanStore.getState().bulkSetCooked([alreadyCooked.id], true);
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();

    useMealPlanStore.getState().bulkSetCooked([alreadyRaw.id], false);
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('does nothing for an empty selection', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    useMealPlanStore.getState().bulkSetCooked([], true);
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('registers an undo that restores each entry to its own original cookedAt', () => {
    const a = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    const b = entry('2026-08-06', 'lunch', { cookedAt: null });
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkSetCooked([a.id, b.id], true);
    useMealPlanStore.getState().undoLastAction();

    const byId = new Map(getEntries().map(e => [e.id, e]));
    expect(byId.get(a.id)!.cookedAt).toBe('2026-08-05T18:00:00.000Z');
    expect(byId.get(b.id)!.cookedAt).toBeNull();
  });
});
