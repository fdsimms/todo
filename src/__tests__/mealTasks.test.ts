import {
  MEAL_SLOT_SEGMENTS,
  cookTaskDraft,
  cookTaskFields,
  cookTaskNeedsUpdate,
  cookTaskTitle,
  wantsCookTask,
} from '../utils/mealTasks';
import type { MealPlanEntry, MealSlot } from '../types';

// dateUtils reaches the settings store, which reaches expo-sqlite — same mock
// dateUtils' own suite uses. Nothing here reads a setting.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

function entry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'm-1',
    date: '2026-08-11',
    slot: 'dinner',
    recipeId: null,
    title: 'Frijoles de la olla',
    sortOrder: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    recipeScale: 1,
    cookTask: null,
    ...overrides,
  };
}

describe('wantsCookTask', () => {
  it('takes a recipe-backed meal, and only while the setting is on', () => {
    const meal = entry({ recipeId: 'r1' });
    expect(wantsCookTask(meal, true)).toBe(true);
    expect(wantsCookTask(meal, false)).toBe(false);
  });

  // The Quest-protein-shake case: the row that made the old block read as
  // though pouring a drink were a chore.
  it('leaves free text alone', () => {
    expect(wantsCookTask(entry({ recipeId: null }), true)).toBe(false);
  });

  it('leaves a leftover alone even when it names a recipe', () => {
    expect(wantsCookTask(entry({ recipeId: 'r1', leftoverId: 'lo-1' }), true)).toBe(false);
  });

  it('lets an explicit answer beat the setting in both directions', () => {
    expect(wantsCookTask(entry({ cookTask: true }), false)).toBe(true);
    expect(wantsCookTask(entry({ recipeId: 'r1', cookTask: false }), true)).toBe(false);
  });

  // The tombstone has to outrank the default, or deleting the task and then
  // editing the meal brings it straight back.
  it('keeps honouring a false through a change that would otherwise qualify', () => {
    const optedOut = entry({ recipeId: 'r2', cookTask: false, slot: 'lunch' });
    expect(wantsCookTask(optedOut, true)).toBe(false);
  });
});

describe('cookTaskFields', () => {
  it('names the task after the meal', () => {
    expect(cookTaskTitle(entry())).toBe('Cook Frijoles de la olla');
  });

  it('segments each slot to its own part of the day', () => {
    const segs = (slot: MealSlot) => cookTaskFields(entry({ slot })).timeSegments;
    expect(segs('breakfast')).toEqual(['morning']);
    expect(segs('lunch')).toEqual(['afternoon']);
    expect(segs('dinner')).toEqual(['evening']);
    // A snack is whenever, so it claims no part of the day.
    expect(segs('snack')).toEqual([]);
  });

  it('covers every slot, so no slot falls through to undefined', () => {
    const slots: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
    slots.forEach(slot => expect(MEAL_SLOT_SEGMENTS[slot]).toBeDefined());
  });

  it('dates the task to the meal\'s own local day', () => {
    const { dueDate } = cookTaskFields(entry({ date: '2026-08-11' }));
    // Noon-normalized, the same anchor this meal's prep tasks resolve against,
    // and local — a UTC-parsed midnight would read as the 10th behind UTC.
    const d = new Date(dueDate);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(11);
    expect(d.getHours()).toBe(12);
  });

  it('carries the back-pointer on a new draft', () => {
    expect(cookTaskDraft(entry({ id: 'm-9' })).mealEntryId).toBe('m-9');
  });
});

describe('cookTaskNeedsUpdate', () => {
  const meal = entry({ date: '2026-08-11', slot: 'dinner' });
  const current = cookTaskFields(meal);

  it('is false when the task already says the right thing', () => {
    expect(cookTaskNeedsUpdate(current, meal)).toBe(false);
  });

  it('notices a rename, a new day and a new slot', () => {
    expect(cookTaskNeedsUpdate({ ...current, title: 'Cook something else' }, meal)).toBe(true);
    expect(cookTaskNeedsUpdate(current, entry({ date: '2026-08-12' }))).toBe(true);
    expect(cookTaskNeedsUpdate(current, entry({ slot: 'breakfast' }))).toBe(true);
  });

  // Only three fields are the meal's; everything else on the row is the
  // user's and must never provoke a write.
  it('ignores a task the user has filed, prioritised or dated a reminder on', () => {
    expect(cookTaskNeedsUpdate({ ...current, timeSegments: ['evening'] }, meal)).toBe(false);
  });

  it('notices a task that lost its segment entirely', () => {
    expect(cookTaskNeedsUpdate({ ...current, timeSegments: [] }, meal)).toBe(true);
  });
});

describe('cookTaskDraft category', () => {
  it('files the task where the setting says, and nowhere by default', () => {
    expect(cookTaskDraft(entry()).category).toBeNull();
    expect(cookTaskDraft(entry(), 'Kitchen').category).toBe('Kitchen');
  });

  // Category is applied on creation only — it isn't one of the three fields
  // the meal owns, so a reconcile must never rewrite where the user filed it.
  it('is not one of the fields a reconcile compares', () => {
    const meal = entry();
    const filed = { ...cookTaskFields(meal), category: 'Somewhere else' };
    expect(cookTaskNeedsUpdate(filed, meal)).toBe(false);
  });
});
