import {
  segmentOf,
  buildRhythmProfile,
  findSegmentMismatches,
  suggestSegment,
  formatHour,
  formatHourRange,
  describeRhythm,
  DEFAULT_BOUNDARIES,
  MIN_SAMPLES,
} from '../utils/rhythms';
import type { Task, TimeOfDay } from '../types';

let nextId = 1;

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: String(nextId++),
  title: 'Untitled',
  notes: '',
  completed: true,
  missedAt: null,
  autoScheduledAt: null,
  completedAt: '2026-01-01T09:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
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
  targetCount: null,
  targetUnit: null,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  reminderTime: null,
  reminderKind: 'notification',
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  blockedById: null,
  pendingImport: null,
  ...overrides,
});

beforeEach(() => {
  nextId = 1;
});

/**
 * Local-time ISO string, so a test asserting "completed at 9am" means 9am on
 * the machine running it. `new Date('...Z')` would shift by the TZ offset and
 * make every hour assertion fail outside UTC.
 */
function at(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

/** N completions of the same title, all at `hour`, each on its own day. */
function completionsAt(
  title: string,
  hour: number,
  count: number,
  overrides: Partial<Task> = {},
): Task[] {
  return Array.from({ length: count }, (_, i) =>
    makeTask({ title, completedAt: at(2026, 3, i + 1, hour), ...overrides }),
  );
}

describe('segmentOf', () => {
  const cases: [number, TimeOfDay][] = [
    [7, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [20, 'evening'],
    [21, 'night'],
    [23, 'night'],
  ];

  it.each(cases)('puts %ih in the %s', (hour, expected) => {
    expect(segmentOf(new Date(2026, 2, 1, hour), DEFAULT_BOUNDARIES)).toBe(expected);
  });

  it('puts the small hours in night — the one segment that wraps past midnight', () => {
    expect(segmentOf(new Date(2026, 2, 1, 0, 30), DEFAULT_BOUNDARIES)).toBe('night');
    expect(segmentOf(new Date(2026, 2, 1, 3), DEFAULT_BOUNDARIES)).toBe('night');
    expect(segmentOf(new Date(2026, 2, 1, 5, 59), DEFAULT_BOUNDARIES)).toBe('night');
  });

  it('honours boundaries the user has moved', () => {
    const lateRiser = {
      morningStart: '10:00',
      afternoonStart: '14:00',
      eveningStart: '19:00',
      nightStart: '23:00',
    };
    expect(segmentOf(new Date(2026, 2, 1, 9), lateRiser)).toBe('night');
    expect(segmentOf(new Date(2026, 2, 1, 10), lateRiser)).toBe('morning');
    expect(segmentOf(new Date(2026, 2, 1, 22), lateRiser)).toBe('evening');
  });

  it('does not depend on the boundaries being given in chronological order', () => {
    const scrambled = {
      eveningStart: '18:00',
      morningStart: '06:00',
      nightStart: '21:00',
      afternoonStart: '12:00',
    };
    expect(segmentOf(new Date(2026, 2, 1, 13), scrambled)).toBe('afternoon');
    expect(segmentOf(new Date(2026, 2, 1, 4), scrambled)).toBe('night');
  });

  it('defaults its boundaries when none are supplied', () => {
    expect(segmentOf(new Date(2026, 2, 1, 8))).toBe('morning');
  });
});

describe('buildRhythmProfile', () => {
  it('abstains from every claim below the sample floor', () => {
    const profile = buildRhythmProfile(completionsAt('Stretch', 9, MIN_SAMPLES - 1));
    expect(profile.sampleCount).toBe(MIN_SAMPLES - 1);
    expect(profile.peakRange).toBeNull();
    expect(profile.peakSegment).toBeNull();
  });

  it('counts completions by clock hour and by part of the day', () => {
    const profile = buildRhythmProfile([
      ...completionsAt('Stretch', 9, 4),
      ...completionsAt('Dishes', 20, 2),
    ]);
    expect(profile.sampleCount).toBe(6);
    expect(profile.byHour[9]).toBe(4);
    expect(profile.byHour[20]).toBe(2);
    expect(profile.bySegment.morning).toBe(4);
    expect(profile.bySegment.evening).toBe(2);
    expect(profile.peakSegment).toBe('morning');
  });

  it('finds the busiest three-hour stretch', () => {
    const profile = buildRhythmProfile([
      ...completionsAt('A', 9, 3),
      ...completionsAt('B', 10, 4),
      ...completionsAt('C', 11, 3),
      ...completionsAt('D', 16, 1),
    ]);
    expect(profile.peakRange).toMatchObject({ startHour: 9, endHour: 12, count: 10 });
  });

  it('ignores subtasks, archived rows and incomplete rows', () => {
    const profile = buildRhythmProfile([
      ...completionsAt('Real', 9, 3),
      ...completionsAt('Sub', 14, 5, { parentId: 'parent-1' }),
      ...completionsAt('Filed away', 15, 5, { archived: true }),
      makeTask({ title: 'Not done', completed: false, completedAt: null }),
    ]);
    expect(profile.sampleCount).toBe(3);
    expect(profile.byHour[14]).toBe(0);
    expect(profile.byHour[15]).toBe(0);
  });

  it('survives an unparseable completedAt', () => {
    const profile = buildRhythmProfile([
      ...completionsAt('Real', 9, 3),
      makeTask({ title: 'Corrupt', completedAt: 'not a date' }),
    ]);
    expect(profile.sampleCount).toBe(3);
  });

  it('honours windowDays, so retention-era history can be excluded', () => {
    const now = new Date(2026, 2, 20, 12);
    const profile = buildRhythmProfile(
      [
        ...completionsAt('Recent', 9, 3, { completedAt: at(2026, 3, 19, 9) }),
        ...completionsAt('Ancient', 21, 4, { completedAt: at(2026, 1, 2, 21) }),
      ],
      { windowDays: 30, now },
    );
    expect(profile.sampleCount).toBe(3);
    expect(profile.bySegment.night).toBe(0);
  });

  it('attributes a small-hours completion to the previous logical day under a late reset', () => {
    // 01:00 on Tuesday the 3rd, with the day flipping at 04:00, is still Monday.
    const task = makeTask({ completedAt: at(2026, 3, 3, 1) });
    const monday = buildRhythmProfile([task], { dayResetTime: '04:00' });
    const midnight = buildRhythmProfile([task], { dayResetTime: '00:00' });
    expect(new Date(2026, 2, 3).getDay()).toBe(2); // the 3rd is a Tuesday
    expect(monday.byWeekday[1]).toBe(1);   // Monday
    expect(midnight.byWeekday[2]).toBe(1); // Tuesday
  });

  it('reads the hour off the wall clock regardless of the day reset', () => {
    const task = makeTask({ completedAt: at(2026, 3, 3, 1) });
    expect(buildRhythmProfile([task], { dayResetTime: '04:00' }).byHour[1]).toBe(1);
  });
});

describe('formatHour / formatHourRange / describeRhythm', () => {
  it('formats hours in both clock preferences', () => {
    expect(formatHour(0)).toBe('12am');
    expect(formatHour(9)).toBe('9am');
    expect(formatHour(12)).toBe('12pm');
    expect(formatHour(13)).toBe('1pm');
    expect(formatHour(9, true)).toBe('09:00');
    expect(formatHour(24)).toBe('12am');
  });

  it('drops the repeated meridiem inside one half of the day', () => {
    expect(formatHourRange({ startHour: 9, endHour: 11, count: 0 })).toBe('9–11am');
  });

  it('keeps both when the range crosses midday', () => {
    expect(formatHourRange({ startHour: 11, endHour: 13, count: 0 })).toBe('11am–1pm');
  });

  it('names both ends when a morning peak runs into the afternoon', () => {
    // The shape a real profile actually produces: a 9,10,11 peak is the span
    // 9am–12pm, and must not render as the nonsense "9–12pm".
    expect(formatHourRange({ startHour: 9, endHour: 12, count: 0 })).toBe('9am–12pm');
  });

  it('formats a range on the 24-hour setting', () => {
    expect(formatHourRange({ startHour: 9, endHour: 12, count: 0 }, true)).toBe('09:00–12:00');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeRhythm(buildRhythmProfile([]))).toBeNull();
  });

  it('describes the peak stretch', () => {
    const profile = buildRhythmProfile(completionsAt('A', 9, 5));
    expect(describeRhythm(profile)).toContain('Most gets done');
  });
});

describe('findSegmentMismatches', () => {
  /** A habit declared as `declared` but completed at `hour`, plus a live row. */
  function habit(title: string, declared: TimeOfDay, hour: number, count: number): Task[] {
    return [
      ...completionsAt(title, hour, count, { timeSegments: [declared] }),
      makeTask({ title, completed: false, completedAt: null, timeSegments: [declared] }),
    ];
  }

  it('reports a task labelled morning but done in the evening', () => {
    const found = findSegmentMismatches(habit('Water the plants', 'morning', 20, 4));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      title: 'Water the plants',
      declared: 'morning',
      observed: 'evening',
      observedCount: 4,
      total: 4,
    });
    expect(found[0].reason).toBe('Done in the evening 4 of the last 4 times.');
  });

  it('points the fix at the live rows, not the completed history', () => {
    const tasks = habit('Water the plants', 'morning', 20, 4);
    const live = tasks[tasks.length - 1];
    expect(findSegmentMismatches(tasks)[0].taskIds).toEqual([live.id]);
  });

  it('says nothing when the label is right', () => {
    expect(findSegmentMismatches(habit('Water the plants', 'evening', 20, 4))).toEqual([]);
  });

  it('abstains below the sample floor', () => {
    expect(findSegmentMismatches(habit('Water the plants', 'morning', 20, MIN_SAMPLES - 1))).toEqual([]);
  });

  it('abstains when the evidence is merely a plurality', () => {
    // 3 evening, 2 morning, 1 afternoon — 50%, under the majority bar.
    const tasks = [
      ...completionsAt('Wobbly', 20, 3, { timeSegments: ['morning'] }),
      ...completionsAt('Wobbly', 9, 2, { timeSegments: ['morning'] }),
      ...completionsAt('Wobbly', 14, 1, { timeSegments: ['morning'] }),
      makeTask({ title: 'Wobbly', completed: false, completedAt: null, timeSegments: ['morning'] }),
    ];
    expect(findSegmentMismatches(tasks)).toEqual([]);
  });

  it('stays quiet when there is no live row left to fix', () => {
    const tasks = completionsAt('Done forever', 20, 5, { timeSegments: ['morning'] });
    expect(findSegmentMismatches(tasks)).toEqual([]);
  });

  it('ignores rows that declare no segment, or more than one', () => {
    const none = [
      ...completionsAt('Unlabelled', 20, 5),
      makeTask({ title: 'Unlabelled', completed: false, completedAt: null }),
    ];
    expect(findSegmentMismatches(none)).toEqual([]);

    const several = [
      ...completionsAt('Ambiguous', 20, 5, { timeSegments: ['morning', 'afternoon'] }),
      makeTask({
        title: 'Ambiguous',
        completed: false,
        completedAt: null,
        timeSegments: ['morning', 'afternoon'],
      }),
    ];
    expect(findSegmentMismatches(several)).toEqual([]);
  });

  it('groups a series on its seriesId rather than its title', () => {
    const tasks = [
      ...completionsAt('Walk the dog', 20, 4, { seriesId: 's1', timeSegments: ['morning'] }),
      makeTask({
        title: 'Walk the dog',
        completed: false,
        completedAt: null,
        seriesId: 's1',
        timeSegments: ['morning'],
      }),
    ];
    const found = findSegmentMismatches(tasks);
    expect(found).toHaveLength(1);
    expect(found[0].key).toContain('series:s1');
  });

  it('judges each declared label on its own completions after a relabel', () => {
    // Called "morning" for four evening completions, then relabelled "night" —
    // the morning era is still a finding, the night one has too few samples.
    const tasks = [
      ...completionsAt('Journal', 20, 4, { timeSegments: ['morning'] }),
      ...completionsAt('Journal', 20, 2, { timeSegments: ['night'] }),
      makeTask({ title: 'Journal', completed: false, completedAt: null, timeSegments: ['morning'] }),
    ];
    const found = findSegmentMismatches(tasks);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ declared: 'morning', observed: 'evening', total: 4 });
  });

  it('skips subtasks and archived rows', () => {
    const tasks = [
      ...completionsAt('Sub', 20, 5, { timeSegments: ['morning'], parentId: 'p1' }),
      ...completionsAt('Filed', 20, 5, { timeSegments: ['morning'], archived: true }),
      makeTask({ title: 'Sub', completed: false, completedAt: null, timeSegments: ['morning'] }),
      makeTask({ title: 'Filed', completed: false, completedAt: null, timeSegments: ['morning'] }),
    ];
    expect(findSegmentMismatches(tasks)).toEqual([]);
  });

  it('skips tasks that belong to a stack', () => {
    const tasks = [
      ...completionsAt('Feed cat', 20, 5, { timeSegments: ['morning'], groupId: 'g1' }),
      makeTask({ title: 'Feed cat', completed: false, completedAt: null, timeSegments: ['morning'], groupId: 'g1' }),
    ];
    expect(findSegmentMismatches(tasks)).toEqual([]);
  });

  it('sorts the most lopsided evidence first', () => {
    const tasks = [
      // 4/5 — strong but not unanimous.
      ...completionsAt('Softer', 20, 4, { timeSegments: ['morning'] }),
      ...completionsAt('Softer', 9, 1, { timeSegments: ['morning'] }),
      makeTask({ title: 'Softer', completed: false, completedAt: null, timeSegments: ['morning'] }),
      // 4/4 — unanimous.
      ...completionsAt('Stronger', 20, 4, { timeSegments: ['morning'] }),
      makeTask({ title: 'Stronger', completed: false, completedAt: null, timeSegments: ['morning'] }),
    ];
    expect(findSegmentMismatches(tasks).map(m => m.title)).toEqual(['Stronger', 'Softer']);
  });

  it('honours windowDays', () => {
    const now = new Date(2026, 2, 20, 12);
    const tasks = [
      ...completionsAt('Old habit', 20, 5, { timeSegments: ['morning'], completedAt: at(2026, 1, 2, 20) }),
      makeTask({ title: 'Old habit', completed: false, completedAt: null, timeSegments: ['morning'] }),
    ];
    expect(findSegmentMismatches(tasks, { windowDays: 30, now })).toEqual([]);
    expect(findSegmentMismatches(tasks)).toHaveLength(1);
  });
});

describe('suggestSegment', () => {
  it('abstains with no history', () => {
    expect(suggestSegment('Gym', {}, [])).toBeNull();
  });

  it('abstains below the sample floor', () => {
    const tasks = completionsAt('Gym', 18, MIN_SAMPLES - 1);
    expect(suggestSegment('Gym', {}, tasks)).toBeNull();
  });

  it('suggests from past completions of the same title', () => {
    const tasks = completionsAt('Gym', 18, 4);
    expect(suggestSegment('Gym', {}, tasks)).toMatchObject({ segment: 'evening' });
  });

  it('matches titles case- and whitespace-insensitively', () => {
    const tasks = completionsAt('Gym  Session', 18, 4);
    expect(suggestSegment('gym session', {}, tasks)?.segment).toBe('evening');
  });

  it('prefers the series tier over the title tier', () => {
    const tasks = [
      ...completionsAt('Walk', 9, 5, { seriesId: 's1' }),
      ...completionsAt('Walk', 21, 8),
    ];
    const found = suggestSegment('Walk', { seriesId: 's1' }, tasks);
    expect(found?.segment).toBe('morning');
    expect(found?.reason).toContain('in this set');
  });

  it('falls back to a shared title word', () => {
    const tasks = [
      ...completionsAt('Gym legs', 18, 2),
      ...completionsAt('Gym arms', 18, 2),
    ];
    const found = suggestSegment('Gym core', {}, tasks);
    expect(found?.segment).toBe('evening');
    expect(found?.reason).toContain('gym');
  });

  it('falls back to category and tags', () => {
    const tasks = completionsAt('Something else entirely', 21, 4, { category: 'Home' });
    const found = suggestSegment('Brand new task', { category: 'Home' }, tasks);
    expect(found?.segment).toBe('night');
    expect(found?.reason).toContain('similar category or tag');
  });

  it('has no global tier — an unrelated task gets no suggestion', () => {
    const tasks = completionsAt('Totally unrelated', 9, 20);
    expect(suggestSegment('Brand new task', {}, tasks)).toBeNull();
  });

  it('abstains when the history is spread across the day', () => {
    const tasks = [
      ...completionsAt('Scattered', 9, 2),
      ...completionsAt('Scattered', 14, 2),
      ...completionsAt('Scattered', 21, 2),
    ];
    expect(suggestSegment('Scattered', {}, tasks)).toBeNull();
  });

  it('excludes the task being edited from its own history', () => {
    const tasks = completionsAt('Gym', 18, 3);
    expect(suggestSegment('Gym', { excludeTaskId: tasks[0].id }, tasks)).toBeNull();
  });

  it('ignores archived and incomplete rows', () => {
    const tasks = [
      ...completionsAt('Gym', 18, 5, { archived: true }),
      makeTask({ title: 'Gym', completed: false, completedAt: null }),
    ];
    expect(suggestSegment('Gym', {}, tasks)).toBeNull();
  });
});
