import { useMedicationStore } from '../store/useMedicationStore';
import { recordDose, unrecordDose } from '../utils/doseRecording';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Platform: { OS: 'ios' } }));
jest.mock('../utils/notifications', () => ({ requestNotificationPermissions: jest.fn() }));
jest.mock('../utils/okAgainNotification', () => ({ syncOkAgainNotification: jest.fn() }));
jest.mock('../utils/checkInRecording', () => ({ cancelCheckInFor: jest.fn() }));
jest.mock('../utils/permissionAlert', () => ({ alertPermissionOff: jest.fn() }));
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ tasks: [], updateTask: jest.fn(), addTask: jest.fn() }) },
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ use24HourTime: false, dayResetTime: '00:00' }) },
}));
jest.mock('../db/database', () => ({
  dbInsertMedicationLog: jest.fn(),
  dbDeleteMedicationLog: jest.fn(),
  dbUpdateMedicationLog: jest.fn(),
  dbSetSetting: jest.fn(),
  dbGetAllMedicationLogs: jest.fn(() => []),
}));

const state = () => useMedicationStore.getState();

beforeEach(() => {
  useMedicationStore.setState({
    logs: [], archived: [], registered: [], settings: {}, milestoneDismissed: [], initialized: false,
    lastAction: null, undoStack: [], redoStack: [],
  });
});

describe('recordDose and shake-to-undo', () => {
  it('files an undo that takes the dose back, and a redo that puts it back', () => {
    const log = recordDose({ name: 'Ibuprofen', amount: 200, unit: 'mg', asNeeded: true })!;
    expect(state().undoStack).toHaveLength(1);
    expect(state().lastAction?.label).toBe('Recorded Ibuprofen');

    state().undoLastAction();
    expect(state().logs).toHaveLength(0);
    expect(state().undoStack).toHaveLength(0);

    state().redoLastUndone();
    expect(state().logs.map(l => l.id)).toEqual([log.id]);
  });

  it('files nothing for a dose drained from a queue', () => {
    recordDose({ name: 'Ibuprofen', amount: 200, unit: 'mg', asNeeded: true }, { undoable: false });
    expect(state().logs).toHaveLength(1);
    expect(state().undoStack).toHaveLength(0);
  });

  it('a stale shake entry does nothing once the dose is already gone', () => {
    const log = recordDose({ name: 'Ibuprofen', amount: 200, unit: 'mg', asNeeded: true })!;
    unrecordDose(log);
    expect(() => state().undoLastAction()).not.toThrow();
    expect(state().logs).toHaveLength(0);
  });
});
