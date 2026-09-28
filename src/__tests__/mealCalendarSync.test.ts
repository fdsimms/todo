import type { MealPlanEntry } from '../types';

let mockSettings: { mealCalendarId: string | null } = { mealCalendarId: null };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

const mockCreate = jest.fn();
const mockMove = jest.fn();
const mockDelete = jest.fn();
jest.mock('../utils/calendarSync', () => ({
  createAllDayEvent: (...args: unknown[]) => mockCreate(...args),
  moveAllDayEvent: (...args: unknown[]) => mockMove(...args),
  deleteCalendarEvent: (...args: unknown[]) => mockDelete(...args),
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { mealEventTitle, mealEventFields, mealEventsAfterSync, syncMealEvent } from '../utils/mealCalendarSync';
import { emptyApplyReport, type ApplyReport } from '../utils/syncMerge';
import { dayKeyOf } from '../utils/dateUtils';
import { subDays } from 'date-fns/subDays';

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
  recipeScale: 1,
  cookTask: null,
  shopTask: null,
  logMeal: null,
  calendarEventId: null,
};

const entry = (overrides: Partial<MealPlanEntry> = {}): MealPlanEntry => ({ ...BASE, ...overrides });

beforeEach(() => {
  mockSettings = { mealCalendarId: 'cal-1' };
  mockDemoActive = false;
  mockCreate.mockReset().mockResolvedValue('evt-new');
  // EventKit reports the same id back for an event rewritten in place.
  mockMove.mockReset().mockImplementation((id: string) => Promise.resolve(id));
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

  it('says a leftover night is leftovers, so nobody cooks the dish again', () => {
    expect(mealEventTitle(entry({ recipeId: null, leftoverId: 'lo-1', title: 'Chicken stir-fry' })))
      .toBe('Dinner: Chicken stir-fry (leftovers)');
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
    expect(mockMove).toHaveBeenCalledWith('evt-1', 'cal-1', expect.objectContaining({
      title: 'Dinner: Weeknight chicken stir-fry',
    }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  // #2949: switching "Write meals to" from a shared calendar to a private one
  // kept rewriting every existing meal in the shared one, because the rewrite
  // never said which calendar.
  it('moves an existing event into the calendar picked now, and links the id it comes back with', async () => {
    mockSettings = { mealCalendarId: 'cal-home' };
    mockMove.mockResolvedValue('evt-moved');
    expect(await syncMealEvent(entry({ calendarEventId: 'evt-family' }))).toBe('evt-moved');
    expect(mockMove).toHaveBeenCalledWith('evt-family', 'cal-home', expect.objectContaining({
      title: 'Dinner: Weeknight chicken stir-fry',
    }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('writes a fresh event when the stored id no longer resolves', async () => {
    mockMove.mockResolvedValue(null);
    expect(await syncMealEvent(entry({ calendarEventId: 'stale' }))).toBe('evt-new');
    expect(mockCreate).toHaveBeenCalledWith('cal-1', expect.anything());
  });

  it('clears the old event before writing a fresh one, so a refused move leaves no copy behind', async () => {
    mockMove.mockResolvedValue(null);
    await syncMealEvent(entry({ calendarEventId: 'evt-family' }));
    expect(mockDelete).toHaveBeenCalledWith('evt-family');
    expect(mockDelete.mock.invocationCallOrder[0]).toBeLessThan(mockCreate.mock.invocationCallOrder[0]);
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
    // "Dinner: Stir-fry (leftovers)" is a complete answer to the question the
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
    expect(mockMove).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

// #2950. A meal's event belongs to the device that wrote it, so a peer's move,
// rename or removal reaches it only through this.
describe('mealEventsAfterSync', () => {
  const NOW = new Date(2026, 7, 20, 12);
  const daysAgo = (n: number) => dayKeyOf(subDays(NOW, n));
  const applied = (over: Partial<ApplyReport>) => ({ ...emptyApplyReport(), ...over });
  const lookup = (...rows: MealPlanEntry[]) => (id: string) => rows.find(r => r.id === id) ?? null;

  it('reconciles a changed meal that holds an event of this device\'s', () => {
    const moved = entry({ id: 'm1', date: '2026-08-14', calendarEventId: 'evt-1' });

    const plan = mealEventsAfterSync(applied({ mealEntryIds: ['m1'] }), lookup(moved), NOW);

    expect(plan.reconcile).toEqual([moved]);
    expect(plan.remove).toEqual([]);
  });

  it('leaves a changed meal with no event here alone, rather than writing a second one', () => {
    // Every meal that arrives new is this shape: the id never syncs. The device
    // that planned it may already have written it to a shared calendar.
    const plan = mealEventsAfterSync(
      applied({ mealEntryIds: ['m1'] }),
      lookup(entry({ id: 'm1', calendarEventId: null })),
      NOW,
    );

    expect(plan.reconcile).toEqual([]);
  });

  it('skips a meal that no longer resolves, and reconciles one changed twice only once', () => {
    const kept = entry({ id: 'm1', calendarEventId: 'evt-1' });

    const plan = mealEventsAfterSync(applied({ mealEntryIds: ['m1', 'gone', 'm1'] }), lookup(kept), NOW);

    expect(plan.reconcile).toEqual([kept]);
  });

  it('deletes the event of a meal another device removed', () => {
    const plan = mealEventsAfterSync(
      applied({ removedMealEvents: [{ eventId: 'evt-9', date: daysAgo(3) }] }),
      lookup(),
      NOW,
    );

    expect(plan.remove).toEqual(['evt-9']);
  });

  it('keeps the event of a meal the 180-day purge took, with a margin for a peer a day or two ahead', () => {
    // The purge leaves events on the calendar as the household's record, and
    // runs on every device, so its deletions arrive here too.
    const plan = mealEventsAfterSync(
      applied({
        removedMealEvents: [
          { eventId: 'evt-purged', date: daysAgo(200) },
          { eventId: 'evt-peer-ahead', date: daysAgo(179) },
          { eventId: 'evt-removed', date: daysAgo(177) },
        ],
      }),
      lookup(),
      NOW,
    );

    expect(plan.remove).toEqual(['evt-removed']);
  });

  it('asks for nothing at all in demo mode', () => {
    mockDemoActive = true;

    const plan = mealEventsAfterSync(
      applied({
        mealEntryIds: ['m1'],
        removedMealEvents: [{ eventId: 'evt-9', date: daysAgo(3) }],
      }),
      lookup(entry({ id: 'm1', calendarEventId: 'evt-1' })),
      NOW,
    );

    expect(plan).toEqual({ reconcile: [], remove: [] });
  });
});
