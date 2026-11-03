import { landingFor, taskHomeFor } from '../utils/taskHome';
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

describe('landingFor', () => {
  it('is taskHomeFor for a task one of the four lists holds', () => {
    only('isInboxTask');
    expect(landingFor(task())).toBe('inbox');
    only('isTaskVisible');
    expect(landingFor(task())).toBe('today');
    only('isUnscheduledTask');
    expect(landingFor(task())).toBe('unscheduled');
    only('isTaskDeferred');
    expect(landingFor(task())).toBe('later');
  });

  // The case the toast used to get wrong: no list holds an undated project
  // task, and "else Later" named one it was never on.
  it('puts an undated project task on its project', () => {
    only(null);
    expect(landingFor(task({ projectId: 'proj1', dueDate: null }))).toBe('project');
  });

  it('does not offer a project to a task that has a date, or is not a live top-level row', () => {
    only(null);
    expect(landingFor(task({ projectId: 'proj1', dueDate: '2026-11-05T12:00:00.000Z' }))).toBeNull();
    expect(landingFor(task({ projectId: 'proj1', dueDate: null, completed: true }))).toBeNull();
    expect(landingFor(task({ projectId: 'proj1', dueDate: null, parentId: 'p' }))).toBeNull();
    expect(landingFor(task({ projectId: null, dueDate: null }))).toBeNull();
  });

  it('is null for an archived task, which is never announced as arriving', () => {
    only(null);
    expect(landingFor(task({ archived: true, projectId: 'proj1', dueDate: null }))).toBeNull();
  });
});
