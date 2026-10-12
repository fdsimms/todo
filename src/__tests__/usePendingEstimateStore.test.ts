import { usePendingEstimateStore } from '../store/usePendingEstimateStore';
import type { PendingEstimate } from '../utils/estimateQueue';
import type { NutritionEstimate } from '../utils/nutritionEstimate';

let mockRows: PendingEstimate[] = [];
const mockAddEntry = jest.fn();
const mockEstimate = jest.fn();
let mockDemo = false;

jest.mock('../db/database', () => ({
  dbGetPendingEstimates: jest.fn(() => mockRows),
  dbSavePendingEstimate: jest.fn((p: PendingEstimate) => {
    mockRows = [...mockRows.filter(r => r.id !== p.id), p];
  }),
  dbDeletePendingEstimate: jest.fn((id: string) => {
    mockRows = mockRows.filter(r => r.id !== id);
  }),
}));

jest.mock('../store/useFoodLogStore', () => ({
  useFoodLogStore: { getState: () => ({ addEntry: mockAddEntry }) },
}));

jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemo }));

jest.mock('../services/aiSuggestions', () => ({
  estimateMealNutrition: (...args: unknown[]) => mockEstimate(...args),
  describeAIError: (e: unknown) => `described: ${e instanceof Error ? e.message : ''}`,
}));

const LUNCH = new Date(2026, 3, 1, 12, 30);

function result(label = 'Cheeseburger and fries', calorieKcal = 1100): NutritionEstimate {
  return {
    label,
    quantity: '1 burger and a regular fries',
    amounts: { calorieKcal },
    basis: 'typical',
    confidence: 'medium',
    attribution: null,
    questions: [],
    breakdown: [],
  };
}

function enqueue(description: string, at: Date = LUNCH) {
  return usePendingEstimateStore.getState().enqueue({ description, slot: 'lunch', at, context: [] });
}

const queue = () => usePendingEstimateStore.getState().pending;

beforeEach(() => {
  mockRows = [];
  mockDemo = false;
  mockAddEntry.mockReset();
  mockEstimate.mockReset();
  usePendingEstimateStore.getState().initialize();
});

describe('enqueue', () => {
  it('keeps the meal waiting, with when it was eaten and which meal it was', () => {
    expect(enqueue('cheeseburger and fries')).toBe('queued');
    expect(queue()).toHaveLength(1);
    expect(queue()[0]).toMatchObject({
      description: 'cheeseburger and fries',
      slot: 'lunch',
      atISO: LUNCH.toISOString(),
      status: 'waiting',
      estimate: null,
    });
    expect(mockRows).toHaveLength(1);
  });

  it('refuses a blank description and a repeat of the same meal', () => {
    expect(enqueue('   ')).toBe('empty');
    expect(enqueue('pad thai')).toBe('queued');
    expect(enqueue('Pad Thai')).toBe('duplicate');
    expect(queue()).toHaveLength(1);
  });

  it('refuses once the queue is full', () => {
    for (let i = 0; i < 20; i++) enqueue(`meal ${i}`);
    expect(enqueue('one more')).toBe('full');
    expect(queue()).toHaveLength(20);
  });

  it('writes nothing to the food log', () => {
    enqueue('cheeseburger and fries');
    expect(mockAddEntry).not.toHaveBeenCalled();
  });
});

describe('drain', () => {
  it('turns a waiting meal into a ready estimate without logging it', async () => {
    enqueue('cheeseburger and fries');
    mockEstimate.mockResolvedValue(result());
    await usePendingEstimateStore.getState().drain();

    expect(queue()[0].status).toBe('ready');
    expect(queue()[0].estimate?.amounts.calorieKcal).toBe(1100);
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('stops at the first failure waiting can fix and leaves every meal waiting', async () => {
    enqueue('first', new Date(2026, 3, 1, 8));
    enqueue('second', new Date(2026, 3, 1, 12));
    mockEstimate.mockRejectedValue(new TypeError('Network request failed'));
    await usePendingEstimateStore.getState().drain();

    expect(mockEstimate).toHaveBeenCalledTimes(1);
    expect(queue().map(p => p.status)).toEqual(['waiting', 'waiting']);
    expect(usePendingEstimateStore.getState().draining).toBe(false);
  });

  it('marks a meal failed for a reason waiting cannot fix and carries on to the next', async () => {
    enqueue('first', new Date(2026, 3, 1, 8));
    enqueue('second', new Date(2026, 3, 1, 12));
    mockEstimate
      .mockRejectedValueOnce(new Error('No estimate returned'))
      .mockResolvedValueOnce(result('Second'));
    await usePendingEstimateStore.getState().drain();

    expect(queue()[0]).toMatchObject({ status: 'failed', error: 'described: No estimate returned' });
    expect(queue()[1].status).toBe('ready');
  });

  it('asks oldest first, with the context it was saved with', async () => {
    usePendingEstimateStore.getState().enqueue({
      description: 'dinner',
      slot: 'dinner',
      at: new Date(2026, 3, 1, 19),
      context: [{ label: 'My chili', quantity: '1 bowl', amounts: { calorieKcal: 400 } }],
    });
    enqueue('lunch');
    mockEstimate.mockResolvedValue(result());
    await usePendingEstimateStore.getState().drain();

    expect(mockEstimate.mock.calls.map(c => c[0])).toEqual(['lunch', 'dinner']);
    expect(mockEstimate.mock.calls[1][1]).toEqual([{ label: 'My chili', quantity: '1 bowl', amounts: { calorieKcal: 400 } }]);
  });

  it('does not ask about a meal that is already ready or failed', async () => {
    enqueue('lunch');
    mockEstimate.mockResolvedValue(result());
    await usePendingEstimateStore.getState().drain();
    await usePendingEstimateStore.getState().drain();
    expect(mockEstimate).toHaveBeenCalledTimes(1);
  });

  it('does not bring back a meal discarded while its request was out', async () => {
    enqueue('lunch');
    const id = queue()[0].id;
    mockEstimate.mockImplementation(async () => {
      usePendingEstimateStore.getState().discard(id);
      return result();
    });
    await usePendingEstimateStore.getState().drain();
    expect(queue()).toEqual([]);
    expect(mockRows).toEqual([]);
  });

  it('does nothing in demo mode, leaving the queue as it was', async () => {
    enqueue('lunch');
    mockDemo = true;
    await usePendingEstimateStore.getState().drain();
    expect(mockEstimate).not.toHaveBeenCalled();
    expect(queue()[0].status).toBe('waiting');
  });
});

describe('retry', () => {
  it('puts a failed meal back to waiting and asks again', async () => {
    enqueue('lunch');
    mockEstimate.mockRejectedValueOnce(new Error('API error 401'));
    await usePendingEstimateStore.getState().drain();
    expect(queue()[0].status).toBe('failed');

    mockEstimate.mockResolvedValueOnce(result());
    await usePendingEstimateStore.getState().retry(queue()[0].id);
    expect(queue()[0]).toMatchObject({ status: 'ready', error: null });
  });
});

describe('log', () => {
  it('logs a ready meal at the moment it was eaten, estimated and without a weight', async () => {
    enqueue('cheeseburger and fries');
    mockEstimate.mockResolvedValue(result());
    await usePendingEstimateStore.getState().drain();
    mockAddEntry.mockReturnValue({ id: 'entry-1' });

    const written = usePendingEstimateStore.getState().log(queue()[0].id);

    expect(written).toEqual({ id: 'entry-1' });
    const draft = mockAddEntry.mock.calls[0][0];
    expect(draft.at).toEqual(LUNCH);
    expect(draft).toMatchObject({
      label: 'Cheeseburger and fries',
      quantity: '1 burger and a regular fries',
      grams: null,
      slot: 'lunch',
      mealPlanEntryId: null,
    });
    expect(draft.nutrition.source).toBe('estimated');
    expect(draft.nutrition.amounts.calorieKcal).toBe(1100);
    expect(queue()).toEqual([]);
  });

  it('will not log a meal that has no estimate yet', () => {
    enqueue('lunch');
    expect(usePendingEstimateStore.getState().log(queue()[0].id)).toBeNull();
    expect(mockAddEntry).not.toHaveBeenCalled();
    expect(queue()).toHaveLength(1);
  });

  it('keeps the ready meal when the food log refuses it', async () => {
    enqueue('lunch');
    mockEstimate.mockResolvedValue(result());
    await usePendingEstimateStore.getState().drain();
    mockAddEntry.mockReturnValue(null);

    expect(usePendingEstimateStore.getState().log(queue()[0].id)).toBeNull();
    expect(queue()).toHaveLength(1);
  });
});

describe('initialize', () => {
  it('reads the queue back, as after the app was closed', () => {
    enqueue('lunch');
    usePendingEstimateStore.setState({ pending: [] });
    usePendingEstimateStore.getState().initialize();
    expect(queue()).toHaveLength(1);
  });
});
