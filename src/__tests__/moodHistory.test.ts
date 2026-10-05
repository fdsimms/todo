import {
  EMPTY_MOOD_FILTER,
  dreamStats,
  hasWrittenDream,
  filterMoodLogs,
  groupLogsByDay,
  isMoodFilterActive,
  logsInDayRange,
  adjacentLogDays,
  logsWithSymptom,
  lookBacks,
  searchMoodLogs,
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
    dream: over.dream ?? null,
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
      moods: [2], symptomKeys: ['headache'], contextTagKeys: ['travel'], withNote: false, withDream: false,
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

describe('looking back', () => {
  const written = (dayKey: string, note: string | null, mood: MoodLog['mood'] = 3) =>
    log({ dayKey, loggedAt: `${dayKey}T20:00:00`, note, mood });

  it('finds the same date a month, a season and a year back', () => {
    const logs = [
      written('2026-07-17', 'a month'),
      written('2026-05-17', 'three months'),
      written('2025-08-17', 'a year'),
    ];
    expect(lookBacks(logs, '2026-08-17').map(l => l.label)).toEqual([
      'A month ago', '3 months ago', 'A year ago',
    ]);
  });

  it('skips entries with no words, and shows nothing rather than a placeholder', () => {
    const logs = [written('2026-07-17', null, 5), written('2026-06-17', '   ')];
    expect(lookBacks(logs, '2026-08-17')).toEqual([]);
  });

  it('keeps a day\'s written entries oldest first and drops the unwritten ones', () => {
    const logs = [
      log({ dayKey: '2026-07-17', loggedAt: '2026-07-17T21:00:00', note: 'evening' }),
      log({ dayKey: '2026-07-17', loggedAt: '2026-07-17T08:00:00', note: 'morning' }),
      log({ dayKey: '2026-07-17', loggedAt: '2026-07-17T12:00:00', note: null }),
    ];
    expect(lookBacks(logs, '2026-08-17')[0].logs.map(l => l.note)).toEqual(['morning', 'evening']);
  });

  it('clamps a short month the way the calendar does', () => {
    expect(lookBacks([written('2026-02-28', 'x')], '2026-03-31')[0].dayKey).toBe('2026-02-28');
  });

  it('caps the card at three look-backs, most recent first', () => {
    const logs = [
      written('2026-07-17', 'a'), written('2026-05-17', 'b'),
      written('2026-02-17', 'c'), written('2025-08-17', 'd'),
    ];
    expect(lookBacks(logs, '2026-08-17').map(l => l.label)).toEqual([
      'A month ago', '3 months ago', '6 months ago',
    ]);
  });
});

describe('searching the notes', () => {
  const logs = [
    log({ note: 'Long walk by the river' }),
    log({ note: 'Slept badly, walk helped' }),
    log({ note: null, symptoms: [{ name: 'Walk-induced cramp', severity: 1 }] }),
    log({ note: '   ' }),
  ];

  it('keeps everything for an empty query', () => {
    expect(searchMoodLogs(logs, '  ')).toHaveLength(4);
  });

  it('matches case-insensitively and needs every word, in any order', () => {
    expect(searchMoodLogs(logs, 'WALK').map(l => l.note)).toEqual([
      'Long walk by the river', 'Slept badly, walk helped',
    ]);
    expect(searchMoodLogs(logs, 'helped walk')).toHaveLength(1);
  });

  it('reads notes only, never symptoms, and never an empty note', () => {
    expect(searchMoodLogs(logs, 'cramp')).toEqual([]);
  });
});

describe('the has-a-note filter', () => {
  it('ANDs with the rest and drops blank notes', () => {
    const logs = [log({ note: 'x', mood: 2 }), log({ note: '  ', mood: 2 }), log({ note: 'y', mood: 5 })];
    const out = filterMoodLogs(logs, { ...EMPTY_MOOD_FILTER, withNote: true, moods: [2] });
    expect(out.map(l => l.note)).toEqual(['x']);
    expect(isMoodFilterActive({ ...EMPTY_MOOD_FILTER, withNote: true })).toBe(true);
  });
});

describe('paging between written days', () => {
  const logs = [log({ dayKey: '2026-08-01' }), log({ dayKey: '2026-08-05' }), log({ dayKey: '2026-08-05' }), log({ dayKey: '2026-08-09' })];

  it('skips days with nothing logged', () => {
    expect(adjacentLogDays(logs, '2026-08-05')).toEqual({ previous: '2026-08-01', next: '2026-08-09' });
  });

  it('is null at either end', () => {
    expect(adjacentLogDays(logs, '2026-08-01').previous).toBeNull();
    expect(adjacentLogDays(logs, '2026-08-09').next).toBeNull();
  });
});

describe('dreams', () => {
  it('counts a dream as written only when it has more than whitespace', () => {
    expect(hasWrittenDream(log({ dream: 'Flying over a city' }))).toBe(true);
    expect(hasWrittenDream(log({ dream: '   ' }))).toBe(false);
    expect(hasWrittenDream(log())).toBe(false);
  });

  it('filters to entries with a dream and ANDs it with the rest', () => {
    const logs = [log({ dream: 'Falling', mood: 2 }), log({ mood: 2 }), log({ dream: 'Beach', mood: 5 })];
    const withDream = { ...EMPTY_MOOD_FILTER, withDream: true };
    expect(isMoodFilterActive(withDream)).toBe(true);
    expect(filterMoodLogs(logs, withDream)).toHaveLength(2);
    expect(filterMoodLogs(logs, { ...withDream, moods: [2] })).toHaveLength(1);
  });

  it('searches the dream as well as the note, with every word in one entry', () => {
    const logs = [
      log({ note: 'Long day', dream: 'Missing a train' }),
      log({ note: 'Train was late' }),
      log({ dream: 'A quiet beach' }),
    ];
    expect(searchMoodLogs(logs, 'train')).toHaveLength(2);
    expect(searchMoodLogs(logs, 'long train')).toHaveLength(1);
    expect(searchMoodLogs(logs, 'beach')).toHaveLength(1);
    expect(searchMoodLogs([log({ mood: 3 })], 'train')).toHaveLength(0);
  });

  it('tallies days and entries, and a day with no dream is not counted', () => {
    const logs = [
      log({ dayKey: '2026-10-02', dream: 'One' }),
      log({ dayKey: '2026-10-02', dream: 'Two' }),
      log({ dayKey: '2026-09-28', dream: 'Three' }),
      log({ dayKey: '2026-10-03' }),
    ];
    expect(dreamStats(logs, '2026-10')).toEqual({
      dayCount: 2, entryCount: 3, dayCountInMonth: 1, lastDayKey: '2026-10-02',
    });
  });

  it('has no last day when nothing was written', () => {
    expect(dreamStats([log()], '2026-10')).toEqual({
      dayCount: 0, entryCount: 0, dayCountInMonth: 0, lastDayKey: null,
    });
  });
});
