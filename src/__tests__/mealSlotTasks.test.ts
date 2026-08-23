import type { MealPlanEntry, MealSlot, Task } from '../types';
import {
  DEFAULT_MEAL_SLOTS_ENABLED,
  MEAL_SLOT_SEGMENTS,
  completesMealSlot,
  mealSlotChain,
  mealSlotDrift,
  mealSlotLinkUrl,
  mealSlotSourceId,
  mealSlotStepTimeSegments,
  mealSlotTaskDraft,
  mealSlotTaskFields,
  mealSlotTaskTitle,
  parseMealSlotSource,
} from '../utils/mealSlotTasks';

// mealSlotTasks reaches dateUtils for dayKeyToDate, which reaches the settings
// store for dayResetTime — nothing here needs it, since every date this module
// handles is a calendar day key it was handed. Same defensive mock as
// mealPlanNudge.test.ts / mealPlan.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
function entry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  seq += 1;
  return {
    id: `m-${seq}`,
    date: '2026-08-22',
    slot: 'dinner',
    recipeId: null,
    title: `Meal ${seq}`,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    recipeScale: 1,
    cookTask: null,
    calendarEventId: null,
    ...overrides,
  };
}

/** A live meal task, as the daily pass would have written it. */
function taskFor(
  dayKey: string,
  slot: MealSlot,
  e: MealPlanEntry | null,
  over: Partial<Task> = {},
  recipeMinutes: number | null = null
) {
  const fields = mealSlotTaskFields(dayKey, slot, e, recipeMinutes);
  return { ...fields, chainIndex: 0, recurrenceType: 'none', ...over } as Task;
}

beforeEach(() => { seq = 0; });

describe('source ids', () => {
  it('round-trips a day and a slot', () => {
    expect(mealSlotSourceId('2026-08-22', 'lunch')).toBe('2026-08-22#lunch');
    expect(parseMealSlotSource('2026-08-22#lunch')).toEqual({ dayKey: '2026-08-22', slot: 'lunch' });
  });

  it('refuses anything that isn\'t one', () => {
    // A meal entry id, which is what this generator's predecessor stored — the
    // one string that must not be mistaken for a slot, since a completion
    // reads it to decide which meal to mark cooked.
    expect(parseMealSlotSource('m-12')).toBeNull();
    expect(parseMealSlotSource(null)).toBeNull();
    expect(parseMealSlotSource('2026-08-22#brunch')).toBeNull();
    expect(parseMealSlotSource('not-a-day#lunch')).toBeNull();
    // The day key contains '-' and the split is on '#', so this is unambiguous
    // rather than merely usually right.
    expect(parseMealSlotSource('#lunch')).toBeNull();
  });
});

describe('the chain, given what the slot holds', () => {
  it('asks you to choose when there is nothing in it', () => {
    expect(mealSlotChain('lunch', null).map(c => c.title))
      .toEqual(['Choose lunch', 'Prepare lunch', 'Eat lunch']);
    expect(mealSlotTaskTitle('lunch', null)).toBe('Lunch');
  });

  it('drops the choosing once something is planned', () => {
    // "Already chosen" is the same task with its first step gone.
    const planned = entry({ recipeId: 'r1', title: 'Chili' });
    expect(mealSlotChain('dinner', planned).map(c => c.title))
      .toEqual(['Cook Chili', 'Eat Chili']);
    expect(mealSlotTaskTitle('dinner', planned)).toBe('Chili');
  });

  it('carries the recipe\'s time onto the Cook step alone', () => {
    // recipeMinutes is the caller's already-summed prep+cook total (see
    // recipeMinutesFor); there's no separate Prepare step once a recipe is
    // chosen, so Cook X is the one step that gets it.
    const planned = entry({ recipeId: 'r1', title: 'Chili' });
    const chain = mealSlotChain('dinner', planned, 35);
    expect(chain.map(c => c.estimatedMinutes)).toEqual([35, null]);
  });

  it('leaves every step unestimated with no recipe time to give', () => {
    expect(mealSlotChain('lunch', null).map(c => c.estimatedMinutes)).toEqual([null, null, null]);
    const planned = entry({ recipeId: 'r1', title: 'Chili' });
    expect(mealSlotChain('dinner', planned).map(c => c.estimatedMinutes)).toEqual([null, null]);
  });

  it('ignores a recipe time when the slot has nothing to cook', () => {
    // A leftover/takeaway chain is Eat X alone — recipeMinutes has no Cook
    // step to land on.
    const leftover = entry({ recipeId: 'r1', leftoverId: 'lo-1', title: "Tuesday's chilli" });
    expect(mealSlotChain('dinner', leftover, 35).map(c => c.estimatedMinutes)).toEqual([null]);
  });

  it('drops the cooking too for a leftover or a takeaway', () => {
    // A recipe is the app's own evidence that a meal is something you make;
    // pointing at the fridge is the opposite of a thing to cook.
    const leftover = entry({ recipeId: 'r1', leftoverId: 'lo-1', title: "Tuesday's chilli" });
    const takeaway = entry({ title: 'Takeaway' });
    expect(mealSlotChain('dinner', leftover).map(c => c.title)).toEqual(["Eat Tuesday's chilli"]);
    expect(mealSlotChain('dinner', takeaway).map(c => c.title)).toEqual(['Eat Takeaway']);
    // One step, so no chain at all — a single-item chain reads as a plain task
    // everywhere in the UI anyway (see activeChainStep).
    expect(mealSlotTaskFields('2026-08-22', 'dinner', takeaway).chainEnabled).toBe(false);
    expect(mealSlotTaskTitle('dinner', takeaway)).toBe('Eat Takeaway');
  });

  it('gives its steps ids derived from the slot, so an unchanged chain compares equal', () => {
    const a = mealSlotChain('lunch', null);
    const b = mealSlotChain('lunch', null);
    expect(a.map(c => c.id)).toEqual(b.map(c => c.id));
    expect(a[0].id).toBe('lunch-choose');
  });
});

describe('the fields a slot owns', () => {
  it('does not hide an unanswered slot\'s first step — Choose is not the meal itself', () => {
    // [Choose, Prepare, Eat]: mealSlotTaskFields always describes step 0, and
    // deciding what's for dinner isn't a thing that happens at dinner time.
    expect(mealSlotTaskFields('2026-08-22', 'breakfast', null).timeSegments).toEqual([]);
    expect(mealSlotTaskFields('2026-08-22', 'lunch', null).timeSegments).toEqual([]);
    expect(mealSlotTaskFields('2026-08-22', 'dinner', null).timeSegments).toEqual([]);
  });

  it('does not hide a planned meal\'s Cook step either', () => {
    // [Cook Chili, Eat Chili]: still step 0, still not the meal's own moment.
    const planned = entry({ recipeId: 'r1', title: 'Chili' });
    expect(mealSlotTaskFields('2026-08-22', 'dinner', planned).timeSegments).toEqual([]);
  });

  it('hides a one-step slot behind its own part of the day — it is its own last step', () => {
    const takeaway = entry({ title: 'Takeaway' });
    expect(mealSlotTaskFields('2026-08-22', 'dinner', takeaway).timeSegments).toEqual(['evening']);
    const leftover = entry({ recipeId: 'r1', leftoverId: 'lo-1', title: "Tuesday's chilli" });
    expect(mealSlotTaskFields('2026-08-22', 'dinner', leftover).timeSegments).toEqual(['evening']);
  });

  it('never segments a snack, whatever step it is', () => {
    // A snack is whenever, so segmenting it would invent a time nobody said.
    expect(mealSlotTaskFields('2026-08-22', 'snack', null).timeSegments).toEqual([]);
    expect(mealSlotTaskFields('2026-08-22', 'snack', entry({ title: 'Chips' })).timeSegments).toEqual([]);
    expect(MEAL_SLOT_SEGMENTS.snack).toEqual([]);
  });

  it('lands on the slot\'s own day, noon-normalized', () => {
    expect(mealSlotTaskFields('2026-08-22', 'lunch', null).dueDate.startsWith('2026-08-22')).toBe(true);
  });

  it('offers the picker only while the slot is unanswered', () => {
    expect(mealSlotLinkUrl('2026-08-22', 'lunch', false))
      .toBe('dundundun://mealplan?date=2026-08-22&pick=lunch');
    // Answered, so the row stops offering to re-decide.
    expect(mealSlotLinkUrl('2026-08-22', 'lunch', true)).toBe('dundundun://mealplan?date=2026-08-22');
  });

  it('files a new task under the category it was given, and points back at its slot', () => {
    const draft = mealSlotTaskDraft('2026-08-22', 'lunch', null, 'Meal Plan');
    expect(draft.category).toBe('Meal Plan');
    expect(draft.generatedKind).toBe('mealSlot');
    expect(draft.generatedSourceId).toBe('2026-08-22#lunch');
    expect(draft.chainIndex).toBe(0);
  });
});

describe('mealSlotStepTimeSegments', () => {
  it('gates only the step that finishes the chain', () => {
    // [Choose, Prepare, Eat] — only index 2 (Eat) is the meal itself.
    expect(mealSlotStepTimeSegments('dinner', 0, 3)).toEqual([]);
    expect(mealSlotStepTimeSegments('dinner', 1, 3)).toEqual([]);
    expect(mealSlotStepTimeSegments('dinner', 2, 3)).toEqual(['evening']);
  });

  it('gates the last step of a two-step chain, not the first', () => {
    // [Cook X, Eat X]
    expect(mealSlotStepTimeSegments('lunch', 0, 2)).toEqual([]);
    expect(mealSlotStepTimeSegments('lunch', 1, 2)).toEqual(['afternoon']);
  });

  it('gates a one-step slot immediately — it is its own last step', () => {
    expect(mealSlotStepTimeSegments('breakfast', 0, 1)).toEqual(['morning']);
  });

  it('never gates a snack, whatever step it is', () => {
    expect(mealSlotStepTimeSegments('snack', 0, 3)).toEqual([]);
    expect(mealSlotStepTimeSegments('snack', 2, 3)).toEqual([]);
  });
});

describe('drift', () => {
  it('writes nothing when nothing has changed', () => {
    // The reconcile runs on every meal-plan mutation, most of which (a scale
    // change, a re-sort, an edit to another slot) change nothing this shows.
    const task = taskFor('2026-08-22', 'dinner', null);
    expect(mealSlotDrift(task, '2026-08-22', 'dinner', null)).toBeNull();
  });

  it('rewrites the whole row when the slot is answered', () => {
    const task = taskFor('2026-08-22', 'dinner', null);
    const planned = entry({ recipeId: 'r1', title: 'Chili' });
    const updates = mealSlotDrift(task, '2026-08-22', 'dinner', planned)!;
    expect(updates.title).toBe('Chili');
    expect(updates.chainItems!.map(c => c.title)).toEqual(['Cook Chili', 'Eat Chili']);
    expect(updates.linkUrl).toBe('dundundun://mealplan?date=2026-08-22');
    // Still step 0 of its (now two-step) chain either way — nothing to write.
    expect(updates.timeSegments).toBeUndefined();
  });

  it('holds the steps — and the time gate — once the chain has been started', () => {
    // chainIndex > 0 means a step has been ticked and the next row spawned, and
    // the index only means anything against the list it came from: step 1 of
    // [Choose, Prepare, Eat] has no honest answer in [Cook X, Eat X]. Which
    // step is time-gated is exactly as chain-position-dependent, so it's
    // withheld the same way.
    const task = taskFor('2026-08-22', 'dinner', null, { chainIndex: 1 });
    const planned = entry({ recipeId: 'r1', title: 'Chili' });
    const updates = mealSlotDrift(task, '2026-08-22', 'dinner', planned)!;
    expect(updates.chainItems).toBeUndefined();
    expect(updates.chainEnabled).toBeUndefined();
    expect(updates.timeSegments).toBeUndefined();
    // The rest still chases the meal.
    expect(updates.title).toBe('Chili');
  });

  it('picks up a new time gate on an unstarted row when the answer changes its step count', () => {
    // Still chainIndex 0, but the slot going from unanswered (3 steps) to a
    // leftover (1 step, its own last step) moves step 0 from "not the meal"
    // to "is the meal" — a real drift, not a no-op.
    const task = taskFor('2026-08-22', 'dinner', null);
    const leftover = entry({ recipeId: 'r1', leftoverId: 'lo-1', title: "Tuesday's chilli" });
    const updates = mealSlotDrift(task, '2026-08-22', 'dinner', leftover)!;
    expect(updates.timeSegments).toEqual(['evening']);
  });

  it('picks up a changed recipe time on an unstarted row', () => {
    const planned = entry({ recipeId: 'r1', title: 'Chili' });
    const task = taskFor('2026-08-22', 'dinner', planned, {}, 20);
    const updates = mealSlotDrift(task, '2026-08-22', 'dinner', planned, 35)!;
    expect(updates.chainItems!.map(c => c.estimatedMinutes)).toEqual([35, null]);
  });

  it('writes nothing when the recipe time is unchanged', () => {
    const planned = entry({ recipeId: 'r1', title: 'Chili' });
    const task = taskFor('2026-08-22', 'dinner', planned, {}, 20);
    expect(mealSlotDrift(task, '2026-08-22', 'dinner', planned, 20)).toBeNull();
  });

  it('holds the recipe time too once the chain has been started', () => {
    // Nothing else about the row has drifted, so withholding chainItems along
    // with it means there is nothing left to write at all.
    const planned = entry({ recipeId: 'r1', title: 'Chili' });
    const task = taskFor('2026-08-22', 'dinner', planned, { chainIndex: 1 }, 20);
    expect(mealSlotDrift(task, '2026-08-22', 'dinner', planned, 35)).toBeNull();
  });

  it('never touches the date', () => {
    // Set once at creation from the day in the source id, which never changes —
    // so the only thing that can move it is the user, and chasing it would
    // rewrite a row they deferred to tomorrow straight back onto today.
    const deferred = taskFor('2026-08-22', 'dinner', null, { dueDate: '2026-08-25T12:00:00.000Z' });
    const updates = mealSlotDrift(deferred, '2026-08-22', 'dinner', null);
    expect(updates).toBeNull();
  });
});

describe('completesMealSlot', () => {
  it('is only the last step of a real chain', () => {
    // A cook task answered "did this happen" by existing. A chain's first tick
    // is "I have decided what to have", which is nowhere near having had it.
    const chain = taskFor('2026-08-22', 'dinner', null);
    expect(completesMealSlot({ ...chain, chainIndex: 0 })).toBe(false);
    expect(completesMealSlot({ ...chain, chainIndex: 1 })).toBe(false);
    expect(completesMealSlot({ ...chain, chainIndex: 2 })).toBe(true);
  });

  it('is immediate for a slot with only one step', () => {
    // A leftover or a takeaway is its own last step.
    const single = taskFor('2026-08-22', 'dinner', entry({ title: 'Takeaway' }));
    expect(completesMealSlot(single)).toBe(true);
  });
});

describe('the default set of meals', () => {
  it('is the three a day is counted out of', () => {
    // Matches MEAL_PLAN_NUDGE_SLOTS: a day isn't incomplete for want of a
    // snack, and a snack has no part of the day to surface in.
    expect([...DEFAULT_MEAL_SLOTS_ENABLED]).toEqual(['breakfast', 'lunch', 'dinner']);
  });
});
