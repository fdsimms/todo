import { Alert } from 'react-native';
import type { Task } from '../types';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));
const mockBulkSetWhen = jest.fn();
let mockStoreTasks: Task[] = [];
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ tasks: mockStoreTasks, bulkSetWhen: mockBulkSetWhen }) },
}));

import { confirmBulkSetWhen, confirmScheduleMove } from '../utils/scheduleMovePrompt';

const at = (d: number) => new Date(2026, 5, d, 12, 0, 0, 0);
const task = (over: Partial<Task> = {}): Task => ({
  id: 't',
  title: 'Walk',
  dueDate: at(10).toISOString(),
  recurrenceType: 'daily',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceAnchorDay: null,
  recurrenceAnchorDate: null,
  recurrenceFromCompletion: false,
  recurrenceEndDate: null,
  recurrenceCount: null,
  seriesId: null,
  ...over,
} as Task);

const buttons = () =>
  (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreTasks = [];
});

describe('confirmScheduleMove', () => {
  it('goes straight through, keeping the schedule, when nothing is a pull', () => {
    const proceed = jest.fn();
    confirmScheduleMove([task()], at(12), proceed);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(proceed).toHaveBeenCalledWith(false);
  });

  it('puts both next dates on the buttons for one task', () => {
    const proceed = jest.fn();
    confirmScheduleMove([task()], at(9), proceed);
    expect(buttons().map(b => b.text)).toEqual(['Next on Thu, Jun 11', 'Next on Wed, Jun 10', 'Cancel']);
    buttons()[1].onPress!();
    expect(proceed).toHaveBeenCalledWith(true);
  });

  it('does nothing on Cancel', () => {
    const proceed = jest.fn();
    confirmScheduleMove([task()], at(9), proceed);
    buttons()[2].onPress?.();
    expect(proceed).not.toHaveBeenCalled();
  });

  it('asks once for several', () => {
    const proceed = jest.fn();
    confirmScheduleMove([task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c', recurrenceType: 'none' })], at(9), proceed);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toBe('2 of these repeat. Keep their schedules as they are, or count each one from Tue, Jun 9?');
    buttons()[0].onPress!();
    expect(proceed).toHaveBeenCalledWith(false);
  });
});

describe('confirmBulkSetWhen', () => {
  it('passes the answer through to bulkSetWhen and then finishes', () => {
    mockStoreTasks = [task({ id: 'a' })];
    const done = jest.fn();
    confirmBulkSetWhen(['a'], at(9), [], done);
    buttons()[1].onPress!();
    expect(mockBulkSetWhen).toHaveBeenCalledWith(['a'], at(9), [], { restartSchedules: true });
    expect(done).toHaveBeenCalled();
  });

  it('leaves the selection alone on Cancel', () => {
    mockStoreTasks = [task({ id: 'a' })];
    const done = jest.fn();
    confirmBulkSetWhen(['a'], at(9), [], done);
    buttons()[2].onPress?.();
    expect(mockBulkSetWhen).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
});
