import {
  MIN_PAIRED_DAYS,
  buildMoodDays,
  taskContrastTitles,
  taskIdentityKey,
  taskMoodContrasts,
  taskPairedDays,
  categoryMoodContrasts,
  completionDayKey,
  contextTagMoodContrasts,
  correlation,
  correlationStrength,
  describeHealthInsight,
  describeNutrientInsight,
  foodMoodContrasts,
  foodPairedDays,
  metricAverage,
  healthInsight,
  nutrientFindings,
  nutrientInsight,
  NUTRIENT_INSIGHT_KEYS,
  loggingStreak,
  lowMoodRun,
  moodByTimeOfDay,
  moodCompletionInsight,
  moodSummary,
  pairedDays,
  symptomMoodContrasts,
  type HealthInsight,
  type MoodDay,
  type NutrientInsight,
} from '../utils/moodInsights';
import type { MoodLog, Task } from '../types';

function log(dayKey: string, mood: number | null, over: Partial<MoodLog> = {}): MoodLog {
  return {
    id: over.id ?? `${dayKey}-${mood}`,
    loggedAt: over.loggedAt ?? `${dayKey}T09:00:00.000Z`,
    dayKey,
    mood: mood as MoodLog['mood'],
    symptoms: over.symptoms ?? [],
    contextTags: over.contextTags ?? [],
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
    // Spread last so a case that cares about a field this helper does not name
    // — a title, a seriesId, a previousOccurrenceId — can set it.
    ...over,
  } as unknown as Task;
}

/** A day series with the given moods, one per consecutive August day. */
function daysWithMoods(moods: (number | null)[], completed: number[] = []): MoodDay[] {
  return moods.map((mood, i) => ({
    dayKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
    mood,
    symptomKeys: [],
    contextTagKeys: [],
    completed: completed[i] ?? 0,
    categories: [],
    taskKeys: [],
    steps: null,
    sleepHours: null,
    nutrients: null,
    foodKeys: [],
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

  it('carries context tags onto a day with no mood on it', () => {
    const days = buildMoodDays(
      [log('2026-08-17', null, { contextTags: ['Vacation'] })],
      [],
      '00:00',
    );
    expect(days[0].contextTagKeys).toEqual(['vacation']);
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
  const build = (rows: { mood: number; categories?: string[]; symptomKeys?: string[]; contextTagKeys?: string[]; taskKeys?: string[] }[]): MoodDay[] =>
    rows.map((r, i) => ({
      dayKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
      mood: r.mood,
      symptomKeys: r.symptomKeys ?? [],
      contextTagKeys: r.contextTagKeys ?? [],
      completed: 0,
      categories: r.categories ?? [],
      taskKeys: r.taskKeys ?? [],
      steps: null,
      sleepHours: null,
      nutrients: null,
      foodKeys: [],
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

  it('compares mood on days a context tag applied against days it didn\'t', () => {
    const days = build([
      ...Array(5).fill(0).map(() => ({ mood: 5, contextTagKeys: ['vacation'] })),
      ...Array(5).fill(0).map(() => ({ mood: 2, contextTagKeys: [] as string[] })),
    ]);
    const [row] = contextTagMoodContrasts(days);
    expect(row).toMatchObject({ label: 'vacation', withDays: 5, withoutDays: 5, delta: 3 });
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
      { dayKey: '2026-08-01', mood: null, symptomKeys: ['headache'], contextTagKeys: [], completed: 0, categories: [], taskKeys: [], steps: null, sleepHours: null, nutrients: null, foodKeys: [] },
      { dayKey: '2026-08-02', mood: 4, symptomKeys: [], contextTagKeys: [], completed: 0, categories: [], taskKeys: [], steps: null, sleepHours: null, nutrients: null, foodKeys: [] },
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
      dayKey, mood: 3, symptomKeys: [], contextTagKeys: [], completed: 0, categories: [], taskKeys: [],
      steps: null, sleepHours: null, nutrients: null, foodKeys: [],
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
      contextTagKeys: [],
      completed: opts.completed?.[i] ?? 0,
      categories: [],
      taskKeys: [],
      steps: s,
      sleepHours: opts.sleepHours ? (opts.sleepHours[i] ?? null) : null,
      nutrients: null,
      foodKeys: [],
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
    expect(metricAverage(rows([1000, 3000, null]), 'steps')).toBe(2000);
  });

  it('has no average to give when nothing was recorded', () => {
    expect(metricAverage(rows([null, null]), 'steps')).toBeNull();
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

describe('a purged task record', () => {
  // completedRetentionDays deletes completed rows while the mood log keeps
  // every entry forever, so without a horizon the days behind the window read
  // as days on which nothing was finished. That is rule 3's exact failure
  // mode, arriving through the app's own housekeeping.
  const logs = [log('2026-05-01', 2), log('2026-08-17', 4)];
  const tasks = [task('2026-08-17T10:00:00')];

  it('counts a day as zero completions when nothing tells it otherwise', () => {
    const days = buildMoodDays(logs, tasks, '00:00');
    expect(days.find(d => d.dayKey === '2026-05-01')?.completed).toBe(0);
  });

  it('reports null, not zero, for a day before the horizon', () => {
    const days = buildMoodDays(logs, tasks, '00:00', [], '2026-08-01');
    expect(days.find(d => d.dayKey === '2026-05-01')?.completed).toBeNull();
    expect(days.find(d => d.dayKey === '2026-08-17')?.completed).toBe(1);
  });

  it('drops the categories and the task keys of a purged day too', () => {
    const days = buildMoodDays(
      [log('2026-05-01', 2)],
      [task('2026-05-01T10:00:00', { category: 'Work' })],
      '00:00', [], '2026-08-01',
    );
    expect(days[0]).toMatchObject({ completed: null, categories: [], taskKeys: [] });
  });

  // A row that outlived the window — an archived one, or a decision task
  // holding an answer — must not make a purged day look fully recorded.
  it('clears a day even when one row survived the purge', () => {
    const days = buildMoodDays(
      [log('2026-05-01', 2)],
      [task('2026-05-01T10:00:00')],
      '00:00', [], '2026-08-01',
    );
    expect(days[0].completed).toBeNull();
  });

  it('keeps the mood and the symptoms of a purged day', () => {
    const days = buildMoodDays(
      [log('2026-05-01', 2, { symptoms: [{ name: 'Headache', severity: 2 }] })],
      [], '00:00', [], '2026-08-01',
    );
    expect(days[0]).toMatchObject({ mood: 2, symptomKeys: ['headache'] });
  });

  it('leaves every day alone when retention is off', () => {
    const days = buildMoodDays(logs, tasks, '00:00', [], null);
    expect(days.every(d => d.completed !== null)).toBe(true);
  });

  it('keeps purged days out of the reads that are about what got done', () => {
    const days = buildMoodDays(logs, tasks, '00:00', [], '2026-08-01');
    expect(taskPairedDays(days).map(d => d.dayKey)).toEqual(['2026-08-17']);
    // Symptoms and context only touch the mood side, so they keep everything.
    expect(days.filter(d => d.mood !== null)).toHaveLength(2);
  });
});

describe('a task\'s identity across its occurrences', () => {
  const byId = (tasks: Task[]) => new Map(tasks.map(t => [t.id, t]));

  it('walks the completion chain back to its root', () => {
    const first = task('2026-08-15T09:00:00', { id: 'a' });
    const second = task('2026-08-16T09:00:00', { id: 'b', previousOccurrenceId: 'a' } as Partial<Task>);
    const third = task('2026-08-17T09:00:00', { id: 'c', previousOccurrenceId: 'b' } as Partial<Task>);
    const map = byId([first, second, third]);
    expect(taskIdentityKey(third, map)).toBe('a');
    expect(taskIdentityKey(second, map)).toBe('a');
  });

  it('uses the series when there is one', () => {
    const row = task('2026-08-17T09:00:00', { id: 'x', seriesId: 's1' } as Partial<Task>);
    expect(taskIdentityKey(row, byId([row]))).toBe('series:s1');
  });

  // Resolve-or-shrug, like every other chain walk in the app: a pointer at a
  // row a purge deleted stops the walk rather than throwing.
  it('stops where a pointer dangles', () => {
    const row = task('2026-08-17T09:00:00', { id: 'b', previousOccurrenceId: 'gone' } as Partial<Task>);
    expect(taskIdentityKey(row, byId([row]))).toBe('b');
  });
});

describe('mood against one repeating task', () => {
  /** Ten logged days; the task is completed on the ones named. */
  const build = (moods: number[], completedOn: number[]) => {
    const logs = moods.map((mood, i) => log(`2026-08-${String(i + 1).padStart(2, '0')}`, mood));
    const tasks: Task[] = [];
    let previous: string | null = null;
    for (const dayIndex of completedOn) {
      const id = `occ-${dayIndex}`;
      tasks.push(task(`2026-08-${String(dayIndex + 1).padStart(2, '0')}T10:00:00`, {
        id, title: 'Take the tablets', previousOccurrenceId: previous,
      } as Partial<Task>));
      previous = id;
    }
    return buildMoodDays(logs, tasks, '00:00');
  };

  it('contrasts the days it was done against the days it was not', () => {
    const days = build([5, 5, 5, 5, 5, 2, 2, 2, 2, 2], [0, 1, 2, 3, 4]);
    const rows = taskMoodContrasts(days);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ withDays: 5, withoutDays: 5, moodWith: 5, moodWithout: 2 });
  });

  it('collapses the occurrences of one task into one row', () => {
    const days = build([5, 5, 5, 5, 5, 2, 2, 2, 2, 2], [0, 1, 2, 3, 4]);
    // Five completed rows, one label: keyed on the row id instead, this would
    // be five tasks with one day apiece and no contrast at all.
    expect(taskMoodContrasts(days).map(r => r.label)).toEqual(['occ-0']);
  });

  it('says nothing about a one-off, which cannot clear the both-sides gate', () => {
    const days = build([5, 5, 5, 5, 5, 2, 2, 2, 2, 2], [0]);
    expect(taskMoodContrasts(days)).toEqual([]);
  });

  it('says nothing below the paired-day floor', () => {
    const days = build([5, 5, 5, 4, 2, 2], [0, 1, 2]);
    expect(taskMoodContrasts(days)).toEqual([]);
  });

  it('says nothing about a task done every single day, which has no without', () => {
    const days = build([5, 5, 5, 5, 5, 2, 2, 2, 2, 2], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(taskMoodContrasts(days)).toEqual([]);
  });

  it('titles a row from the most recent occurrence, so a rename is honoured', () => {
    const first = task('2026-08-15T09:00:00', { id: 'a', title: 'Take tablets' } as Partial<Task>);
    const second = task('2026-08-17T09:00:00', {
      id: 'b', title: 'Take the tablets', previousOccurrenceId: 'a',
    } as Partial<Task>);
    expect(taskContrastTitles([first, second]).get('a')).toBe('Take the tablets');
  });
});

describe('the food axis', () => {
  /** N consecutive August days, each carrying a mood and a day of eating. */
  const rows = (
    calories: (number | null)[],
    opts: { mood?: (number | null)[]; completed?: number[]; foods?: string[][] } = {},
  ): MoodDay[] =>
    calories.map((c, i) => ({
      dayKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
      mood: opts.mood ? (opts.mood[i] ?? null) : 3,
      symptomKeys: [],
      contextTagKeys: [],
      completed: opts.completed?.[i] ?? 0,
      categories: [],
      taskKeys: [],
      steps: null,
      sleepHours: null,
      // Null is a day the food log could not speak for, which is the whole
      // point of the axis — see FoodDayInput.
      nutrients: c === null ? null : { calorieKcal: c },
      foodKeys: c === null ? [] : (opts.foods?.[i] ?? []),
    }));

  const rising = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000];

  it('reports a direction and a strength once there are enough paired days', () => {
    const insight = nutrientInsight(
      rows(rising, { completed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
      'calorieKcal',
      'completed',
    );
    expect(insight.dayCount).toBe(MIN_PAIRED_DAYS);
    expect(insight.direction).toBe('more');
    expect(insight.strength).toBe('strong');
  });

  it('says nothing below the paired-day floor', () => {
    const insight = nutrientInsight(rows(rising.slice(0, 4)), 'calorieKcal', 'mood');
    expect(insight.dayCount).toBe(4);
    expect(insight.strength).toBeNull();
  });

  it('drops a day the food log could not speak for rather than scoring it zero', () => {
    // The failure this axis exists to avoid: a half-logged day arrives looking
    // like a small number rather than like a hole, and counted it would invent
    // "you eat less when you feel worse" out of days somebody stopped logging.
    const days = rows([null, ...rising], { mood: [1, ...rising.map(() => 4)] });
    expect(nutrientInsight(days, 'calorieKcal', 'mood').dayCount).toBe(MIN_PAIRED_DAYS);
  });

  it('has no opinion about a nutrient no day stated', () => {
    expect(nutrientInsight(rows(rising), 'caffeineMg', 'mood').dayCount).toBe(0);
  });

  it('averages a nutrient over the days that carried it', () => {
    expect(metricAverage(rows([1000, 3000, null]), 'calorieKcal')).toBe(2000);
  });

  it('keeps the nutrient vocabulary short, because the width is the risk', () => {
    // Ten nutrients against two outcomes is twenty comparisons over the same
    // thirty-odd days, and at that width a couple land at something
    // eye-catching by arithmetic alone. Each key must also have a phrase, or
    // the app says "the days you have more calorie kcal".
    expect(NUTRIENT_INSIGHT_KEYS.length).toBeLessThanOrEqual(3);
    for (const key of NUTRIENT_INSIGHT_KEYS) {
      const insight: NutrientInsight = {
        metric: key, against: 'mood', dayCount: 20, r: 0.5, strength: 'moderate', direction: 'more',
      };
      const text = describeNutrientInsight(insight);
      expect(text).toBeTruthy();
      expect(text).not.toContain(key);
    }
  });
});

describe('what a food finding is allowed to say', () => {
  const insight = (over: Partial<NutrientInsight> = {}): NutrientInsight => ({
    metric: 'calorieKcal',
    against: 'mood',
    dayCount: 20,
    r: 0.5,
    strength: 'moderate',
    direction: 'more',
    ...over,
  });

  it('describes and never advises', () => {
    const text = describeNutrientInsight(insight()) ?? '';
    expect(text).toBe('Your mood runs higher on the days you eat more.');
    // The gap between a description and "Eat more." is a claim about cause,
    // and on this axis it is also telling somebody what to eat. Advice is a
    // sentence in the imperative, so that is what this looks for — "the days
    // you eat more" is the same verb doing the opposite job.
    for (const sentence of text.split(/(?<=\.)\s*/).filter(Boolean)) {
      expect(sentence).not.toMatch(/^(try|eat|cut|avoid|consider|drink|keep|stick)\b/i);
    }
    expect(text).not.toMatch(/\bshould\b|\bought to\b/i);
  });

  it('never prints a coefficient', () => {
    for (const against of ['mood', 'completed'] as const) {
      for (const metric of NUTRIENT_INSIGHT_KEYS) {
        const text = describeNutrientInsight(insight({ metric, against })) ?? '';
        expect(text).not.toContain('0.5');
        expect(text).not.toMatch(/\br\s*=/);
      }
    }
  });

  it('says out loud that it found nothing', () => {
    expect(describeNutrientInsight(insight({ strength: 'none' })))
      .toBe('No clear pattern between how much you eat and your mood.');
    expect(describeNutrientInsight(insight({ strength: 'none', against: 'completed', metric: 'caffeineMg' })))
      .toBe('No clear pattern between your caffeine and what you finish.');
  });

  it('says nothing at all when there was not enough to go on', () => {
    expect(describeNutrientInsight(insight({ strength: null, direction: null }))).toBeNull();
  });

  it('leads the completions pairing with what you finished', () => {
    expect(describeNutrientInsight(insight({ against: 'completed', direction: 'fewer' })))
      .toBe('You finish fewer tasks on the days you eat more.');
  });
});

describe('mood by what you ate', () => {
  /** Ten paired days: the first `withIt` of them carry the food. */
  const build = (withIt: number, moodWith: number, moodWithout: number): MoodDay[] =>
    Array.from({ length: 10 }, (_, i) => ({
      dayKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
      mood: i < withIt ? moodWith : moodWithout,
      symptomKeys: [],
      contextTagKeys: [],
      completed: 0,
      categories: [],
      taskKeys: [],
      steps: null,
      sleepHours: null,
      nutrients: { calorieKcal: 2000 },
      foodKeys: i < withIt ? ['coffee'] : ['porridge'],
    }));

  it('compares the days you ate it against the days you did not', () => {
    const [row] = foodMoodContrasts(build(5, 4, 2));
    expect(row.label).toBe('coffee');
    expect(row.withDays).toBe(5);
    expect(row.withoutDays).toBe(5);
    expect(row.delta).toBe(2);
  });

  it('keeps a food eaten once off the screen through the existing gate', () => {
    const days = build(1, 5, 3);
    expect(foodMoodContrasts(days).map(r => r.label)).toEqual([]);
  });

  it('counts as "without" only the days the log would have mentioned it', () => {
    // Otherwise this read is really "the days I logged my food against the days
    // I didn't", with a food's name on it.
    const days = build(5, 4, 2).map((d, i) =>
      // The last three days lose their food log entirely.
      i >= 7 ? { ...d, nutrients: null, foodKeys: [] } : d);
    expect(foodPairedDays(days)).toHaveLength(7);
    // Seven paired days is under the floor, so nothing is claimed at all —
    // rather than the three stripped days being counted as coffee-free.
    expect(foodMoodContrasts(days)).toEqual([]);
  });

  it('leaves the symptom contrasts alone, which never touch the food side', () => {
    const days = build(5, 4, 2).map(d => ({
      ...d, nutrients: null, foodKeys: [], symptomKeys: d.mood === 4 ? ['headache'] : [],
    }));
    expect(foodPairedDays(days)).toHaveLength(0);
    expect(symptomMoodContrasts(days)).toHaveLength(1);
  });
});

describe('a day of eating decorates a day and never creates one', () => {
  it('ignores a food day nothing else knows about', () => {
    const days = buildMoodDays(
      [log('2026-08-17', 4)], [], '00:00', [], null,
      [
        { dayKey: '2026-08-17', nutrients: { calorieKcal: 2000 }, labels: ['coffee'] },
        { dayKey: '2026-07-01', nutrients: { calorieKcal: 1800 }, labels: ['toast'] },
      ],
    );
    // The July day was never a day this person logged a mood or finished
    // anything on. Admitting it would charge it `completed: 0`.
    expect(days.map(d => d.dayKey)).toEqual(['2026-08-17']);
    expect(days[0].nutrients).toEqual({ calorieKcal: 2000 });
    expect(days[0].foodKeys).toEqual(['coffee']);
  });

  it('leaves a day with no food row unable to speak to the axis', () => {
    const days = buildMoodDays([log('2026-08-17', 4)], [], '00:00');
    expect(days[0].nutrients).toBeNull();
    expect(days[0].foodKeys).toEqual([]);
  });
});

describe('the lines the eating card says', () => {
  /** N days carrying a nutrient and a paired value. */
  const rows = (
    amounts: Partial<Record<'calorieKcal' | 'sugarG' | 'caffeineMg', number>>[],
    opts: { mood?: number[]; completed?: number[] } = {},
  ): MoodDay[] =>
    amounts.map((a, i) => ({
      dayKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
      mood: opts.mood?.[i] ?? 3,
      symptomKeys: [],
      contextTagKeys: [],
      completed: opts.completed?.[i] ?? 0,
      categories: [],
      taskKeys: [],
      steps: null,
      sleepHours: null,
      nutrients: a,
      foodKeys: [],
    }));

  const flat = Array.from({ length: 10 }, () => ({ sugarG: 40 }));
  // Sugar varies with nothing, which is what "no clear pattern" is made of.
  const noisy = [20, 90, 30, 85, 25, 95, 35, 80, 22, 88].map(sugarG => ({ sugarG }));

  it('says it found nothing once per nutrient, not once per pairing', () => {
    // The card was looked at before this existed: half of it was the same six
    // words with a different noun on the end, which teaches somebody to skip
    // the paragraph the real findings are in.
    const days = rows(noisy, {
      mood: [3, 3, 4, 3, 3, 4, 3, 3, 4, 3],
      completed: [2, 2, 3, 2, 2, 3, 2, 2, 3, 2],
    });
    const sugar = nutrientFindings(days).filter(r => r.key.startsWith('sugarG'));
    expect(sugar).toHaveLength(1);
    expect(sugar[0].text).toBe('No clear pattern between your sugar and your mood or what you finish.');
  });

  it('still says it found nothing, rather than showing only what landed', () => {
    // Rule: hiding it leaves only the findings that happened to land, which is
    // how a screen of associations starts looking like a screen of results.
    const days = rows(noisy, { mood: [3, 3, 4, 3, 3, 4, 3, 3, 4, 3] });
    expect(nutrientFindings(days).some(r => r.text.startsWith('No clear pattern'))).toBe(true);
  });

  it('keeps both lines for a nutrient that found something one way', () => {
    const rising = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000];
    const days = rows(rising.map(calorieKcal => ({ calorieKcal })), {
      completed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      mood: [3, 4, 3, 4, 3, 4, 3, 4, 3, 4],
    });
    const calories = nutrientFindings(days).filter(r => r.key.startsWith('calorieKcal'));
    expect(calories).toHaveLength(2);
    expect(calories[0].text).toBe('You finish more tasks on the days you eat more.');
  });

  it('leads each nutrient with what you finished, the join no food logger can make', () => {
    const rising = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000];
    const days = rows(rising.map(calorieKcal => ({ calorieKcal })), {
      completed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      mood: [1, 2, 3, 4, 5, 1, 2, 3, 4, 5],
    });
    expect(nutrientFindings(days)[0].key).toBe('calorieKcal-completed');
  });

  it('leaves out a nutrient there was never enough of to compare', () => {
    expect(nutrientFindings(rows(flat)).some(r => r.key.startsWith('caffeineMg'))).toBe(false);
  });

  it('holds a stable order, so a finding is not promoted by the layout', () => {
    const days = rows(noisy, { mood: [3, 3, 4, 3, 3, 4, 3, 3, 4, 3] });
    expect(nutrientFindings(days).map(r => r.key))
      .toEqual(nutrientFindings(days).map(r => r.key));
  });
});
