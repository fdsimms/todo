import type { Task } from '../types';
import { journalLogUrl, journalTaskDayKey, journalTaskSourceId } from '../utils/journalTasks';

const task = (generatedKind: string, generatedSourceId: string) =>
  ({ generatedKind, generatedSourceId }) as Pick<Task, 'generatedKind' | 'generatedSourceId'>;

describe('journalTaskSourceId', () => {
  it('is the day alone with no part of the day, else the day and the part', () => {
    expect(journalTaskSourceId('2026-10-06', null)).toBe('2026-10-06');
    expect(journalTaskSourceId('2026-10-06', 'evening')).toBe('2026-10-06:evening');
  });
});

describe('journalTaskDayKey', () => {
  it('reads the day off either form, for its own kind only', () => {
    expect(journalTaskDayKey(task('journalLog', '2026-10-06:morning'), 'journal')).toBe('2026-10-06');
    expect(journalTaskDayKey(task('dreamLog', '2026-10-06'), 'dream')).toBe('2026-10-06');
    expect(journalTaskDayKey(task('dreamLog', '2026-10-06'), 'journal')).toBeNull();
    expect(journalTaskDayKey(task('moodLog', '2026-10-06'), 'journal')).toBeNull();
  });
});

describe('journalLogUrl', () => {
  it('opens the sheet for its own kind', () => {
    expect(journalLogUrl('journal')).toBe('dundundun://journal?log=1');
    expect(journalLogUrl('dream')).toBe('dundundun://dreams?log=1');
  });
});
