import { projectTasksOf, seriesTasksOf } from '../utils/projectTasks';
import { benchBaseTask } from '../__bench__/benchTask';
import type { Task } from '../types';

const task = (id: string, projectId: string | null): Task => ({ ...benchBaseTask, id, projectId });

describe('projectTasksOf', () => {
  const tasks = [task('a', 'p1'), task('b', null), task('c', 'p2'), task('d', 'p1')];

  it('gives the same rows, in the same order, as filtering the list', () => {
    for (const id of ['p1', 'p2', 'nobody']) {
      expect(projectTasksOf(tasks, id)).toEqual(tasks.filter(t => t.projectId === id));
    }
  });

  it('answers from one bucketing per task array, and again for a new array', () => {
    expect(projectTasksOf(tasks, 'p1')).toBe(projectTasksOf(tasks, 'p1'));
    const next = [...tasks, task('e', 'p1')];
    expect(projectTasksOf(next, 'p1').map(t => t.id)).toEqual(['a', 'd', 'e']);
    expect(projectTasksOf(tasks, 'p1').map(t => t.id)).toEqual(['a', 'd']);
  });
});

describe('seriesTasksOf', () => {
  const dated = (id: string, seriesId: string | null): Task => ({ ...benchBaseTask, id, seriesId });
  const tasks = [dated('a', 's1'), dated('b', null), dated('c', 's2'), dated('d', 's1')];

  it('gives the same rows, in the same order, as filtering the list', () => {
    for (const id of ['s1', 's2', 'nobody']) {
      expect(seriesTasksOf(tasks, id)).toEqual(tasks.filter(t => t.seriesId === id));
    }
  });
});

