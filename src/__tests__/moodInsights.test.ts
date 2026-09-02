import {
  MIN_PAIRED_DAYS,
  buildMoodDays,
  categoryMoodContrasts,
  completionDayKey,
  correlation,
  correlationStrength,
  describeHealthInsight,
  healthAverage,
  healthInsight,
  loggingStreak,
  lowMoodRun,
  moodByTimeOfDay,
  moodCompletionInsight,
  moodSummary,
  pairedDays,
  symptomMoodContrasts,
  type HealthInsight,
  type MoodDay,
} from '../utils/moodInsights';
import type { MoodLog, Task } from '../types';

function log(dayKey: string, mood: number | null, over: Partial<MoodLog> = {}): MoodLog {
  return {
    id: over.id ?? `${dayKey}-${mood}`,
    loggedAt: over.loggedAt ?? `${dayKey}T09:00:00.000Z`,
    dayKey,
    mood: mood as MoodLog['mood'],
    symptoms: over.symptoms ?? [],
    note: over.note ?? null,
  };
}

function task(completedAt: string | null, over: Partial<Task> = {}): Task {
  return {
    id: over.id ?? `t-${completedAt}-${Math.random()}`,
    title: 'x',
    completed: completedAt !== null,
    completedAt,
    parentId: over.parentId ?? null,
    missedAt: over.missedAt ?? null,
    category: over.category ?? null,
  } as unknown as Task;
}

/** A day series with the given moods, one per consecutive August day. */
function daysWithMoods(moods: (number | null)[], completed: number[] = []): MoodDay[] {
  return moods.map((mood, i) => ({
    dayKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
    mood,
    symptomKeys: [],
    completed: completed[i] ?? 0,
    categories: [],
    steps: null,
    sleepHours: null,
  }));
}

describe('the day a completion counts toward', () => {
  it('uses the logical day, so a late-night finish lands on the day it belonged to', () => {
    // The grace-window rule, applied to a read. Without it every night's
    // completions file against the wrong day's mood for anyone whose day does
    // not start at midnight.
    expect(completionDayKey('2026-08-17T01:30:00', '02:00')).toBe('2026-08-16');
    expect(completionDayKey('2026-08-17T01:30:00', '00:00')).toBe('2026-08-17');
  });
});

describe('building the day series', () => {
  it('joins moods to that day\'s completions', () => {
    const days = buildMoodDays(
      [log('2026-08-17', 4)],
      [task('2026-08-17T10:00:00'), task('2026-08-17T11:00:00')],
      '00:00',
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ dayKey: '2026-08-17', mood: 4, completed: 2 });
  });

  it('counts neither subtasks nor missed rows as completions', () => {
    const days = buildMoodDays(
      [log('2026-08-17', 4)],
      [
        task('2026-08-17T10:00:00'),
        task('2026-08-17T10:00:00', { parentId: 'p' }),
        task('2026-08-17T10:00:00', { missedAt: '2026-08-17T10:00:00' }),
      ],
      '00:00',
    );
    expect(days[0].completed).toBe(1);
  });

  it('counts each category once a day, however many of it were finished', () => {
    const days = buildMoodDays(
      [log('2026-08-17', 4)],
      [
        task('2026-08-17T10:00:00', { category: 'Work' }),
        task('2026-08-17T11:00:00', { category: 'Work' }),
        task('2026-08-17T12:00:00', { category: 'Home' }),
      ],
      '00:00',
    );
    expect(days[0].categories).toEqual(['Home', 'Work']);
  });

  it('keeps a day that was only logged, and a day that was only worked', () => {
    const days = buildMoodDays([log('2026-08-17', 4)], [task('2026-08-18T10:00:00')], '00:00');
    expect(days.map(d => d.dayKey)).toEqual(['2026-08-17', '2026-08-18']);
    expect(days[1].mood).toBeNull();
  });

  it('carries symptoms onto a day with no mood on it', () => {
    const days = buildMoodDays(
      [log('2026-08-17', null, { symptoms: [{ name: 'Headache', severity: 2 }] })],
      [],
      '00:00',
    );
    expect(days[0].symptomKeys).toEqual(['headache']);
  });

  it('drops an unlogged day from every comparison rather than scoring it zero', () => {
    // Rule 3: not opening the app is not a bad day, and treating it as one is
    // the easiest way to invent a trend out of a fortnight of silence.
    const days = buildMoodDays([log('2026-08-17', 4)], [task('2026-08-18T10:00:00')], '00:00');
    expect(pairedDays(days).map(d => d.dayKey)).toEqual(['2026-08-17']);
  });
});

describe('correlation', () => {
  it('is 1 for a perfectly rising pair and -1 for a falling one', () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(correlation([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1);
  });

  it('is null when either side never varies, rather than claiming no relationship', () => {
    expect(correlation([3, 3, 3], [1, 2, 3])).toBeNull();
    expect(correlation([1, 2, 3], [2, 2, 2])).toBeNull();
  });

  it('is null with fewer than two points', () => {
    expect(correlation([1], [1])).toBeNull();
  });

  it('reports anything under 0.2 as no pattern at all', () => {
    expect(correlationStrength(0.19)).toBe('none');
    expect(correlationStrength(-0.19)).toBe('none');
    expect(correlationStrength(0.3)).toBe('slight');
    expect(correlationStrength(-0.75)).toBe('strong');
  });
});

describe('mood against what you finish', () => {
  it('says nothing until there are enough paired days', () => {
    const short = daysWithMoods([1, 2, 3, 4], [1, 2, 3, 4]);
    const insight = moodCompletionInsight(short);
    expect(insight.dayCount).toBe(4);
    expect(insight.r).toBeNull();
    expect(insight.strength).toBeNull();
  });

  it('reports a direction and a strength once there are', () => {
    const moods = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5];
    const done = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4];
    expect(moods).toHaveLength(MIN_PAIRED_DAYS);
    const insight = moodCompletionInsight(daysWithMoods(moods, done));
    expect(insight.direction).toBe('more');
    expect(insight.strength).toBe('strong');
  });

  it('averages the good days against the low ones', () => {
    const moods = [1, 1, 5, 5, 3, 3, 3, 3, 3, 3];
    const done = [0, 2, 8, 10, 4, 4, 4, 4, 4, 4];
    const insight = moodCompletionInsight(daysWithMoods(moods, done));
    expect(insight.completedOnLowDays).toBe(1);
    expect(insight.completedOnGoodDays).toBe(9);
  });
});

describe('contrasts', () => {
  const build = (rows: { mood: number; categories?: string[]; symptomKeys?: string[] }[]): MoodDay[] =>
    rows.map((r, i) => ({
      dayKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
      mood: r.mood,
      symptomKeys: r.symptomKeys ?? [],
      completed: 0,
      categories: r.categories ?? [],
      steps: null,
      sleepHours: null,
    }));

  it('compares mood on days with a category against days without it', () => {
    const days = build([
      ...Array(5).fill(0).map(() => ({ mood: 5, categories: ['Work'] })),
      ...Array(5).fill(0).map(() => ({ mood: 2, categories: [] as string[] })),
    ]);
    const [row] = categoryMoodContrasts(days);
    expect(row).toMatchObject({ label: 'Work', withDays: 5, withoutDays: 5, delta: 3 });
  });

  it('skips a label with too few days on either side', () => {
    // A symptom logged twice tells you nothing about its days, and a category
    // completed on every single day has no "without" to compare against.
    const days = build([
      ...Array(2).fill(0).map(() => ({ mood: 5, symptomKeys: ['rare'] })),
      ...Array(8).fill(0).map(() => ({ mood: 2, symptomKeys: [] as string[] })),
    ]);
    expect(symptomMoodContrasts(days)).toEqual([]);
  });

  it('sorts by the size of the gap in either direction, not by good news', () => {
    const days = build([
      ...Array(4).fill(0).map(() => ({ mood: 1, categories: ['Chores'] })),
      ...Array(3).fill(0).map(() => ({ mood: 4, categories: ['Hobby'] })),
      ...Array(3).fill(0).map(() => ({ mood: 3, categories: [] as string[] })),
    ]);
    expect(categoryMoodContrasts(days)[0].label).toBe('Chores');
  });

  it('says nothing at all below the paired-day floor', () => {
    const days = build([{ mood: 5, categories: ['Work'] }, { mood: 1, categories: [] }]);
    expect(categoryMoodContrasts(days)).toEqual([]);
  });
});

describe('mood by time of day', () => {
  it('buckets entries into the app\'s own segments, in day order', () => {
    const logs = [
      log('2026-08-17', 2, { id: 'm', loggedAt: '2026-08-17T08:00:00' }),
      log('2026-08-17', 4, { id: 'e', loggedAt: '2026-08-17T20:00:00' }),
    ];
    const rows = moodByTimeOfDay(logs, iso =>
      new Date(iso).getHours() < 12 ? 'morning' : 'evening');
    expect(rows).toEqual([
      { segment: 'morning', entryCount: 1, mood: 2 },
      { segment: 'evening', entryCount: 1, mood: 4 },
    ]);
  });

  it('ignores entries with no mood on them', () => {
    const logs = [log('2026-08-17', null, { loggedAt: '2026-08-17T08:00:00' })];
    expect(moodByTimeOfDay(logs, () => 'morning')).toEqual([]);
  });
});

describe('the low run behind the nudge', () => {
  it('counts back over consecutive low logged days ending today', () => {
    const days = daysWithMoods([3, 2, 1, 2]);
    expect(lowMoodRun(days, '2026-08-04')).toBe(3);
  });

  it('is zero unless today itself was logged and low', () => {
    // A run that ended on Tuesday is a statement about the past, and offering
    // to cheer somebody up off it is the app not paying attention.
    expect(lowMoodRun(daysWithMoods([1, 1, 1, 4]), '2026-08-04')).toBe(0);
    expect(lowMoodRun(daysWithMoods([1, 1, 1]), '2026-08-09')).toBe(0);
  });

  it('lets an unlogged day neither build the run nor break it', () => {
    const days = daysWithMoods([2, null, 2]);
    expect(lowMoodRun(days, '2026-08-03')).toBe(2);
  });

  it('ignores days after today', () => {
    const days = daysWithMoods([2, 2, 5]);
    expect(lowMoodRun(days, '2026-08-02')).toBe(2);
  });
});

describe('the summary', () => {
  it('counts logged days, low days and the average', () => {
    const days = daysWithMoods([1, 2, 5, 4]);
    const summary = moodSummary(days, '2026-08-04');
    expect(summary).toMatchObject({ loggedDays: 4, moodDays: 4, lowDays: 2, averageMood: 3 });
  });

  it('counts a symptom-only day as logged but not toward the average', () => {
    const days: MoodDay[] = [
      { dayKey: '2026-08-01', mood: null, symptomKeys: ['headache'], completed: 0, categories: [], steps: null, sleepHours: null },
      { dayKey: '2026-08-02', mood: 4, symptomKeys: [], completed: 0, categories: [], steps: null, sleepHours: null },
    ];
    const summary = moodSummary(days, '2026-08-02');
    expect(summary.loggedDays).toBe(2);
    expect(summary.moodDays).toBe(1);
    expect(summary.averageMood).toBe(4);
  });
});

describe('the logging streak', () => {
  const dayRows = (keys: string[]): MoodDay[] =>
    keys.map(dayKey => ({
      dayKey, mood: 3, symptomKeys: [], completed: 0, categories: [],
      steps: null, sleepHours: null,
    }));

  it('counts consecutive logged days ending today', () => {
    expect(loggingStreak(dayRows(['2026-08-15', '2026-08-16', '2026-08-17']), '2026-08-17')).toBe(3);
  });

  it('still stands this morning, before today has been logged', () => {
    expect(loggingStreak(dayRows(['2026-08-15', '2026-08-16']), '2026-08-17')).toBe(2);
  });

  it('is zero once a whole day has been missed', () => {
    expect(loggingStreak(dayRows(['2026-08-14', '2026-08-15']), '2026-08-17')).toBe(0);
  });

  it('is zero with nothing logged at all', () => {
    expect(loggingStreak([], '2026-08-17')).toBe(0);
  });
});

describe('the health axis', () => {
  /** N consecutive August days carrying a reading and a paired value. */
  const rows = (
    steps: (number | null)[],
    opts: { mood?: (number | null)[]; completed?: number[]; sleepHours?: (number | null)[] } = {},
  ): MoodDay[] =>
    steps.map((s, i) => ({
      dayKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
      // `?? 3` would swallow a deliberate null, which is the one input these
      // cases are about — so an omitted array defaults, and a supplied one is
      // taken at its word.
      mood: opts.mood ? (opts.mood[i] ?? null) : 3,
      symptomKeys: [],
      completed: opts.completed?.[i] ?? 0,
      categories: [],
      steps: s,
      sleepHours: opts.sleepHours ? (opts.sleepHours[i] ?? null) : null,
    }));

  const rising = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];

  it('reports a direction and a strength when the two rise together', () => {
    const days = rows(rising, { completed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    const insight = healthInsight(days, 'steps', 'completed');
    expect(insight.dayCount).toBe(10);
    expect(insight.direction).toBe('more');
    expect(insight.strength).toBe('strong');
  });

  it('reports the other direction just as readily', () => {
    // A one-sided read would only ever be able to deliver good news.
    const days = rows(rising, { completed: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] });
    expect(healthInsight(days, 'steps', 'completed').direction).toBe('fewer');
  });

  it('says nothing below the paired-day floor', () => {
    // With four days every pair of variables correlates at something
    // eye-catching, which is what MIN_PAIRED_DAYS exists to refuse.
    const days = rows(rising.slice(0, 9), { completed: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    const insight = healthInsight(days, 'steps', 'completed');
    expect(insight.dayCount).toBe(9);
    expect(insight.r).toBeNull();
    expect(insight.strength).toBeNull();
    expect(insight.direction).toBeNull();
  });

  it('treats a day with no reading as absent, never as zero steps', () => {
    // The rule that matters most: null covers a *refused* read, so counting it
    // as "walked nowhere" would turn declining to share into a finding.
    const days = rows([...rising.slice(0, 9), null], { completed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    const insight = healthInsight(days, 'steps', 'completed');
    expect(insight.dayCount).toBe(9);
    expect(insight.direction).toBeNull();
  });

  it('pairs against mood, skipping days logged without one', () => {
    const moods = [2, 2, 3, 3, 4, 4, 5, 5, 1, null];
    const insight = healthInsight(rows(rising, { mood: moods }), 'steps', 'mood');
    expect(insight.dayCount).toBe(9);
  });

  it('reads sleep on the same terms as steps', () => {
    const sleep = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5];
    const days = rows(new Array(10).fill(null), {
      sleepHours: sleep,
      completed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    const insight = healthInsight(days, 'sleepHours', 'completed');
    expect(insight.dayCount).toBe(10);
    expect(insight.direction).toBe('more');
  });

  it('reports no relationship rather than none-shaped when the reading never moves', () => {
    // correlation() answers null on zero variance rather than 0, because "no
    // relationship" is a claim and there is nothing there to have one.
    const days = rows(new Array(10).fill(5000), { completed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    const insight = healthInsight(days, 'steps', 'completed');
    expect(insight.dayCount).toBe(10);
    expect(insight.r).toBeNull();
    expect(insight.strength).toBeNull();
  });

  it('averages over the days that have a reading, not over the window', () => {
    expect(healthAverage(rows([1000, 3000, null]), 'steps')).toBe(2000);
  });

  it('has no average to give when nothing was recorded', () => {
    expect(healthAverage(rows([null, null]), 'steps')).toBeNull();
  });
});

describe('buildMoodDays with readings', () => {
  it('decorates a day the log or the tasks already made', () => {
    const logs = [log('2026-08-01', 4)];
    const days = buildMoodDays(logs, [], '00:00', [
      { dayKey: '2026-08-01', steps: 4120, sleepHours: 7.5 },
    ]);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ steps: 4120, sleepHours: 7.5 });
  });

  it('never creates a day out of a reading alone', () => {
    // HealthKit will answer for ninety days running. Folding those in would
    // conjure ninety days carrying completed: 0 and mood: null — a fortnight of
    // invented zero-completion days for somebody who just didn't open the app.
    const logs = [log('2026-08-01', 4)];
    const days = buildMoodDays(logs, [], '00:00', [
      { dayKey: '2026-08-01', steps: 4120, sleepHours: 7.5 },
      { dayKey: '2026-07-30', steps: 9000, sleepHours: 8 },
      { dayKey: '2026-07-31', steps: 9000, sleepHours: 8 },
    ]);
    expect(days.map(d => d.dayKey)).toEqual(['2026-08-01']);
  });

  it('leaves a day with no reading null on both, rather than zero', () => {
    const days = buildMoodDays([log('2026-08-01', 4)], [], '00:00');
    expect(days[0].steps).toBeNull();
    expect(days[0].sleepHours).toBeNull();
  });
});

describe('describing a health insight', () => {
  const insight = (over: Partial<HealthInsight> = {}): HealthInsight => ({
    metric: 'steps',
    against: 'completed',
    dayCount: 20,
    r: 0.6,
    strength: 'moderate',
    direction: 'more',
    ...over,
  });

  it('says nothing at all below the floor', () => {
    expect(describeHealthInsight(insight({ strength: null, direction: null }))).toBeNull();
  });

  it('describes both directions against what you finish', () => {
    expect(describeHealthInsight(insight()))
      .toBe('You finish more tasks on the days you walk more.');
    expect(describeHealthInsight(insight({ direction: 'fewer' })))
      .toBe('You finish fewer tasks on the days you walk more.');
  });

  it('describes both directions against mood', () => {
    expect(describeHealthInsight(insight({ against: 'mood' })))
      .toBe('Your mood runs higher on the days you walk more.');
    expect(describeHealthInsight(insight({ against: 'mood', direction: 'fewer' })))
      .toBe('Your mood runs lower on the days you walk more.');
  });

  it('speaks about sleeping rather than walking for the sleep metric', () => {
    expect(describeHealthInsight(insight({ metric: 'sleepHours' })))
      .toBe('You finish more tasks on the days you sleep more.');
  });

  it('says so when there is no clear pattern, rather than staying quiet', () => {
    expect(describeHealthInsight(insight({ strength: 'none' })))
      .toBe('No clear pattern between your steps and what you finish.');
    expect(describeHealthInsight(insight({ strength: 'none', against: 'mood' })))
      .toBe('No clear pattern between your steps and your mood.');
  });

  it('never gives advice and never quotes a coefficient', () => {
    // The two rules this copy exists to keep. Asserted directly, the way
    // moodTasks.test.ts asserts that the nudge never names a feeling.
    const every: HealthInsight[] = [];
    for (const metric of ['steps', 'sleepHours'] as const) {
      for (const against of ['mood', 'completed'] as const) {
        for (const direction of ['more', 'fewer'] as const) {
          for (const strength of ['none', 'slight', 'moderate', 'strong'] as const) {
            every.push(insight({ metric, against, direction, strength }));
          }
        }
      }
    }
    for (const one of every) {
      const text = describeHealthInsight(one) as string;
      expect(text).not.toMatch(/\btry\b|\bshould\b|\bwhy not\b|helps|because|causes?\b/i);
      expect(text).not.toContain('0.');
    }
  });
});
