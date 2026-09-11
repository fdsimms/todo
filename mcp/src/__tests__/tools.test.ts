/**
 * The tool layer against a stub replica.
 *
 * No database and no SDK, which is the point of `tools.ts` taking a `Replica`
 * rather than reaching for one: the lenses, the caps and the projection are
 * ordinary functions over ordinary data. replica.test.ts is where the same
 * functions meet a real database.
 */
import { serializeTask } from '../serialize';
import {
  getTask,
  listFoodLog,
  listGroceryItems,
  listMedicationLogs,
  listMoodLogs,
  listProjects,
  listTasks,
  resolveRange,
  searchTasks,
  DEFAULT_LIMIT,
  DEFAULT_LOG_DAYS,
  MAX_LIMIT,
  MAX_LOG_DAYS,
} from '../tools';
import type { Replica } from '../replica';
import type { FoodLogEntry, GroceryItem, MedicationLog, MoodLog, Project, Task } from '../../../src/types';

const task = (over: Partial<Task> & { id: string; title: string }): Task =>
  ({
    notes: '',
    completed: false,
    category: null,
    tags: [],
    timeSegments: [],
    priority: 0,
    parentId: null,
    projectId: null,
    dueDate: null,
    deadline: null,
    deferUntil: null,
    recurrenceType: 'none',
    chainItems: [],
    chainIndex: 0,
    pinned: false,
    ...over,
  }) as Task;

/**
 * Visibility is stubbed by convention rather than computed: a task whose id
 * starts with the lens name belongs to it. The real model is tested against a
 * real database in replica.test.ts, and duplicating it here would be testing
 * the stub.
 */
function stubReplica(over: Partial<Replica> = {}): Replica {
  const tasks: Task[] = [];
  return {
    path: ':stub:',
    refresh: () => {},
    tasks: () => tasks,
    taskById: (id: string) => tasks.find(t => t.id === id) ?? null,
    projects: () => [],
    categories: () => [],
    groceryItems: () => [],
    isVisible: (t: Task) => t.id.startsWith('today'),
    isUnscheduled: (t: Task) => t.id.startsWith('unscheduled'),
    isInbox: (t: Task) => t.id.startsWith('inbox'),
    isBlocked: (t: Task) => t.id.startsWith('blocked'),
    visibleAt: () => new Date('2099-01-01T00:00:00.000Z'),
    search: () => [],
    displayTitle: (t: Task) => t.title,
    estimatedMinutes: () => null,
    deliverableKind: () => null,
    // A fixed "today" so the range arithmetic is assertable. The real one goes
    // through getLogicalToday; what is tested here is the counting, not the
    // clock.
    todayKey: () => '2026-09-11',
    shiftDayKey: (key: string, days: number) => {
      const d = new Date(`${key}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    },
    foodLogEntries: () => [],
    foodTotals: () => ({ total: {}, reported: {}, entries: 0 }),
    moodLogs: () => [],
    medicationLogs: () => [],
    medicationSummary: (log: MedicationLog) => log.name,
    // No store configured is the ordinary state for a replica pointed at a
    // file somebody copied, and the tool layer never calls this anyway.
    sync: async () => null,
    templates: () => [],
    createTemplate: () => { throw new Error('not stubbed'); },
    createTask: () => { throw new Error('not stubbed'); },
    deviceId: () => 'stub-device',
    syncable: () => true,
    ...over,
  };
}

const withTasks = (tasks: Task[], over: Partial<Replica> = {}) =>
  stubReplica({ tasks: () => tasks, taskById: id => tasks.find(t => t.id === id) ?? null, ...over });

describe('listTasks', () => {
  const everything = [
    task({ id: 'today-1', title: 'Due now' }),
    task({ id: 'later-1', title: 'Deferred' }),
    task({ id: 'unscheduled-1', title: 'Someday' }),
    task({ id: 'inbox-1', title: 'Untriaged' }),
  ];

  it('defaults to today', () => {
    const result = listTasks(withTasks(everything));
    expect(result.view).toBe('today');
    expect(result.tasks.map(t => t.id)).toEqual(['today-1']);
  });

  it('treats later as the leftover of the other three, not as its own predicate', () => {
    // This is the property that lets the four lenses stay disjoint without
    // tools.ts owning a fifth definition of "later".
    expect(listTasks(withTasks(everything), { view: 'later' }).tasks.map(t => t.id)).toEqual(['later-1']);
  });

  it.each(['unscheduled', 'inbox'] as const)('routes %s to its own selector', view => {
    expect(listTasks(withTasks(everything), { view }).tasks.map(t => t.id)).toEqual([`${view}-1`]);
  });

  it('excludes subtasks from every lens', () => {
    const tasks = [task({ id: 'today-1', title: 'Parent' }), task({ id: 'today-2', title: 'Step', parentId: 'today-1' })];
    expect(listTasks(withTasks(tasks), { view: 'all' }).tasks.map(t => t.id)).toEqual(['today-1']);
  });

  it('hides completed tasks unless asked', () => {
    const tasks = [task({ id: 'today-1', title: 'Open' }), task({ id: 'today-2', title: 'Done', completed: true })];
    expect(listTasks(withTasks(tasks), { view: 'all' }).tasks).toHaveLength(1);
    expect(listTasks(withTasks(tasks), { view: 'all', includeCompleted: true }).tasks).toHaveLength(2);
  });

  it('filters by category, tag and project', () => {
    const tasks = [
      task({ id: 'today-1', title: 'A', category: 'Home', tags: ['errand'], projectId: 'p1' }),
      task({ id: 'today-2', title: 'B', category: 'Work', tags: ['deep'], projectId: 'p2' }),
    ];
    expect(listTasks(withTasks(tasks), { category: 'Home' }).tasks.map(t => t.id)).toEqual(['today-1']);
    expect(listTasks(withTasks(tasks), { tag: 'deep' }).tasks.map(t => t.id)).toEqual(['today-2']);
    expect(listTasks(withTasks(tasks), { projectId: 'p1' }).tasks.map(t => t.id)).toEqual(['today-1']);
  });

  it('caps the list but still reports what matched', () => {
    const many = Array.from({ length: 300 }, (_, i) => task({ id: `today-${i}`, title: `T${i}` }));
    const capped = listTasks(withTasks(many));
    expect(capped.tasks).toHaveLength(DEFAULT_LIMIT);
    // The count is what tells the caller the answer was cut, so it counts
    // matches rather than what survived the cap.
    expect(capped.matched).toBe(300);

    expect(listTasks(withTasks(many), { limit: 9999 }).tasks).toHaveLength(MAX_LIMIT);
    expect(listTasks(withTasks(many), { limit: 0 }).tasks).toHaveLength(1);
  });
});

describe('searchTasks', () => {
  it('hands the query to the replica and caps the result', () => {
    const hits = Array.from({ length: 80 }, (_, i) => ({
      task: task({ id: `t${i}`, title: `T${i}` }),
      score: 1,
      projectName: null,
    }));
    const result = searchTasks(stubReplica({ search: () => hits }), { query: 'plant' });

    expect(result.query).toBe('plant');
    expect(result.matched).toBe(80);
    expect(result.tasks).toHaveLength(DEFAULT_LIMIT);
  });
});

describe('getTask', () => {
  const parent = task({ id: 'today-1', title: 'Book haircut', projectId: 'p1', chainItems: [{ title: 'Book' }, { title: 'Go' }] as Task['chainItems'], chainIndex: 1 });
  const child = task({ id: 'today-2', title: 'Find a barber', parentId: 'today-1' });
  const project = { id: 'p1', title: 'Errands', notes: '', deadline: null, archived: false } as Project;

  it('returns null for an id that is not there', () => {
    expect(getTask(stubReplica(), 'nope')).toBeNull();
  });

  it('gathers subtasks, the chain and the project', () => {
    const result = getTask(withTasks([parent, child], { projects: () => [project] }), 'today-1')!;

    expect(result.subtasks.map(t => t.id)).toEqual(['today-2']);
    expect(result.chain).toEqual({ index: 1, steps: ['Book', 'Go'] });
    expect(result.project).toEqual({ id: 'p1', title: 'Errands' });
  });

  it('says when a task is hidden and until when, and stays quiet when it is not', () => {
    expect(getTask(withTasks([parent]), 'today-1')!.hiddenUntil).toBeUndefined();

    const hidden = task({ id: 'later-1', title: 'Deferred' });
    expect(getTask(withTasks([hidden]), 'later-1')!.hiddenUntil).toBe('2099-01-01T00:00:00.000Z');
  });
});

describe('listProjects', () => {
  const projects = [
    { id: 'p1', title: 'Kitchen', notes: '', deadline: null, archived: false },
    { id: 'p2', title: 'Old thing', notes: '', deadline: null, archived: true },
  ] as Project[];

  it('leaves archived projects out', () => {
    expect(listProjects(stubReplica({ projects: () => projects })).map(p => p.id)).toEqual(['p1']);
  });

  it('counts live top-level members only', () => {
    const tasks = [
      task({ id: 'a', title: 'Open', projectId: 'p1' }),
      task({ id: 'b', title: 'Done', projectId: 'p1', completed: true }),
      task({ id: 'c', title: 'Subtask', projectId: 'p1', parentId: 'a' }),
    ];
    expect(listProjects(withTasks(tasks, { projects: () => projects }))[0].outstanding).toBe(1);
  });
});

describe('listGroceryItems', () => {
  const items = [
    { id: 'g1', name: 'Milk', quantity: '2L', aisle: 'Dairy', onList: true, checked: false },
    { id: 'g2', name: 'Paprika', quantity: null, aisle: '', onList: false, checked: false },
  ] as GroceryItem[];

  it('shows the list by default and the catalog on request', () => {
    const replica = stubReplica({ groceryItems: () => items });
    expect(listGroceryItems(replica).map(i => i.id)).toEqual(['g1']);
    expect(listGroceryItems(replica, { onListOnly: false }).map(i => i.id)).toEqual(['g1', 'g2']);
  });

  it('drops empty strings rather than reporting them', () => {
    const [, catalog] = listGroceryItems(stubReplica({ groceryItems: () => items }), { onListOnly: false });
    expect(catalog.quantity).toBeUndefined();
    expect(catalog.aisle).toBeUndefined();
  });
});

describe('resolveRange', () => {
  it('counts days back from today, with today inside the count', () => {
    // 7 days means today and the six before it, not today and seven before it.
    expect(resolveRange(stubReplica())).toEqual({ from: '2026-09-05', to: '2026-09-11' });
    expect(resolveRange(stubReplica(), { days: 1 })).toEqual({ from: '2026-09-11', to: '2026-09-11' });
    expect(DEFAULT_LOG_DAYS).toBe(7);
  });

  it('lets an explicit from win, and defaults its end to today', () => {
    expect(resolveRange(stubReplica(), { from: '2026-01-01' })).toEqual({
      from: '2026-01-01',
      to: '2026-09-11',
    });
    expect(resolveRange(stubReplica(), { from: '2026-01-01', to: '2026-01-31' })).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
    // `days` is ignored rather than combined, so the two can't disagree.
    expect(resolveRange(stubReplica(), { from: '2026-01-01', days: 3 }).from).toBe('2026-01-01');
  });

  it('clamps the day count at both ends', () => {
    expect(resolveRange(stubReplica(), { days: 0 }).from).toBe('2026-09-11');
    expect(resolveRange(stubReplica(), { days: 99999 }).from).toBe(
      resolveRange(stubReplica(), { days: MAX_LOG_DAYS }).from
    );
  });
});

describe('listFoodLog', () => {
  const entry = (over: Partial<FoodLogEntry> & { id: string; label: string }): FoodLogEntry =>
    ({
      dayKey: '2026-09-11',
      atISO: '2026-09-11T08:00:00.000Z',
      slot: null,
      quantity: '',
      grams: null,
      recipeId: null,
      ...over,
    }) as FoodLogEntry;

  it('reports the range it actually read, alongside the entries', () => {
    const result = listFoodLog(
      stubReplica({ foodLogEntries: () => [entry({ id: 'f1', label: 'Porridge', slot: 'breakfast' })] })
    );
    expect(result.range).toEqual({ from: '2026-09-05', to: '2026-09-11' });
    expect(result.entries).toEqual([
      { id: 'f1', dayKey: '2026-09-11', at: '2026-09-11T08:00:00.000Z', slot: 'breakfast', label: 'Porridge' },
    ]);
  });

  it('passes totals through without filling in a nutrient nobody logged', () => {
    const result = listFoodLog(
      stubReplica({
        foodLogEntries: () => [entry({ id: 'f1', label: 'Toast' })],
        foodTotals: () => ({ total: { calorieKcal: 210 }, reported: { calorieKcal: 1 }, entries: 1 }),
      })
    );
    // A day logged thinly is a hole, not a small number, so protein is absent
    // rather than 0 — that distinction is the whole reason totals carry
    // `reported` alongside `total`.
    expect(result.totals.total).toEqual({ calorieKcal: 210 });
    expect(result.totals.total.proteinG).toBeUndefined();
    expect(result.totals.reported).toEqual({ calorieKcal: 1 });
  });
});

describe('listMoodLogs', () => {
  const log = (over: Partial<MoodLog> & { id: string }): MoodLog =>
    ({
      dayKey: '2026-09-11',
      loggedAt: '2026-09-11T09:00:00.000Z',
      mood: null,
      symptoms: [],
      contextTags: [],
      note: null,
      ...over,
    }) as MoodLog;

  it('keeps a check-in that recorded only symptoms', () => {
    const result = listMoodLogs(
      stubReplica({
        moodLogs: () => [log({ id: 'm1', symptoms: [{ name: 'Headache', severity: 2 }] as MoodLog['symptoms'] })],
      })
    );
    // mood is nullable on purpose: somebody can log a symptom without rating
    // the day, and reporting that as a 0 would invent a rating.
    expect(result.logs[0].mood).toBeUndefined();
    expect(result.logs[0].symptoms).toEqual([{ name: 'Headache', severity: '2' }]);
  });

  it('drops empty symptom and tag lists rather than sending them', () => {
    const result = listMoodLogs(stubReplica({ moodLogs: () => [log({ id: 'm1', mood: 4 })] }));
    expect(result.logs[0]).toEqual({
      id: 'm1',
      dayKey: '2026-09-11',
      loggedAt: '2026-09-11T09:00:00.000Z',
      mood: 4,
    });
  });
});

describe('listMedicationLogs', () => {
  const dose = (over: Partial<MedicationLog> & { id: string; name: string }): MedicationLog =>
    ({
      dayKey: '2026-09-11',
      takenAt: '2026-09-11T20:00:00.000Z',
      amount: null,
      unit: null,
      asNeeded: false,
      ...over,
    }) as MedicationLog;

  it("uses the app's own one-line rendering rather than rebuilding it", () => {
    const result = listMedicationLogs(
      stubReplica({
        medicationLogs: () => [dose({ id: 'd1', name: 'Ibuprofen', amount: 400, unit: 'mg', asNeeded: true })],
        medicationSummary: () => 'Ibuprofen · 400 mg · as needed',
      })
    );
    expect(result.logs[0].summary).toBe('Ibuprofen · 400 mg · as needed');
    expect(result.logs[0]).toMatchObject({ amount: 400, unit: 'mg', asNeeded: true });
  });

  it('omits asNeeded when a dose was scheduled', () => {
    const result = listMedicationLogs(
      stubReplica({ medicationLogs: () => [dose({ id: 'd1', name: 'Levothyroxine' })] })
    );
    expect(result.logs[0].asNeeded).toBeUndefined();
  });
});

describe('serializeTask', () => {
  it('drops nulls and empty arrays rather than serializing them', () => {
    const result = serializeTask(stubReplica(), task({ id: 't', title: 'Bare' }));
    expect(result).toEqual({ id: 't', title: 'Bare', completed: false });
  });

  it('names the priority rather than emitting its number, and omits None', () => {
    expect(serializeTask(stubReplica(), task({ id: 't', title: 'A', priority: 4 })).priority).toBe('Urgent');
    expect(serializeTask(stubReplica(), task({ id: 't', title: 'A', priority: 0 })).priority).toBeUndefined();
  });

  it('takes the title from the live chain step, not from the task', () => {
    const chained = task({
      id: 't',
      title: 'Haircut',
      chainItems: [{ title: 'Book' }, { title: 'Go' }] as Task['chainItems'],
      chainIndex: 1,
    });
    const replica = stubReplica({ displayTitle: () => 'Go' });

    expect(serializeTask(replica, chained)).toMatchObject({ title: 'Go', chainStep: 'Go' });
  });

  it('does not call a single-item chain a chain', () => {
    const one = task({ id: 't', title: 'Solo', chainItems: [{ title: 'Solo' }] as Task['chainItems'] });
    expect(serializeTask(stubReplica(), one).chainStep).toBeUndefined();
  });

  it('reports blocked separately from merely not being due', () => {
    expect(serializeTask(stubReplica(), task({ id: 'blocked-1', title: 'Waiting' })).blocked).toBe(true);
    expect(serializeTask(stubReplica(), task({ id: 'today-1', title: 'Free' })).blocked).toBeUndefined();
  });
});
