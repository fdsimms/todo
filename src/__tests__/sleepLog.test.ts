import {
  MIN_SLEEP_AXIS_SPAN,
  SLEEP_GOAL_RANGE,
  averageClockMinutes,
  axisToClockMinutes,
  formatClockMinutes,
  formatSleepDuration,
  minutesOnSleepAxis,
  nightsInWindow,
  parseSleepEpisodes,
  parseSleepGoal,
  sleepNights,
  sleepPlot,
  sleepReadings,
  sleepSummary,
  type SleepEpisode,
  type SleepStages,
  averageSleepStages,
} from '@/utils/sleepLog';

/** Local wall-clock instants, so the tests read the same in every zone. */
function at(day: string, hhmm: string): Date {
  return new Date(`${day}T${hhmm}:00`);
}

function episode(start: Date, end: Date, minutes?: number, source = 0, stages: SleepStages | null = null): SleepEpisode {
  return { start, end, minutes: minutes ?? (end.getTime() - start.getTime()) / 60000, source, stages };
}

describe('parseSleepEpisodes', () => {
  it('reads the wire format', () => {
    const json = JSON.stringify([
      { start: at('2026-10-03', '23:10').toISOString(), end: at('2026-10-04', '07:00').toISOString(), minutes: 455, source: 1 },
    ]);
    expect(parseSleepEpisodes(json)).toEqual([
      { start: at('2026-10-03', '23:10'), end: at('2026-10-04', '07:00'), minutes: 455, source: 1, stages: null },
    ]);
  });

  it('reads stages, and an episode with none staged as unstaged rather than zeros', () => {
    const base = { start: at('2026-10-03', '23:00').toISOString(), end: at('2026-10-04', '07:00').toISOString(), minutes: 460, source: 0 };
    const [staged, unstaged, wakesOnly, legacy] = parseSleepEpisodes(JSON.stringify([
      { ...base, core: 260, deep: 80, rem: 120, awake: 15 },
      { ...base, core: 0, deep: 0, rem: 0, awake: 0 },
      { ...base, core: 0, deep: 0, rem: 0, awake: 20 },
      base,
    ]));
    expect(staged.stages).toEqual({ core: 260, deep: 80, rem: 120, awake: 15 });
    expect(unstaged.stages).toBeNull();
    expect(wakesOnly.stages).toBeNull();
    expect(legacy.stages).toBeNull();
  });

  it('drops malformed entries and answers [] for anything unreadable', () => {
    const good = { start: at('2026-10-03', '23:00').toISOString(), end: at('2026-10-04', '07:00').toISOString(), minutes: 480, source: 0 };
    const json = JSON.stringify([
      good,
      { ...good, start: 'not a date' },
      { ...good, end: good.start },
      { ...good, minutes: 0 },
      { ...good, minutes: 'lots' },
      null,
      'nope',
    ]);
    expect(parseSleepEpisodes(json)).toHaveLength(1);
    expect(parseSleepEpisodes('null')).toEqual([]);
    expect(parseSleepEpisodes('{oops')).toEqual([]);
    expect(parseSleepEpisodes('{}')).toEqual([]);
  });
});

describe('sleepNights', () => {
  it('files a night under the day it ends in', () => {
    const nights = sleepNights([episode(at('2026-10-03', '23:00'), at('2026-10-04', '07:00'))], '00:00');
    expect(nights).toHaveLength(1);
    expect(nights[0].dayKey).toBe('2026-10-04');
    expect(nights[0].minutes).toBe(480);
    expect(nights[0].asleepAt).toEqual(at('2026-10-03', '23:00'));
    expect(nights[0].wokeAt).toEqual(at('2026-10-04', '07:00'));
  });

  it('honours dayResetTime when deciding which day a night ended in', () => {
    // Woke at 3am under a 4am reset: still the previous logical day.
    const nights = sleepNights([episode(at('2026-10-03', '20:00'), at('2026-10-04', '03:00'))], '04:00');
    expect(nights[0].dayKey).toBe('2026-10-03');
  });

  it('counts a nap toward the day but keeps the night as the main stretch', () => {
    const nights = sleepNights([
      episode(at('2026-10-03', '23:00'), at('2026-10-04', '06:30')),
      episode(at('2026-10-04', '14:00'), at('2026-10-04', '14:40')),
    ], '00:00');
    expect(nights).toHaveLength(1);
    expect(nights[0].minutes).toBe(450 + 40);
    expect(nights[0].mainMinutes).toBe(450);
    expect(nights[0].asleepAt).toEqual(at('2026-10-03', '23:00'));
  });

  it('uses time asleep, not the span, for a stretch holding a short wake', () => {
    const nights = sleepNights([episode(at('2026-10-03', '23:00'), at('2026-10-04', '07:00'), 440)], '00:00');
    expect(nights[0].minutes).toBe(440);
    expect(nights[0].mainMinutes).toBe(440);
  });

  it('keeps the source with the most sleep and ignores the rest, rather than adding them', () => {
    // A phone and a watch both recording the same night.
    const nights = sleepNights([
      episode(at('2026-10-03', '22:30'), at('2026-10-04', '07:00'), 420, 0),
      episode(at('2026-10-03', '23:15'), at('2026-10-04', '06:50'), 445, 1),
    ], '00:00');
    expect(nights).toHaveLength(1);
    expect(nights[0].minutes).toBe(445);
    expect(nights[0].asleepAt).toEqual(at('2026-10-03', '23:15'));
  });

  it('picks the winning source by its whole day, naps included', () => {
    const nights = sleepNights([
      episode(at('2026-10-03', '23:00'), at('2026-10-04', '06:00'), 400, 0),
      episode(at('2026-10-03', '23:00'), at('2026-10-04', '06:00'), 380, 1),
      episode(at('2026-10-04', '13:00'), at('2026-10-04', '14:00'), 60, 1),
    ], '00:00');
    expect(nights[0].minutes).toBe(440);
    expect(nights[0].mainMinutes).toBe(380);
  });

  it('breaks a tie between sources the same way every time', () => {
    const a = episode(at('2026-10-03', '23:00'), at('2026-10-04', '07:00'), 480, 1);
    const b = episode(at('2026-10-03', '22:00'), at('2026-10-04', '06:00'), 480, 0);
    expect(sleepNights([a, b], '00:00')[0].asleepAt).toEqual(b.start);
    expect(sleepNights([b, a], '00:00')[0].asleepAt).toEqual(b.start);
  });

  it('returns days oldest first', () => {
    const nights = sleepNights([
      episode(at('2026-10-04', '23:00'), at('2026-10-05', '07:00')),
      episode(at('2026-10-02', '23:00'), at('2026-10-03', '07:00')),
    ], '00:00');
    expect(nights.map(n => n.dayKey)).toEqual(['2026-10-03', '2026-10-05']);
  });
});

describe('sleepReadings', () => {
  it("hands the day's total to the mood comparison, and no steps", () => {
    const nights = sleepNights([
      episode(at('2026-10-03', '23:00'), at('2026-10-04', '06:00')),
      episode(at('2026-10-04', '14:00'), at('2026-10-04', '15:00')),
    ], '00:00');
    expect(sleepReadings(nights)).toEqual([{ dayKey: '2026-10-04', steps: null, sleepHours: 8 }]);
  });
});

describe('stages', () => {
  const staged = (core: number, deep: number, rem: number, awake: number): SleepStages => ({ core, deep, rem, awake });

  it("carries the main stretch's stages onto the night", () => {
    const nights = sleepNights([
      episode(at('2026-10-03', '23:00'), at('2026-10-04', '07:00'), 470, 0, staged(270, 80, 120, 10)),
      episode(at('2026-10-04', '14:00'), at('2026-10-04', '14:30'), 30, 0, staged(30, 0, 0, 0)),
    ], '00:00');
    expect(nights[0].stages).toEqual(staged(270, 80, 120, 10));
  });

  it('averages only the staged nights, so a phone night is not a night of zero deep sleep', () => {
    const nights = sleepNights([
      episode(at('2026-10-01', '23:00'), at('2026-10-02', '07:00'), 480, 0, staged(280, 80, 120, 10)),
      episode(at('2026-10-02', '23:00'), at('2026-10-03', '07:00'), 480, 0, null),
      episode(at('2026-10-03', '23:00'), at('2026-10-04', '07:00'), 460, 0, staged(260, 60, 140, 20)),
    ], '00:00');
    expect(averageSleepStages(nights)).toEqual({ stages: staged(270, 70, 130, 15), nights: 2 });
  });

  it('has no average with no staged nights', () => {
    const nights = sleepNights([episode(at('2026-10-03', '23:00'), at('2026-10-04', '07:00'))], '00:00');
    expect(averageSleepStages(nights)).toBeNull();
  });
});

describe('nightsInWindow', () => {
  it('keeps the days ending on today, inclusive', () => {
    const nights = sleepNights([
      episode(at('2026-09-26', '23:00'), at('2026-09-27', '07:00')),
      episode(at('2026-09-27', '23:00'), at('2026-09-28', '07:00')),
      episode(at('2026-10-03', '23:00'), at('2026-10-04', '07:00')),
    ], '00:00');
    expect(nightsInWindow(nights, 7, '2026-10-04').map(n => n.dayKey)).toEqual(['2026-09-28', '2026-10-04']);
  });
});

describe('averageClockMinutes', () => {
  it('averages across midnight rather than through noon', () => {
    expect(averageClockMinutes([at('2026-10-03', '23:00'), at('2026-10-04', '01:00')])).toBe(0);
    expect(averageClockMinutes([at('2026-10-03', '22:30'), at('2026-10-03', '23:30')])).toBe(23 * 60);
  });

  it('answers null for no times, or times too scattered to share an average', () => {
    expect(averageClockMinutes([])).toBeNull();
    expect(averageClockMinutes([
      at('2026-10-01', '00:00'), at('2026-10-02', '06:00'), at('2026-10-03', '12:00'), at('2026-10-04', '18:00'),
    ])).toBeNull();
  });
});

describe('sleepSummary', () => {
  const nights = sleepNights([
    episode(at('2026-10-01', '23:00'), at('2026-10-02', '07:00')),
    episode(at('2026-10-02', '23:30'), at('2026-10-03', '06:30')),
    episode(at('2026-10-03', '22:30'), at('2026-10-04', '07:30')),
  ], '00:00');

  it('averages hours and clock times, and counts days at the goal', () => {
    const summary = sleepSummary(nights, 480);
    expect(summary.nights).toBe(3);
    expect(summary.averageMinutes).toBe(Math.round((480 + 420 + 540) / 3));
    expect(summary.averageAsleepAt).toBe(23 * 60);
    expect(summary.averageWokeAt).toBe(7 * 60);
    expect(summary.atGoal).toBe(2);
  });

  it('has no goal count without a goal, and nothing to average without nights', () => {
    expect(sleepSummary(nights, null).atGoal).toBeNull();
    expect(sleepSummary([], 480)).toEqual({
      nights: 0, averageMinutes: null, averageAsleepAt: null, averageWokeAt: null, atGoal: 0,
    });
  });
});

describe('the sleep axis', () => {
  it('puts a night crossing midnight on one unbroken run', () => {
    expect(minutesOnSleepAxis(at('2026-10-03', '23:00'), '2026-10-04')).toBe(660);
    expect(minutesOnSleepAxis(at('2026-10-04', '07:00'), '2026-10-04')).toBe(1140);
    expect(axisToClockMinutes(660)).toBe(23 * 60);
    expect(axisToClockMinutes(1140)).toBe(7 * 60);
  });

  it('frames the bars on whole hours, never narrower than the floor', () => {
    const nights = sleepNights([episode(at('2026-10-03', '23:10'), at('2026-10-04', '06:50'))], '00:00');
    const plot = sleepPlot(nights)!;
    expect(plot.domainStart % 60).toBe(0);
    expect(plot.domainEnd - plot.domainStart).toBeGreaterThanOrEqual(MIN_SLEEP_AXIS_SPAN);
    expect(plot.domainStart).toBeLessThanOrEqual(plot.bars[0].from);
    expect(plot.domainEnd).toBeGreaterThanOrEqual(plot.bars[0].to);
  });

  it('spans every bar when the window is wide', () => {
    const nights = sleepNights([
      episode(at('2026-10-01', '21:00'), at('2026-10-02', '05:00')),
      episode(at('2026-10-03', '02:00'), at('2026-10-03', '11:30'), 480),
    ], '00:00');
    const plot = sleepPlot(nights)!;
    expect(plot.domainStart).toBe(minutesOnSleepAxis(at('2026-10-01', '21:00'), '2026-10-02'));
    expect(plot.domainEnd).toBe(minutesOnSleepAxis(at('2026-10-03', '12:00'), '2026-10-03'));
  });

  it('has nothing to draw with no nights', () => {
    expect(sleepPlot([])).toBeNull();
  });
});

describe('formatting', () => {
  it('writes a duration in hours and minutes', () => {
    expect(formatSleepDuration(443)).toBe('7 hr 23 min');
    expect(formatSleepDuration(480)).toBe('8 hr');
    expect(formatSleepDuration(45)).toBe('45 min');
    expect(formatSleepDuration(0)).toBe('0 min');
  });

  it('writes a clock time in either convention', () => {
    expect(formatClockMinutes(23 * 60 + 5, false)).toBe('11:05 PM');
    expect(formatClockMinutes(23 * 60 + 5, true)).toBe('23:05');
    expect(formatClockMinutes(-60, true)).toBe('23:00');
  });
});

describe('parseSleepGoal', () => {
  it('reads a stored goal inside the range and nothing else', () => {
    expect(parseSleepGoal('480')).toBe(480);
    expect(parseSleepGoal(String(SLEEP_GOAL_RANGE.min))).toBe(SLEEP_GOAL_RANGE.min);
    expect(parseSleepGoal('')).toBeNull();
    expect(parseSleepGoal(null)).toBeNull();
    expect(parseSleepGoal('7.5')).toBeNull();
    expect(parseSleepGoal('60')).toBeNull();
    expect(parseSleepGoal(String(SLEEP_GOAL_RANGE.max + 30))).toBeNull();
    expect(parseSleepGoal('eight')).toBeNull();
  });
});
