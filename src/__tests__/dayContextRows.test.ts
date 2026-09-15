import type { MealPlanEntry, MealSlot, Recipe } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import type { TodayListItem } from '../utils/taskGrouping';
import {
  eventContextRows,
  mealContextRows,
  healthContextRows,
  insertContextRows,
  withoutContextRows,
} from '../utils/dayContextRows';

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
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    logMeal: null,
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

  it('leaves the calendar tag null with no calendarsById given', () => {
    const [row] = eventContextRows([ev(at(16), at(17))], eventOpts);
    expect(row.calendarTag).toBeNull();
  });

  it('tags a row with its own calendar\'s name and color', () => {
    const [row] = eventContextRows([ev(at(16), at(17), { calendarId: 'work' })], {
      ...eventOpts,
      calendarsById: { work: { title: 'Work', color: '#0A84FF' } },
    });
    expect(row.calendarTag).toEqual({ name: 'Work', color: '#0A84FF' });
  });

  it('leaves a row untagged when its own calendar is missing from the map', () => {
    const [row] = eventContextRows([ev(at(16), at(17), { calendarId: 'family' })], {
      ...eventOpts,
      calendarsById: { work: { title: 'Work', color: '#0A84FF' } },
    });
    expect(row.calendarTag).toBeNull();
  });

  it('drops an event the caller reports as hidden', () => {
    const rows = eventContextRows(
      [ev(at(16), at(17), { id: 'hide-me' }), ev(at(18), at(19), { id: 'keep-me' })],
      { ...eventOpts, isHidden: e => e.id === 'hide-me' },
    );
    expect(rows.map(r => r.sourceId)).toEqual(['keep-me']);
  });

  it('keeps every event when no isHidden predicate is given', () => {
    const rows = eventContextRows([ev(at(16), at(17)), ev(at(18), at(19))], eventOpts);
    expect(rows).toHaveLength(2);
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

describe('healthContextRows', () => {
  const TODAY = '2026-08-13';
  const opts = { todayKey: TODAY, category: 'Health' };

  it('says the count, captioned as a running total', () => {
    const rows = healthContextRows({ dayKey: TODAY, steps: 4120 }, opts);
    expect(rows.map(r => [r.kind, r.title, r.caption]))
      .toEqual([['health', '4,120 steps', 'So far today']]);
  });

  it('files under the category it is given, and carries no source', () => {
    const [row] = healthContextRows({ dayKey: TODAY, steps: 900 }, opts);
    expect(row.category).toBe('Health');
    // The reading is about a day, not a row — there is nothing to point at.
    expect(row.sourceId).toBe('');
    expect(row.now).toBe(false);
    expect(row.calendarTag).toBeNull();
  });

  it('says nothing when there is no reading at all', () => {
    expect(healthContextRows(null, opts)).toEqual([]);
  });

  it('says nothing about a reading from another day', () => {
    // The store holds one day-keyed snapshot, and one taken before the day
    // turned over is not an answer about this day.
    expect(healthContextRows({ dayKey: '2026-08-12', steps: 9000 }, opts)).toEqual([]);
  });

  it('says nothing for a null count, which is also what a refusal looks like', () => {
    // HealthKit serves a refused read as an empty store, so null covers "you
    // said no" as well as "nothing recorded". A "No steps" row would be shown
    // to exactly the people who declined.
    expect(healthContextRows({ dayKey: TODAY, steps: null }, opts)).toEqual([]);
  });

  it('says nothing for zero, which is where every morning starts', () => {
    // The bridge keeps a real 0 truthfully; the row declines to exist for it.
    // Zero steps is not context about a day, and in practice it is also the
    // not-synced-yet state.
    expect(healthContextRows({ dayKey: TODAY, steps: 0 }, opts)).toEqual([]);
  });

  it('does not say "1 steps"', () => {
    expect(healthContextRows({ dayKey: TODAY, steps: 1 }, opts)[0].title).toBe('1 step');
  });

  it('lands in the loose group when no category is set, like every other kind', () => {
    // The screen drops the row before it gets here in that case — the category
    // is the row's off switch — but the builder itself stays kind-blind about
    // it, exactly as eventContextRows does.
    const [row] = healthContextRows({ dayKey: TODAY, steps: 12 }, { ...opts, category: null });
    expect(row.category).toBeNull();
  });
});
