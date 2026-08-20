import {
  dropGeneratedTask,
  reconcileGeneratedTask,
  deleteGeneratedTaskQuietly,
} from '../store/generatedTaskSync';
import { derivedId, spawnSeed } from '../utils/syncIds';
import type { Task } from '../types';

// The shared reconcile reaches useTaskStore directly, the same way each
// generator's store used to. Same mockTaskState shape as
// useLeftoverStore.test.ts / useGroceryStore.test.ts.
const mockTaskState = {
  tasks: [] as Task[],
  // The third parameter is declared so the skipCategoryDefault assertion below
  // can read it — reconcileGeneratedTask always passes one, same reason as
  // updateTask's _options below.
  addTask: jest.fn((draft: Partial<Task>, id?: string, _options?: { skipCategoryDefault?: boolean }) => {
    const task = {
      id: id ?? `t-${mockTaskState.tasks.length + 1}`,
      completed: false,
      archived: false,
      generatedKind: null,
      generatedSourceId: null,
      ...draft,
    } as Task;
    mockTaskState.tasks.push(task);
    return task;
  }),
  // The third parameter is declared so the skipPostponeCount assertions below
  // can read it — reconcileGeneratedTask always passes one.
  updateTask: jest.fn((id: string, updates: Partial<Task>, _options?: { skipPostponeCount?: boolean }) => {
    mockTaskState.tasks = mockTaskState.tasks.map(t => (t.id === id ? { ...t, ...updates } : t));
  }),
  deleteTask: jest.fn((id: string) => {
    mockTaskState.tasks = mockTaskState.tasks.filter(t => t.id !== id);
  }),
  setLastAction: jest.fn(),
};
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => mockTaskState },
}));

function seedTask(overrides: Partial<Task> = {}): Task {
  const task = {
    id: 'existing',
    title: 'Use up Spinach',
    completed: false,
    archived: false,
    generatedKind: 'groceryUseUp',
    generatedSourceId: 'g-1',
    ...overrides,
  } as Task;
  mockTaskState.tasks.push(task);
  return task;
}

/** The common case: wanted, nothing has drifted, one draft to create. */
const opts = (overrides: Partial<Parameters<typeof reconcileGeneratedTask>[0]> = {}) => ({
  kind: 'groceryUseUp' as const,
  sourceId: 'g-1',
  wanted: true,
  drift: () => null,
  draft: () => ({ title: 'Use up Spinach' }),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTaskState.tasks = [];
});

describe('reconcileGeneratedTask — creating', () => {
  it('creates the task when one is wanted and none exists', () => {
    reconcileGeneratedTask(opts());

    expect(mockTaskState.addTask).toHaveBeenCalledTimes(1);
    expect(mockTaskState.tasks).toHaveLength(1);
  });

  // #1724: the draft's category is the source's own dedicated setting,
  // already resolved and possibly deliberately null — addTask must not read
  // that null as unanswered and substitute newTaskDefaults.category for it.
  it('creates with skipCategoryDefault, so a deliberately uncategorized source stays uncategorized', () => {
    reconcileGeneratedTask(opts({ draft: () => ({ title: 'Use up Spinach', category: null }) }));

    const [draftArg, , optionsArg] = mockTaskState.addTask.mock.calls[0];
    expect(draftArg).toEqual({ title: 'Use up Spinach', category: null });
    expect(optionsArg).toEqual({ skipCategoryDefault: true, skipTitleRules: true });
  });

  it('does not create one when the source does not want it', () => {
    reconcileGeneratedTask(opts({ wanted: false }));

    expect(mockTaskState.addTask).not.toHaveBeenCalled();
    expect(mockTaskState.tasks).toHaveLength(0);
  });

  it('builds the draft lazily, so a reconcile that creates nothing costs nothing', () => {
    const draft = jest.fn(() => ({ title: 'Use up Spinach' }));
    reconcileGeneratedTask(opts({ wanted: false, draft }));

    expect(draft).not.toHaveBeenCalled();
  });

  it('creates a second task for a source whose earlier one is finished', () => {
    // A grocery item is a forever-row: last month's ticked-off "Use up spinach"
    // says nothing about the bag bought this afternoon.
    seedTask({ id: 'old', completed: true });

    reconcileGeneratedTask(opts());

    expect(mockTaskState.tasks).toHaveLength(2);
    // And it must not reuse the finished row's id (#1751): the two share a
    // (kind, source) pair, so without a per-occurrence index the second
    // create would collide with the first instead of standing beside it.
    const created = mockTaskState.tasks[1];
    expect(created.id).not.toBe('old');
    expect(created.id).toBe(derivedId(spawnSeed.generated('groceryUseUp', 'g-1', 1)));
  });

  it('derives the created id from the kind, source and how many already exist (#1751)', () => {
    // The bug this prevents: two devices each reconcile the same grocery item
    // before ever syncing. Without a shared id each mints its own random one
    // via addTask, and the ordinary sync merge keeps both as separate rows.
    reconcileGeneratedTask(opts());

    expect(mockTaskState.tasks[0].id).toBe(derivedId(spawnSeed.generated('groceryUseUp', 'g-1', 0)));
  });

  it('gives two independent reconciles of the same fresh source the same id', () => {
    // Simulates the race directly: two "devices" each reconcile a source
    // neither has ever created a task for, without seeing the other's tasks.
    const firstDeviceTasks: Task[] = [];
    const secondDeviceTasks: Task[] = [];

    mockTaskState.tasks = firstDeviceTasks;
    reconcileGeneratedTask(opts());
    const firstId = mockTaskState.tasks[0].id;

    mockTaskState.tasks = secondDeviceTasks;
    reconcileGeneratedTask(opts());
    const secondId = mockTaskState.tasks[0].id;

    expect(secondId).toBe(firstId);
  });

  it('refuses the second one when blocksOnFinished is set', () => {
    // A meal is one event, so a completed cook task means the night happened.
    seedTask({ id: 'old', generatedKind: 'mealCook', generatedSourceId: 'm-1', completed: true });

    reconcileGeneratedTask(opts({ kind: 'mealCook', sourceId: 'm-1', blocksOnFinished: true }));

    expect(mockTaskState.addTask).not.toHaveBeenCalled();
    expect(mockTaskState.tasks).toHaveLength(1);
  });

  it('ignores a task of another kind carrying the same source id', () => {
    seedTask({ id: 'other', generatedKind: 'leftoverUseUp', generatedSourceId: 'g-1' });

    reconcileGeneratedTask(opts());

    expect(mockTaskState.tasks).toHaveLength(2);
  });
});

describe('reconcileGeneratedTask — useUpCap', () => {
  it('creates the task while under the cap', () => {
    seedTask({ id: 'other', generatedKind: 'leftoverUseUp', generatedSourceId: 'l-1' });

    reconcileGeneratedTask(opts({ useUpCap: 2 }));

    expect(mockTaskState.addTask).toHaveBeenCalledTimes(1);
  });

  it('declines to create once the cap is already spent', () => {
    seedTask({ id: 'other', generatedKind: 'leftoverUseUp', generatedSourceId: 'l-1' });

    reconcileGeneratedTask(opts({ useUpCap: 1 }));

    expect(mockTaskState.addTask).not.toHaveBeenCalled();
    expect(mockTaskState.tasks).toHaveLength(1);
  });

  it('counts grocery and leftover use-up tasks together against one cap', () => {
    seedTask({ id: 'g-other', generatedSourceId: 'g-2' });
    seedTask({ id: 'l-other', generatedKind: 'leftoverUseUp', generatedSourceId: 'l-1' });

    reconcileGeneratedTask(opts({ useUpCap: 2 }));

    expect(mockTaskState.addTask).not.toHaveBeenCalled();
  });

  it('ignores a completed or archived task when spending the cap', () => {
    seedTask({ id: 'done', completed: true });

    reconcileGeneratedTask(opts({ useUpCap: 1 }));

    expect(mockTaskState.addTask).toHaveBeenCalledTimes(1);
  });

  it('does not count cook tasks or the nudge against the cap', () => {
    seedTask({ id: 'cook', generatedKind: 'mealCook', generatedSourceId: 'm-1' });
    seedTask({ id: 'nudge', generatedKind: 'mealPlanNudge', generatedSourceId: null });

    reconcileGeneratedTask(opts({ useUpCap: 1 }));

    expect(mockTaskState.addTask).toHaveBeenCalledTimes(1);
  });

  it('treats null (and omitted) as unlimited', () => {
    seedTask({ id: 'other', generatedKind: 'leftoverUseUp', generatedSourceId: 'l-1' });

    reconcileGeneratedTask(opts({ useUpCap: null }));
    expect(mockTaskState.addTask).toHaveBeenCalledTimes(1);
  });

  it('never evicts an already-live task to make room — a shown task stays shown', () => {
    seedTask({ id: 'other', generatedKind: 'leftoverUseUp', generatedSourceId: 'l-1' });

    reconcileGeneratedTask(opts({ useUpCap: 1 }));

    expect(mockTaskState.deleteTask).not.toHaveBeenCalled();
    expect(mockTaskState.tasks).toHaveLength(1);
  });

  it('does not gate an update to an already-existing task', () => {
    seedTask();
    seedTask({ id: 'other', generatedKind: 'leftoverUseUp', generatedSourceId: 'l-1' });

    reconcileGeneratedTask(opts({ useUpCap: 1, drift: () => ({ title: 'Use up Baby spinach' }) }));

    expect(mockTaskState.updateTask).toHaveBeenCalledWith(
      'existing',
      { title: 'Use up Baby spinach' },
      { skipPostponeCount: true }
    );
  });
});

describe('reconcileGeneratedTask — updating', () => {
  it('rewrites only what the caller reports as drifted', () => {
    seedTask();

    reconcileGeneratedTask(opts({ drift: () => ({ title: 'Use up Baby spinach' }) }));

    expect(mockTaskState.updateTask).toHaveBeenCalledWith(
      'existing',
      { title: 'Use up Baby spinach' },
      { skipPostponeCount: true }
    );
  });

  it('writes nothing when nothing has drifted', () => {
    seedTask();

    reconcileGeneratedTask(opts());

    expect(mockTaskState.updateTask).not.toHaveBeenCalled();
    expect(mockTaskState.addTask).not.toHaveBeenCalled();
  });

  it('always skips the postpone count — the date is the source\'s, not a duck', () => {
    seedTask();

    reconcileGeneratedTask(opts({ drift: () => ({ dueDate: '2026-08-20T12:00:00.000Z' }) }));

    expect(mockTaskState.updateTask.mock.calls[0][2]).toEqual({ skipPostponeCount: true });
  });

  it('updates the live task rather than a completed one for the same source', () => {
    seedTask({ id: 'old', completed: true });
    seedTask({ id: 'live' });

    reconcileGeneratedTask(opts({ drift: () => ({ title: 'Use up Baby spinach' }) }));

    expect(mockTaskState.updateTask.mock.calls[0][0]).toBe('live');
  });
});

describe('reconcileGeneratedTask — removing', () => {
  it('deletes the live task when the source no longer wants one', () => {
    seedTask();

    reconcileGeneratedTask(opts({ wanted: false }));

    // No skipGeneratedOptOut: this delete is reached only when the source has
    // already said no, so writing that "no" back onto it is a no-op the store's
    // own equality guard drops — and the path stays the one that *would* write.
    expect(mockTaskState.deleteTask).toHaveBeenCalledWith('existing', { skipGeneratedOptOut: undefined });
    expect(mockTaskState.tasks).toHaveLength(0);
  });

  it('leaves a completed one alone — it records something that was done', () => {
    seedTask({ completed: true });

    reconcileGeneratedTask(opts({ wanted: false }));

    expect(mockTaskState.deleteTask).not.toHaveBeenCalled();
  });

  it('leaves an archived one alone', () => {
    seedTask({ archived: true });

    reconcileGeneratedTask(opts({ wanted: false }));

    expect(mockTaskState.deleteTask).not.toHaveBeenCalled();
  });

  it('does not arm shake-to-undo for a delete the user did not perform', () => {
    seedTask();

    reconcileGeneratedTask(opts({ wanted: false }));

    expect(mockTaskState.setLastAction).toHaveBeenCalledWith(null);
  });
});

describe('a generator with no source row', () => {
  it('matches on the kind alone', () => {
    seedTask({ id: 'nudge', generatedKind: 'mealPlanNudge', generatedSourceId: null });

    reconcileGeneratedTask(opts({ kind: 'mealPlanNudge', sourceId: null }));

    expect(mockTaskState.addTask).not.toHaveBeenCalled();
  });

  it('creates one when there is none', () => {
    reconcileGeneratedTask(opts({ kind: 'mealPlanNudge', sourceId: null }));

    expect(mockTaskState.tasks).toHaveLength(1);
  });
});

describe('dropGeneratedTask', () => {
  it('deletes the live task, quietly', () => {
    seedTask();

    dropGeneratedTask('groceryUseUp', 'g-1');

    // "Without deciding anything" — so no opt-out is written on the source.
    // It was true by accident for the original callers, whose source row is
    // already gone by this point; projectReview's outlives its task, so the
    // skip has to be explicit (see dropGeneratedTask's own note).
    expect(mockTaskState.deleteTask).toHaveBeenCalledWith('existing', { skipGeneratedOptOut: true });
    expect(mockTaskState.setLastAction).toHaveBeenCalledWith(null);
  });

  it('leaves completed history alone — forgetting a source must not erase the Logbook', () => {
    seedTask({ completed: true });

    dropGeneratedTask('groceryUseUp', 'g-1');

    expect(mockTaskState.deleteTask).not.toHaveBeenCalled();
  });

  it('shrugs when the source never had one', () => {
    expect(() => dropGeneratedTask('groceryUseUp', 'g-nope')).not.toThrow();
    expect(mockTaskState.deleteTask).not.toHaveBeenCalled();
  });

  it('will not take another kind\'s task that shares the id', () => {
    seedTask({ generatedKind: 'leftoverUseUp' });

    dropGeneratedTask('groceryUseUp', 'g-1');

    expect(mockTaskState.deleteTask).not.toHaveBeenCalled();
  });
});

describe('deleteGeneratedTaskQuietly', () => {
  it('deletes and then clears the undo slot, in that order', () => {
    seedTask();

    deleteGeneratedTaskQuietly('existing');

    expect(mockTaskState.deleteTask).toHaveBeenCalledWith('existing', { skipGeneratedOptOut: undefined });
    // Clearing first would leave whatever deleteTask armed sitting there.
    expect(mockTaskState.setLastAction.mock.invocationCallOrder[0])
      .toBeGreaterThan(mockTaskState.deleteTask.mock.invocationCallOrder[0]);
  });
});
