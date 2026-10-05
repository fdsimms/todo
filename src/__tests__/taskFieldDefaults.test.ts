import {
  parseTaskFieldDefaults, parseGeneratedTaskDefaults, serializeTaskFieldDefaults, hasTaskFieldDefaults,
  resolveFieldDefaults, seedTaskFields, existingTaskPatch, tasksNeedingDefaults, describeTaskFieldDefaults,
  backfillGroupKey, backfillGroupMembers, NO_TASK_FIELD_DEFAULTS, defaultsFromAnswer, defaultsDiffer,
} from '../utils/taskFieldDefaults';
import type { Task, TaskFieldDefaults } from '../types';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'T', parentId: null, completed: false, archived: false, polarity: 'positive',
  priority: 0, difficulty: null, effort: 0, estimatedMinutes: null, backfillDismissedFields: [],
  generatedKind: null, projectId: null, recurrenceType: 'none', chainEnabled: false, chainItems: [], chainIndex: 0,
  ...over,
} as unknown as Task);

const NO_GLOBAL = { priority: null, effort: null, difficulty: null };

describe('parseTaskFieldDefaults', () => {
  it('reads a stored object and keeps the valid fields', () => {
    expect(parseTaskFieldDefaults({ priority: 0, difficulty: 'easy', effort: 2 })).toEqual({ priority: 0, difficulty: 'easy', effort: 2 });
    expect(parseTaskFieldDefaults('{"priority":3}')).toEqual({ priority: 3, difficulty: null, effort: null });
  });

  it('drops one bad field without losing the others', () => {
    expect(parseTaskFieldDefaults({ priority: 9, difficulty: 'hard', effort: 0 })).toEqual({ priority: null, difficulty: 'hard', effort: null });
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
    expect(serializeTaskFieldDefaults({ priority: 0, difficulty: null, effort: null })).toBe('{"priority":0,"difficulty":null,"effort":null}');
  });

  it('treats priority 0 as an answer', () => {
    expect(hasTaskFieldDefaults({ priority: 0, difficulty: null, effort: null })).toBe(true);
  });
});

describe('parseGeneratedTaskDefaults', () => {
  it('keeps a kind this build does not know, and drops an empty or invalid one', () => {
    const raw = JSON.stringify({ birthday: { priority: 2 }, futureKind: { difficulty: 'hard' }, weather: {}, moodLog: 'x' });
    expect(parseGeneratedTaskDefaults(raw)).toEqual({
      birthday: { priority: 2, difficulty: null, effort: null },
      futureKind: { priority: null, difficulty: 'hard', effort: null },
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
    const kind: TaskFieldDefaults = { priority: 3, difficulty: null, effort: null };
    const project: TaskFieldDefaults = { priority: 1, difficulty: 'easy', effort: 2 };
    expect(resolveFieldDefaults(kind, project)).toEqual({ priority: 3, difficulty: 'easy', effort: 2 });
    expect(resolveFieldDefaults(null, undefined)).toEqual(NO_TASK_FIELD_DEFAULTS);
  });

  it('lets an answer of 0 stop a later source filling priority', () => {
    expect(resolveFieldDefaults({ priority: 0, difficulty: null, effort: null }, { priority: 4, difficulty: null, effort: null }).priority).toBe(0);
  });
});

describe('seedTaskFields', () => {
  it('uses the group default beneath the draft and above the global one', () => {
    const group: TaskFieldDefaults = { priority: 2, difficulty: 'hard', effort: 3 };
    const global = { priority: 4 as const, effort: 5 as const, difficulty: 'easy' as const };
    expect(seedTaskFields({}, group, global, false)).toEqual({
      priority: 2, effort: 3, estimatedMinutes: 30, difficulty: 'hard', backfillDismissedFields: [],
    });
    expect(seedTaskFields({}, NO_TASK_FIELD_DEFAULTS, global, false)).toMatchObject({ priority: 4, effort: 5, difficulty: 'easy', estimatedMinutes: null });
  });

  it('never overrides what the draft named', () => {
    const group: TaskFieldDefaults = { priority: 2, difficulty: 'hard', effort: 3 };
    const out = seedTaskFields({ priority: 1, effort: 4, estimatedMinutes: 50, difficulty: 'easy' }, group, NO_GLOBAL, false);
    expect(out).toMatchObject({ priority: 1, effort: 4, estimatedMinutes: 50, difficulty: 'easy' });
  });

  it('stamps the priority backfill as dismissed when the group answers "none"', () => {
    const group: TaskFieldDefaults = { priority: 0, difficulty: null, effort: null };
    expect(seedTaskFields({}, group, NO_GLOBAL, false).backfillDismissedFields).toEqual(['priority']);
    // An explicit 0 from a sheet seeded with the same answer is still "none".
    expect(seedTaskFields({ priority: 0 }, group, NO_GLOBAL, false).backfillDismissedFields).toEqual(['priority']);
    // A priority the draft chose over the group's "none" is a real one.
    expect(seedTaskFields({ priority: 3 }, group, NO_GLOBAL, false).backfillDismissedFields).toEqual([]);
    // No group answer: a bare 0 stays unanswered.
    expect(seedTaskFields({}, NO_TASK_FIELD_DEFAULTS, NO_GLOBAL, false).backfillDismissedFields).toEqual([]);
  });

  it('writes the minutes only when the effort is the default one', () => {
    const group: TaskFieldDefaults = { priority: null, difficulty: null, effort: 2 };
    expect(seedTaskFields({ effort: 4 }, group, NO_GLOBAL, false).estimatedMinutes).toBeNull();
    expect(seedTaskFields({ effort: 2 }, group, NO_GLOBAL, false).estimatedMinutes).toBe(15);
  });

  it('does not rate an avoid-habit', () => {
    const group: TaskFieldDefaults = { priority: null, difficulty: 'hard', effort: null };
    expect(seedTaskFields({}, group, { ...NO_GLOBAL, difficulty: 'easy' }, true).difficulty).toBeNull();
  });
});

describe('existingTaskPatch', () => {
  const all: TaskFieldDefaults = { priority: 2, difficulty: 'easy', effort: 2 };

  it('fills only what is still unset', () => {
    expect(existingTaskPatch(task(), all)).toEqual({ priority: 2, difficulty: 'easy', effort: 2, estimatedMinutes: 15 });
    expect(existingTaskPatch(task({ priority: 4, difficulty: 'hard' }), all)).toEqual({ effort: 2, estimatedMinutes: 15 });
    expect(existingTaskPatch(task({ priority: 4, difficulty: 'hard', estimatedMinutes: 30 }), all)).toBeNull();
  });

  it('records "no priority" as a dismissal, not a value', () => {
    const patch = existingTaskPatch(task(), { priority: 0, difficulty: null, effort: null });
    expect(patch).toEqual({ backfillDismissedFields: ['priority'] });
  });

  it('skips a field already dismissed and an avoid-habit difficulty', () => {
    expect(existingTaskPatch(task({ backfillDismissedFields: ['priority'] }), { priority: 3, difficulty: null, effort: null })).toBeNull();
    expect(existingTaskPatch(task({ polarity: 'negative' }), { priority: null, difficulty: 'easy', effort: null })).toBeNull();
  });

  it('is null with no defaults', () => {
    expect(existingTaskPatch(task(), null)).toBeNull();
    expect(existingTaskPatch(task(), NO_TASK_FIELD_DEFAULTS)).toBeNull();
  });

  it('counts only live top-level tasks it would change', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', completed: true }), task({ id: 'c', archived: true }), task({ id: 'd', parentId: 'a' }), task({ id: 'e', priority: 2 })];
    expect(tasksNeedingDefaults(tasks, { priority: 1, difficulty: null, effort: null }).map(t => t.id)).toEqual(['a']);
  });
});

describe('describeTaskFieldDefaults', () => {
  it('reads as plain words and is null with no answers', () => {
    expect(describeTaskFieldDefaults(null)).toBeNull();
    expect(describeTaskFieldDefaults({ priority: 0, difficulty: 'easy', effort: 2 })).toBe('No priority, Easy, 15m');
    expect(describeTaskFieldDefaults({ priority: 3, difficulty: null, effort: null })).toBe('High');
  });
});

describe('backfill groups', () => {
  it('groups by generated kind first, then project, and a loose task has none', () => {
    expect(backfillGroupKey(task({ generatedKind: 'birthday', projectId: 'p1' }))).toBe('generated:birthday');
    expect(backfillGroupKey(task({ projectId: 'p1' }))).toBe('project:p1');
    expect(backfillGroupKey(task())).toBeNull();
  });

  it('finds the queued members of the current task\'s group', () => {
    const queue = [task({ id: 'a', projectId: 'p1' }), task({ id: 'b', projectId: 'p2' }), task({ id: 'c', projectId: 'p1' })];
    expect(backfillGroupMembers(queue, queue[0]).map(t => t.id)).toEqual(['a', 'c']);
    expect(backfillGroupMembers(queue, task())).toEqual([]);
  });
});

describe('the "also use this for new tasks" offer', () => {
  it('turns an answer into a default, and leaving priority unset into "no priority"', () => {
    expect(defaultsFromAnswer('priority', { priority: 3 }, false)).toEqual({ priority: 3 });
    expect(defaultsFromAnswer('priority', {}, true)).toEqual({ priority: 0 });
    expect(defaultsFromAnswer('difficulty', { difficulty: 'hard' }, false)).toEqual({ difficulty: 'hard' });
    expect(defaultsFromAnswer('estimate', { effort: 2, estimatedMinutes: 15 }, false)).toEqual({ effort: 2 });
  });

  it('offers nothing where there is no "none" answer or no default field', () => {
    expect(defaultsFromAnswer('difficulty', {}, true)).toBeNull();
    expect(defaultsFromAnswer('estimate', {}, true)).toBeNull();
    expect(defaultsFromAnswer('category', { category: 'Home' }, false)).toBeNull();
  });

  it('only offers when the answer would change the current default', () => {
    expect(defaultsDiffer(null, { priority: 0 })).toBe(true);
    expect(defaultsDiffer({ priority: 0, difficulty: null, effort: null }, { priority: 0 })).toBe(false);
    expect(defaultsDiffer({ priority: 1, difficulty: null, effort: null }, { priority: 0 })).toBe(true);
  });
});
