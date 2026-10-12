import { awaitingRecipeEstimate, liveFor, type PendingRecipeEstimate } from '../utils/recipeEstimateQueue';

function row(overrides: Partial<PendingRecipeEstimate> = {}): PendingRecipeEstimate {
  return {
    recipeId: 'r1',
    estimateKey: 'Stew\n4\n1 lb beef|beef|',
    title: 'Stew',
    servings: 4,
    lines: ['1 lb beef'],
    status: 'waiting',
    estimate: null,
    error: null,
    createdAt: '2026-04-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('liveFor', () => {
  it('speaks for the reading it was asked about', () => {
    expect(liveFor([row()], 'r1', 'Stew\n4\n1 lb beef|beef|')?.recipeId).toBe('r1');
  });

  it('does not speak for the same recipe once its lines or scale have changed', () => {
    expect(liveFor([row()], 'r1', 'Stew\n8\n2 lb beef|beef|')).toBeNull();
  });

  it('does not speak for another recipe', () => {
    expect(liveFor([row()], 'r2', 'Stew\n4\n1 lb beef|beef|')).toBeNull();
  });
});

describe('awaitingRecipeEstimate', () => {
  it('lists only waiting rows, oldest first, leaving a failed one for a manual retry', () => {
    const rows = [
      row({ recipeId: 'late', createdAt: '2026-04-01T13:00:00.000Z' }),
      row({ recipeId: 'early' }),
      row({ recipeId: 'failed', status: 'failed' }),
      row({ recipeId: 'ready', status: 'ready', estimate: { amounts: { calorieKcal: 1 }, confidence: 'low' } }),
    ];
    expect(awaitingRecipeEstimate(rows).map(r => r.recipeId)).toEqual(['early', 'late']);
  });
});
