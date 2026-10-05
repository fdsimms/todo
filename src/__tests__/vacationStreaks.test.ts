import { forgiveVacationStreaks, isVacationProtectedStreak } from '../utils/vacationStreaks';
import type { Task } from '../types';

const task = (over: Partial<Task>): Task =>
  ({ id: 'x', title: 'x', vacationPause: true, recurrenceType: 'daily', completed: false, streakCount: 3, streakDate: '2026-09-20T04:00:00.000Z', ...over }) as Task;

describe('vacation streaks', () => {
  it('protects only an open repeating task marked for vacation pause that has a streak', () => {
    expect(isVacationProtectedStreak(task({}))).toBe(true);
    expect(isVacationProtectedStreak(task({ vacationPause: false }))).toBe(false);
    expect(isVacationProtectedStreak(task({ recurrenceType: 'none' }))).toBe(false);
    expect(isVacationProtectedStreak(task({ completed: true }))).toBe(false);
    expect(isVacationProtectedStreak(task({ streakCount: 0 }))).toBe(false);
  });

  it('re-dates each protected streak to the day start given and leaves the count alone', () => {
    const today = '2026-10-05T04:00:00.000Z';
    const rows = [task({ id: 'a' }), task({ id: 'b', streakCount: 0 }), task({ id: 'c', streakCount: 9 })];
    const forgiven = forgiveVacationStreaks(rows, today);
    expect(forgiven.map(t => t.id)).toEqual(['a', 'c']);
    expect(forgiven.map(t => t.streakDate)).toEqual([today, today]);
    expect(forgiven.map(t => t.streakCount)).toEqual([3, 9]);
    // The rows handed in are not changed in place.
    expect(rows[0].streakDate).toBe('2026-09-20T04:00:00.000Z');
  });
});
