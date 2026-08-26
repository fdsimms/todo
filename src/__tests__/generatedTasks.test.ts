import {
  GENERATED_KINDS,
  GENERATED_KIND_LIST,
  GENERATED_KIND_SPECS,
  generatedBy,
  generatedSourceOf,
  generatedTaskCountOf,
  hasAnyGeneratedTask,
  isUseUpKind,
  liveGeneratedTask,
  liveGeneratedTasksOfKind,
  liveUseUpTaskCount,
  wantsGeneratedTask,
} from '../utils/generatedTasks';
import type { GeneratedKind, Task } from '../types';

type TaskShape = Pick<Task, 'id' | 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>;

let seq = 0;
function task(overrides: Partial<TaskShape> = {}): TaskShape {
  return {
    id: `task-${++seq}`,
    generatedKind: null,
    generatedSourceId: null,
    completed: false,
    archived: false,
    ...overrides,
  };
}

const from = (kind: GeneratedKind, sourceId: string | null, rest: Partial<TaskShape> = {}) =>
  task({ generatedKind: kind, generatedSourceId: sourceId, ...rest });

describe('wantsGeneratedTask', () => {
  it('defers to the setting when the source has no explicit answer', () => {
    expect(wantsGeneratedTask(null, true, true)).toBe(true);
    expect(wantsGeneratedTask(null, false, true)).toBe(false);
  });

  it('still needs the source to qualify when the setting is on', () => {
    expect(wantsGeneratedTask(null, true, false)).toBe(false);
  });

  it('lets an explicit yes beat the setting being off', () => {
    expect(wantsGeneratedTask(true, false, true)).toBe(true);
  });

  it('lets an explicit no beat the setting being on — the opt-out a delete records', () => {
    expect(wantsGeneratedTask(false, true, true)).toBe(false);
  });

  it('honours an explicit yes even for a source that would not otherwise qualify', () => {
    // "I keep wasting this one" has to outrank the default, or the answer would
    // be re-decided against the user on the next reconcile.
    expect(wantsGeneratedTask(true, true, false)).toBe(true);
  });

  it('treats undefined as "no answer", the same as null', () => {
    // Rows written before a generator's column existed read back undefined.
    expect(wantsGeneratedTask(undefined, true, true)).toBe(true);
    expect(wantsGeneratedTask(undefined, false, true)).toBe(false);
  });
});

describe('liveGeneratedTasksOfKind', () => {
  it('finds every live task of the kind, whatever source each came from', () => {
    // What the meal-plan nudge needs: it lays down a task per day of a week,
    // so there is no single source id to ask about.
    const monday = from('mealPlanNudge', '2026-08-10');
    const tuesday = from('mealPlanNudge', '2026-08-11');
    expect(liveGeneratedTasksOfKind([task(), monday, tuesday], 'mealPlanNudge')).toEqual([
      monday,
      tuesday,
    ]);
  });

  it('finds one whose source id is null, which liveGeneratedTask would too', () => {
    const legacy = from('mealPlanNudge', null);
    expect(liveGeneratedTasksOfKind([legacy], 'mealPlanNudge')).toEqual([legacy]);
  });

  it('ignores completed and archived ones', () => {
    const live = from('mealPlanNudge', '2026-08-10');
    const tasks = [
      live,
      from('mealPlanNudge', '2026-08-11', { completed: true }),
      from('mealPlanNudge', '2026-08-12', { archived: true }),
    ];
    expect(liveGeneratedTasksOfKind(tasks, 'mealPlanNudge')).toEqual([live]);
  });

  it("ignores another generator's tasks", () => {
    expect(liveGeneratedTasksOfKind([from('mealCook', 'm-1')], 'mealPlanNudge')).toEqual([]);
  });

  it('returns them in the order given, which is the store\'s own', () => {
    const a = from('mealPlanNudge', '2026-08-12');
    const b = from('mealPlanNudge', '2026-08-10');
    expect(liveGeneratedTasksOfKind([a, b], 'mealPlanNudge')).toEqual([a, b]);
  });
});

describe('liveGeneratedTask', () => {
  it('finds this source\'s task', () => {
    const wanted = from('groceryUseUp', 'g-1');
    expect(liveGeneratedTask([task(), wanted], 'groceryUseUp', 'g-1')).toBe(wanted);
  });

  it('ignores a completed one — a finished task is a record, not a live chore', () => {
    expect(
      liveGeneratedTask([from('groceryUseUp', 'g-1', { completed: true })], 'groceryUseUp', 'g-1')
    ).toBeUndefined();
  });

  it('ignores an archived one', () => {
    expect(
      liveGeneratedTask([from('groceryUseUp', 'g-1', { archived: true })], 'groceryUseUp', 'g-1')
    ).toBeUndefined();
  });

  it('ignores another source of the same kind', () => {
    expect(liveGeneratedTask([from('groceryUseUp', 'g-2')], 'groceryUseUp', 'g-1')).toBeUndefined();
  });

  it('ignores another kind carrying the same id', () => {
    // The whole hazard of one column where there used to be three: two
    // generators can hand out the same source id and must not collide.
    expect(liveGeneratedTask([from('leftoverUseUp', 'x-1')], 'groceryUseUp', 'x-1')).toBeUndefined();
  });

  it('matches on the kind alone for a generator with no source', () => {
    const nudge = from('mealPlanNudge', null);
    expect(liveGeneratedTask([nudge], 'mealPlanNudge')).toBe(nudge);
  });

  it('never matches a task nobody generated', () => {
    expect(liveGeneratedTask([task()], 'mealPlanNudge')).toBeUndefined();
  });
});

describe('hasAnyGeneratedTask', () => {
  it('counts a finished task, where liveGeneratedTask does not', () => {
    const tasks = [from('mealCook', 'm-1', { completed: true })];
    expect(hasAnyGeneratedTask(tasks, 'mealCook', 'm-1')).toBe(true);
    expect(liveGeneratedTask(tasks, 'mealCook', 'm-1')).toBeUndefined();
  });

  it('counts an archived one too', () => {
    expect(hasAnyGeneratedTask([from('mealCook', 'm-1', { archived: true })], 'mealCook', 'm-1')).toBe(true);
  });

  it('is still scoped to the kind and the source', () => {
    expect(hasAnyGeneratedTask([from('leftoverUseUp', 'm-1')], 'mealCook', 'm-1')).toBe(false);
    expect(hasAnyGeneratedTask([from('mealCook', 'm-2')], 'mealCook', 'm-1')).toBe(false);
  });
});

describe('generatedTaskCountOf', () => {
  it('is 0 for a source with no task yet', () => {
    expect(generatedTaskCountOf([], 'groceryUseUp', 'g-1')).toBe(0);
  });

  it('counts a finished one, like hasAnyGeneratedTask — a repeat purchase must not reuse its id', () => {
    const tasks = [from('groceryUseUp', 'g-1', { completed: true })];
    expect(generatedTaskCountOf(tasks, 'groceryUseUp', 'g-1')).toBe(1);
  });

  it('counts a live one and a finished one for the same source together', () => {
    const tasks = [
      from('groceryUseUp', 'g-1', { completed: true }),
      from('groceryUseUp', 'g-1'),
    ];
    expect(generatedTaskCountOf(tasks, 'groceryUseUp', 'g-1')).toBe(2);
  });

  it('is scoped to the kind and the source, like hasAnyGeneratedTask', () => {
    const tasks = [from('leftoverUseUp', 'g-1'), from('groceryUseUp', 'g-2')];
    expect(generatedTaskCountOf(tasks, 'groceryUseUp', 'g-1')).toBe(0);
  });
});

describe('generatedSourceOf', () => {
  it('gives the source id back for the kind asked about', () => {
    expect(generatedSourceOf(from('mealCook', 'm-1'), 'mealCook')).toBe('m-1');
  });

  it('gives null for a different kind, however the id looks', () => {
    // The guard that stops "complete this task" marking a *meal* cooked
    // because a leftover happened to share the id.
    expect(generatedSourceOf(from('leftoverUseUp', 'm-1'), 'mealCook')).toBeNull();
  });

  it('gives null for a task nobody generated', () => {
    expect(generatedSourceOf(task(), 'mealCook')).toBeNull();
  });
});

describe('generatedBy', () => {
  it('stamps both fields together', () => {
    expect(generatedBy('mealCook', 'm-1')).toEqual({
      generatedKind: 'mealCook',
      generatedSourceId: 'm-1',
    });
  });

  it('defaults the source to null, for a generator projected from no row', () => {
    expect(generatedBy('mealPlanNudge')).toEqual({
      generatedKind: 'mealPlanNudge',
      generatedSourceId: null,
    });
  });
});

describe('isUseUpKind', () => {
  it('is true for the two use-up generators only', () => {
    expect(isUseUpKind('groceryUseUp')).toBe(true);
    expect(isUseUpKind('leftoverUseUp')).toBe(true);
    expect(isUseUpKind('mealCook')).toBe(false);
    expect(isUseUpKind('mealPlanNudge')).toBe(false);
  });
});

describe('liveUseUpTaskCount', () => {
  it('counts grocery and leftover use-up tasks together', () => {
    const tasks = [from('groceryUseUp', 'g-1'), from('leftoverUseUp', 'l-1')];
    expect(liveUseUpTaskCount(tasks)).toBe(2);
  });

  it('ignores cook tasks and the nudge — they draw from no shared cap', () => {
    const tasks = [from('mealCook', 'm-1'), from('mealPlanNudge', '2026-08-10')];
    expect(liveUseUpTaskCount(tasks)).toBe(0);
  });

  it('ignores completed and archived use-up tasks', () => {
    const tasks = [
      from('groceryUseUp', 'g-1', { completed: true }),
      from('leftoverUseUp', 'l-1', { archived: true }),
    ];
    expect(liveUseUpTaskCount(tasks)).toBe(0);
  });

  it('ignores tasks nobody generated', () => {
    expect(liveUseUpTaskCount([task()])).toBe(0);
  });
});

describe('the registry', () => {
  it('describes every kind that is still written, and keeps the retired one answerable', () => {
    // GENERATED_KINDS is what a *listing* enumerates; the specs are keyed by
    // GeneratedKind, which is wider because it also holds 'mealCook'. That kind
    // folded into 'mealSlot' but stays in the union: it's a storage value, and
    // rows written before the fold still say it.
    for (const kind of GENERATED_KINDS) {
      expect(GENERATED_KIND_SPECS[kind]).toBeDefined();
    }
    expect(GENERATED_KIND_LIST).toHaveLength(GENERATED_KINDS.length);
    // Retired: described, so a legacy row is still recognised, but never listed
    // — a settings row for it would offer to turn on a half that can't happen.
    expect(GENERATED_KIND_SPECS.mealCook).toBeDefined();
    expect(GENERATED_KINDS).not.toContain('mealCook');
    expect(GENERATED_KIND_LIST.map(s => s.kind)).not.toContain('mealCook');
  });

  it('lists them in the declared order, which is the order Settings renders', () => {
    expect(GENERATED_KIND_LIST.map(s => s.kind)).toEqual([...GENERATED_KINDS]);
  });

  it('keys each spec under its own kind', () => {
    for (const kind of GENERATED_KINDS) {
      expect(GENERATED_KIND_SPECS[kind].kind).toBe(kind);
    }
  });

  it('gives every kind a label and both hint states', () => {
    for (const spec of GENERATED_KIND_LIST) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.onHint.length).toBeGreaterThan(0);
      expect(spec.offHint.length).toBeGreaterThan(0);
      expect(spec.icon.length).toBeGreaterThan(0);
    }
  });

  it('marks the two calendar-shaped generators as having no source row', () => {
    // It's why generatedSourceId is nullable, and why deleting either's task
    // writes no opt-out — there is nothing to write it on.
    expect(GENERATED_KIND_SPECS.mealPlanNudge.sourced).toBe(false);
    // And it stopped being the only one. A meal task's source id is a day and a
    // slot — a square on the calendar, not a row — which is what lets one exist
    // for a meal nobody has planned yet.
    expect(GENERATED_KIND_SPECS.mealSlot.sourced).toBe(false);
    expect(GENERATED_KIND_SPECS.groceryUseUp.sourced).toBe(true);
    expect(GENERATED_KIND_SPECS.leftoverUseUp.sourced).toBe(true);
    // Sourced by the project it speaks for — the id its linkUrl scopes the
    // pull sheet to, and the row its opt-out is stamped on.
    expect(GENERATED_KIND_SPECS.projectReview.sourced).toBe(true);
    // Sourced by the grocery item whose pantry guess ran out — the row its
    // linkUrl opens and its decline stamp is written on.
    expect(GENERATED_KIND_SPECS.pantryCheck.sourced).toBe(true);
    // Sourced by the MealPlanEntry it shops for — the row its opt-out
    // (MealPlanEntry.shopTask) is written on, and the one deleting the meal
    // takes with it.
    expect(GENERATED_KIND_SPECS.mealShortfall.sourced).toBe(true);
  });

  it('gives every kind a category to file under, the nudge included', () => {
    // The nudge was the odd one out until #1571: no category setting, so the
    // one task written entirely on the app's own schedule landed loose at the
    // top of Today however the other three were filed.
    expect(GENERATED_KIND_LIST.filter(s => s.categorized).map(s => s.kind))
      .toEqual(['mealSlot', 'groceryUseUp', 'pantryCheck', 'pantryReview', 'leftoverUseUp', 'mealPlanNudge', 'mealShortfall', 'projectReview', 'birthday', 'birthdayGift', 'reachOut']);
  });

  it('shares one default category between planning the week and cooking it', () => {
    // Two generators, one section: the distinction between "plan the week" and
    // "cook what you planned" is one only the code makes.
    expect(GENERATED_KIND_SPECS.mealSlot.defaultCategory).toBe('Meal Plan');
    expect(GENERATED_KIND_SPECS.mealPlanNudge.defaultCategory).toBe('Meal Plan');
    // And the third of that set: shopping for the week you planned is the same
    // job again, from the other end.
    expect(GENERATED_KIND_SPECS.mealShortfall.defaultCategory).toBe('Meal Plan');
    expect(GENERATED_KIND_SPECS.leftoverUseUp.defaultCategory).toBe('Leftovers');
    // And one section for the two questions about the kitchen cupboard: using
    // up a bag of spinach and checking whether there's still flour are one trip
    // to the same place.
    expect(GENERATED_KIND_SPECS.groceryUseUp.defaultCategory).toBe('Groceries');
    expect(GENERATED_KIND_SPECS.pantryCheck.defaultCategory).toBe('Groceries');
    // Every categorized kind has one — an unfiled generator is one whose tasks
    // pile up in the loose block above every section. Two exceptions:
    // calendarReview, which reuses calendarEventCategory instead of owning a
    // category of its own, and supplyReorder, which inherits the category of
    // the task its supply is on instead of sharing one global category.
    expect(GENERATED_KIND_LIST.filter(s => s.categorized).every(s => !!s.defaultCategory)).toBe(true);
    expect(GENERATED_KIND_SPECS.calendarReview.categorized).toBe(false);
    expect(GENERATED_KIND_SPECS.supplyReorder.categorized).toBe(false);
  });
});
