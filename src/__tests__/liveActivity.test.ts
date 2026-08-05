// react-native isn't loadable under the node test env, and this suite only
// exercises the pure request-building logic, so stub it out (mirrors
// deepLinks.test.ts's react-native mock).
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'ios' },
}));
// Only the pure request-building logic is under test here (buildLiveActivityRequest
// takes `enabled` as an explicit param), so the store itself is irrelevant —
// stubbed out to avoid pulling in database.ts's expo-sqlite import, which
// isn't transformable under the node test env (mirrors snoozeEngine.test.ts).
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ linkLiveActivity: true }) },
}));

import { describeLink, buildLiveActivityRequest, STALE_AFTER_SECONDS } from '../utils/liveActivity';
import type { Task } from '../types';

const BASE: Task = {
  id: 'task-1',
  title: 'Test',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: new Date().toISOString(),
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  tags: [],
  sortOrder: 0,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  reminderTime: null,
  parentId: null,
  groupId: null,
  projectId: null,
  category: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
};

function makeTask(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

// ─── describeLink ────────────────────────────────────────────────────────────

describe('describeLink', () => {
  it('matches a known preset scheme', () => {
    expect(describeLink('duolingo://')).toEqual({ label: 'Duolingo', sfSymbol: 'graduationcap.fill' });
  });

  it('matches a preset scheme with a path', () => {
    expect(describeLink('instagram://app')).toEqual({ label: 'Instagram', sfSymbol: 'camera.fill' });
  });

  it('falls back to the URL host, stripping www., for an arbitrary https link', () => {
    expect(describeLink('https://www.news.ycombinator.com/item?id=1')).toEqual({
      label: 'news.ycombinator.com',
      sfSymbol: 'safari',
    });
  });

  it('drops the port from the host fallback', () => {
    expect(describeLink('http://localhost:3000')).toEqual({ label: 'localhost', sfSymbol: 'safari' });
  });

  it('falls back to a generic link glyph for an unknown custom scheme', () => {
    expect(describeLink('slack://open?team=1')).toEqual({ label: '', sfSymbol: 'link' });
  });

  it('falls back to a generic link glyph for unparseable input', () => {
    expect(describeLink('not a url')).toEqual({ label: '', sfSymbol: 'link' });
  });
});

// ─── buildLiveActivityRequest ────────────────────────────────────────────────

describe('buildLiveActivityRequest', () => {
  it('returns null when disabled', () => {
    const task = makeTask({ linkUrl: 'duolingo://' });
    expect(buildLiveActivityRequest(task, { enabled: false })).toBeNull();
  });

  it('returns null when the task has no link', () => {
    const task = makeTask({ linkUrl: null });
    expect(buildLiveActivityRequest(task, { enabled: true })).toBeNull();
  });

  it('returns null when the task is already completed', () => {
    const task = makeTask({ linkUrl: 'duolingo://', completed: true });
    expect(buildLiveActivityRequest(task, { enabled: true })).toBeNull();
  });

  it('builds a request for an enabled task with a link', () => {
    const task = makeTask({ id: 'abc', title: 'Practice Spanish', linkUrl: 'duolingo://', streakCount: 5 });
    expect(buildLiveActivityRequest(task, { enabled: true })).toEqual({
      taskId: 'abc',
      title: 'Practice Spanish',
      subtitle: 'Duolingo',
      symbolName: 'graduationcap.fill',
      streakCount: 5,
      staleAfterSeconds: STALE_AFTER_SECONDS,
    });
  });

  it('truncates a long title', () => {
    const longTitle = 'x'.repeat(80);
    const task = makeTask({ linkUrl: 'duolingo://', title: longTitle });
    const request = buildLiveActivityRequest(task, { enabled: true });
    expect(request!.title.length).toBe(60);
    expect(request!.title.endsWith('…')).toBe(true);
  });

  it('leaves a short title untouched', () => {
    const task = makeTask({ linkUrl: 'duolingo://', title: 'Short' });
    const request = buildLiveActivityRequest(task, { enabled: true });
    expect(request!.title).toBe('Short');
  });
});
