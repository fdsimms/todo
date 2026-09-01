import {
  MOOD_LEVELS,
  LOW_MOOD_AT_OR_BELOW,
  dayMoodAverage,
  daySymptoms,
  hasLogOnDay,
  logsOnDay,
  moodEmoji,
  moodLabel,
  moodLogSummary,
  severityLabel,
  symptomKey,
  symptomVocabulary,
  withSymptom,
  withoutSymptom,
} from '../utils/moodLog';
import type { MoodLevel, MoodLog } from '../types';

function log(over: Partial<MoodLog> = {}): MoodLog {
  return {
    id: over.id ?? 'l1',
    loggedAt: over.loggedAt ?? '2026-08-17T09:00:00.000Z',
    dayKey: over.dayKey ?? '2026-08-17',
    mood: over.mood === undefined ? 3 : over.mood,
    symptoms: over.symptoms ?? [],
    note: over.note ?? null,
  };
}

describe('the scale', () => {
  it('is five levels, low to high, numbered 1..5', () => {
    expect(MOOD_LEVELS.map(m => m.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it('draws the low line below OK, so a fine day is never treated as a bad one', () => {
    // The one rule this feature cannot break is telling somebody how they feel.
    const ok = MOOD_LEVELS.find(m => m.label === 'OK')!;
    expect(ok.value).toBeGreaterThan(LOW_MOOD_AT_OR_BELOW);
  });

  it('labels and emoji every level, and falls back rather than throwing', () => {
    expect(moodLabel(1)).toBe('Very low');
    expect(moodLabel(5)).toBe('Very good');
    expect(moodEmoji(3)).toBe('😐');
    expect(moodLabel(9 as MoodLevel)).toBe('OK');
    expect(severityLabel(3)).toBe('Severe');
  });
});

describe('symptom names', () => {
  it('matches on case and surrounding space only', () => {
    expect(symptomKey('  Headache ')).toBe('headache');
    expect(symptomKey('HEADACHE')).toBe(symptomKey('headache'));
  });

  it('deliberately does not fold near-spellings together', () => {
    // Not stemming or de-pluralising: folding "headache" and "head aches" into
    // one series would merge two complaints in a chart somebody may show a
    // doctor, and the app has no business deciding they are the same thing.
    expect(symptomKey('head aches')).not.toBe(symptomKey('headache'));
    expect(symptomKey('headaches')).not.toBe(symptomKey('headache'));
  });
});

describe('building a symptom set', () => {
  it('adds one', () => {
    expect(withSymptom([], 'Headache', 2)).toEqual([{ name: 'Headache', severity: 2 }]);
  });

  it('replaces the severity rather than logging the same symptom twice', () => {
    const once = withSymptom([], 'Headache', 1);
    expect(withSymptom(once, 'headache', 3)).toEqual([{ name: 'Headache', severity: 3 }]);
  });

  it('keeps the first spelling when the same symptom is re-picked', () => {
    const once = withSymptom([], 'Brain fog', 1);
    expect(withSymptom(once, 'BRAIN FOG', 2)[0].name).toBe('Brain fog');
  });

  it('refuses a blank', () => {
    expect(withSymptom([], '   ', 1)).toEqual([]);
  });

  it('removes one, matching case-insensitively', () => {
    const set = withSymptom([], 'Headache', 1);
    expect(withoutSymptom(set, 'HEADACHE')).toEqual([]);
  });
});

describe('the vocabulary', () => {
  it('is derived from the entries, most-used first', () => {
    const logs = [
      log({ id: 'a', symptoms: [{ name: 'Headache', severity: 1 }] }),
      log({ id: 'b', symptoms: [{ name: 'headache', severity: 2 }, { name: 'Nausea', severity: 1 }] }),
    ];
    expect(symptomVocabulary(logs)).toEqual(['Headache', 'Nausea']);
  });

  it('drops a symptom by itself once it stops being logged', () => {
    // The whole reason this is derived rather than a stored registry: there is
    // nothing to prune, and a symptom logged once years ago stops being
    // offered without anybody tidying up.
    expect(symptomVocabulary([log({ symptoms: [] })])).toEqual([]);
  });
});

describe('reading a day', () => {
  const logs = [
    log({ id: 'b', loggedAt: '2026-08-17T20:00:00.000Z', mood: 2 }),
    log({ id: 'a', loggedAt: '2026-08-17T08:00:00.000Z', mood: 4 }),
    log({ id: 'c', dayKey: '2026-08-18', mood: 5 }),
  ];

  it('returns a day\'s entries oldest first', () => {
    expect(logsOnDay(logs, '2026-08-17').map(l => l.id)).toEqual(['a', 'b']);
  });

  it('averages several entries into the day\'s mood', () => {
    expect(dayMoodAverage(logs, '2026-08-17')).toBe(3);
  });

  it('does not round, so a day average keeps its precision', () => {
    const three = [log({ id: '1', mood: 1 }), log({ id: '2', mood: 2 }), log({ id: '3', mood: 2 })];
    expect(dayMoodAverage(three, '2026-08-17')).toBeCloseTo(5 / 3);
  });

  it('separates "logged without a mood" from "did not log"', () => {
    const symptomOnly = [log({ mood: null, symptoms: [{ name: 'Headache', severity: 1 }] })];
    expect(dayMoodAverage(symptomOnly, '2026-08-17')).toBeNull();
    expect(hasLogOnDay(symptomOnly, '2026-08-17')).toBe(true);
    expect(hasLogOnDay(symptomOnly, '2026-08-19')).toBe(false);
  });

  it('reports a symptom at the worst it got that day', () => {
    const day = [
      log({ id: 'a', symptoms: [{ name: 'Headache', severity: 1 }] }),
      log({ id: 'b', symptoms: [{ name: 'headache', severity: 3 }] }),
    ];
    expect(daySymptoms(day, '2026-08-17')).toEqual([{ name: 'headache', severity: 3 }]);
  });
});

describe('an entry summary', () => {
  it('leads with the mood, then names the symptoms', () => {
    expect(moodLogSummary(log({ mood: 4, symptoms: [{ name: 'Headache', severity: 1 }] })))
      .toBe('🙂 Good · Headache');
  });

  it('falls back to the note for an entry that is only a note', () => {
    expect(moodLogSummary(log({ mood: null, note: 'Slept badly' }))).toBe('Slept badly');
  });
});
