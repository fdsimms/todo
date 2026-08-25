import type { MealPlanEntry, MealSlot } from '../types';
import { decidableNights, weekNights } from '../utils/weekPlan';

// weekPlan reaches dateUtils for dayKeyOf, which reaches the settings store for
// dayResetTime — which nothing here needs: a meal plan day key is a calendar
// day and carries no time at all.
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
    createdAt: `2026-01-01T00:00:0${seq % 10}.000Z`,
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

// Noon, so nothing here can be pushed onto the neighbouring day by a timezone.
function day(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

// Mon 3 Aug 2026 → Sun 9 Aug 2026.
const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
  .map(day);

describe('weekNights', () => {
  it('marks a night open when the anchor slot is empty, whatever else is on the day', () => {
    const entries = [
      entry('2026-08-04', 'breakfast'),
      entry('2026-08-05', 'dinner'),
    ];
    const nights = weekNights(entries, WEEK, '2026-08-03');
    expect(nights.map(n => n.open)).toEqual([true, true, false, true, true, true, true]);
    // The breakfast is still the day's, and still rendered — it just doesn't
    // settle the night.
    expect(nights[1].entries).toHaveLength(1);
  });

  it('marks past and today off the day key, not off the entries', () => {
    const nights = weekNights([], WEEK, '2026-08-06');
    expect(nights.map(n => n.past)).toEqual([true, true, true, false, false, false, false]);
    expect(nights.filter(n => n.today).map(n => n.dayKey)).toEqual(['2026-08-06']);
  });

  it('reads a day in reading order', () => {
    const entries = [
      entry('2026-08-05', 'dinner', { title: 'Chilli' }),
      entry('2026-08-05', 'breakfast', { title: 'Porridge' }),
    ];
    const nights = weekNights(entries, WEEK, '2026-08-03');
    expect(nights[2].entries.map(e => e.title)).toEqual(['Porridge', 'Chilli']);
  });

  it('takes the anchor slot as a parameter', () => {
    const entries = [entry('2026-08-05', 'dinner')];
    expect(weekNights(entries, WEEK, '2026-08-03', 'lunch')[2].open).toBe(true);
  });

  it('has nothing to say about an empty week of days', () => {
    expect(weekNights([entry('2026-08-05', 'dinner')], [], '2026-08-03')).toEqual([]);
  });
});

describe('decidableNights', () => {
  it('drops an open night that has already passed', () => {
    const nights = weekNights([], WEEK, '2026-08-06');
    expect(decidableNights(nights).map(d => d.getDate())).toEqual([6, 7, 8, 9]);
  });

  it('drops a night that is spoken for', () => {
    const entries = [entry('2026-08-07', 'dinner')];
    const nights = weekNights(entries, WEEK, '2026-08-06');
    expect(decidableNights(nights).map(d => d.getDate())).toEqual([6, 8, 9]);
  });

  it('is empty for a week entirely behind the reader', () => {
    expect(decidableNights(weekNights([], WEEK, '2026-08-20'))).toEqual([]);
  });
});
