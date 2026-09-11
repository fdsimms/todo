import type { MedicationLog } from '../types';
import {
  MEDICATION_EXPORT_COLUMNS,
  medicationExportCsv,
  medicationExportFileName,
  medicationExportSummary,
} from '../utils/medicationExport';

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

const lines = (csv: string) => csv.trimEnd().split('\n');

describe('medicationExportCsv', () => {
  it('leads with the header row', () => {
    expect(lines(medicationExportCsv([]))[0]).toBe(MEDICATION_EXPORT_COLUMNS.join(','));
  });

  it('writes one row per dose, oldest first', () => {
    // A record is read forwards, unlike every list in the app.
    const csv = medicationExportCsv([
      dose({ name: 'Later', dayKey: '2026-09-11' }),
      dose({ name: 'Earlier', dayKey: '2026-09-01' }),
    ]);
    const [, first, second] = lines(csv);
    expect(first).toContain('Earlier');
    expect(second).toContain('Later');
  });

  it('keeps the amount and its unit in separate columns', () => {
    // "400 mg" in one cell cannot be summed or charted.
    const csv = medicationExportCsv([dose({ amount: 400, unit: 'mg' })]);
    expect(lines(csv)[1]).toBe('2026-09-11,2026-09-11T09:00:00.000Z,Ibuprofen,400,mg,no,');
  });

  it('leaves both blank when no amount was stated', () => {
    expect(lines(medicationExportCsv([dose()]))[1])
      .toBe('2026-09-11,2026-09-11T09:00:00.000Z,Ibuprofen,,,no,');
  });

  it('says in words whether a dose was taken as needed', () => {
    expect(lines(medicationExportCsv([dose({ asNeeded: true })]))[1]).toContain(',yes,');
  });

  it('does not export the task that recorded it', () => {
    // Provenance, meaningless outside this database, and "as needed" already
    // says the thing it would imply.
    const csv = medicationExportCsv([dose({ taskId: 'task-abc' })]);
    expect(csv).not.toContain('task-abc');
  });

  it('exports nothing derived', () => {
    // No totals, no trend, and above all no "usually 400 mg": a mode over a
    // history reads as a prescription once it is a spreadsheet cell.
    const csv = medicationExportCsv([
      dose({ amount: 400, unit: 'mg' }),
      dose({ amount: 400, unit: 'mg' }),
      dose({ amount: 200, unit: 'mg' }),
    ]);
    expect(csv.toLowerCase()).not.toContain('usually');
    expect(lines(csv)).toHaveLength(4); // header + three doses, nothing summarised
  });

  it('quotes a note containing a comma', () => {
    const csv = medicationExportCsv([dose({ note: 'Took it with food, felt fine' })]);
    expect(lines(csv)[1]).toContain('"Took it with food, felt fine"');
  });

  it('quotes and escapes a medication name containing a quote', () => {
    const csv = medicationExportCsv([dose({ name: 'The "good" one' })]);
    expect(lines(csv)[1]).toContain('"The ""good"" one"');
  });

  it('ends with a newline', () => {
    // A spreadsheet importing a file without one drops the last row.
    expect(medicationExportCsv([dose()]).endsWith('\n')).toBe(true);
  });

  it('carries both the logical day and the real instant', () => {
    // They differ by one for anybody whose day does not start at midnight.
    const csv = medicationExportCsv([
      dose({ dayKey: '2026-09-10', takenAt: '2026-09-11T01:30:00.000Z' }),
    ]);
    expect(lines(csv)[1]).toContain('2026-09-10');
    expect(lines(csv)[1]).toContain('2026-09-11T01:30:00.000Z');
  });
});

describe('medicationExportFileName', () => {
  it('is dated so two exports never collide', () => {
    expect(medicationExportFileName(new Date(2026, 8, 11)))
      .toBe('medication-log-2026-09-11.csv');
  });
});

describe('medicationExportSummary', () => {
  it('says how many doses, of how many medications, over what span', () => {
    const summary = medicationExportSummary([
      dose({ name: 'Ibuprofen', dayKey: '2026-08-12' }),
      dose({ name: 'Sertraline', dayKey: '2026-09-11' }),
      dose({ name: 'Sertraline', dayKey: '2026-09-10' }),
    ]);
    expect(summary).toBe('3 doses of 2 medications from Aug 12, 2026 to Sep 11, 2026.');
  });

  it('collapses two spellings of one medication', () => {
    const summary = medicationExportSummary([
      dose({ name: 'Ibuprofen' }),
      dose({ name: 'ibuprofen' }),
    ]);
    expect(summary).toContain('1 medication');
  });

  it('names a single day once rather than as a range', () => {
    expect(medicationExportSummary([dose({ dayKey: '2026-09-11' })]))
      .toBe('1 dose of 1 medication from Sep 11, 2026.');
  });

  it('says so when there is nothing to share', () => {
    expect(medicationExportSummary([])).toBe('Nothing recorded yet.');
  });
});
