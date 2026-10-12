import {
  parseTaskFieldDefaults, parseGeneratedTaskDefaults, serializeTaskFieldDefaults, hasTaskFieldDefaults,
  resolveFieldDefaults, seedTaskFields, existingTaskPatch, tasksNeedingDefaults, describeTaskFieldDefaults,
  previewSeededFields, previewCategoryDefault,
  NO_TASK_FIELD_DEFAULTS, defaultsFromAnswer, defaultsDiffer,
} from '../utils/taskFieldDefaults';
import type { Category, Effort, Priority, Task, TaskFieldDefaults } from '../types';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'T', parentId: null, completed: false, archived: false, polarity: 'positive',
  priority: 0, difficulty: null, effort: 0, estimatedMinutes: null, backfillDismissedFields: [],
  generatedKind: null, projectId: null, recurrenceType: 'none', chainEnabled: false, chainItems: [], chainIndex: 0,
  ...over,
} as unknown as Task);

const NO_GLOBAL = { priority: null, effort: null, difficulty: null };

describe('parseTaskFieldDefaults', () => {
  it('reads a stored object and keeps the valid fields', () => {
    expect(parseTaskFieldDefaults({ priority: 0, difficulty: 'easy', effort: 2 })).toEqual({ priority: 0, difficulty: 'easy', effort: 2, showStreak: null, vacationPause: null, excludeFromSuggestions: null });
    expect(parseTaskFieldDefaults('{"priority":3}')).toEqual({ priority: 3, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null });
  });

  it('drops one bad field without losing the others', () => {
    expect(parseTaskFieldDefaults({ priority: 9, difficulty: 'hard', effort: 7 })).toEqual({ priority: null, difficulty: 'hard', effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null });
    expect(parseTaskFieldDefaults({ effort: 0 })).toEqual({ priority: null, difficulty: null, effort: 0, showStreak: null, vacationPause: null, excludeFromSuggestions: null });
  });

  it('is null when nothing valid is left', () => {
    expect(parseTaskFieldDefaults(null)).toBeNull();
    expect(parseTaskFieldDefaults('not json')).toBeNull();
    expect(parseTaskFieldDefaults({ priority: null })).toBeNull();
    expect(parseTaskFieldDefaults([])).toBeNull();
  });

  it('serializes no defaults as null', () => {
    expect(serializeTaskFieldDefaults(null)).toBeNull();
    expect(serializeTaskFieldDefaults(NO_TASK_FIELD_DEFAULTS)).toBeNull();
    expect(serializeTaskFieldDefaults({ priority: 0, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toBe('{"priority":0,"difficulty":null,"effort":null,"showStreak":null,"vacationPause":null,"excludeFromSuggestions":null}');
  });

  it('treats priority 0 as an answer', () => {
    expect(hasTaskFieldDefaults({ priority: 0, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toBe(true);
  });
});

describe('parseGeneratedTaskDefaults', () => {
  it('keeps a kind this build does not know, and drops an empty or invalid one', () => {
    const raw = JSON.stringify({ birthday: { priority: 2 }, futureKind: { difficulty: 'hard' }, weather: {}, moodLog: 'x' });
    expect(parseGeneratedTaskDefaults(raw)).toEqual({
      birthday: { priority: 2, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null },
      futureKind: { priority: null, difficulty: 'hard', effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null },
    });
  });

  it('is empty for a missing or malformed row', () => {
    expect(parseGeneratedTaskDefaults(null)).toEqual({});
    expect(parseGeneratedTaskDefaults('[1]')).toEqual({});
    expect(parseGeneratedTaskDefaults('{')).toEqual({});
  });
});

describe('resolveFieldDefaults', () => {
  it('takes the first answer per field, most specific source first', () => {
    const kind: TaskFieldDefaults = { priority: 3, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    const project: TaskFieldDefaults = { priority: 1, difficulty: 'easy', effort: 2, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    expect(resolveFieldDefaults(kind, project)).toEqual({ priority: 3, difficulty: 'easy', effort: 2, showStreak: null, vacationPause: null, excludeFromSuggestions: null });
    expect(resolveFieldDefaults(null, undefined)).toEqual(NO_TASK_FIELD_DEFAULTS);
  });

  it('lets an answer of 0 stop a later source filling priority', () => {
    expect(resolveFieldDefaults({ priority: 0, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null }, { priority: 4, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null }).priority).toBe(0);
  });
});

describe('seedTaskFields', () => {
  it('uses the group default beneath the draft and above the global one', () => {
    const group: TaskFieldDefaults = { priority: 2, difficulty: 'hard', effort: 3, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    const global = { priority: 4 as const, effort: 5 as const, difficulty: 'easy' as const };
    expect(seedTaskFields({}, group, global, false)).toEqual({
      priority: 2, effort: 3, estimatedMinutes: 30, difficulty: 'hard', backfillDismissedFields: [],
    });
    expect(seedTaskFields({}, NO_TASK_FIELD_DEFAULTS, global, false)).toMatchObject({ priority: 4, effort: 5, difficulty: 'easy', estimatedMinutes: null });
  });

  it('never overrides what the draft named', () => {
    const group: TaskFieldDefaults = { priority: 2, difficulty: 'hard', effort: 3, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    const out = seedTaskFields({ priority: 1, effort: 4, estimatedMinutes: 50, difficulty: 'easy' }, group, NO_GLOBAL, false);
    expect(out).toMatchObject({ priority: 1, effort: 4, estimatedMinutes: 50, difficulty: 'easy' });
  });

  it('stamps the priority backfill as dismissed when the group answers "none"', () => {
    const group: TaskFieldDefaults = { priority: 0, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    expect(seedTaskFields({}, group, NO_GLOBAL, false).backfillDismissedFields).toEqual(['priority']);
    // An explicit 0 from a sheet seeded with the same answer is still "none".
    expect(seedTaskFields({ priority: 0 }, group, NO_GLOBAL, false).backfillDismissedFields).toEqual(['priority']);
    // A priority the draft chose over the group's "none" is a real one.
    expect(seedTaskFields({ priority: 3 }, group, NO_GLOBAL, false).backfillDismissedFields).toEqual([]);
    // No group answer: a bare 0 stays unanswered.
    expect(seedTaskFields({}, NO_TASK_FIELD_DEFAULTS, NO_GLOBAL, false).backfillDismissedFields).toEqual([]);
  });

  it('stamps the estimate backfill as dismissed when the group answers "no estimate"', () => {
    const group: TaskFieldDefaults = { priority: null, difficulty: null, effort: 0, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    expect(seedTaskFields({}, group, NO_GLOBAL, false)).toMatchObject({ effort: 0, estimatedMinutes: null, backfillDismissedFields: ['estimate'] });
    // An estimate the draft chose over the group's "none" is a real one.
    expect(seedTaskFields({ effort: 3 }, group, NO_GLOBAL, false).backfillDismissedFields).toEqual([]);
    expect(seedTaskFields({ estimatedMinutes: 20 }, group, NO_GLOBAL, false).backfillDismissedFields).toEqual([]);
    // Both "none" answers share one list.
    expect(seedTaskFields({}, { priority: 0, difficulty: null, effort: 0, showStreak: null, vacationPause: null, excludeFromSuggestions: null }, NO_GLOBAL, false).backfillDismissedFields).toEqual(['priority', 'estimate']);
  });

  it('writes the minutes only when the effort is the default one', () => {
    const group: TaskFieldDefaults = { priority: null, difficulty: null, effort: 2, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    expect(seedTaskFields({ effort: 4 }, group, NO_GLOBAL, false).estimatedMinutes).toBeNull();
    expect(seedTaskFields({ effort: 2 }, group, NO_GLOBAL, false).estimatedMinutes).toBe(15);
  });

  it('does not rate an avoid-habit', () => {
    const group: TaskFieldDefaults = { priority: null, difficulty: 'hard', effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    expect(seedTaskFields({}, group, { ...NO_GLOBAL, difficulty: 'easy' }, true).difficulty).toBeNull();
  });
});

describe('previewSeededFields', () => {
  it('reads the project default ahead of the global one', () => {
    const project: TaskFieldDefaults = { priority: 3, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    expect(previewSeededFields(project, { ...NO_GLOBAL, priority: 1 as Priority, effort: 2 as Effort }, false))
      .toEqual({ priority: 3, effort: 2, showStreak: false, vacationPause: false, excludeFromSuggestions: false });
  });

  it('falls back to none when nothing answers', () => {
    expect(previewSeededFields(null, NO_GLOBAL, false)).toEqual({ priority: 0, effort: 0, showStreak: false, vacationPause: false, excludeFromSuggestions: false });
  });

  it('agrees with what seedTaskFields writes for an unanswered draft', () => {
    const project: TaskFieldDefaults = { priority: null, difficulty: null, effort: 4, showStreak: null, vacationPause: null, excludeFromSuggestions: null };
    const global = { ...NO_GLOBAL, priority: 2 as Priority };
    const seeded = seedTaskFields({}, resolveFieldDefaults(project), global, false);
    expect(previewSeededFields(project, global, false)).toEqual({ priority: seeded.priority, effort: seeded.effort, showStreak: false, vacationPause: false, excludeFromSuggestions: false });
  });

  it('is what an explicit 0 from the draft would have blocked', () => {
    // The reason the editor leaves an untouched row out of the draft: a 0 sent
    // with it is an answer and beats every default behind it.
    expect(seedTaskFields({ priority: 0 }, NO_TASK_FIELD_DEFAULTS, { ...NO_GLOBAL, priority: 3 as Priority }, false).priority).toBe(0);
    expect(seedTaskFields({}, NO_TASK_FIELD_DEFAULTS, { ...NO_GLOBAL, priority: 3 as Priority }, false).priority).toBe(3);
  });
});

describe('previewCategoryDefault', () => {
  it('prefers the project default, then Settings, then none', () => {
    expect(previewCategoryDefault('Work', 'Home')).toBe('Work');
    expect(previewCategoryDefault(null, 'Home')).toBe('Home');
    expect(previewCategoryDefault(undefined, undefined)).toBeNull();
  });
});

describe('existingTaskPatch', () => {
  const all: TaskFieldDefaults = { priority: 2, difficulty: 'easy', effort: 2, showStreak: null, vacationPause: null, excludeFromSuggestions: null };

  it('fills only what is still unset', () => {
    expect(existingTaskPatch(task(), all)).toEqual({ priority: 2, difficulty: 'easy', effort: 2, estimatedMinutes: 15 });
    expect(existingTaskPatch(task({ priority: 4, difficulty: 'hard' }), all)).toEqual({ effort: 2, estimatedMinutes: 15 });
    expect(existingTaskPatch(task({ priority: 4, difficulty: 'hard', estimatedMinutes: 30 }), all)).toBeNull();
  });

  it('records "no priority" as a dismissal, not a value', () => {
    const patch = existingTaskPatch(task(), { priority: 0, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null });
    expect(patch).toEqual({ backfillDismissedFields: ['priority'] });
  });

  it('records "no estimate" as a dismissal, and keeps it alongside "no priority"', () => {
    expect(existingTaskPatch(task(), { priority: null, difficulty: null, effort: 0, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toEqual({ backfillDismissedFields: ['estimate'] });
    expect(existingTaskPatch(task(), { priority: 0, difficulty: null, effort: 0, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toEqual({ backfillDismissedFields: ['priority', 'estimate'] });
    expect(existingTaskPatch(task({ estimatedMinutes: 15 }), { priority: null, difficulty: null, effort: 0, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toBeNull();
  });

  it('skips a field already dismissed and an avoid-habit difficulty', () => {
    expect(existingTaskPatch(task({ backfillDismissedFields: ['priority'] }), { priority: 3, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toBeNull();
    expect(existingTaskPatch(task({ polarity: 'negative' }), { priority: null, difficulty: 'easy', effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toBeNull();
  });

  it('is null with no defaults', () => {
    expect(existingTaskPatch(task(), null)).toBeNull();
    expect(existingTaskPatch(task(), NO_TASK_FIELD_DEFAULTS)).toBeNull();
  });

  it('counts only live top-level tasks it would change', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', completed: true }), task({ id: 'c', archived: true }), task({ id: 'd', parentId: 'a' }), task({ id: 'e', priority: 2 })];
    expect(tasksNeedingDefaults(tasks, { priority: 1, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null }).map(t => t.id)).toEqual(['a']);
  });
});

describe('describeTaskFieldDefaults', () => {
  it('reads as plain words and is null with no answers', () => {
    expect(describeTaskFieldDefaults(null)).toBeNull();
    expect(describeTaskFieldDefaults({ priority: 0, difficulty: 'easy', effort: 2, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toBe('No priority, Easy, 15m');
    expect(describeTaskFieldDefaults({ priority: 3, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toBe('High');
    expect(describeTaskFieldDefaults({ priority: null, difficulty: null, effort: 0, showStreak: null, vacationPause: null, excludeFromSuggestions: null })).toBe('No estimate');
  });
});

describe('the "also use this for new tasks" offer', () => {
  it('turns an answer into a default, and leaving priority unset into "no priority"', () => {
    expect(defaultsFromAnswer('priority', { priority: 3 }, false)).toEqual({ priority: 3 });
    expect(defaultsFromAnswer('priority', {}, true)).toEqual({ priority: 0 });
    expect(defaultsFromAnswer('estimate', {}, true)).toEqual({ effort: 0 });
    expect(defaultsFromAnswer('difficulty', { difficulty: 'hard' }, false)).toEqual({ difficulty: 'hard' });
    expect(defaultsFromAnswer('estimate', { effort: 2, estimatedMinutes: 15 }, false)).toEqual({ effort: 2 });
  });

  it('offers nothing where there is no "none" answer or no default field', () => {
    expect(defaultsFromAnswer('difficulty', {}, true)).toBeNull();

    expect(defaultsFromAnswer('category', { category: 'Home' }, false)).toBeNull();
  });

  it('only offers when the answer would change the current default', () => {
    expect(defaultsDiffer(null, { priority: 0 })).toBe(true);
    expect(defaultsDiffer({ priority: 0, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null }, { priority: 0 })).toBe(false);
    expect(defaultsDiffer({ priority: 1, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null }, { priority: 0 })).toBe(true);
  });
});

const N = { showStreak: null, vacationPause: null, excludeFromSuggestions: null };

describe('yes/no defaults', () => {
  it('parses a stored boolean and drops a non-boolean', () => {
    expect(parseTaskFieldDefaults({ showStreak: true, vacationPause: false, excludeFromSuggestions: 'yes' }))
      .toEqual({ priority: null, difficulty: null, effort: null, showStreak: true, vacationPause: false, excludeFromSuggestions: null });
    expect(parseTaskFieldDefaults({ vacationPause: false })).not.toBeNull();
    expect(hasTaskFieldDefaults({ ...NO_TASK_FIELD_DEFAULTS, excludeFromSuggestions: false })).toBe(true);
  });

  it('merges per field, most specific first', () => {
    const kind = { ...N, vacationPause: false } as TaskFieldDefaults;
    const project = { ...NO_TASK_FIELD_DEFAULTS, vacationPause: true, excludeFromSuggestions: true };
    expect(resolveFieldDefaults({ ...NO_TASK_FIELD_DEFAULTS, ...kind }, project))
      .toMatchObject({ vacationPause: false, excludeFromSuggestions: true, showStreak: null });
  });

  describe('seedTaskFields', () => {
    const on: TaskFieldDefaults = { priority: null, difficulty: null, effort: null, showStreak: true, vacationPause: true, excludeFromSuggestions: true };

    it('turns streak and vacation pause on for a repeating task only', () => {
      const repeating = seedTaskFields({ recurrenceType: 'daily' }, on, NO_GLOBAL, false);
      expect(repeating).toMatchObject({ showStreak: true, vacationPause: true, excludeFromSuggestions: true });
      const once = seedTaskFields({}, on, NO_GLOBAL, false);
      expect(once.showStreak).toBeUndefined();
      expect(once.vacationPause).toBeUndefined();
      expect(once.excludeFromSuggestions).toBe(true);
    });

    it('stamps the question as dismissed for a "no" and leaves the value to the caller', () => {
      const off: TaskFieldDefaults = { ...on, showStreak: false, vacationPause: false, excludeFromSuggestions: false };
      const seeded = seedTaskFields({ recurrenceType: 'weekly' }, off, NO_GLOBAL, false);
      expect(seeded.backfillDismissedFields).toEqual(['streak', 'vacation', 'suggestions']);
      expect(seeded.showStreak).toBeUndefined();
    });

    it('never overrides what the draft already turned on', () => {
      const off: TaskFieldDefaults = { ...on, vacationPause: false };
      const seeded = seedTaskFields({ recurrenceType: 'daily', vacationPause: true }, off, NO_GLOBAL, false);
      expect(seeded.backfillDismissedFields).not.toContain('vacation');
    });

    it('previews the same answers', () => {
      expect(previewSeededFields(on, NO_GLOBAL, false, 'daily')).toMatchObject({ showStreak: true, vacationPause: true, excludeFromSuggestions: true });
      expect(previewSeededFields(on, NO_GLOBAL, false)).toMatchObject({ showStreak: false, vacationPause: false, excludeFromSuggestions: true });
    });
  });

  describe('existingTaskPatch', () => {
    const repeating = (over: Partial<Task> = {}) => task({ recurrenceType: 'daily', showStreak: false, vacationPause: false, excludeFromSuggestions: false, ...over });

    it('turns each on for the tasks that are missing it', () => {
      const d = { ...NO_TASK_FIELD_DEFAULTS, showStreak: true, vacationPause: true, excludeFromSuggestions: true };
      expect(existingTaskPatch(repeating(), d)).toEqual({ showStreak: true, vacationPause: true, excludeFromSuggestions: true });
      expect(existingTaskPatch(task({ excludeFromSuggestions: false }), d)).toEqual({ excludeFromSuggestions: true });
    });

    it('records a "no" as a dismissal and keeps earlier ones', () => {
      const d = { ...NO_TASK_FIELD_DEFAULTS, showStreak: false, vacationPause: false };
      expect(existingTaskPatch(repeating({ backfillDismissedFields: ['priority'] }), d))
        .toEqual({ backfillDismissedFields: ['priority', 'streak', 'vacation'] });
    });

    it('skips what is already set or dismissed', () => {
      const d = { ...NO_TASK_FIELD_DEFAULTS, showStreak: true, vacationPause: true, excludeFromSuggestions: true };
      expect(existingTaskPatch(repeating({ showStreak: true, vacationPause: true, excludeFromSuggestions: true }), d)).toBeNull();
      expect(existingTaskPatch(repeating({ backfillDismissedFields: ['streak', 'vacation', 'suggestions'] }), d)).toBeNull();
    });

    it('leaves a task whose category already answers it', () => {
      const d = { ...NO_TASK_FIELD_DEFAULTS, vacationPause: true, excludeFromSuggestions: true };
      const cats = [{ name: 'Home', hideOnVacation: true, excludeFromSuggestions: true }] as unknown as Category[];
      expect(existingTaskPatch(repeating({ category: 'Home' }), d, cats)).toBeNull();
      expect(tasksNeedingDefaults([repeating({ category: 'Home' })], d, cats)).toEqual([]);
    });
  });

  it('describes the answers in plain words', () => {
    expect(describeTaskFieldDefaults({ ...NO_TASK_FIELD_DEFAULTS, showStreak: true, vacationPause: false, excludeFromSuggestions: true }))
      .toBe('Streak chip, No vacation pause, Skip in suggestions');
  });

  it('offers the answer back as a default', () => {
    expect(defaultsFromAnswer('streak', { showStreak: true }, false)).toEqual({ showStreak: true });
    expect(defaultsFromAnswer('vacation', {}, true)).toEqual({ vacationPause: false });
    expect(defaultsFromAnswer('suggestions', { excludeFromSuggestions: true }, false)).toEqual({ excludeFromSuggestions: true });
    expect(defaultsFromAnswer('reminder', {}, true)).toBeNull();
  });
});
