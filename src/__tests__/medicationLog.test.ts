import type { MedicationLog } from '../types';
import {
  DOSE_UNITS,
  MIN_TREND_DOSES,
  doseCountInWindow,
  dosesOnDay,
  formatDose,
  frequencyTrend,
  hasDoseOnDay,
  isAsNeededMedication,
  logsOnDay,
  medicationKey,
  medicationLogSummary,
  medicationStats,
  medicationVocabulary,
} from '../utils/medicationLog';

let seq = 0;

function dose(overrides: Partial<MedicationLog> = {}): MedicationLog {
  seq++;
  const dayKey = overrides.dayKey ?? '2026-09-11';
  return {
    id: `dose-${seq}`,
    name: 'Ibuprofen',
    takenAt: `${dayKey}T09:00:00.000Z`,
    dayKey,
    amount: null,
    unit: null,
    asNeeded: false,
    taskId: null,
    note: null,
    ...overrides,
  };
}

describe('medicationKey', () => {
  it('folds case and surrounding space', () => {
    expect(medicationKey('  Ibuprofen ')).toBe('ibuprofen');
    expect(medicationKey('IBUPROFEN')).toBe(medicationKey('ibuprofen'));
  });

  it('refuses to fold two strengths of one medicine together', () => {
    // The whole point of the no-fuzzy-matching rule: these are different doses
    // and treating them as one medicine would misstate a record.
    expect(medicationKey('Ibuprofen 200')).not.toBe(medicationKey('Ibuprofen 400'));
  });

  it('does not de-pluralise or stem', () => {
    expect(medicationKey('vitamin')).not.toBe(medicationKey('vitamins'));
  });
});

describe('medicationVocabulary', () => {
  it('ranks most-logged first, then alphabetically', () => {
    const logs = [
      dose({ name: 'Sertraline' }),
      dose({ name: 'Ibuprofen' }),
      dose({ name: 'Ibuprofen' }),
      dose({ name: 'Antihistamine' }),
    ];
    expect(medicationVocabulary(logs)).toEqual(['Ibuprofen', 'Antihistamine', 'Sertraline']);
  });

  it('collapses spellings onto one entry', () => {
    const logs = [dose({ name: 'Ibuprofen' }), dose({ name: 'ibuprofen' })];
    expect(medicationVocabulary(logs)).toEqual(['Ibuprofen']);
  });

  it('ignores a blank name rather than producing an empty pill', () => {
    expect(medicationVocabulary([dose({ name: '   ' })])).toEqual([]);
  });
});

describe('day reads', () => {
  const logs = [
    dose({ dayKey: '2026-09-11', takenAt: '2026-09-11T20:00:00.000Z' }),
    dose({ dayKey: '2026-09-11', takenAt: '2026-09-11T08:00:00.000Z' }),
    dose({ dayKey: '2026-09-10' }),
    dose({ dayKey: '2026-09-11', name: 'Sertraline' }),
  ];

  it('reads a day oldest first', () => {
    const day = logsOnDay(logs, '2026-09-11');
    expect(day).toHaveLength(3);
    expect(day[0].takenAt < day[1].takenAt).toBe(true);
  });

  it('counts doses of one medicine on a day', () => {
    expect(dosesOnDay(logs, '2026-09-11', 'ibuprofen')).toBe(2);
    expect(dosesOnDay(logs, '2026-09-11', 'sertraline')).toBe(1);
    expect(dosesOnDay(logs, '2026-09-09', 'ibuprofen')).toBe(0);
  });

  it('answers whether something was taken at all on a day', () => {
    expect(hasDoseOnDay(logs, '2026-09-10', 'ibuprofen')).toBe(true);
    expect(hasDoseOnDay(logs, '2026-09-10', 'sertraline')).toBe(false);
  });
});

describe('formatDose', () => {
  it('pluralises a countable unit and leaves a measure alone', () => {
    expect(formatDose(dose({ amount: 2, unit: 'tablet' }))).toBe('2 tablets');
    expect(formatDose(dose({ amount: 1, unit: 'tablet' }))).toBe('1 tablet');
    expect(formatDose(dose({ amount: 200, unit: 'mg' }))).toBe('200 mg');
  });

  it('is null when no amount was stated', () => {
    expect(formatDose(dose())).toBeNull();
    expect(formatDose(dose({ amount: 2, unit: null }))).toBeNull();
    expect(formatDose(dose({ amount: null, unit: 'mg' }))).toBeNull();
  });

  it('renders a zero rather than treating it as absent', () => {
    // 0 and null are different in the schema and must stay different here.
    expect(formatDose(dose({ amount: 0, unit: 'mg' }))).toBe('0 mg');
  });

  it('has a plural for every countable unit it offers', () => {
    for (const unit of DOSE_UNITS) {
      const formatted = formatDose(dose({ amount: 3, unit: unit.value }));
      expect(formatted).toBe(`3 ${unit.plural ?? unit.value}`);
    }
  });
});

describe('medicationLogSummary', () => {
  it('leads with the name and adds the dose where there is one', () => {
    expect(medicationLogSummary(dose({ name: 'Ibuprofen', amount: 400, unit: 'mg' })))
      .toBe('Ibuprofen · 400 mg');
  });

  it('says when a dose was taken as needed', () => {
    expect(medicationLogSummary(dose({ name: 'Ibuprofen', asNeeded: true })))
      .toBe('Ibuprofen · as needed');
  });

  it('is just the name when nothing else was recorded', () => {
    expect(medicationLogSummary(dose({ name: 'Sertraline' }))).toBe('Sertraline');
  });
});

describe('isAsNeededMedication', () => {
  it('is true when any dose said so', () => {
    const logs = [
      dose({ name: 'Ibuprofen', asNeeded: false }),
      dose({ name: 'Ibuprofen', asNeeded: true }),
    ];
    expect(isAsNeededMedication(logs, 'ibuprofen')).toBe(true);
  });

  it('is false for a medicine only ever taken on schedule', () => {
    expect(isAsNeededMedication([dose({ name: 'Sertraline' })], 'sertraline')).toBe(false);
  });
});

describe('medicationStats', () => {
  it('counts doses and days separately', () => {
    const logs = [
      dose({ dayKey: '2026-09-11' }),
      dose({ dayKey: '2026-09-11' }),
      dose({ dayKey: '2026-09-10' }),
    ];
    const [stat] = medicationStats(logs);
    expect(stat.doses).toBe(3);
    expect(stat.days).toBe(2);
  });

  it('has no minimum — one dose still gets a row', () => {
    // Tallies have no threshold; only comparisons do.
    expect(medicationStats([dose()])).toHaveLength(1);
  });

  it('reports the most common dose as typical', () => {
    const logs = [
      dose({ amount: 400, unit: 'mg' }),
      dose({ amount: 400, unit: 'mg' }),
      dose({ amount: 200, unit: 'mg' }),
    ];
    expect(medicationStats(logs)[0].typicalDose).toBe('400 mg');
  });

  it('has a null typical dose when no amount was ever stated', () => {
    expect(medicationStats([dose(), dose()])[0].typicalDose).toBeNull();
  });

  it('labels by the most recent spelling', () => {
    const logs = [
      dose({ name: 'ibuprofen', takenAt: '2026-09-01T09:00:00.000Z' }),
      dose({ name: 'Ibuprofen', takenAt: '2026-09-11T09:00:00.000Z' }),
    ];
    expect(medicationStats(logs)[0].name).toBe('Ibuprofen');
  });

  it('sorts most recently taken first', () => {
    const logs = [
      dose({ name: 'Sertraline', takenAt: '2026-09-01T09:00:00.000Z' }),
      dose({ name: 'Ibuprofen', takenAt: '2026-09-11T09:00:00.000Z' }),
    ];
    expect(medicationStats(logs).map(s => s.name)).toEqual(['Ibuprofen', 'Sertraline']);
  });
});

describe('doseCountInWindow', () => {
  it('counts the window inclusive of its last day', () => {
    const logs = [
      dose({ dayKey: '2026-09-11' }),
      dose({ dayKey: '2026-09-05' }),
      dose({ dayKey: '2026-09-04' }),
    ];
    // 7 days ending 2026-09-11 covers 09-05..09-11.
    expect(doseCountInWindow(logs, 'ibuprofen', '2026-09-11', 7)).toBe(2);
  });
});

describe('frequencyTrend', () => {
  // A log running since 2026-08-01 so both windows are covered.
  const anchor = dose({ name: 'Ibuprofen', dayKey: '2026-08-01' });

  it('compares the recent window against the one before it', () => {
    const logs = [
      anchor,
      dose({ dayKey: '2026-09-11' }),
      dose({ dayKey: '2026-09-10' }),
      dose({ dayKey: '2026-09-09' }),
      dose({ dayKey: '2026-09-01' }),
    ];
    const trend = frequencyTrend(logs, 'ibuprofen', '2026-09-11', 7);
    expect(trend).toEqual({ recent: 3, previous: 1, days: 7 });
  });

  it('refuses when the log had not started for the earlier window', () => {
    // Every dose is inside the recent window; the earlier one is empty because
    // the log did not exist, not because nothing was taken.
    const logs = [
      dose({ dayKey: '2026-09-11' }),
      dose({ dayKey: '2026-09-10' }),
      dose({ dayKey: '2026-09-09' }),
      dose({ dayKey: '2026-09-08' }),
    ];
    expect(frequencyTrend(logs, 'ibuprofen', '2026-09-11', 7)).toBeNull();
  });

  it('refuses below the dose floor', () => {
    const logs = [anchor, dose({ dayKey: '2026-09-11' })];
    expect(frequencyTrend(logs, 'ibuprofen', '2026-09-11', 7)).toBeNull();
  });

  it('draws once the floor is met', () => {
    const logs = [
      anchor,
      dose({ dayKey: '2026-09-11' }),
      dose({ dayKey: '2026-09-10' }),
      dose({ dayKey: '2026-09-03' }),
      dose({ dayKey: '2026-09-02' }),
    ];
    const trend = frequencyTrend(logs, 'ibuprofen', '2026-09-11', 7);
    expect(trend).not.toBeNull();
    expect(trend!.recent + trend!.previous).toBe(MIN_TREND_DOSES);
  });

  it('is null for an empty log', () => {
    expect(frequencyTrend([], 'ibuprofen', '2026-09-11', 7)).toBeNull();
  });

  it('counts a fall as readily as a rise', () => {
    const logs = [
      anchor,
      dose({ dayKey: '2026-09-01' }),
      dose({ dayKey: '2026-09-02' }),
      dose({ dayKey: '2026-09-03' }),
      dose({ dayKey: '2026-09-11' }),
    ];
    const trend = frequencyTrend(logs, 'ibuprofen', '2026-09-11', 7);
    expect(trend).toEqual({ recent: 1, previous: 3, days: 7 });
  });
});
