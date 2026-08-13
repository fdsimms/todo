import {
  dropGeneratedTask,
  reconcileGeneratedTask,
  deleteGeneratedTaskQuietly,
} from '../store/generatedTaskSync';
import type { Task } from '../types';

// The shared reconcile reaches useTaskStore directly, the same way each
// generator's store used to. Same mockTaskState shape as
// useLeftoverStore.test.ts / useGroceryStore.test.ts.
const mockTaskState = {
  tasks: [] as Task[],
  addTask: jest.fn((draft: Partial<Task>) => {
    const task = {
      id: `t-${mockTaskState.tasks.length + 1}`,
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

    expect(mockTaskState.deleteTask).toHaveBeenCalledWith('existing');
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

    expect(mockTaskState.deleteTask).toHaveBeenCalledWith('existing');
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

    expect(mockTaskState.deleteTask).toHaveBeenCalledWith('existing');
    // Clearing first would leave whatever deleteTask armed sitting there.
    expect(mockTaskState.setLastAction.mock.invocationCallOrder[0])
      .toBeGreaterThan(mockTaskState.deleteTask.mock.invocationCallOrder[0]);
  });
});
