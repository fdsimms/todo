import { editedTaskMove } from '../utils/editedTaskMove';
import * as home from '../utils/taskHome';
import type { Task } from '../types';

jest.mock('../utils/taskHome', () => ({ taskHomeFor: jest.fn() }));

const taskHomeFor = home.taskHomeFor as unknown as jest.Mock;
const task = (id: string) => ({ id }) as Task;

/** `taskHomeFor` answers in turn: the task as it opened, then as it was saved. */
function homes(before: string | null, after: string | null) {
  taskHomeFor.mockReset();
  taskHomeFor.mockReturnValueOnce(before).mockReturnValueOnce(after);
}

describe('editedTaskMove', () => {
  it('names the list a task moved to when an edit took it off the one on screen', () => {
    homes('today', 'later');
    expect(editedTaskMove(task('a'), task('a'), 'today')).toBe('later');
    homes('inbox', 'unscheduled');
    expect(editedTaskMove(task('a'), task('a'), 'inbox')).toBe('unscheduled');
    homes('later', 'inbox');
    expect(editedTaskMove(task('a'), task('a'), 'later')).toBe('inbox');
  });

  it('says nothing when the task stayed on its list', () => {
    homes('today', 'today');
    expect(editedTaskMove(task('a'), task('a'), 'today')).toBeNull();
  });

  it('says nothing for a task that was never on the list being viewed', () => {
    homes('later', 'unscheduled');
    expect(editedTaskMove(task('a'), task('a'), 'today')).toBeNull();
  });

  it('says nothing when it arrived on Today, was archived, or landed on no list', () => {
    homes('later', 'today');
    expect(editedTaskMove(task('a'), task('a'), 'later')).toBeNull();
    homes('today', 'archived');
    expect(editedTaskMove(task('a'), task('a'), 'today')).toBeNull();
    homes('today', null);
    expect(editedTaskMove(task('a'), task('a'), 'today')).toBeNull();
  });
});
