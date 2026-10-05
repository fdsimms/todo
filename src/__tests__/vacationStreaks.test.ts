import { forgiveVacationStreaks, isVacationProtectedStreak } from '../utils/vacationStreaks';
import type { Task } from '../types';

const task = (over: Partial<Task>): Task =>
  ({ id: 'x', title: 'x', vacationPause: true, category: null, recurrenceType: 'daily', completed: false, streakCount: 3, streakDate: '2026-09-20T04:00:00.000Z', ...over }) as Task;

// Stands in for isHiddenForVacation: the task's own flag, or a category set to hide.
const hidden = (t: Task) => t.vacationPause || t.category === 'Chores';

describe('vacation streaks', () => {
  it('protects only an open repeating task that vacation hides and that has a streak', () => {
    expect(isVacationProtectedStreak(task({}), hidden)).toBe(true);
    expect(isVacationProtectedStreak(task({ vacationPause: false }), hidden)).toBe(false);
    expect(isVacationProtectedStreak(task({ recurrenceType: 'none' }), hidden)).toBe(false);
    expect(isVacationProtectedStreak(task({ completed: true }), hidden)).toBe(false);
    expect(isVacationProtectedStreak(task({ streakCount: 0 }), hidden)).toBe(false);
  });

  it('protects a task hidden through its category as well as one with its own pause flag', () => {
    const viaCategory = task({ vacationPause: false, category: 'Chores' });
    expect(isVacationProtectedStreak(viaCategory, hidden)).toBe(true);
    // The flag alone would have missed it.
    expect(isVacationProtectedStreak(viaCategory, t => t.vacationPause)).toBe(false);
  });

  it('re-dates each protected streak to the day start given and leaves the count alone', () => {
    const today = '2026-10-05T04:00:00.000Z';
    const rows = [task({ id: 'a' }), task({ id: 'b', streakCount: 0 }), task({ id: 'c', streakCount: 9 })];
    const forgiven = forgiveVacationStreaks(rows, today, hidden);
    expect(forgiven.map(t => t.id)).toEqual(['a', 'c']);
    expect(forgiven.map(t => t.streakDate)).toEqual([today, today]);
    expect(forgiven.map(t => t.streakCount)).toEqual([3, 9]);
    // The rows handed in are not changed in place.
    expect(rows[0].streakDate).toBe('2026-09-20T04:00:00.000Z');
  });
});
