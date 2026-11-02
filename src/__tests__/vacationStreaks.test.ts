import { forgivePausedProjectStreaks, forgiveVacationStreaks, isVacationProtectedStreak } from '../utils/vacationStreaks';
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

// A paused project's habit read as broken the morning the pause lifted.
describe('a project pause', () => {
  // Last done Oct 1; the pause lifts Oct 10.
  const habit = (over: Partial<Task> = {}) =>
    task({ id: 'h', projectId: 'garden', vacationPause: false, streakCount: 12, streakDate: new Date(2026, 9, 1, 4).toISOString(), ...over });
  const ended = new Map([['garden', '2026-10-10']]);
  const dayKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('dates the streak to the day before the pause lifted, and leaves the count alone', () => {
    const [forgiven] = forgivePausedProjectStreaks([habit()], ended);
    expect(dayKey(forgiven.streakDate!)).toBe('2026-10-09');
    expect(forgiven.streakCount).toBe(12);
  });

  // Forgiving up to the pause, not up to today: a run of missed days after it
  // still lapses, however late the pass that finds it runs.
  it('forgives nothing after the pause, and nothing twice', () => {
    const [forgiven] = forgivePausedProjectStreaks([habit()], ended);
    expect(forgivePausedProjectStreaks([forgiven], ended)).toEqual([]);
    const doneSince = habit({ streakDate: new Date(2026, 9, 11, 4).toISOString() });
    expect(forgivePausedProjectStreaks([doneSince], ended)).toEqual([]);
  });

  it('only touches an open repeating task with a streak, in a project whose pause ended', () => {
    expect(forgivePausedProjectStreaks([
      habit({ id: 'one-off', recurrenceType: 'none' }),
      habit({ id: 'done', completed: true }),
      habit({ id: 'none', streakCount: 0 }),
      habit({ id: 'elsewhere', projectId: 'kitchen' }),
      habit({ id: 'loose', projectId: null }),
    ], ended)).toEqual([]);
  });
});

