import { rankStreaks, streakScore } from '../utils/streakLeaderboard';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0, holidaySet: 'none', customHolidays: [] }),
  },
}));

const task = (over: Partial<Task>): Task =>
  ({
    id: over.title ?? 'x',
    title: 'x',
    recurrenceType: 'daily',
    completed: false,
    parentId: null,
    streakCount: 10,
    streakDate: null,
    chainItems: [],
    polarity: 'positive',
    priority: 0,
    effort: 0,
    estimatedMinutes: null,
    difficulty: null,
    ...over,
  }) as Task;

describe('streakLeaderboard', () => {
  it('ranks a harder task above an easier one with the same run', () => {
    const ranked = rankStreaks([
      task({ title: 'Floss', difficulty: 'easy' }),
      task({ title: 'Run', difficulty: 'hard', estimatedMinutes: 30 }),
    ]);
    expect(ranked.map(t => t.title)).toEqual(['Run', 'Floss']);
  });

  it('lets a longer run on an easy task outrank a short run on a hard one', () => {
    const ranked = rankStreaks([
      task({ title: 'Long easy', difficulty: 'normal', streakCount: 100 }),
      task({ title: 'Short hard', difficulty: 'hard', streakCount: 3 }),
    ]);
    expect(ranked[0].title).toBe('Long easy');
  });

  it('leaves trivial tasks off the board', () => {
    const ranked = rankStreaks([
      task({ title: 'Drink water', difficulty: 'trivial', streakCount: 99 }),
      task({ title: 'Anki', streakCount: 1 }),
    ]);
    expect(ranked.map(t => t.title)).toEqual(['Anki']);
  });

  it('scores an unrated task as an ordinary one', () => {
    expect(streakScore(task({ difficulty: null }))).toBe(streakScore(task({ difficulty: 'normal' })));
  });

  it('breaks score ties by run, then priority, then title', () => {
    const ranked = rankStreaks([
      task({ title: 'B', priority: 1 }),
      task({ title: 'A', priority: 1 }),
      task({ title: 'C', priority: 3 }),
      task({ title: 'D', priority: 0, estimatedMinutes: 20, difficulty: 'easy', streakCount: 20 }),
    ]);
    // D: 20 x 1 = 20 on score and run; the rest score 10 x 2 = 20 with a run of 10.
    expect(ranked.map(t => t.title)).toEqual(['D', 'C', 'A', 'B']);
  });

  it('skips subtasks, one-offs, completed rows and broken runs, and caps at the limit', () => {
    const ranked = rankStreaks(
      [
        task({ title: 'sub', parentId: 'p' }),
        task({ title: 'once', recurrenceType: 'none' }),
        task({ title: 'done', completed: true }),
        task({ title: 'zero', streakCount: 0 }),
        task({ title: 'a' }),
        task({ title: 'b' }),
      ],
      undefined,
      1,
    );
    expect(ranked.map(t => t.title)).toEqual(['a']);
  });
});
