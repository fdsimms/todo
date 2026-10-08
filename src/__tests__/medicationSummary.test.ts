import type { MedicationLog, Milestone, Task } from '../types';
import {
  buildMedicationSummary,
  describeRange,
  missedCountsByMedication,
  rangeDays,
  sectionLines,
  summaryCandidates,
  summaryHtml,
  summaryRange,
  summaryText,
  type SummaryOptions,
  type SummaryRange,
} from '../utils/medicationSummary';
import type { MedicationSettingsMap } from '../utils/medicationSettings';

let seq = 0;

function dose(dayKey: string, overrides: Partial<MedicationLog> = {}, hour = 9): MedicationLog {
  seq++;
  return {
    id: `d-${seq}`,
    name: 'Ibuprofen',
    takenAt: new Date(`${dayKey}T${String(hour).padStart(2, '0')}:00`).toISOString(),
    dayKey,
    amount: 400,
    unit: 'mg',
    asNeeded: true,
    taskId: null,
    note: null,
    ...overrides,
  };
}

const range: SummaryRange = { startKey: '2026-09-01', endKey: '2026-09-30' };

function opts(overrides: Partial<SummaryOptions> = {}): SummaryOptions {
  return {
    range,
    keys: ['ibuprofen', 'sertraline'],
    settings: {},
    missed: {},
    includeNotes: true,
    includeTimeOfDay: false,
    milestones: null,
    personName: null,
    preparedAt: new Date('2026-09-30T12:00'),
    ...overrides,
  };
}

describe('summaryRange', () => {
  it('ends today and counts back inclusively', () => {
    expect(summaryRange('30', '2026-10-08')).toEqual({ startKey: '2026-09-09', endKey: '2026-10-08' });
    expect(rangeDays(summaryRange('90', '2026-10-08'))).toBe(90);
  });

  it('starts the day after the last summary, or falls back to 90 days', () => {
    expect(summaryRange('sinceLast', '2026-10-08', { lastSummaryDayKey: '2026-09-20' }))
      .toEqual({ startKey: '2026-09-21', endKey: '2026-10-08' });
    expect(rangeDays(summaryRange('sinceLast', '2026-10-08', { lastSummaryDayKey: null }))).toBe(90);
  });

  it('takes a custom range as given, swapping one that arrived backwards', () => {
    expect(summaryRange('custom', '2026-10-08', { custom: { startKey: '2026-09-10', endKey: '2026-09-01' } }))
      .toEqual({ startKey: '2026-09-01', endKey: '2026-09-10' });
  });

  it('describes a range in words', () => {
    expect(describeRange(range)).toBe('Sep 1 to Sep 30, 2026 (30 days)');
  });
});

describe('summaryCandidates', () => {
  it('lists medications with doses in the range, most first, flagging archived ones', () => {
    const logs = [
      dose('2026-09-02'), dose('2026-09-03'),
      dose('2026-09-04', { name: 'Amoxicillin' }),
      dose('2026-08-20', { name: 'Old' }),
    ];
    expect(summaryCandidates(logs, ['amoxicillin'], range)).toEqual([
      { key: 'ibuprofen', name: 'Ibuprofen', doses: 2, archived: false },
      { key: 'amoxicillin', name: 'Amoxicillin', doses: 1, archived: true },
    ]);
  });
});

describe('missedCountsByMedication', () => {
  it('counts missed occurrences of medication tasks in the range', () => {
    const base = { medicationName: 'Sertraline', medicationAmount: 50, medicationUnit: 'mg', chainItems: [], chainIndex: 0 };
    const tasks = [
      { ...base, missedAt: new Date('2026-09-05T10:00').toISOString() },
      { ...base, missedAt: new Date('2026-09-06T10:00').toISOString() },
      { ...base, missedAt: new Date('2026-08-06T10:00').toISOString() },
      { ...base, missedAt: null },
      { ...base, medicationName: null, missedAt: new Date('2026-09-06T10:00').toISOString() },
    ] as unknown as Task[];
    expect(missedCountsByMedication(tasks, range)).toEqual({ sertraline: 2 });
  });
});

describe('buildMedicationSummary', () => {
  it('only counts chosen medications inside the range', () => {
    const logs = [
      dose('2026-09-02'), dose('2026-08-30'),
      dose('2026-09-03', { name: 'Paracetamol' }),
    ];
    const summary = buildMedicationSummary(logs, opts());
    expect(summary.sections.map(s => s.name)).toEqual(['Ibuprofen']);
    expect(summary.sections[0].doses).toBe(1);
  });

  it('gives an as-needed medicine a breakdown, never a usual dose', () => {
    const logs = [
      dose('2026-09-02'), dose('2026-09-02', {}, 15), dose('2026-09-02', {}, 21),
      dose('2026-09-10', { amount: 200 }),
    ];
    const section = buildMedicationSummary(logs, opts()).sections[0];
    expect(section.asNeeded).toBe(true);
    expect(section.amounts).toEqual([{ dose: '400 mg', count: 3 }, { dose: '200 mg', count: 1 }]);
    expect(section.timeline).toBeNull();
    expect(section.maxInOneDay).toEqual({ count: 3, dayKey: '2026-09-02' });
    const lines = sectionLines(section, range);
    expect(lines.find(l => l.label === 'Amounts')!.value).toBe('400 mg ×3, 200 mg ×1');
    expect(lines.find(l => l.label === 'Recorded')!.value).toBe('4 doses on 2 days');
  });

  it('shows a scheduled dose change as a timeline', () => {
    const sched = { name: 'Sertraline', asNeeded: false, taskId: 't', unit: 'mg' };
    const logs = [
      dose('2026-09-01', { ...sched, amount: 50 }),
      dose('2026-09-02', { ...sched, amount: 50 }),
      dose('2026-09-03', { ...sched, amount: 100 }),
      dose('2026-09-04', { ...sched, amount: 100 }),
    ];
    const section = buildMedicationSummary(logs, opts({ missed: { sertraline: 2 } })).sections[0];
    expect(section.timeline).toEqual([
      { dose: '50 mg', fromKey: '2026-09-01', toKey: '2026-09-02' },
      { dose: '100 mg', fromKey: '2026-09-03', toKey: '2026-09-04' },
    ]);
    const lines = sectionLines(section, range);
    expect(lines.find(l => l.label === 'Amounts')!.value).toBe('50 mg (Sep 1 to Sep 2), then 100 mg (Sep 3 to Sep 4)');
    expect(lines.find(l => l.label === 'Recorded')!.value).toBe('4 times, marked missed 2 times');
  });

  it('falls back to a breakdown when a scheduled dose changes too often', () => {
    const sched = { name: 'Sertraline', asNeeded: false, unit: 'mg' };
    const logs = [50, 100, 50, 100, 50].map((amount, i) => dose(`2026-09-0${i + 1}`, { ...sched, amount }));
    const section = buildMedicationSummary(logs, opts()).sections[0];
    expect(section.timeline).toBeNull();
    expect(section.amounts).toEqual([{ dose: '50 mg', count: 3 }, { dose: '100 mg', count: 2 }]);
  });

  it('says when no amount was ever stated', () => {
    const logs = [dose('2026-09-02', { amount: null, unit: null })];
    const section = buildMedicationSummary(logs, opts()).sections[0];
    expect(sectionLines(section, range).find(l => l.label === 'Amounts')!.value).toBe('Not stated');
  });

  it('buckets as-needed doses by week for a short range', () => {
    const logs = [dose('2026-09-01'), dose('2026-09-08'), dose('2026-09-09'), dose('2026-09-30')];
    const section = buildMedicationSummary(logs, opts()).sections[0];
    expect(section.bucketDays).toBe(7);
    expect(section.buckets!.map(b => b.count)).toEqual([1, 2, 0, 0, 1]);
  });

  it('reports the limit you set and only the breaches since it was set', () => {
    const settings: MedicationSettingsMap = {
      ibuprofen: {
        limit: { minHours: 6, maxPer24h: null, notify: false, since: new Date('2026-09-10T00:00').toISOString() },
        supply: null,
      },
    };
    const logs = [
      dose('2026-09-05', {}, 9), dose('2026-09-05', {}, 10),
      dose('2026-09-14', {}, 9), dose('2026-09-14', {}, 11),
    ];
    const section = buildMedicationSummary(logs, opts({ settings })).sections[0];
    expect(section.breachDays).toEqual(['2026-09-14']);
    const lines = sectionLines(section, range);
    expect(lines.find(l => l.label === 'Limit you set')!.value).toBe('At least 6 hours apart (set Sep 10)');
    expect(lines.find(l => l.label === 'Sooner than that')!.value).toBe('1 day (Sep 14)');
  });

  it('does not claim "Never" for a limit set after the range ended', () => {
    const settings: MedicationSettingsMap = {
      ibuprofen: {
        limit: { minHours: 6, maxPer24h: null, notify: false, since: new Date('2026-10-05T00:00').toISOString() },
        supply: null,
      },
    };
    const section = buildMedicationSummary([dose('2026-09-05')], opts({ settings })).sections[0];
    expect(sectionLines(section, range).some(l => l.label === 'Sooner than that')).toBe(false);
  });

  it('includes time of day only when asked', () => {
    const logs = [dose('2026-09-02', {}, 8), dose('2026-09-03', {}, 14), dose('2026-09-04', {}, 15), dose('2026-09-05', {}, 2)];
    expect(buildMedicationSummary(logs, opts()).sections[0].timeOfDay).toBeNull();
    expect(buildMedicationSummary(logs, opts({ includeTimeOfDay: true })).sections[0].timeOfDay).toEqual([
      { label: 'Morning', count: 1 },
      { label: 'Afternoon', count: 2 },
      { label: 'Night', count: 1 },
    ]);
  });

  it('includes notes and milestones only when asked', () => {
    const logs = [dose('2026-09-02', { note: ' migraine ' })];
    const milestones: Milestone[] = [
      { id: 'm1', label: 'New job', date: new Date('2026-09-15T12:00').toISOString(), createdAt: '' },
      { id: 'm2', label: 'Earlier', date: new Date('2026-08-15T12:00').toISOString(), createdAt: '' },
    ];
    const withAll = buildMedicationSummary(logs, opts({ milestones }));
    expect(withAll.notes).toEqual([{ dayKey: '2026-09-02', name: 'Ibuprofen', note: 'migraine' }]);
    expect(withAll.milestones).toEqual([{ dayKey: '2026-09-15', label: 'New job' }]);
    const without = buildMedicationSummary(logs, opts({ includeNotes: false }));
    expect(without.notes).toBeNull();
    expect(without.milestones).toBeNull();
  });
});

describe('renderings', () => {
  const logs = [
    dose('2026-09-02', { note: '<b>bad</b> & worse' }),
    dose('2026-09-08'),
  ];
  const summary = buildMedicationSummary(logs, opts({ personName: ' Alex ' }));

  it('text says what it covers and how it was recorded', () => {
    const text = summaryText(summary);
    expect(text).toContain('Medication summary\nAlex\nSep 1 to Sep 30, 2026 (30 days)');
    expect(text).toContain('IBUPROFEN (as needed)');
    expect(text).toContain('Doses per week: 1, 1, 0, 0, 0');
    expect(text).toContain('Not a prescription.');
  });

  it('html escapes what the user typed', () => {
    const html = summaryHtml(summary);
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt; &amp; worse');
    expect(html).not.toContain('<b>bad</b>');
  });

  it('html says so when nothing was chosen', () => {
    const empty = buildMedicationSummary(logs, opts({ keys: [] }));
    expect(summaryHtml(empty)).toContain('No doses recorded');
  });
});
