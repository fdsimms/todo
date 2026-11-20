import { rowFollowsClock } from '../utils/rowClock';
import { benchBaseTask } from '../__bench__/benchTask';
import type { Task } from '../types';

const RESET = '04:00';
const task = (patch: Partial<Task>): Task => ({ ...benchBaseTask, ...patch });
const follows = (patch: Partial<Task>, categoryHasHours = false) =>
  rowFollowsClock(task(patch), RESET, categoryHasHours);

describe('rowFollowsClock', () => {
  it('says no for a task with nothing timed on it', () => {
    expect(follows({})).toBe(false);
    // A date at the start of its logical day, and one at midnight, name no time.
    expect(follows({ dueDate: new Date(2026, 7, 12, 4, 0).toISOString() })).toBe(false);
    expect(follows({ dueDate: new Date(2026, 7, 12, 0, 0).toISOString() })).toBe(false);
    expect(follows({ recurrenceType: 'daily', dueDate: new Date(2026, 7, 12, 4, 0).toISOString() })).toBe(false);
  });

  it('says yes for a date that names a time, and for one it cannot read', () => {
    expect(follows({ dueDate: new Date(2026, 7, 12, 15, 30).toISOString() })).toBe(true);
    expect(follows({ dueDate: 'not a date' })).toBe(true);
  });

  it.each<[string, Partial<Task>]>([
    ['a window start', { windowStart: '09:00' }],
    ['a window end', { windowEnd: '17:00' }],
    ['a time of day', { timeSegments: ['evening'] }],
    ['a snooze', { deferUntil: new Date(2026, 7, 12, 4, 0).toISOString() }],
    ['a deadline', { deadline: new Date(2026, 7, 14, 4, 0).toISOString() }],
    ['a reminder', { reminderTime: new Date(2026, 7, 12, 9, 0).toISOString() }],
    ['a running timer', { timerStartedAt: new Date(2026, 7, 12, 9, 0).toISOString() }],
    ['a paused timer with time on it', { timerElapsedSeconds: 90 }],
    ['a target', { targetCount: 8 }],
    ['an hourly repeat', { recurrenceType: 'hours' }],
    ['a habit to avoid', { polarity: 'negative' }],
    ['a task the app wrote', { generatedKind: 'travel' }],
    ['a linked alarm', { alarmLink: 'alarm-1' }],
    ['an import waiting for an answer', { pendingImport: { title: 'x' } }],
  ])('says yes for %s', (_name, patch) => {
    expect(follows(patch)).toBe(true);
  });

  it('says yes for a category limited to hours', () => {
    expect(follows({}, true)).toBe(true);
  });
});
