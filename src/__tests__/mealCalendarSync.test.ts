import type { MealPlanEntry } from '../types';

let mockSettings: { mealCalendarId: string | null } = { mealCalendarId: null };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
jest.mock('../utils/calendarSync', () => ({
  createAllDayEvent: (...args: unknown[]) => mockCreate(...args),
  updateAllDayEvent: (...args: unknown[]) => mockUpdate(...args),
  deleteCalendarEvent: (...args: unknown[]) => mockDelete(...args),
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { mealEventTitle, mealEventFields, syncMealEvent } from '../utils/mealCalendarSync';

const BASE: MealPlanEntry = {
  id: 'meal-1',
  date: '2026-08-13',
  slot: 'dinner',
  recipeId: 'r1',
  title: 'Weeknight chicken stir-fry',
  sortOrder: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  cookedAt: null,
  leftoverId: null,
  recipeChoices: [],
  personIds: [],
  recipeScale: 1,
  cookTask: null,
  shopTask: null,
  calendarEventId: null,
};

const entry = (overrides: Partial<MealPlanEntry> = {}): MealPlanEntry => ({ ...BASE, ...overrides });

beforeEach(() => {
  mockSettings = { mealCalendarId: 'cal-1' };
  mockDemoActive = false;
  mockCreate.mockReset().mockResolvedValue('evt-new');
  mockUpdate.mockReset().mockResolvedValue(true);
  mockDelete.mockReset().mockResolvedValue(undefined);
});

describe('mealEventTitle', () => {
  it('names the slot ahead of the dish', () => {
    expect(mealEventTitle(entry())).toBe('Dinner: Weeknight chicken stir-fry');
    expect(mealEventTitle(entry({ slot: 'breakfast', title: 'Overnight oats' })))
      .toBe('Breakfast: Overnight oats');
    expect(mealEventTitle(entry({ slot: 'snack', title: 'Hummus plate' })))
      .toBe('Snack: Hummus plate');
  });

  it('falls back to the slot alone rather than a trailing colon', () => {
    expect(mealEventTitle(entry({ title: '   ' }))).toBe('Dinner');
  });

  it('reads the entry title, never a recipe lookup', () => {
    // The entry keeps its own title in step; this stays free of the recipe store.
    expect(mealEventTitle(entry({ recipeId: 'r-other', title: 'Takeaway curry' })))
      .toBe('Dinner: Takeaway curry');
  });
});

describe('mealEventFields', () => {
  it('resolves the day key to that local day', () => {
    const { date } = mealEventFields(entry({ date: '2026-08-13' }));
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(13);
  });
});

describe('syncMealEvent', () => {
  it('creates an event and hands back the new id', async () => {
    expect(await syncMealEvent(entry())).toBe('evt-new');
    expect(mockCreate).toHaveBeenCalledWith('cal-1', {
      title: 'Dinner: Weeknight chicken stir-fry',
      date: expect.any(Date),
    });
  });

  it('updates in place and keeps the same id', async () => {
    expect(await syncMealEvent(entry({ calendarEventId: 'evt-1' }))).toBe('evt-1');
    expect(mockUpdate).toHaveBeenCalledWith('evt-1', expect.objectContaining({
      title: 'Dinner: Weeknight chicken stir-fry',
    }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('writes a fresh event when the stored id no longer resolves', async () => {
    mockUpdate.mockResolvedValue(false);
    expect(await syncMealEvent(entry({ calendarEventId: 'stale' }))).toBe('evt-new');
    expect(mockCreate).toHaveBeenCalled();
  });

  it('deletes the event and unlinks when no calendar is picked', async () => {
    mockSettings = { mealCalendarId: null };
    expect(await syncMealEvent(entry({ calendarEventId: 'evt-1' }))).toBeNull();
    expect(mockDelete).toHaveBeenCalledWith('evt-1');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not call delete when there was never an event to remove', async () => {
    mockSettings = { mealCalendarId: null };
    expect(await syncMealEvent(entry())).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('keeps a cooked meal on the calendar', async () => {
    // Unlike a cook task, which a cooked meal has no use for: Thursday's
    // dinner having been eaten doesn't stop it being what was for dinner.
    expect(await syncMealEvent(entry({ cookedAt: '2026-08-13T19:00:00.000Z', calendarEventId: 'evt-1' })))
      .toBe('evt-1');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('mirrors a leftover night too', async () => {
    // "Dinner: Leftover stir-fry" is a complete answer to the question the
    // calendar is being asked; cookTaskFor skips leftovers because there is
    // nothing to cook, which is a different question.
    expect(await syncMealEvent(entry({
      recipeId: null,
      leftoverId: 'lo-1',
      title: 'Leftover stir-fry (1 day old)',
    }))).toBe('evt-new');
    expect(mockCreate).toHaveBeenCalledWith('cal-1', expect.objectContaining({
      title: 'Dinner: Leftover stir-fry (1 day old)',
    }));
  });

  it('returns null when the device write fails, so the next reconcile retries', async () => {
    mockCreate.mockResolvedValue(null);
    expect(await syncMealEvent(entry())).toBeNull();
  });

  it('never touches the device calendar while demo mode is active', async () => {
    // #1629 — demo mode seeds a week of meals through the real planMeal
    // action, and without this guard every one of them would write a real
    // all-day event to whatever calendar the user had picked before
    // switching demo mode on.
    mockDemoActive = true;
    expect(await syncMealEvent(entry({ calendarEventId: 'evt-1' }))).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
