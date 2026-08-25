import type { LeftoverFreshness, MealPlanEntry, MealSlot, Recipe } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import type { TodayListItem } from '../utils/taskGrouping';
import {
  eventContextRows,
  mealContextRows,
  kitchenContextRows,
  plannedUsesToday,
  insertContextRows,
  withoutContextRows,
} from '../utils/dayContextRows';
import type { KitchenEntry } from '../utils/kitchenInventory';
import { groceryNameKey } from '../utils/groceryParse';

// Both mocks are here for what this module *imports*, not for what it does:
// dateUtils reaches the settings store for the 12/24-hour preference (every
// call below passes it explicitly), and taskGrouping — for LATER_TODAY_LABEL —
// reaches visibilityUtils and so the category store, which loads expo-sqlite.
// Same pair taskGrouping's own suite installs.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ use24HourTime: false, dayResetTime: '00:00' }) },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ categories: [], getCategoryByName: () => null }),
  },
}));

const NOW = new Date('2026-08-13T14:00:00Z');

let seq = 0;
function ev(start: string, end: string, overrides: Partial<BusyEvent> = {}): BusyEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    title: `Event ${seq}`,
    start,
    end,
    allDay: false,
    calendarId: 'cal',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

/** An ISO instant at the given UTC hour on the test day. */
function at(hours: number, minutes = 0): string {
  const d = new Date('2026-08-13T00:00:00Z');
  d.setUTCHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function entry(slot: MealSlot, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  seq += 1;
  return {
    id: `m-${seq}`,
    date: '2026-08-13',
    slot,
    recipeId: null,
    title: `Meal ${seq}`,
    sortOrder: 1,
    createdAt: '2026-08-13T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    personIds: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    calendarEventId: null,
    ...overrides,
  };
}

const NO_RECIPES = new Map<string, Recipe>();
const eventOpts = { now: NOW, category: 'Calendar Events', use24Hour: true };
const mealOpts = { category: 'Kitchen', hasCookTask: () => false };

const header = (label: string): TodayListItem => ({ type: 'header', label });
const task = (id: string, category: string | null = null): TodayListItem =>
  ({ type: 'task', task: { id, category } as never });

describe('eventContextRows', () => {
  it('drops an event that has already ended', () => {
    const rows = eventContextRows([ev(at(9), at(10)), ev(at(16), at(17))], eventOpts);
    expect(rows.map(r => r.caption)).toEqual(['16:00']);
  });

  it('marks the event happening right now, and only that one', () => {
    const rows = eventContextRows([ev(at(13, 30), at(14, 30)), ev(at(18), at(19))], eventOpts);
    expect(rows.map(r => [r.caption, r.now])).toEqual([['Now', true], ['18:00', false]]);
  });

  it('keeps an all-day event and leads with it, whatever the clock says', () => {
    const rows = eventContextRows(
      [
        ev(at(16), at(17), { title: 'Dentist' }),
        ev(at(0), at(24), { allDay: true, title: 'Sam out of office' }),
      ],
      eventOpts,
    );
    expect(rows.map(r => [r.title, r.caption])).toEqual([
      ['Sam out of office', 'All day'],
      ['Dentist', '16:00'],
    ]);
  });

  it('drops a cancelled event, matching every other calendar read', () => {
    expect(eventContextRows([ev(at(16), at(17), { status: 'canceled' })], eventOpts)).toEqual([]);
  });

  it('prefixes the id by kind so it cannot collide with a task id', () => {
    const [row] = eventContextRows([ev(at(16), at(17), { id: 'abc' })], eventOpts);
    expect(row.id).toBe('event-abc');
    expect(row.sourceId).toBe('abc');
  });
});

describe('mealContextRows', () => {
  it('leaves out a meal that already has a live cook task', () => {
    const withTask = entry('dinner');
    const withoutTask = entry('lunch');
    const rows = mealContextRows([withTask, withoutTask], NO_RECIPES, {
      category: 'Kitchen',
      hasCookTask: entry => entry.id === withTask.id,
    });
    expect(rows.map(r => r.title)).toEqual([withoutTask.title]);
  });

  it('leaves out a meal already cooked', () => {
    const rows = mealContextRows([entry('dinner', { cookedAt: at(12) })], NO_RECIPES, mealOpts);
    expect(rows).toEqual([]);
  });

  it('reads in slot order and captions each with its slot', () => {
    const rows = mealContextRows(
      [entry('dinner', { title: 'Chilli' }), entry('breakfast', { title: 'Oats' })],
      NO_RECIPES,
      mealOpts,
    );
    expect(rows.map(r => [r.title, r.caption])).toEqual([['Oats', 'Breakfast'], ['Chilli', 'Dinner']]);
  });

  // Today ticks a meal off by this id — a row that carried only the prefixed
  // list key would have the screen peeling the prefix back off to find the
  // entry, which is exactly the re-derivation sourceId exists to stop.
  it('carries the entry id alongside the prefixed list key', () => {
    const dinner = entry('dinner');
    const [row] = mealContextRows([dinner], NO_RECIPES, mealOpts);
    expect(row.id).toBe(`meal-${dinner.id}`);
    expect(row.sourceId).toBe(dinner.id);
  });
});

describe('insertContextRows', () => {
  const rows = eventContextRows([ev(at(16), at(17), { title: 'Dentist' })], eventOpts);

  it('puts rows under their existing header, ahead of that section\'s tasks', () => {
    const out = insertContextRows(
      [header('Home'), task('a', 'Home'), header('Calendar Events'), task('b', 'Calendar Events')],
      rows,
      { categoryOrder: ['Home', 'Calendar Events'] },
    );
    expect(out.map(i => (i.type === 'context' ? `ctx:${i.row.title}` : i.type))).toEqual([
      'header', 'task', 'header', 'ctx:Dentist', 'task',
    ]);
  });

  it('creates the section when the category holds nothing else', () => {
    const out = insertContextRows([header('Home'), task('a', 'Home')], rows, {
      categoryOrder: ['Home', 'Calendar Events'],
    });
    expect(out.map(i => (i.type === 'header' ? i.label : i.type))).toEqual([
      'Home', 'task', 'Calendar Events', 'context',
    ]);
  });

  it('places a created section where the category order says, not just last', () => {
    const out = insertContextRows([header('Work'), task('a', 'Work')], rows, {
      categoryOrder: ['Calendar Events', 'Work'],
    });
    expect(out.map(i => (i.type === 'header' ? i.label : i.type))).toEqual([
      'Calendar Events', 'context', 'Work', 'task',
    ]);
  });

  it('keeps a created section above Later Today, which is not a category', () => {
    const out = insertContextRows([header('Later Today'), task('a')], rows, {
      categoryOrder: ['Calendar Events'],
    });
    expect(out.map(i => (i.type === 'header' ? i.label : i.type))).toEqual([
      'Calendar Events', 'context', 'Later Today', 'task',
    ]);
  });

  it('puts uncategorized rows at the top, with the loose tasks', () => {
    const loose = mealContextRows([entry('dinner', { title: 'Leftovers' })], NO_RECIPES, {
      category: null,
      hasCookTask: () => false,
    });
    const out = insertContextRows([task('a'), header('Home'), task('b', 'Home')], loose, {
      categoryOrder: ['Home'],
    });
    expect(out.map(i => (i.type === 'header' ? i.label : i.type))).toEqual([
      'context', 'task', 'Home', 'task',
    ]);
  });

  it('changes nothing when there are no rows', () => {
    const items = [header('Home'), task('a', 'Home')];
    expect(insertContextRows(items, [], { categoryOrder: ['Home'] })).toEqual(items);
  });
});

describe('withoutContextRows', () => {
  it('strips them back out for the drop machinery', () => {
    const withRows = insertContextRows(
      [header('Calendar Events')],
      eventContextRows([ev(at(16), at(17))], eventOpts),
      { categoryOrder: ['Calendar Events'] },
    );
    expect(withRows).toHaveLength(2);
    expect(withoutContextRows(withRows)).toEqual([header('Calendar Events')]);
  });
});

// ─── the kitchen (#1689) ────────────────────────────────────────────────────

/**
 * `KitchenEntry` fixtures, built by hand rather than through
 * `kitchenInventory`: what's under test here is which of them earns a row and
 * what that row says, and staging a purchase cadence to produce one is
 * `kitchenInventory.test.ts`'s job. `useByCaption`/`freshness` are set
 * together, since the row reads one and the filter reads the other.
 */
function kitchen(
  title: string,
  freshness: LeftoverFreshness | null,
  overrides: Partial<KitchenEntry> = {},
): KitchenEntry {
  seq += 1;
  const kind = overrides.kind ?? 'grocery';
  const sourceId = overrides.sourceId ?? `k-${seq}`;
  return {
    id: `${kind}-${sourceId}`,
    sourceId,
    kind,
    title,
    productName: null,
    itemId: null,
    section: 'Other',
    useBy: freshness === null ? null : '2026-08-13',
    freshness,
    daysLeft: freshness === null ? null : 0,
    reason: 'Bought 2×',
    useByCaption: freshness === null ? '' : 'Use by today',
    caption: 'Bought 2×',
    onList: false,
    matchKey: groceryNameKey(title),
    ...overrides,
  };
}

const NO_TASKS = { category: 'Kitchen', hasUseUpTask: () => false };

describe('kitchenContextRows', () => {
  it('says nothing on a day with nothing about to go off', () => {
    expect(kitchenContextRows([kitchen('Rice', 'fresh'), kitchen('Flour', null)], NO_TASKS))
      .toEqual([]);
  });

  it('names one thing on its own line, with the use-by day as the caption', () => {
    const rows = kitchenContextRows([kitchen('Spinach', 'due')], NO_TASKS);
    expect(rows.map(r => [r.kind, r.title, r.caption]))
      .toEqual([['kitchen', 'Spinach', 'Use by today']]);
  });

  it('names two, and collapses three or more into one row', () => {
    const dying = [
      kitchen('Spinach', 'over', { useByCaption: '2 days past' }),
      kitchen('Chilli', 'due', { kind: 'leftover' }),
      kitchen('Yogurt', 'soon', { useByCaption: 'Use by tomorrow' }),
    ];
    expect(kitchenContextRows(dying.slice(0, 2), NO_TASKS).map(r => r.title))
      .toEqual(['Spinach', 'Chilli']);
    // The soonest day leads the summary — it can't state three, and the one
    // already past is the one that has to be dealt with tonight.
    expect(kitchenContextRows(dying, NO_TASKS).map(r => [r.title, r.caption]))
      .toEqual([['3 things to use up', '2 days past']]);
  });

  it('drops anything that already has a use-up task, rather than saying it twice', () => {
    const spinach = kitchen('Spinach', 'due');
    const chilli = kitchen('Chilli', 'over', { kind: 'leftover' });
    const rows = kitchenContextRows([spinach, chilli], {
      category: 'Kitchen',
      hasUseUpTask: entry => entry.id === chilli.id,
    });
    expect(rows.map(r => r.title)).toEqual(['Spinach']);
  });

  it('counts only what is left after that drop, so the summary cannot overstate', () => {
    const dying = [
      kitchen('Spinach', 'over'),
      kitchen('Chilli', 'due'),
      kitchen('Yogurt', 'soon'),
    ];
    const rows = kitchenContextRows(dying, {
      category: 'Kitchen',
      hasUseUpTask: entry => entry.title === 'Yogurt',
    });
    expect(rows.map(r => r.title)).toEqual(['Spinach', 'Chilli']);
  });

  it('files under the category it is given and is never marked as running', () => {
    const [row] = kitchenContextRows([kitchen('Spinach', 'due')], NO_TASKS);
    expect(row.category).toBe('Kitchen');
    expect(row.now).toBe(false);
  });

  it('prefixes the id by kind, twice over, so it cannot collide with anything', () => {
    const entry = kitchen('Spinach', 'due', { sourceId: 'gi-1' });
    const [row] = kitchenContextRows([entry], NO_TASKS);
    expect(row.id).toBe('kitchen-grocery-gi-1');
    expect(row.sourceId).toBe('gi-1');
  });

  it('names no single source on the summary row', () => {
    const dying = ['a', 'b', 'c'].map(n => kitchen(n, 'due'));
    expect(kitchenContextRows(dying, NO_TASKS)[0].sourceId).toBe('');
  });

  it('adds the meal that would eat it, when there is one', () => {
    const spinach = kitchen('Spinach', 'due');
    const rows = kitchenContextRows([spinach], {
      ...NO_TASKS,
      plannedUses: new Map([[spinach.id, 'Green salad']]),
    });
    expect(rows[0].caption).toBe('Use by today · For Green salad');
  });
});

describe('plannedUsesToday', () => {
  const spinach = kitchen('Spinach', 'due');

  function withRecipe(name: string, ingredientNames: string[]) {
    const ingredients = ingredientNames.map(n => ({
      id: `i-${++seq}`,
      name: n,
      nameKey: groceryNameKey(n),
      quantity: '',
      aisle: null,
      prep: null,
      purpose: null,
      section: null,
      choiceGroup: null,
    }));
    return {
      id: `r-${++seq}`,
      name,
      ingredients,
      components: [],
      emptySections: [],
    } as unknown as Recipe;
  }

  it('pairs a catalog row with the meal whose recipe calls for it', () => {
    const salad = withRecipe('Green salad', ['Spinach', 'Olive oil']);
    const uses = plannedUsesToday(
      [spinach],
      [entry('dinner', { recipeId: salad.id })],
      new Map([[salad.id, salad]]),
    );
    expect(uses.get(spinach.id)).toBe('Green salad');
  });

  it('pairs a leftover by the pointer the user made, not by its title', () => {
    const chilli = kitchen('Chilli', 'due', { kind: 'leftover', sourceId: 'lo-1' });
    const uses = plannedUsesToday(
      [chilli],
      [entry('dinner', { leftoverId: 'lo-1', title: 'Leftover chilli' })],
      NO_RECIPES,
    );
    expect(uses.get(chilli.id)).toBe('Leftover chilli');
  });

  it('says nothing about a leftover a meal merely shares a name with', () => {
    const chilli = kitchen('Chilli', 'due', { kind: 'leftover' });
    const uses = plannedUsesToday(
      [chilli],
      [entry('dinner', { title: 'Chilli' })],
      NO_RECIPES,
    );
    expect(uses.size).toBe(0);
  });

  it('names the earliest slot when two meals both want it', () => {
    const salad = withRecipe('Green salad', ['Spinach']);
    const soup = withRecipe('Spinach soup', ['Spinach']);
    const uses = plannedUsesToday(
      [spinach],
      [entry('dinner', { recipeId: soup.id }), entry('lunch', { recipeId: salad.id })],
      new Map([[salad.id, salad], [soup.id, soup]]),
    );
    expect(uses.get(spinach.id)).toBe('Green salad');
  });

  it('ignores a meal already cooked', () => {
    const salad = withRecipe('Green salad', ['Spinach']);
    const uses = plannedUsesToday(
      [spinach],
      [entry('lunch', { recipeId: salad.id, cookedAt: '2026-08-13T12:00:00.000Z' })],
      new Map([[salad.id, salad]]),
    );
    expect(uses.size).toBe(0);
  });

  it('says nothing when the day has no meal that would use it', () => {
    const soup = withRecipe('Tomato soup', ['Tomatoes']);
    const uses = plannedUsesToday(
      [spinach],
      [entry('dinner', { recipeId: soup.id }), entry('lunch')],
      new Map([[soup.id, soup]]),
    );
    expect(uses.size).toBe(0);
  });
});
