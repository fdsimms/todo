import {
  GENERATED_KINDS,
  GENERATED_KIND_LIST,
  GENERATED_KIND_SPECS,
  generatedBy,
  generatedSourceOf,
  hasAnyGeneratedTask,
  liveGeneratedTask,
  liveGeneratedTasksOfKind,
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

describe('the registry', () => {
  it('describes every kind, and only the kinds', () => {
    expect(Object.keys(GENERATED_KIND_SPECS).sort()).toEqual([...GENERATED_KINDS].sort());
    expect(GENERATED_KIND_LIST).toHaveLength(GENERATED_KINDS.length);
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

  it('marks the meal-plan nudge as the one generator with no source row', () => {
    // It's why generatedSourceId is nullable, and why deleting its task writes
    // no opt-out — there is nothing to write it on.
    expect(GENERATED_KIND_SPECS.mealPlanNudge.sourced).toBe(false);
    expect(GENERATED_KIND_SPECS.mealCook.sourced).toBe(true);
    expect(GENERATED_KIND_SPECS.groceryUseUp.sourced).toBe(true);
    expect(GENERATED_KIND_SPECS.leftoverUseUp.sourced).toBe(true);
  });

  it('gives every kind a category to file under, the nudge included', () => {
    // The nudge was the odd one out until #1571: no category setting, so the
    // one task written entirely on the app's own schedule landed loose at the
    // top of Today however the other three were filed.
    expect(GENERATED_KIND_LIST.filter(s => s.categorized).map(s => s.kind))
      .toEqual(['mealCook', 'groceryUseUp', 'leftoverUseUp', 'mealPlanNudge']);
  });

  it('shares one default category between planning the week and cooking it', () => {
    // Two generators, one section: the distinction between "plan the week" and
    // "cook what you planned" is one only the code makes.
    expect(GENERATED_KIND_SPECS.mealCook.defaultCategory).toBe('Meal Plan');
    expect(GENERATED_KIND_SPECS.mealPlanNudge.defaultCategory).toBe('Meal Plan');
    expect(GENERATED_KIND_SPECS.leftoverUseUp.defaultCategory).toBe('Leftovers');
    // Every kind has one — an unfiled generator is one whose tasks pile up in
    // the loose block above every section.
    expect(GENERATED_KIND_LIST.every(s => !!s.defaultCategory)).toBe(true);
  });
});
