import { completionLogChips } from '../utils/completionLogChip';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', vacationMode: false }) },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: jest.fn(() => ({ categories: [], getCategoryByName: jest.fn().mockReturnValue(null) })) },
}));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Take a pill',
    completed: false,
    parentId: null,
    chainEnabled: false,
    chainItems: [],
    chainIndex: 0,
    generatedKind: null,
    generatedSourceId: null,
    medicationName: null,
    medicationAmount: null,
    medicationUnit: null,
    logMealSlot: null,
    logSavedMealId: null,
    ...overrides,
  } as unknown as Task;
}

describe('completionLogChips', () => {
  it('says nothing for a task that logs nothing', () => {
    expect(completionLogChips(task(), true)).toEqual([]);
  });

  it('names a dose with its amount and unit', () => {
    const t = task({ medicationName: 'Sodium Chloride', medicationAmount: 1, medicationUnit: 'tablet' });
    expect(completionLogChips(t, true)).toEqual([{ kind: 'dose', text: 'Logs 1 tablet' }]);
  });

  it('pluralizes a counted unit', () => {
    const t = task({ medicationName: 'Iron', medicationAmount: 2, medicationUnit: 'capsule' });
    expect(completionLogChips(t, true)[0].text).toBe('Logs 2 capsules');
  });

  it('says "Logs dose" when no amount is set', () => {
    expect(completionLogChips(task({ medicationName: 'Iron' }), true)).toEqual([{ kind: 'dose', text: 'Logs dose' }]);
  });

  it('counts several medicines', () => {
    const t = task({
      medicationName: 'Iron',
      medicationExtras: [{ name: 'Vitamin C', amount: null, unit: null }],
    });
    expect(completionLogChips(t, true)).toEqual([{ kind: 'dose', text: 'Logs 2 doses' }]);
  });

  it('says a saved meal is logged by the tick', () => {
    const t = task({ logMealSlot: 'breakfast', logSavedMealId: 'm1' });
    expect(completionLogChips(t, true)).toEqual([{ kind: 'food', text: 'Logs to food log' }]);
  });

  it('says a meal slot task asks what you ate, even with the prompt setting off', () => {
    const t = task({ logMealSlot: 'breakfast' });
    expect(completionLogChips(t, false)).toEqual([{ kind: 'food', text: 'Asks what you ate' }]);
  });

  it('shows nothing once the task is done', () => {
    const t = task({ completed: true, medicationName: 'Iron', logSavedMealId: 'm1' });
    expect(completionLogChips(t, true)).toEqual([]);
  });
});
