import type { Priority, SavedViewClause, Task } from '../types';
import {
  clauseOfKind,
  clausesFromFilters,
  savedViewTriClause,
  savedViewTriState,
  describeSavedView,
  describeSavedViewClause,
  filterTasksForView,
  isSavedViewCandidate,
  matchesClause,
  matchesSavedView,
  parseSavedViewClauses,
  savedViewClauseLabel,
  SAVED_VIEW_CLAUSE_KINDS,
  serializeSavedViewClauses,
  withClause,
  type SavedViewContext,
} from '../utils/savedViews';

// A local minimum rather than a shared fixture, same as timeBlock.test.ts:
// these tests touch a dozen fields and the cast keeps the file readable.
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Write the report',
    notes: '',
    completed: false,
    archived: false,
    parentId: null,
    category: null,
    projectId: null,
    tags: [],
    priority: 0,
    effort: 0,
    estimatedMinutes: null,
    dueDate: null,
    deferUntil: null,
    reminderTime: null,
    chainEnabled: false,
    chainItems: [],
    chainIndex: 0,
    ...overrides,
  } as unknown as Task;
}

const TODAY_START = new Date(2026, 8, 15);
const noonOn = (year: number, month: number, day: number) =>
  new Date(year, month, day, 12).toISOString();

function ctx(overrides: Partial<SavedViewContext> = {}): SavedViewContext {
  return { todayStart: TODAY_START, heldBack: () => false, ...overrides };
}

describe('matchesClause', () => {
  describe('value-list clauses', () => {
    it('matches a task whose category is one of the listed ones', () => {
      const clause: SavedViewClause = { kind: 'category', values: ['Work', 'Home'] };
      expect(matchesClause(makeTask({ category: 'Home' }), clause, ctx())).toBe(true);
      expect(matchesClause(makeTask({ category: 'Errands' }), clause, ctx())).toBe(false);
      expect(matchesClause(makeTask({ category: null }), clause, ctx())).toBe(false);
    });

    it('matches when any one of a task\'s tags is listed', () => {
      const clause: SavedViewClause = { kind: 'tag', values: ['errand'] };
      expect(matchesClause(makeTask({ tags: ['home', 'errand'] }), clause, ctx())).toBe(true);
      expect(matchesClause(makeTask({ tags: ['home'] }), clause, ctx())).toBe(false);
    });

    it('matches a project by id', () => {
      const clause: SavedViewClause = { kind: 'project', values: ['p1'] };
      expect(matchesClause(makeTask({ projectId: 'p1' }), clause, ctx())).toBe(true);
      expect(matchesClause(makeTask({ projectId: null }), clause, ctx())).toBe(false);
    });

    it('matches priority and effort by value', () => {
      expect(matchesClause(makeTask({ priority: 3 }), { kind: 'priority', values: [3, 4] }, ctx())).toBe(true);
      expect(matchesClause(makeTask({ priority: 1 }), { kind: 'priority', values: [3, 4] }, ctx())).toBe(false);
      expect(matchesClause(makeTask({ effort: 2 }), { kind: 'effort', values: [1, 2] }, ctx())).toBe(true);
      expect(matchesClause(makeTask({ effort: 5 }), { kind: 'effort', values: [1, 2] }, ctx())).toBe(false);
    });

    // The rule that stops the list emptying under someone who has opened a
    // control and not yet answered it.
    it('is inert rather than impossible when nothing is selected', () => {
      for (const kind of ['category', 'tag', 'project', 'priority', 'effort'] as const) {
        const clause = { kind, values: [] } as SavedViewClause;
        expect(matchesClause(makeTask(), clause, ctx())).toBe(true);
      }
    });
  });

  describe('maxMinutes', () => {
    it('admits a task at or under the ceiling', () => {
      const clause: SavedViewClause = { kind: 'maxMinutes', minutes: 10 };
      expect(matchesClause(makeTask({ estimatedMinutes: 5 }), clause, ctx())).toBe(true);
      expect(matchesClause(makeTask({ estimatedMinutes: 10 }), clause, ctx())).toBe(true);
      expect(matchesClause(makeTask({ estimatedMinutes: 30 }), clause, ctx())).toBe(false);
    });

    it('refuses a task with nothing to measure, rather than assuming it is quick', () => {
      const clause: SavedViewClause = { kind: 'maxMinutes', minutes: 10 };
      expect(matchesClause(makeTask({ estimatedMinutes: null, effort: 0 }), clause, ctx())).toBe(false);
    });

    it('reads the live chain step, not the task-level estimate', () => {
      const task = makeTask({
        estimatedMinutes: 120,
        chainEnabled: true,
        chainIndex: 0,
        chainItems: [
          { title: 'Step one', estimatedMinutes: 5 },
          { title: 'Step two', estimatedMinutes: 90 },
        ],
      } as Partial<Task>);
      expect(matchesClause(task, { kind: 'maxMinutes', minutes: 10 }, ctx())).toBe(true);
    });
  });

  describe('overdue', () => {
    it('counts a task due before today, on the logical day boundary', () => {
      const clause: SavedViewClause = { kind: 'overdue', overdue: true };
      expect(matchesClause(makeTask({ dueDate: noonOn(2026, 8, 14) }), clause, ctx())).toBe(true);
      expect(matchesClause(makeTask({ dueDate: noonOn(2026, 8, 15) }), clause, ctx())).toBe(false);
      expect(matchesClause(makeTask({ dueDate: noonOn(2026, 8, 16) }), clause, ctx())).toBe(false);
    });

    it('treats a task with no date as not overdue, in both directions', () => {
      expect(matchesClause(makeTask(), { kind: 'overdue', overdue: true }, ctx())).toBe(false);
      expect(matchesClause(makeTask(), { kind: 'overdue', overdue: false }, ctx())).toBe(true);
    });
  });

  it('reads hasReminder off the stored instant', () => {
    const withReminder = makeTask({ reminderTime: noonOn(2026, 8, 15) });
    expect(matchesClause(withReminder, { kind: 'hasReminder', hasReminder: true }, ctx())).toBe(true);
    expect(matchesClause(makeTask(), { kind: 'hasReminder', hasReminder: true }, ctx())).toBe(false);
    expect(matchesClause(makeTask(), { kind: 'hasReminder', hasReminder: false }, ctx())).toBe(true);
  });

  it('asks the context for the held-back rule rather than deriving one', () => {
    const blocked = ctx({ heldBack: task => task.id === 'blocked' });
    expect(matchesClause(makeTask({ id: 'blocked' }), { kind: 'heldBack', heldBack: true }, blocked)).toBe(true);
    expect(matchesClause(makeTask({ id: 'free' }), { kind: 'heldBack', heldBack: true }, blocked)).toBe(false);
    expect(matchesClause(makeTask({ id: 'free' }), { kind: 'heldBack', heldBack: false }, blocked)).toBe(true);
  });

  it('counts a defer date as a date for the undated clause', () => {
    const clause: SavedViewClause = { kind: 'undated', undated: true };
    expect(matchesClause(makeTask(), clause, ctx())).toBe(true);
    expect(matchesClause(makeTask({ deferUntil: noonOn(2026, 8, 20) }), clause, ctx())).toBe(false);
    expect(matchesClause(makeTask({ dueDate: noonOn(2026, 8, 20) }), clause, ctx())).toBe(false);
  });
});

describe('matchesSavedView', () => {
  it('requires every clause to admit the task', () => {
    const clauses: SavedViewClause[] = [
      { kind: 'category', values: ['Work'] },
      { kind: 'priority', values: [4] },
    ];
    expect(matchesSavedView(makeTask({ category: 'Work', priority: 4 }), clauses, ctx())).toBe(true);
    expect(matchesSavedView(makeTask({ category: 'Work', priority: 1 }), clauses, ctx())).toBe(false);
    expect(matchesSavedView(makeTask({ category: 'Home', priority: 4 }), clauses, ctx())).toBe(false);
  });

  it('matches everything when there are no clauses', () => {
    expect(matchesSavedView(makeTask(), [], ctx())).toBe(true);
  });
});

describe('filterTasksForView', () => {
  it('spans the daily lists rather than one of them, and drops what has no row', () => {
    const tasks = [
      makeTask({ id: 'today', dueDate: noonOn(2026, 8, 15), tags: ['errand'] }),
      makeTask({ id: 'later', deferUntil: noonOn(2026, 8, 20), tags: ['errand'] }),
      makeTask({ id: 'unscheduled', tags: ['errand'] }),
      makeTask({ id: 'subtask', parentId: 'today', tags: ['errand'] }),
      makeTask({ id: 'done', completed: true, tags: ['errand'] }),
      makeTask({ id: 'filed', archived: true, tags: ['errand'] }),
      makeTask({ id: 'other', tags: ['home'] }),
    ];
    const got = filterTasksForView(tasks, [{ kind: 'tag', values: ['errand'] }], ctx());
    expect(got.map(t => t.id)).toEqual(['today', 'later', 'unscheduled']);
  });

  it('keeps the caller\'s order', () => {
    const tasks = [makeTask({ id: 'b' }), makeTask({ id: 'a' })];
    expect(filterTasksForView(tasks, [], ctx()).map(t => t.id)).toEqual(['b', 'a']);
  });
});

describe('isSavedViewCandidate', () => {
  it('is the base every view sits on', () => {
    expect(isSavedViewCandidate(makeTask())).toBe(true);
    expect(isSavedViewCandidate(makeTask({ parentId: 'p' }))).toBe(false);
    expect(isSavedViewCandidate(makeTask({ completed: true }))).toBe(false);
    expect(isSavedViewCandidate(makeTask({ archived: true }))).toBe(false);
  });
});

describe('describeSavedView', () => {
  it('says Everything rather than nothing for an empty view', () => {
    expect(describeSavedView([])).toBe('Everything');
  });

  it('joins clause phrases with the separator the app already uses', () => {
    expect(describeSavedView([
      { kind: 'category', values: ['Work'] },
      { kind: 'priority', values: [4] },
      { kind: 'overdue', overdue: true },
    ])).toBe('Work · Urgent priority · Overdue');
  });

  it('names two values with "or" and abbreviates past that', () => {
    expect(describeSavedViewClause({ kind: 'category', values: ['Work', 'Home'] })).toBe('Work or Home');
    expect(describeSavedViewClause({ kind: 'category', values: ['Work', 'Home', 'Gym', 'Car'] }))
      .toBe('Work, Home +2');
  });

  it('prefixes tags with a hash', () => {
    expect(describeSavedViewClause({ kind: 'tag', values: ['errand'] })).toBe('#errand');
  });

  it('renders a project by name, and an unknown id as a project rather than an id', () => {
    const labels = { projectNames: new Map([['p1', 'Kitchen refit']]) };
    expect(describeSavedViewClause({ kind: 'project', values: ['p1'] }, labels)).toBe('Kitchen refit');
    expect(describeSavedViewClause({ kind: 'project', values: ['gone'] }, labels)).toBe('a project');
  });

  it('drops an inert clause from the description', () => {
    expect(describeSavedView([
      { kind: 'category', values: [] },
      { kind: 'overdue', overdue: true },
    ])).toBe('Overdue');
  });

  it('reads both positions of the two-way clauses', () => {
    expect(describeSavedViewClause({ kind: 'heldBack', heldBack: false })).toBe('Not blocked');
    expect(describeSavedViewClause({ kind: 'hasReminder', hasReminder: false })).toBe('No reminder');
    expect(describeSavedViewClause({ kind: 'undated', undated: false })).toBe('Has a date');
    expect(describeSavedViewClause({ kind: 'maxMinutes', minutes: 10 })).toBe('Under 10 min');
  });
});

describe('parseSavedViewClauses', () => {
  it('round-trips what it serialized', () => {
    const clauses: SavedViewClause[] = [
      { kind: 'category', values: ['Work'] },
      { kind: 'maxMinutes', minutes: 10 },
      { kind: 'heldBack', heldBack: false },
    ];
    expect(parseSavedViewClauses(serializeSavedViewClauses(clauses))).toEqual(clauses);
  });

  it('answers empty for null, malformed JSON and a non-array', () => {
    expect(parseSavedViewClauses(null)).toEqual([]);
    expect(parseSavedViewClauses(undefined)).toEqual([]);
    expect(parseSavedViewClauses('')).toEqual([]);
    expect(parseSavedViewClauses('{oh no')).toEqual([]);
    expect(parseSavedViewClauses('{"kind":"category"}')).toEqual([]);
  });

  // A throw here would take down every view after it in the same read, which
  // is why one bad clause costs a predicate rather than the whole lens.
  it('drops a clause it cannot trust and keeps the rest of the view', () => {
    const raw = JSON.stringify([
      { kind: 'category', values: ['Work'] },
      { kind: 'category', values: [7] },
      { kind: 'nonsense', values: [] },
      { kind: 'priority', values: [9] },
      { kind: 'maxMinutes', minutes: 0 },
      null,
      'nope',
      { kind: 'overdue', overdue: true },
    ]);
    expect(parseSavedViewClauses(raw)).toEqual([
      { kind: 'category', values: ['Work'] },
      { kind: 'overdue', overdue: true },
    ]);
  });

  it('keeps only the first clause of a kind', () => {
    const raw = JSON.stringify([
      { kind: 'priority', values: [4] },
      { kind: 'priority', values: [1] },
    ]);
    expect(parseSavedViewClauses(raw)).toEqual([{ kind: 'priority', values: [4] }]);
  });
});

describe('withClause', () => {
  it('replaces a kind in place rather than appending a second', () => {
    const started: SavedViewClause[] = [{ kind: 'priority', values: [4] }];
    const got = withClause(started, 'priority', { kind: 'priority', values: [1, 2] });
    expect(got).toEqual([{ kind: 'priority', values: [1, 2] }]);
  });

  it('drops a kind when handed null', () => {
    const started: SavedViewClause[] = [
      { kind: 'category', values: ['Work'] },
      { kind: 'priority', values: [4] },
    ];
    expect(withClause(started, 'priority', null)).toEqual([{ kind: 'category', values: ['Work'] }]);
  });

  it('holds the editor\'s order however the controls were touched', () => {
    let clauses: SavedViewClause[] = [];
    clauses = withClause(clauses, 'overdue', { kind: 'overdue', overdue: true });
    clauses = withClause(clauses, 'category', { kind: 'category', values: ['Work'] });
    clauses = withClause(clauses, 'priority', { kind: 'priority', values: [4] });
    expect(clauses.map(c => c.kind)).toEqual(['category', 'priority', 'overdue']);
  });
});

describe('clauseOfKind', () => {
  it('finds a clause by kind and narrows it', () => {
    const clauses: SavedViewClause[] = [{ kind: 'maxMinutes', minutes: 15 }];
    expect(clauseOfKind(clauses, 'maxMinutes')?.minutes).toBe(15);
    expect(clauseOfKind(clauses, 'category')).toBeNull();
  });
});

describe('savedViewClauseLabel', () => {
  it('names every kind the editor can draw', () => {
    for (const kind of SAVED_VIEW_CLAUSE_KINDS) {
      expect(savedViewClauseLabel(kind).length).toBeGreaterThan(0);
    }
  });
});

describe('clausesFromFilters', () => {
  it('carries the filter sheet\'s own state across, so nothing is rebuilt by hand', () => {
    expect(clausesFromFilters({ priorities: [3, 4], efforts: [1], hasReminder: true })).toEqual([
      { kind: 'priority', values: [3, 4] },
      { kind: 'effort', values: [1] },
      { kind: 'hasReminder', hasReminder: true },
    ]);
  });

  // A filter nobody set is not a predicate, same rule matchesClause applies to
  // an empty value list.
  it('contributes nothing for a filter that is not set', () => {
    expect(clausesFromFilters({ priorities: [], efforts: [], hasReminder: false })).toEqual([]);
    expect(clausesFromFilters({ priorities: [], efforts: [], hasReminder: true })).toEqual([
      { kind: 'hasReminder', hasReminder: true },
    ]);
  });

  it('copies the arrays rather than aliasing the store\'s', () => {
    const priorities: Priority[] = [4];
    const [clause] = clausesFromFilters({ priorities, efforts: [], hasReminder: false });
    expect(clause).toEqual({ kind: 'priority', values: [4] });
    expect((clause as { values: Priority[] }).values).not.toBe(priorities);
  });
});

describe('savedViewTriState and savedViewTriClause', () => {
  it('reads an absent clause as Any rather than as a stored third value', () => {
    expect(savedViewTriState(undefined)).toBe('any');
  });

  it('round-trips each two-position clause through its control', () => {
    for (const kind of ['overdue', 'hasReminder', 'heldBack', 'undated'] as const) {
      expect(savedViewTriState(savedViewTriClause(kind, true))).toBe('yes');
      expect(savedViewTriState(savedViewTriClause(kind, false))).toBe('no');
    }
  });

  it('reads Any for a clause that has no two-position control', () => {
    expect(savedViewTriState({ kind: 'category', values: ['Work'] })).toBe('any');
  });
});
