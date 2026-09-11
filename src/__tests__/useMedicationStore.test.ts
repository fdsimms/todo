import { useMedicationStore } from '../store/useMedicationStore';
import {
  dbGetAllMedicationLogs,
  dbInsertMedicationLog,
  dbUpdateMedicationLog,
  dbDeleteMedicationLog,
  dbDeleteMedicationLogsForTask,
} from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllMedicationLogs: jest.fn(() => []),
  dbInsertMedicationLog: jest.fn(),
  dbUpdateMedicationLog: jest.fn(),
  dbDeleteMedicationLog: jest.fn(),
  dbDeleteMedicationLogsForTask: jest.fn(),
}));

jest.mock('../utils/dateUtils', () => ({
  dayKeyOf: jest.fn((d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }),
  getCurrentDayStart: jest.fn(() => new Date(2026, 8, 11)),
  getDayStart: jest.fn((d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useMedicationStore.setState({ logs: [], initialized: false });
});

const state = () => useMedicationStore.getState();

describe('initialize', () => {
  it('loads the whole history', () => {
    state().initialize();
    expect(dbGetAllMedicationLogs).toHaveBeenCalled();
    expect(state().initialized).toBe(true);
  });
});

describe('addLog', () => {
  it('records a dose and holds it', () => {
    const log = state().addLog({ name: 'Ibuprofen', amount: 400, unit: 'mg' });
    expect(log).not.toBeNull();
    expect(dbInsertMedicationLog).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ibuprofen', amount: 400, unit: 'mg' }),
    );
    expect(state().logs).toHaveLength(1);
  });

  it('refuses a dose with no name', () => {
    expect(state().addLog({ name: '   ' })).toBeNull();
    expect(dbInsertMedicationLog).not.toHaveBeenCalled();
    expect(state().logs).toHaveLength(0);
  });

  it('trims the name', () => {
    expect(state().addLog({ name: '  Sertraline ' })!.name).toBe('Sertraline');
  });

  it('drops an amount with no unit, and a unit with no amount', () => {
    // Half a dose is unreadable, so it is recorded as no dose rather than as a
    // figure a reader would have to guess at.
    expect(state().addLog({ name: 'A', amount: 2 })).toMatchObject({ amount: null, unit: null });
    expect(state().addLog({ name: 'B', unit: 'mg' })).toMatchObject({ amount: null, unit: null });
  });

  it('keeps a stated zero apart from an unstated amount', () => {
    expect(state().addLog({ name: 'A', amount: 0, unit: 'mg' })!.amount).toBe(0);
    expect(state().addLog({ name: 'B' })!.amount).toBeNull();
  });

  it('defaults to a scheduled dose with no task', () => {
    const log = state().addLog({ name: 'Sertraline' })!;
    expect(log.asNeeded).toBe(false);
    expect(log.taskId).toBeNull();
  });

  it('records an as-needed dose when told', () => {
    expect(state().addLog({ name: 'Ibuprofen', asNeeded: true })!.asNeeded).toBe(true);
  });

  it('stamps the day key from the logical day, not from the instant', () => {
    expect(state().addLog({ name: 'Sertraline' })!.dayKey).toBe('2026-09-11');
  });

  it('stamps a backdated dose against the day it happened on', () => {
    const log = state().addLog({ name: 'Ibuprofen', at: new Date(2026, 8, 4, 23, 30) })!;
    expect(log.dayKey).toBe('2026-09-04');
  });

  it('keeps the list newest first', () => {
    state().addLog({ name: 'First' });
    state().addLog({ name: 'Second' });
    expect(state().logs.map(l => l.name)).toEqual(['Second', 'First']);
  });

  it('keeps the task it came from as provenance', () => {
    expect(state().addLog({ name: 'Sertraline', taskId: 'task-1' })!.taskId).toBe('task-1');
  });

  it('drops a blank note to null rather than storing an empty string', () => {
    expect(state().addLog({ name: 'A', note: '   ' })!.note).toBeNull();
  });
});

describe('updateLog', () => {
  it('edits what was recorded', () => {
    const log = state().addLog({ name: 'Ibuprofen' })!;
    state().updateLog(log.id, { amount: 200, unit: 'mg' });
    expect(dbUpdateMedicationLog).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 200, unit: 'mg' }),
    );
  });

  it('refuses to blank the name', () => {
    const log = state().addLog({ name: 'Ibuprofen' })!;
    state().updateLog(log.id, { name: '  ' });
    expect(dbUpdateMedicationLog).not.toHaveBeenCalled();
    expect(state().logs[0].name).toBe('Ibuprofen');
  });

  it('re-pairs the amount and unit when only one is edited away', () => {
    const log = state().addLog({ name: 'Ibuprofen', amount: 400, unit: 'mg' })!;
    state().updateLog(log.id, { unit: null });
    expect(state().logs[0]).toMatchObject({ amount: null, unit: null });
  });

  it('does nothing for an id that is not there', () => {
    state().updateLog('missing', { name: 'X' });
    expect(dbUpdateMedicationLog).not.toHaveBeenCalled();
  });

  it('cannot move the day an entry counts toward', () => {
    // Not expressible through MedicationLogPatch by design — correcting what a
    // dose says must not rewrite which day every window counts it in.
    const log = state().addLog({ name: 'Ibuprofen' })!;
    const before = log.dayKey;
    state().updateLog(log.id, { name: 'Ibuprofen 400' });
    expect(state().logs[0].dayKey).toBe(before);
    expect(state().logs[0].takenAt).toBe(log.takenAt);
  });
});

describe('removeLog', () => {
  it('drops one dose', () => {
    const log = state().addLog({ name: 'Ibuprofen' })!;
    state().removeLog(log.id);
    expect(dbDeleteMedicationLog).toHaveBeenCalledWith(log.id);
    expect(state().logs).toHaveLength(0);
  });
});

describe('removeLogsForTask', () => {
  it('drops every dose a task recorded and leaves the rest', () => {
    state().addLog({ name: 'Sertraline', taskId: 'task-1' });
    state().addLog({ name: 'Sertraline', taskId: 'task-1' });
    state().addLog({ name: 'Ibuprofen', asNeeded: true });
    state().removeLogsForTask('task-1');
    expect(dbDeleteMedicationLogsForTask).toHaveBeenCalledWith('task-1');
    expect(state().logs.map(l => l.name)).toEqual(['Ibuprofen']);
  });

  it('does nothing for a task that recorded none', () => {
    state().addLog({ name: 'Ibuprofen', asNeeded: true });
    state().removeLogsForTask('task-9');
    expect(state().logs).toHaveLength(1);
  });
});

describe('removeLatestLogForTask', () => {
  it('takes back only the most recent dose', () => {
    // Undoing one unit of a daily target: the day's earlier doses were still
    // taken and must survive it.
    state().addLog({ name: 'Sertraline', taskId: 'task-1', at: new Date(2026, 8, 11, 8) });
    state().addLog({ name: 'Sertraline', taskId: 'task-1', at: new Date(2026, 8, 11, 13) });
    state().addLog({ name: 'Sertraline', taskId: 'task-1', at: new Date(2026, 8, 11, 20) });
    state().removeLatestLogForTask('task-1');
    expect(state().logs).toHaveLength(2);
    expect(state().logs.every(l => l.takenAt < new Date(2026, 8, 11, 20).toISOString())).toBe(true);
  });

  it('does nothing for a task that recorded none', () => {
    state().addLog({ name: 'Ibuprofen', asNeeded: true });
    state().removeLatestLogForTask('task-9');
    expect(state().logs).toHaveLength(1);
  });
});
