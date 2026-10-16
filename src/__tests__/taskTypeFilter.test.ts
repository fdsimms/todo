import type { Task } from '../types';
import {
  TASK_TYPE_FILTERS,
  filterByTaskTypes,
  matchesTaskTypes,
  parseTaskTypeFilters,
  taskTypeFilterLabel,
  taskTypesOf,
} from '../utils/taskTypeFilter';

const task = (overrides: Partial<Task> = {}): Task => ({
  recurrenceType: 'none',
  chainEnabled: false,
  targetCount: null,
  timedMinutes: null,
  healthMetric: null,
  healthTarget: null,
  rotationEnabled: false,
  ...overrides,
} as Task);

describe('taskTypesOf', () => {
  it('answers standard for an ordinary task', () => {
    expect(taskTypesOf(task())).toEqual(['task']);
  });

  it('answers each kind taskKindOf does', () => {
    expect(taskTypesOf(task({ timedMinutes: 15 }))).toEqual(['timed']);
    expect(taskTypesOf(task({ targetCount: 3 }))).toEqual(['target']);
    expect(taskTypesOf(task({ chainEnabled: true }))).toEqual(['chain']);
    expect(taskTypesOf(task({ rotationEnabled: true }))).toEqual(['rotation']);
    expect(taskTypesOf(task({ healthMetric: 'steps', healthTarget: 8000 }))).toEqual(['health']);
  });

  it('adds repeating on top of the kind rather than instead of it', () => {
    expect(taskTypesOf(task({ timedMinutes: 15, recurrenceType: 'daily' }))).toEqual(['timed', 'repeating']);
    expect(taskTypesOf(task({ recurrenceType: 'hours' }))).toEqual(['task', 'repeating']);
  });
});

describe('matchesTaskTypes', () => {
  it('filters nothing when nothing is picked', () => {
    expect(matchesTaskTypes(task({ chainEnabled: true }), [])).toBe(true);
  });

  it('matches on any picked chip, never all of them', () => {
    const timedDaily = task({ timedMinutes: 10, recurrenceType: 'daily' });
    expect(matchesTaskTypes(timedDaily, ['timed'])).toBe(true);
    expect(matchesTaskTypes(timedDaily, ['repeating'])).toBe(true);
    expect(matchesTaskTypes(timedDaily, ['chain', 'target'])).toBe(false);
  });

  it('keeps a plain repeating task out of Standard-less picks', () => {
    expect(matchesTaskTypes(task({ recurrenceType: 'weekly' }), ['timed'])).toBe(false);
  });
});

describe('filterByTaskTypes', () => {
  it('hands back the same array when nothing is picked', () => {
    const list = [task()];
    expect(filterByTaskTypes(list, [])).toBe(list);
  });

  it('keeps only the matching rows', () => {
    const a = task({ timedMinutes: 5 });
    const b = task();
    expect(filterByTaskTypes([a, b], ['timed'])).toEqual([a]);
  });
});

describe('parseTaskTypeFilters', () => {
  it('reads known chips back in chip order', () => {
    expect(parseTaskTypeFilters('["repeating","timed"]')).toEqual(['timed', 'repeating']);
  });

  it('drops unknown entries and survives bad JSON', () => {
    expect(parseTaskTypeFilters('["timed","x",1]')).toEqual(['timed']);
    expect(parseTaskTypeFilters('nope')).toEqual([]);
    expect(parseTaskTypeFilters('{"a":1}')).toEqual([]);
    expect(parseTaskTypeFilters(null)).toEqual([]);
  });
});

describe('labels', () => {
  it('names every chip', () => {
    for (const t of TASK_TYPE_FILTERS) expect(taskTypeFilterLabel(t).length).toBeGreaterThan(0);
  });
});
