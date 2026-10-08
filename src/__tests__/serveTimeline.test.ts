import type { MealPlanEntry, Recipe } from '../types';
import {
  describeDishTiming, dishTiming, eatAtInstant, formatMinutes, isEatAtTime, isStartAhead,
  serveTimeline, slotEatAt, startTaskDraft,
} from '../utils/serveTimeline';

const recipe = (id: string, over: Partial<Recipe> = {}): Recipe => ({
  id, name: id, prepMinutes: null, estimatedMinutes: null,
  prepTimeCount: 0, totalPrepMinutes: 0, cookTimeCount: 0, totalCookMinutes: 0,
  ...over,
}) as Recipe;

const entry = (id: string, over: Partial<MealPlanEntry> = {}): MealPlanEntry => ({
  id, date: '2026-10-10', slot: 'dinner', recipeId: id, title: id, sortOrder: 0,
  createdAt: '2026-10-01T09:00:00', cookedAt: null, leftoverId: null, recipeChoices: [],
  recipeScale: 1, cookTask: null, shopTask: null, logMeal: null, calendarEventId: null,
  ...over,
}) as MealPlanEntry;

const time = (d: Date | null) => (d ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : null);

describe('the eat time', () => {
  it('is the slot\'s first time, in plan order', () => {
    expect(slotEatAt([entry('a', { sortOrder: 1, eatAt: '19:00' }), entry('b', { sortOrder: 0, eatAt: null })])).toBe('19:00');
    expect(slotEatAt([entry('a', { sortOrder: 1, eatAt: '19:00' }), entry('b', { sortOrder: 0, eatAt: '18:30' })])).toBe('18:30');
    expect(slotEatAt([entry('a'), entry('b', { eatAt: 'soon' })])).toBeNull();
  });

  it('accepts only a real clock time', () => {
    expect(isEatAtTime('18:30')).toBe(true);
    expect(isEatAtTime('24:00')).toBe(false);
    expect(isEatAtTime('6:30')).toBe(false);
    expect(isEatAtTime(null)).toBe(false);
  });

  it('lands on the meal\'s day, and past midnight after a late reset', () => {
    expect(eatAtInstant('2026-10-10', '18:30', '00:00')).toEqual(new Date(2026, 9, 10, 18, 30));
    // Under a 4 AM reset, 00:30 is the small hours after the 10th's evening.
    expect(eatAtInstant('2026-10-10', '00:30', '04:00')).toEqual(new Date(2026, 9, 11, 0, 30));
    expect(eatAtInstant('2026-10-10', '00:30', '00:00')).toEqual(new Date(2026, 9, 10, 0, 30));
  });
});

describe('a dish\'s minutes', () => {
  it('uses your logged average for each half, else the recipe\'s', () => {
    expect(dishTiming(recipe('r', { prepMinutes: 20, estimatedMinutes: 90 })))
      .toEqual({ prepMinutes: 20, cookMinutes: 90, prepLogged: false, cookLogged: false });
    expect(dishTiming(recipe('r', { prepMinutes: 20, estimatedMinutes: 90, cookTimeCount: 2, totalCookMinutes: 210 })))
      .toEqual({ prepMinutes: 20, cookMinutes: 105, prepLogged: false, cookLogged: true });
    expect(dishTiming(recipe('r', { prepTimeCount: 3, totalPrepMinutes: 31 })))
      .toEqual({ prepMinutes: 10, cookMinutes: null, prepLogged: true, cookLogged: false });
  });

  it('is nothing when the recipe has no minutes at all', () => {
    expect(dishTiming(recipe('r'))).toBeNull();
    expect(dishTiming(recipe('r', { prepMinutes: 0, estimatedMinutes: 0 }))).toBeNull();
  });

  it('reads as words', () => {
    expect(describeDishTiming({ prepMinutes: 20, cookMinutes: 90, prepLogged: false, cookLogged: true }))
      .toBe('Prep 20 min, cook 1 hr 30 min (your average)');
    expect(describeDishTiming({ prepMinutes: null, cookMinutes: 60, prepLogged: false, cookLogged: false })).toBe('Cook 1 hr');
    expect(formatMinutes(45)).toBe('45 min');
  });
});

describe('the timeline', () => {
  const recipes = new Map([
    ['roast', recipe('roast', { prepMinutes: 20, estimatedMinutes: 90 })],
    ['potatoes', recipe('potatoes', { prepMinutes: 10, estimatedMinutes: 45 })],
    ['salad', recipe('salad', { prepMinutes: 15 })],
    ['bread', recipe('bread')],
  ]);
  const eatAt = new Date(2026, 9, 10, 18, 30);
  const plan = [
    entry('salad', { sortOrder: 0 }),
    entry('bread', { sortOrder: 1 }),
    entry('potatoes', { sortOrder: 2 }),
    entry('roast', { sortOrder: 3 }),
  ];

  it('counts each dish back from the eat time, earliest start first', () => {
    const { dishes } = serveTimeline(plan, recipes, eatAt, e => e.title);
    expect(dishes.map(d => [d.title, time(d.startAt), time(d.cookAt)])).toEqual([
      ['roast', '16:40', '17:00'],
      ['potatoes', '17:35', '17:45'],
      // No cook time, so no second time to give.
      ['salad', '18:15', null],
      // No minutes at all: listed last, never guessed.
      ['bread', null, null],
    ]);
  });

  it('leaves a leftover night and a typed meal untimed', () => {
    const { dishes } = serveTimeline([
      entry('roast', { leftoverId: 'l1' }),
      entry('typed', { recipeId: null }),
    ], recipes, eatAt, e => e.title);
    expect(dishes.every(d => d.startAt === null && d.timing === null)).toBe(true);
  });

  it('offers only a start still to come', () => {
    const { dishes } = serveTimeline(plan, recipes, eatAt, e => e.title);
    const at5 = new Date(2026, 9, 10, 17, 0);
    expect(dishes.map(d => isStartAhead(d, at5))).toEqual([false, true, true, false]);
  });
});

describe('a start task', () => {
  const fmt = (d: Date) => time(d)!;
  const eatAt = new Date(2026, 9, 10, 18, 30);

  it('is due on its day, reminds at the start, and says the plan', () => {
    const [roast] = serveTimeline([entry('roast')], new Map([['roast', recipe('roast', { prepMinutes: 20, estimatedMinutes: 90 })]]), eatAt, e => 'Roast chicken').dishes;
    const draft = startTaskDraft(roast, eatAt, '00:00', fmt)!;
    expect(draft.title).toBe('Start Roast chicken');
    expect(new Date(draft.reminderTime)).toEqual(new Date(2026, 9, 10, 16, 40));
    expect(new Date(draft.dueDate)).toEqual(new Date(2026, 9, 10, 12));
    expect(draft.estimatedMinutes).toBe(110);
    expect(draft.notes).toBe('Start prep at 16:40, cooking at 17:00. Eating at 18:30. Prep 20 min, cook 1 hr 30 min.');
  });

  it('dates a start before the reset on the day before', () => {
    // A 1 AM dinner under a 4 AM reset, with a dish started at 11 PM.
    const late = eatAtInstant('2026-10-10', '01:00', '04:00');
    const [dish] = serveTimeline([entry('r')], new Map([['r', recipe('r', { estimatedMinutes: 120 })]]), late, e => e.title).dishes;
    expect(new Date(startTaskDraft(dish, late, '04:00', fmt)!.dueDate)).toEqual(new Date(2026, 9, 10, 12));
  });

  it('is nothing for an untimed dish', () => {
    const [dish] = serveTimeline([entry('r')], new Map([['r', recipe('r')]]), eatAt, e => e.title).dishes;
    expect(startTaskDraft(dish, eatAt, '00:00', fmt)).toBeNull();
  });
});
