import {
  EMPTY_MOOD_FILTER,
  filterMoodLogs,
  groupLogsByDay,
  isMoodFilterActive,
  logsInDayRange,
  logsWithSymptom,
  symptomOnLog,
  symptomSeverityOnDay,
  symptomStatFor,
  symptomStats,
  toggleFilterValue,
} from '../utils/moodHistory';
import type { MoodLog } from '../types';

let n = 0;
function log(over: Partial<MoodLog> = {}): MoodLog {
  n++;
  return {
    id: over.id ?? `l${n}`,
    loggedAt: over.loggedAt ?? '2026-08-17T09:00:00.000Z',
    dayKey: over.dayKey ?? '2026-08-17',
    mood: over.mood === undefined ? 3 : over.mood,
    symptoms: over.symptoms ?? [],
    contextTags: over.contextTags ?? [],
    note: over.note ?? null,
  };
}

describe('the filter', () => {
  it('is inactive until something is picked', () => {
    expect(isMoodFilterActive(EMPTY_MOOD_FILTER)).toBe(false);
    expect(isMoodFilterActive({ ...EMPTY_MOOD_FILTER, moods: [2] })).toBe(true);
  });

  it('keeps everything when nothing is picked', () => {
    const logs = [log(), log({ mood: 5 })];
    expect(filterMoodLogs(logs, EMPTY_MOOD_FILTER)).toHaveLength(2);
  });

  it('ORs within a dimension', () => {
    const logs = [log({ mood: 1 }), log({ mood: 3 }), log({ mood: 5 })];
    expect(filterMoodLogs(logs, { ...EMPTY_MOOD_FILTER, moods: [1, 5] })).toHaveLength(2);
  });

  it('ANDs across dimensions', () => {
    const logs = [
      log({ mood: 2, symptoms: [{ name: 'Headache', severity: 2 }], contextTags: ['Travel'] }),
      log({ mood: 2, symptoms: [{ name: 'Headache', severity: 2 }] }),
    ];
    const filtered = filterMoodLogs(logs, {
      moods: [2], symptomKeys: ['headache'], contextTagKeys: ['travel'],
    });
    expect(filtered).toHaveLength(1);
  });

  it('matches symptoms and tags case-insensitively, like everything else here', () => {
    const logs = [log({ symptoms: [{ name: 'Brain Fog', severity: 1 }] })];
    expect(filterMoodLogs(logs, { ...EMPTY_MOOD_FILTER, symptomKeys: ['brain fog'] }))
      .toHaveLength(1);
  });

  // An entry with no mood is not a 3 — the same rule dayMoodAverage holds.
  it('never matches a mood filter with an entry that recorded no mood', () => {
    const logs = [log({ mood: null, symptoms: [{ name: 'Headache', severity: 1 }] })];
    expect(filterMoodLogs(logs, { ...EMPTY_MOOD_FILTER, moods: [3] })).toHaveLength(0);
    expect(filterMoodLogs(logs, { ...EMPTY_MOOD_FILTER, symptomKeys: ['headache'] }))
      .toHaveLength(1);
  });

  it('filters entries rather than days, so one rough evening survives a good morning', () => {
    const logs = [
      log({ id: 'am', mood: 5, loggedAt: '2026-08-17T08:00:00.000Z' }),
      log({ id: 'pm', mood: 1, loggedAt: '2026-08-17T20:00:00.000Z' }),
    ];
    expect(filterMoodLogs(logs, { ...EMPTY_MOOD_FILTER, moods: [1] }).map(l => l.id))
      .toEqual(['pm']);
  });
});

describe('toggleFilterValue', () => {
  it('adds what is missing and removes what is there', () => {
    expect(toggleFilterValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFilterValue(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('grouping', () => {
  it('reads days newest first and each day forwards', () => {
    const logs = [
      log({ id: 'tue-pm', dayKey: '2026-08-18', loggedAt: '2026-08-18T20:00:00.000Z' }),
      log({ id: 'mon-pm', dayKey: '2026-08-17', loggedAt: '2026-08-17T20:00:00.000Z' }),
      log({ id: 'mon-am', dayKey: '2026-08-17', loggedAt: '2026-08-17T08:00:00.000Z' }),
    ];
    const days = groupLogsByDay(logs);
    expect(days.map(d => d.dayKey)).toEqual(['2026-08-18', '2026-08-17']);
    expect(days[1].logs.map(l => l.id)).toEqual(['mon-am', 'mon-pm']);
  });
});

describe('symptom stats', () => {
  const logs = [
    log({
      dayKey: '2026-08-20', loggedAt: '2026-08-20T20:00:00.000Z',
      symptoms: [{ name: 'headache', severity: 3 }],
    }),
    log({
      dayKey: '2026-08-20', loggedAt: '2026-08-20T09:00:00.000Z',
      symptoms: [{ name: 'Headache', severity: 1 }],
    }),
    log({
      dayKey: '2026-08-17', loggedAt: '2026-08-17T09:00:00.000Z',
      symptoms: [{ name: 'Headache', severity: 2 }, { name: 'Poor sleep', severity: 1 }],
    }),
  ];

  it('counts days, not entries, and reports both', () => {
    const stat = symptomStatFor(logs, 'headache');
    expect(stat?.dayCount).toBe(2);
    expect(stat?.entryCount).toBe(3);
  });

  it('takes the worst severity a day reached', () => {
    const stat = symptomStatFor(logs, 'headache');
    // 20 Aug went mild then severe: one severe day, not one of each.
    expect(stat?.daysBySeverity).toEqual({ 1: 0, 2: 1, 3: 1 });
  });

  it('reports the first and last day it appeared on', () => {
    const stat = symptomStatFor(logs, 'headache');
    expect(stat?.firstDayKey).toBe('2026-08-17');
    expect(stat?.lastDayKey).toBe('2026-08-20');
  });

  it('shows the casing from the most recent entry', () => {
    expect(symptomStatFor(logs, 'headache')?.name).toBe('headache');
  });

  it('sorts by days, most first', () => {
    expect(symptomStats(logs).map(s => s.key)).toEqual(['headache', 'poor sleep']);
  });

  it('has no minimum — a symptom logged once is still shown', () => {
    expect(symptomStatFor(logs, 'poor sleep')?.dayCount).toBe(1);
  });

  it('answers null for a symptom nothing carries', () => {
    expect(symptomStatFor(logs, 'nausea')).toBeNull();
  });
});

describe('a symptom day by day', () => {
  const logs = [
    log({ dayKey: '2026-08-17', symptoms: [{ name: 'Headache', severity: 1 }] }),
    log({ dayKey: '2026-08-17', symptoms: [{ name: 'Headache', severity: 3 }] }),
  ];

  it('reports the day at its worst', () => {
    expect(symptomSeverityOnDay(logs, 'headache', '2026-08-17')).toBe(3);
  });

  // Null, not 0: 0 isn't on the severity scale, and a day without a symptom is
  // not a day with a very mild one.
  it('is null on a day it was not logged', () => {
    expect(symptomSeverityOnDay(logs, 'headache', '2026-08-18')).toBeNull();
  });
});

describe('entries for one symptom', () => {
  const logs = [
    log({ id: 'a', symptoms: [{ name: 'Headache', severity: 2 }] }),
    log({ id: 'b', symptoms: [{ name: 'Nausea', severity: 1 }] }),
  ];

  it('keeps only the entries carrying it', () => {
    expect(logsWithSymptom(logs, 'headache').map(l => l.id)).toEqual(['a']);
  });

  it('finds the severity recorded on one entry', () => {
    expect(symptomOnLog(logs[0], 'headache')?.severity).toBe(2);
    expect(symptomOnLog(logs[1], 'headache')).toBeNull();
  });
});

describe('a day range', () => {
  const logs = [
    log({ id: 'old', dayKey: '2026-07-01' }),
    log({ id: 'mid', dayKey: '2026-08-01' }),
    log({ id: 'new', dayKey: '2026-09-01' }),
  ];

  it('is inclusive at both ends', () => {
    expect(logsInDayRange(logs, '2026-08-01', '2026-09-01').map(l => l.id))
      .toEqual(['mid', 'new']);
  });

  it('treats a null bound as no bound', () => {
    expect(logsInDayRange(logs, null, null)).toHaveLength(3);
    expect(logsInDayRange(logs, '2026-08-15', null).map(l => l.id)).toEqual(['new']);
  });
});
