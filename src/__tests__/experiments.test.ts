import type { Experiment, Milestone, MoodLog, LoggedSymptom } from '../types';
import {
  cleanExperimentSymptoms,
  describeLength,
  experimentProgress,
  experimentRefusal,
  experimentResult,
  experimentSpan,
  experimentStatus,
  overlappingChanges,
  roundedSeverity,
  sortExperimentsForList,
  symptomRate,
} from '../utils/experiments';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';

const dayKeyToDate = (key: string) => new Date(`${key}T00:00:00`);
const dayKeyOf = (date: Date) => format(date, 'yyyy-MM-dd');

/** Noon local on a day key, the way the store anchors a picked date. */
function noon(dayKey: string): string {
  const d = dayKeyToDate(dayKey);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function shift(dayKey: string, days: number): string {
  return dayKeyOf(addDays(dayKeyToDate(dayKey), days));
}

function experiment(over: Partial<Experiment> & { start?: string; end?: string } = {}): Experiment {
  return {
    id: over.id ?? 'e1',
    label: over.label ?? 'No caffeine after noon',
    startDate: over.startDate ?? noon(over.start ?? '2026-11-01'),
    endDate: over.endDate ?? noon(over.end ?? '2026-11-14'),
    symptoms: over.symptoms ?? [],
    note: over.note ?? null,
    createdAt: over.createdAt ?? '2026-10-01T09:00:00',
  };
}

function log(dayKey: string, mood: number | null, symptoms: LoggedSymptom[] = []): MoodLog {
  return {
    id: `${dayKey}-${mood}-${symptoms.map(s => s.name).join(',')}`,
    loggedAt: `${dayKey}T09:00:00`,
    dayKey,
    mood: mood as MoodLog['mood'],
    symptoms,
    contextTags: [],
    note: null,
    change: null,
  };
}

/** One entry a day from `from` for `count` days. */
function run(
  from: string,
  count: number,
  entry: (i: number, dayKey: string) => MoodLog | null,
): MoodLog[] {
  const out: MoodLog[] = [];
  for (let i = 0; i < count; i++) {
    const key = shift(from, i);
    const l = entry(i, key);
    if (l) out.push(l);
  }
  return out;
}

describe('experimentSpan', () => {
  it('reads a baseline of the same length ending the day before it starts', () => {
    const span = experimentSpan(experiment({ start: '2026-11-01', end: '2026-11-14' }));
    expect(span).toEqual({
      startKey: '2026-11-01',
      endKey: '2026-11-14',
      lengthDays: 14,
      baselineFromKey: '2026-10-18',
      baselineToKey: '2026-10-31',
    });
  });

  it('counts a DST change inside it as whole days', () => {
    // Clocks change in early November in North America and late October in Europe.
    const span = experimentSpan(experiment({ start: '2026-10-20', end: '2026-11-16' }));
    expect(span.lengthDays).toBe(28);
  });

  it('is one day long when it starts and ends on the same day', () => {
    expect(experimentSpan(experiment({ start: '2026-11-01', end: '2026-11-01' })).lengthDays).toBe(1);
  });
});

describe('experimentStatus and experimentProgress', () => {
  const e = experiment({ start: '2026-11-01', end: '2026-11-28' });

  it('is upcoming before the first day, running through the last, finished after', () => {
    expect(experimentStatus(e, '2026-10-31')).toBe('upcoming');
    expect(experimentStatus(e, '2026-11-01')).toBe('running');
    expect(experimentStatus(e, '2026-11-28')).toBe('running');
    expect(experimentStatus(e, '2026-11-29')).toBe('finished');
  });

  it('says which day of it today is, clamped to its own days', () => {
    expect(experimentProgress(e, '2026-11-12')).toEqual({ day: 12, of: 28 });
    expect(experimentProgress(e, '2026-10-20')).toEqual({ day: 0, of: 28 });
    expect(experimentProgress(e, '2026-12-20')).toEqual({ day: 28, of: 28 });
  });
});

describe('cleanExperimentSymptoms', () => {
  it('trims, drops blanks and keeps the first spelling of each symptom', () => {
    expect(cleanExperimentSymptoms([' Headache ', '', 'headache', 'Brain fog', '  '])).toEqual(['Headache', 'Brain fog']);
  });
});

describe('experimentRefusal', () => {
  const start = dayKeyToDate('2026-11-05');
  it('refuses a blank name and an end before the start', () => {
    expect(experimentRefusal({ label: '  ', startDate: start, endDate: start })).toMatch(/name/);
    expect(experimentRefusal({ label: 'x', startDate: start, endDate: dayKeyToDate('2026-11-04') })).toMatch(/end before/);
  });

  it('accepts one that ends the day it starts', () => {
    expect(experimentRefusal({ label: 'x', startDate: start, endDate: start })).toBeNull();
  });
});

describe('experimentResult: mood', () => {
  const e = experiment({ start: '2026-11-01', end: '2026-11-14' });

  it('compares the baseline against the experiment’s days', () => {
    const logs = [
      ...run('2026-10-18', 14, (_, k) => log(k, 2)),
      ...run('2026-11-01', 14, (_, k) => log(k, 4)),
    ];
    const r = experimentResult(e, logs, '2026-11-20');
    expect(r.status).toBe('finished');
    expect(r.mood).toEqual({ beforeDays: 14, duringDays: 14, moodBefore: 2, moodDuring: 4, delta: 2 });
  });

  it('leaves out days outside both stretches', () => {
    const logs = [
      log('2026-10-10', 5), // before the baseline
      ...run('2026-10-18', 6, (_, k) => log(k, 3)),
      ...run('2026-11-01', 6, (_, k) => log(k, 3)),
      log('2026-11-20', 1), // after the end
    ];
    const r = experimentResult(e, logs, '2026-11-25');
    expect(r.mood?.beforeDays).toBe(6);
    expect(r.mood?.duringDays).toBe(6);
    expect(r.mood?.delta).toBe(0);
  });

  it('reads only up to today while it runs', () => {
    const logs = [
      ...run('2026-10-18', 14, (_, k) => log(k, 3)),
      ...run('2026-11-01', 14, (_, k) => log(k, 4)),
    ];
    const r = experimentResult(e, logs, '2026-11-05');
    expect(r.status).toBe('running');
    expect(r.readToKey).toBe('2026-11-05');
    expect(r.mood?.duringDays).toBe(5);
  });

  it('stays quiet until each side has enough days with a mood', () => {
    const logs = [
      ...run('2026-10-18', 14, (_, k) => log(k, 3)),
      ...run('2026-11-01', 2, (_, k) => log(k, 5)),
      // Symptom-only days don't count toward a mood.
      ...run('2026-11-03', 5, (_, k) => log(k, null, [{ name: 'Headache', severity: 1 }])),
    ];
    expect(experimentResult(e, logs, '2026-11-14').mood).toBeNull();
  });

  it('needs MIN_PAIRED_DAYS across both sides, not just three on each', () => {
    const logs = [
      ...run('2026-10-18', 3, (_, k) => log(k, 3)),
      ...run('2026-11-01', 3, (_, k) => log(k, 4)),
    ];
    expect(experimentResult(e, logs, '2026-11-20').mood).toBeNull();
  });

  it('reads nothing for one that hasn’t started', () => {
    const logs = run('2026-10-18', 10, (_, k) => log(k, 3));
    const r = experimentResult(e, logs, '2026-10-28');
    expect(r.status).toBe('upcoming');
    expect(r.readToKey).toBeNull();
    expect(r.loggedDaysBefore).toBe(10);
    expect(r.loggedDaysDuring).toBe(0);
    expect(r.mood).toBeNull();
  });
});

describe('experimentResult: symptoms', () => {
  const headache = (severity: 1 | 2 | 3): LoggedSymptom => ({ name: 'Headache', severity });

  it('rates a picked symptom by the share of logged days it was on, at each day’s worst', () => {
    const e = experiment({ start: '2026-11-01', end: '2026-11-14', symptoms: ['headache'] });
    const logs = [
      // Baseline: 10 logged days, headache on the first 6 (moderate).
      ...run('2026-10-18', 10, (i, k) => log(k, 3, i < 6 ? [headache(2)] : [])),
      // Mild then severe on one day: the day counts once, at severe.
      log('2026-10-18', 3, [headache(3)]),
      // During: 10 logged days, headache on 2 (mild).
      ...run('2026-11-01', 10, (i, k) => log(k, 3, i < 2 ? [headache(1)] : [])),
    ];
    const r = experimentResult(e, logs, '2026-11-20');
    expect(r.picked).toHaveLength(1);
    const row = r.picked[0];
    expect(row.name).toBe('headache');
    expect(row.picked).toBe(true);
    expect(row.comparable).toBe(true);
    expect(row.before).toEqual({ loggedDays: 10, daysWith: 6, averageSeverity: (3 + 2 * 5) / 6 });
    expect(row.during).toEqual({ loggedDays: 10, daysWith: 2, averageSeverity: 1 });
    expect(symptomRate(row.before)).toBeCloseTo(0.6);
    expect(symptomRate(row.during)).toBeCloseTo(0.2);
  });

  it('doesn’t count days before a symptom was first logged as days without it', () => {
    const e = experiment({ start: '2026-11-01', end: '2026-11-14', symptoms: ['Brain fog'] });
    const logs = [
      ...run('2026-10-18', 14, (_, k) => log(k, 3)),
      log('2026-11-06', 3, [{ name: 'Brain fog', severity: 1 }]),
      ...run('2026-11-07', 3, (_, k) => log(k, 3)),
    ];
    const row = experimentResult(e, logs, '2026-11-09').picked[0];
    expect(row.firstLoggedKey).toBe('2026-11-06');
    expect(row.before.loggedDays).toBe(0);
    expect(row.during.loggedDays).toBe(4);
    expect(row.comparable).toBe(false);
  });

  it('lists a picked symptom that was never logged, uncomparable', () => {
    const e = experiment({ symptoms: ['Nausea'] });
    const row = experimentResult(e, run('2026-10-18', 28, (_, k) => log(k, 3)), '2026-11-20').picked[0];
    expect(row).toMatchObject({ name: 'Nausea', firstLoggedKey: null, comparable: false });
  });

  it('shows other comparable symptoms apart from the picked ones, biggest change first', () => {
    const e = experiment({ start: '2026-11-01', end: '2026-11-14', symptoms: ['Headache'] });
    const logs = [
      ...run('2026-10-18', 14, (i, k) => log(k, 3, [
        ...(i % 2 === 0 ? [headache(2)] : []),
        ...(i < 2 ? [{ name: 'Nausea', severity: 1 as const }] : []),
        ...(i < 12 ? [{ name: 'Back pain', severity: 2 as const }] : []),
      ])),
      ...run('2026-11-01', 14, (i, k) => log(k, 3, [
        ...(i < 2 ? [{ name: 'Nausea', severity: 1 as const }] : []),
        ...(i < 1 ? [{ name: 'Back pain', severity: 2 as const }] : []),
      ])),
      // Never in either stretch: not listed.
      log('2026-09-01', 3, [{ name: 'Rash', severity: 1 }]),
    ];
    const r = experimentResult(e, logs, '2026-11-20');
    expect(r.picked.map(p => p.name)).toEqual(['Headache']);
    expect(r.others.map(o => o.name)).toEqual(['Back pain', 'Nausea']);
    expect(r.others.every(o => !o.picked)).toBe(true);
  });
});

describe('overlappingChanges', () => {
  const e = experiment({ id: 'mine', start: '2026-11-01', end: '2026-11-14' });
  const milestone = (id: string, day: string): Milestone => ({ id, label: id, date: noon(day), createdAt: '' });

  it('names milestones inside the baseline or the experiment, and overlapping experiments', () => {
    const changes = overlappingChanges(
      e,
      [milestone('too early', '2026-10-17'), milestone('baseline', '2026-10-20'), milestone('during', '2026-11-03'), milestone('after', '2026-11-15')],
      [
        e,
        experiment({ id: 'other', label: 'Earlier bedtime', start: '2026-11-10', end: '2026-11-30' }),
        experiment({ id: 'apart', label: 'Apart', start: '2026-12-01', end: '2026-12-05' }),
      ],
    );
    expect(changes.map(c => `${c.kind}:${c.label}`)).toEqual([
      'milestone:baseline', 'milestone:during', 'experiment:Earlier bedtime',
    ]);
  });
});

describe('describeLength', () => {
  it('names a preset and counts anything else in days', () => {
    expect(describeLength(28)).toBe('4 weeks');
    expect(describeLength(10)).toBe('10 days');
    expect(describeLength(1)).toBe('1 day');
  });
});

describe('roundedSeverity', () => {
  it('rounds to a level and stays on the scale', () => {
    expect(roundedSeverity(1.4)).toBe(1);
    expect(roundedSeverity(2.5)).toBe(3);
    expect(roundedSeverity(0.2)).toBe(1);
  });
});

describe('sortExperimentsForList', () => {
  it('puts running first, then upcoming, then finished newest first', () => {
    const list = sortExperimentsForList([
      experiment({ id: 'old', start: '2026-09-01', end: '2026-09-10' }),
      experiment({ id: 'next', start: '2026-12-01', end: '2026-12-10' }),
      experiment({ id: 'now', start: '2026-11-01', end: '2026-11-30' }),
      experiment({ id: 'recent', start: '2026-10-01', end: '2026-10-20' }),
    ], '2026-11-11');
    expect(list.map(e => e.id)).toEqual(['now', 'next', 'recent', 'old']);
  });
});
