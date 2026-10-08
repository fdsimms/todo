import { taskHomeFor } from '../utils/taskHome';
import * as vis from '../utils/visibilityUtils';
import type { Task } from '../types';

jest.mock('../utils/visibilityUtils', () => ({
  isInboxTask: jest.fn(),
  isTaskVisible: jest.fn(),
  isUnscheduledTask: jest.fn(),
  isTaskDeferred: jest.fn(),
}));

const mocked = vis as unknown as Record<string, jest.Mock>;
const task = (over: Partial<Task> = {}) => ({ archived: false, completed: false, parentId: null, ...over }) as Task;

function only(fn: string | null) {
  for (const name of ['isInboxTask', 'isTaskVisible', 'isUnscheduledTask', 'isTaskDeferred']) {
    mocked[name].mockReturnValue(name === fn);
  }
}

describe('taskHomeFor', () => {
  it('maps each predicate to its list', () => {
    only('isInboxTask');
    expect(taskHomeFor(task())).toBe('inbox');
    only('isTaskVisible');
    expect(taskHomeFor(task())).toBe('today');
    only('isUnscheduledTask');
    expect(taskHomeFor(task())).toBe('unscheduled');
    only('isTaskDeferred');
    expect(taskHomeFor(task())).toBe('later');
  });

  it('is archived whatever else is true', () => {
    only('isTaskVisible');
    expect(taskHomeFor(task({ archived: true, completed: true }))).toBe('archived');
  });

  it('has no home when completed, a subtask, or held back', () => {
    only('isTaskVisible');
    expect(taskHomeFor(task({ completed: true }))).toBeNull();
    expect(taskHomeFor(task({ parentId: 'p' }))).toBeNull();
    only(null);
    expect(taskHomeFor(task())).toBeNull();
  });
});
