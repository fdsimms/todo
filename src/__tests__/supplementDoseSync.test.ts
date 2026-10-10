import type { FoodLogEntry } from '../types';
import { useMedicationStore, setDoseEffects } from '../store/useMedicationStore';
import { installSupplementDoseEffects } from '../utils/supplementDoseSync';
import { supplementDoseIdOf } from '../utils/supplementDose';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

/** Standing in for the food log table and the store that writes it. */
let mockEntries: FoodLogEntry[] = [];
let mockSeq = 0;
const mockAddEntry = jest.fn((draft: any, _opts?: { undoable?: boolean }) => {
  const entry = {
    id: `e${++mockSeq}`,
    dayKey: '2026-09-16',
    atISO: draft.at.toISOString(),
    slot: draft.slot,
    label: draft.label,
    quantity: draft.quantity,
    nutrition: draft.nutrition,
    healthSampleIds: [],
  } as unknown as FoodLogEntry;
  mockEntries.push(entry);
  return entry;
});
const mockRemoveEntry = jest.fn((id: string, _opts?: { undoable?: boolean }) => {
  mockEntries = mockEntries.filter(e => e.id !== id);
});

jest.mock('../store/useFoodLogStore', () => ({
  useFoodLogStore: { getState: () => ({ addEntry: mockAddEntry, removeEntry: mockRemoveEntry }) },
}));

jest.mock('../db/database', () => ({
  dbGetAllMedicationLogs: jest.fn(() => []),
  dbInsertMedicationLog: jest.fn(),
  dbUpdateMedicationLog: jest.fn(),
  dbDeleteMedicationLog: jest.fn(),
  dbDeleteMedicationLogsForTask: jest.fn(),
  dbGetSetting: jest.fn(() => null),
  dbSetSetting: jest.fn(),
  dbGetFoodLogEntries: jest.fn(() => mockEntries),
}));

jest.mock('../utils/dateUtils', () => ({
  dayKeyOf: jest.fn((d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }),
  getCurrentDayStart: jest.fn(() => new Date(2026, 8, 16)),
  getDayStart: jest.fn((d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())),
  getLogicalDayKey: jest.fn(() => '2026-09-16'),
}));

const state = () => useMedicationStore.getState();

const panel = {
  servingAmount: 2,
  servingUnit: 'tablet',
  amounts: { vitaminCMg: 90, magnesiumMg: 100 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEntries = [];
  mockSeq = 0;
  useMedicationStore.setState({ logs: [], archived: [], settings: {}, initialized: false });
  installSupplementDoseEffects();
});

afterAll(() => setDoseEffects(null));

describe('a dose of a supplement with a panel', () => {
  it('writes one food log entry, scaled to the dose, never undoable on its own', () => {
    state().setSupplementPanel('Multivitamin', panel);
    const log = state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet' })!;
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    const [draft, opts] = mockAddEntry.mock.calls[0];
    expect(opts).toEqual({ undoable: false });
    expect(draft.nutrition.amounts).toEqual({ vitaminCMg: 45, magnesiumMg: 50 });
    expect(draft.slot).toBeNull();
    expect(draft.at.toISOString()).toBe(log.takenAt);
    expect(supplementDoseIdOf(mockEntries[0])).toBe(log.id);
  });

  it('finds the panel by name however it is spelled', () => {
    state().setSupplementPanel('Multivitamin', panel);
    state().addLog({ name: '  multivitamin ', amount: 2, unit: 'tablet' });
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a medication with no panel', () => {
    state().addLog({ name: 'Ibuprofen', amount: 400, unit: 'mg' });
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('does not reach back to doses recorded before the panel existed', () => {
    state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet' });
    state().setSupplementPanel('Multivitamin', panel);
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('replaces the entry when the dose amount is corrected', () => {
    state().setSupplementPanel('Multivitamin', panel);
    const log = state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet' })!;
    state().updateLog(log.id, { amount: 2 });
    expect(mockRemoveEntry).toHaveBeenCalledTimes(1);
    expect(mockEntries).toHaveLength(1);
    expect(mockEntries[0].nutrition.amounts).toEqual({ vitaminCMg: 90, magnesiumMg: 100 });
  });

  it('leaves the entry alone when only the note changes', () => {
    state().setSupplementPanel('Multivitamin', panel);
    const log = state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet' })!;
    mockAddEntry.mockClear();
    state().updateLog(log.id, { note: 'with food' });
    expect(mockRemoveEntry).not.toHaveBeenCalled();
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('does not conjure an entry when an older dose is edited', () => {
    const log = state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet' })!;
    state().setSupplementPanel('Multivitamin', panel);
    state().updateLog(log.id, { amount: 2 });
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('takes its entry away with the dose', () => {
    state().setSupplementPanel('Multivitamin', panel);
    const log = state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet' })!;
    state().removeLog(log.id);
    expect(mockEntries).toHaveLength(0);
    expect(mockRemoveEntry.mock.calls[0][1]).toEqual({ undoable: false });
  });

  it('takes the entries away with a task\'s doses', () => {
    state().setSupplementPanel('Multivitamin', panel);
    state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet', taskId: 't1' });
    state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet', taskId: 't1' });
    state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet', taskId: 't2' });
    state().removeLogsForTask('t1');
    expect(mockEntries).toHaveLength(1);
  });

  it('clears the panel when told to, and records plain doses afterwards', () => {
    state().setSupplementPanel('Multivitamin', panel);
    state().setSupplementPanel('Multivitamin', null);
    state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet' });
    expect(mockAddEntry).not.toHaveBeenCalled();
    expect(state().settings).toEqual({});
  });

  it('still records the dose when the food log write throws', () => {
    state().setSupplementPanel('Multivitamin', panel);
    mockAddEntry.mockImplementationOnce(() => { throw new Error('disk full'); });
    const log = state().addLog({ name: 'Multivitamin', amount: 1, unit: 'tablet' });
    expect(log).not.toBeNull();
    expect(state().logs).toHaveLength(1);
  });
});
