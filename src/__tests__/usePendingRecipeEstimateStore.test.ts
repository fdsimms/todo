import { usePendingRecipeEstimateStore } from '../store/usePendingRecipeEstimateStore';
import type { PendingRecipeEstimate } from '../utils/recipeEstimateQueue';

let mockRows: PendingRecipeEstimate[] = [];
const mockEstimate = jest.fn();
let mockDemo = false;

jest.mock('../db/database', () => ({
  dbGetPendingRecipeEstimates: jest.fn(() => mockRows),
  dbSavePendingRecipeEstimate: jest.fn((p: PendingRecipeEstimate) => {
    mockRows = [...mockRows.filter(r => r.recipeId !== p.recipeId), p];
  }),
  dbDeletePendingRecipeEstimate: jest.fn((id: string) => {
    mockRows = mockRows.filter(r => r.recipeId !== id);
  }),
}));

jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemo }));

jest.mock('../services/aiSuggestions', () => ({
  estimateRecipeNutrition: (...args: unknown[]) => mockEstimate(...args),
  describeAIError: (e: unknown) => `described: ${e instanceof Error ? e.message : ''}`,
}));

const result = { amounts: { calorieKcal: 2400 }, confidence: 'medium' as const };

function enqueue(recipeId: string, estimateKey = `key-${recipeId}`, lines: string[] = ['1 lb beef']) {
  usePendingRecipeEstimateStore.getState().enqueue({ recipeId, estimateKey, title: 'Stew', servings: 4, lines });
}
const queue = () => usePendingRecipeEstimateStore.getState().pending;

beforeEach(() => {
  mockRows = [];
  mockDemo = false;
  mockEstimate.mockReset();
  usePendingRecipeEstimateStore.getState().initialize();
});

describe('enqueue', () => {
  it('keeps the ask with the fingerprint it was made under', () => {
    enqueue('r1', 'fingerprint');
    expect(queue()[0]).toMatchObject({ recipeId: 'r1', estimateKey: 'fingerprint', status: 'waiting', servings: 4 });
    expect(mockRows).toHaveLength(1);
  });

  it('replaces the recipe\'s earlier row rather than listing it twice', () => {
    enqueue('r1', 'old');
    enqueue('r1', 'new');
    expect(queue()).toHaveLength(1);
    expect(queue()[0].estimateKey).toBe('new');
  });

  it('refuses an ask with no lines', () => {
    enqueue('r1', 'key', ['  ', '']);
    expect(queue()).toEqual([]);
  });
});

describe('drain', () => {
  it('makes the estimate and keeps it on the row, leaving the key alone', async () => {
    enqueue('r1', 'fingerprint');
    mockEstimate.mockResolvedValue(result);
    await usePendingRecipeEstimateStore.getState().drain();
    expect(mockEstimate).toHaveBeenCalledWith('Stew', 4, ['1 lb beef']);
    expect(queue()[0]).toMatchObject({ status: 'ready', estimate: result, estimateKey: 'fingerprint' });
  });

  it('stops at the first failure waiting can fix, leaving everything waiting', async () => {
    enqueue('r1');
    enqueue('r2');
    mockEstimate.mockRejectedValue(new TypeError('Network request failed'));
    await usePendingRecipeEstimateStore.getState().drain();
    expect(mockEstimate).toHaveBeenCalledTimes(1);
    expect(queue().map(p => p.status)).toEqual(['waiting', 'waiting']);
    expect(usePendingRecipeEstimateStore.getState().draining).toBe(false);
  });

  it('marks a row failed for a reason waiting cannot fix and carries on', async () => {
    enqueue('r1');
    enqueue('r2');
    mockEstimate
      .mockRejectedValueOnce(new Error('API error 401'))
      .mockResolvedValueOnce(result);
    await usePendingRecipeEstimateStore.getState().drain();
    const byId = Object.fromEntries(queue().map(p => [p.recipeId, p]));
    expect(byId.r1).toMatchObject({ status: 'failed', error: 'described: API error 401' });
    expect(byId.r2.status).toBe('ready');
  });

  it('does not write a result over a row replaced by a newer ask while the request was out', async () => {
    enqueue('r1', 'old');
    mockEstimate.mockImplementation(async () => {
      enqueue('r1', 'new');
      return result;
    });
    await usePendingRecipeEstimateStore.getState().drain();
    expect(queue()).toHaveLength(1);
    expect(queue()[0]).toMatchObject({ estimateKey: 'new', status: 'waiting', estimate: null });
  });

  it('does not bring back a row discarded while the request was out', async () => {
    enqueue('r1');
    mockEstimate.mockImplementation(async () => {
      usePendingRecipeEstimateStore.getState().discard('r1');
      return result;
    });
    await usePendingRecipeEstimateStore.getState().drain();
    expect(queue()).toEqual([]);
    expect(mockRows).toEqual([]);
  });

  it('does nothing in demo mode', async () => {
    enqueue('r1');
    mockDemo = true;
    await usePendingRecipeEstimateStore.getState().drain();
    expect(mockEstimate).not.toHaveBeenCalled();
    expect(queue()[0].status).toBe('waiting');
  });
});

describe('retry and discard', () => {
  it('puts a failed row back to waiting and asks again', async () => {
    enqueue('r1');
    mockEstimate.mockRejectedValueOnce(new Error('API error 401'));
    await usePendingRecipeEstimateStore.getState().drain();
    mockEstimate.mockResolvedValueOnce(result);
    await usePendingRecipeEstimateStore.getState().retry('r1');
    expect(queue()[0]).toMatchObject({ status: 'ready', error: null });
  });

  it('removes a row', () => {
    enqueue('r1');
    usePendingRecipeEstimateStore.getState().discard('r1');
    expect(queue()).toEqual([]);
    expect(mockRows).toEqual([]);
  });
});
