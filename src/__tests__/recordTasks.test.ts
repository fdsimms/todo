import { isAnsweredByRecord, recordLogUrl } from '../utils/recordTasks';
import type { Task } from '../types';

const of = (generatedKind: Task['generatedKind']) => ({ generatedKind });

describe('tasks a record answers', () => {
  it.each(['moodLog', 'journalLog', 'dreamLog', 'weighIn'] as const)('%s is one, and names its sheet', kind => {
    expect(isAnsweredByRecord(of(kind))).toBe(true);
    expect(recordLogUrl(of(kind))).toMatch(/^dundundun:\/\/.+\?log=1$/);
  });

  it('does not match a plain task or another generated kind', () => {
    for (const kind of [null, 'moodNudge', 'calendarReview'] as const) {
      expect(isAnsweredByRecord(of(kind))).toBe(false);
      expect(recordLogUrl(of(kind))).toBeNull();
    }
  });
});
