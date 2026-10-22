const mockSettingsState = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
  vacationMode: false,
};

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: jest.fn(() => ({
      categories: [],
      getCategoryByName: jest.fn().mockReturnValue(null),
    })),
  },
}));

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

import { isAnsweredByRecord, isRecordAnswered, recordLogUrl, recordMicUrl } from '../utils/recordTasks';
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

describe('recordMicUrl', () => {
  it('is the sheet link with mic=1 for a journal or dream task', () => {
    expect(recordMicUrl(of('journalLog'))).toBe('dundundun://journal?log=1&mic=1');
    expect(recordMicUrl(of('dreamLog'))).toBe('dundundun://dreams?log=1&mic=1');
  });

  it('is null for mood and weight, which are answered with a tap, and for any other task', () => {
    for (const kind of [null, 'moodLog', 'weighIn', 'moodNudge'] as const) {
      expect(recordMicUrl(of(kind))).toBeNull();
    }
  });
});

describe('isRecordAnswered', () => {
  const none = { moodLogs: [], journalEntries: [], weighInAnsweredOn: null };
  const task = (generatedKind: Task['generatedKind'], generatedSourceId: string) =>
    ({ generatedKind, generatedSourceId } as Task);

  it('reads a mood check-in off an entry on its day', () => {
    const t = task('moodLog', '2026-08-25');
    expect(isRecordAnswered(t, none)).toBe(false);
    expect(isRecordAnswered(t, { ...none, moodLogs: [{ dayKey: '2026-08-24', loggedAt: '2026-08-24T09:00:00.000Z' }] })).toBe(false);
    expect(isRecordAnswered(t, { ...none, moodLogs: [{ dayKey: '2026-08-25', loggedAt: '2026-08-25T09:00:00.000Z' }] })).toBe(true);
  });

  it('keeps a journal entry and a dream apart', () => {
    const entries = [{ kind: 'dream' as const, dayKey: '2026-08-25', loggedAt: '2026-08-25T09:00:00.000Z' }];
    expect(isRecordAnswered(task('dreamLog', '2026-08-25'), { ...none, journalEntries: entries })).toBe(true);
    expect(isRecordAnswered(task('journalLog', '2026-08-25'), { ...none, journalEntries: entries })).toBe(false);
  });

  it('reads a weigh-in off the answered day the pass recorded', () => {
    const t = task('weighIn', '2026-08-25');
    expect(isRecordAnswered(t, none)).toBe(false);
    expect(isRecordAnswered(t, { ...none, weighInAnsweredOn: '2026-08-24' })).toBe(false);
    expect(isRecordAnswered(t, { ...none, weighInAnsweredOn: '2026-08-25' })).toBe(true);
  });

  it('is never true for another kind of task', () => {
    expect(isRecordAnswered(task('moodNudge', '2026-08-25'), none)).toBe(false);
  });
});
