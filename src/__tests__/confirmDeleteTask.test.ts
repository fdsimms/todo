import type { Task } from '../types';

const mockAlert = jest.fn();
const mockConfirmDelete = jest.fn();
const mockConfirmDeleteGenerated = jest.fn();
const mockDeleteTask = jest.fn();
const mockDeleteSeries = jest.fn();
const mockMarkMissed = jest.fn();
let mockSeriesRows: Partial<Task>[] = [];
let mockMealPlan = false;
let mockOneOff = false;
let mockStoppable = false;

jest.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock('../utils/haptics', () => ({ haptics: { success: jest.fn() } }));
jest.mock('../utils/layoutAnimation', () => ({ animateLayout: jest.fn() }));
jest.mock('../utils/confirmDelete', () => ({ confirmDelete: (...args: unknown[]) => mockConfirmDelete(...args) }));
jest.mock('../utils/confirmDeleteGenerated', () => ({
  confirmDeleteGenerated: (...args: unknown[]) => mockConfirmDeleteGenerated(...args),
}));
jest.mock('../utils/bulkDelete', () => ({ isMissableOneOff: () => mockOneOff }));
jest.mock('../utils/visibilityUtils', () => ({ isMissableMealPlanTask: () => mockMealPlan }));
jest.mock('../utils/generatedTasks', () => ({ stoppableGenerator: () => (mockStoppable ? { label: 'Meals' } : null) }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: {
    getState: () => ({
      deleteTask: mockDeleteTask,
      deleteSeries: mockDeleteSeries,
      markMissed: mockMarkMissed,
      seriesRowsOf: () => mockSeriesRows,
    }),
  },
}));

import { confirmDeleteTask } from '../utils/confirmDeleteTask';

const task = (extra: Partial<Task> = {}) => ({
  id: 't1', title: 'Water plants', recurrenceType: 'none', seriesId: null, generatedKind: null, ...extra,
}) as unknown as Task;

/** The buttons of the one alert shown, by label. */
function buttons(): Record<string, { onPress?: () => void; style?: string }> {
  expect(mockAlert).toHaveBeenCalledTimes(1);
  const list = mockAlert.mock.calls[0][2] as { text: string; onPress?: () => void; style?: string }[];
  return Object.fromEntries(list.map(b => [b.text, b]));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSeriesRows = [];
  mockMealPlan = false;
  mockOneOff = false;
  mockStoppable = false;
});

describe('confirmDeleteTask', () => {
  it('asks a plain task through the one confirm, and runs onDone after the delete', () => {
    const onDone = jest.fn();
    confirmDeleteTask(task(), onDone);
    expect(mockAlert).not.toHaveBeenCalled();
    const { onConfirm } = mockConfirmDelete.mock.calls[0][0];
    expect(onDone).not.toHaveBeenCalled();
    onConfirm();
    expect(mockDeleteTask).toHaveBeenCalledWith('t1');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('offers an open one-off task missed to keep a record, or deleted', () => {
    mockOneOff = true;
    const onDone = jest.fn();
    confirmDeleteTask(task(), onDone);
    expect(mockConfirmDelete).not.toHaveBeenCalled();
    const b = buttons();
    b['Mark missed'].onPress!();
    expect(mockMarkMissed).toHaveBeenCalledWith('t1');
    expect(mockDeleteTask).not.toHaveBeenCalled();
    b['Delete'].onPress!();
    expect(mockDeleteTask).toHaveBeenCalledWith('t1');
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('offers a repeating task missed instead of deleted', () => {
    const onDone = jest.fn();
    confirmDeleteTask(task({ recurrenceType: 'daily' }), onDone);
    const b = buttons();
    b['Mark missed'].onPress!();
    expect(mockMarkMissed).toHaveBeenCalledWith('t1');
    expect(mockDeleteTask).not.toHaveBeenCalled();
    b['Delete and stop repeating'].onPress!();
    expect(mockDeleteTask).toHaveBeenCalledWith('t1');
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('marks a whole meal-plan chain missed, and offers turning the generator off only when it can be', () => {
    mockMealPlan = true;
    confirmDeleteTask(task());
    expect(buttons()['Delete and turn off']).toBeUndefined();
    buttons()['Mark missed'].onPress!();
    expect(mockMarkMissed).toHaveBeenCalledWith('t1', { wholeChain: true });

    mockAlert.mockClear();
    mockStoppable = true;
    confirmDeleteTask(task());
    buttons()['Delete and turn off'].onPress!();
    expect(mockDeleteTask).toHaveBeenCalledWith('t1', { stopGenerator: true });
  });

  it('asks this date or all of them only while more than one date is left', () => {
    mockSeriesRows = [{ completed: false }, { completed: false }, { completed: true }];
    confirmDeleteTask(task({ seriesId: 's1' }));
    buttons()['All dates'].onPress!();
    expect(mockDeleteSeries).toHaveBeenCalledWith('s1');

    mockAlert.mockClear();
    mockSeriesRows = [{ completed: false }, { completed: true }];
    confirmDeleteTask(task({ seriesId: 's1' }));
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockConfirmDelete).toHaveBeenCalledTimes(1);
  });

  it('hands a generated task to the generator prompt, which deletes it itself', () => {
    const onDone = jest.fn();
    const t = task({ generatedKind: 'weather' as Task['generatedKind'] });
    confirmDeleteTask(t, onDone);
    expect(mockConfirmDeleteGenerated).toHaveBeenCalledWith(t, expect.any(Function));
    mockConfirmDeleteGenerated.mock.calls[0][1]();
    expect(mockDeleteTask).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
