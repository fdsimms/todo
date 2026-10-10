import {
  MAX_PENDING_ESTIMATES,
  awaitingEstimate,
  canQueueAnother,
  describePending,
  findDuplicate,
  isQueueableFailure,
  sortPending,
  summarizeEstimate,
  type PendingEstimate,
} from '../utils/estimateQueue';
import type { NutritionEstimate } from '../utils/nutritionEstimate';

function row(overrides: Partial<PendingEstimate> = {}): PendingEstimate {
  return {
    id: 'p1',
    description: 'cheeseburger and fries',
    slot: 'lunch',
    atISO: new Date(2026, 3, 1, 12).toISOString(),
    mealPlanEntryId: null,
    context: [],
    status: 'waiting',
    estimate: null,
    estimatedAtISO: null,
    error: null,
    createdAt: new Date(2026, 3, 1, 12, 1).toISOString(),
    ...overrides,
  };
}

function estimate(amounts: NutritionEstimate['amounts']): NutritionEstimate {
  return {
    label: 'Cheeseburger and fries',
    quantity: '1 burger and a regular fries',
    amounts,
    basis: 'typical',
    confidence: 'medium',
    attribution: null,
    questions: [],
    breakdown: [],
  };
}

describe('isQueueableFailure', () => {
  it('queues a failed fetch, which reaches the app as an unrecognized TypeError', () => {
    expect(isQueueableFailure(new TypeError('Network request failed'))).toBe(true);
    expect(isQueueableFailure(new Error('The Internet connection appears to be offline.'))).toBe(true);
  });

  it('queues a timeout, a rate limit and a server error, which clear by themselves', () => {
    expect(isQueueableFailure(new Error('Request timed out'))).toBe(true);
    expect(isQueueableFailure(new Error('API error 429'))).toBe(true);
    expect(isQueueableFailure(new Error('API error 500'))).toBe(true);
    expect(isQueueableFailure(new Error('API error 529'))).toBe(true);
  });

  it('refuses a rejected key and any other client error', () => {
    expect(isQueueableFailure(new Error('API error 401'))).toBe(false);
    expect(isQueueableFailure(new Error('API error 403'))).toBe(false);
    expect(isQueueableFailure(new Error('API error 400'))).toBe(false);
  });

  it('refuses a missing key, a switched-off feature and demo mode', () => {
    expect(isQueueableFailure(new Error('No API key'))).toBe(false);
    expect(isQueueableFailure(new Error('No API key configured for this feature'))).toBe(false);
    expect(isQueueableFailure(new Error('AI feature disabled'))).toBe(false);
    expect(isQueueableFailure(new Error('AI features are off in demo mode.'))).toBe(false);
  });

  it('refuses a reply that came back unusable, which a retry would repeat', () => {
    expect(isQueueableFailure(new Error('No estimate returned'))).toBe(false);
    expect(isQueueableFailure(new Error('Response was truncated'))).toBe(false);
    expect(isQueueableFailure(new SyntaxError('Unexpected token'))).toBe(false);
  });
});

describe('queue bounds', () => {
  it('stops taking meals at the cap', () => {
    const full = Array.from({ length: MAX_PENDING_ESTIMATES }, (_, i) => row({ id: `p${i}` }));
    expect(canQueueAnother(full.slice(0, -1))).toBe(true);
    expect(canQueueAnother(full)).toBe(false);
  });

  it('treats the same text at the same moment as one meal, whatever its case', () => {
    const queue = [row()];
    expect(findDuplicate(queue, '  Cheeseburger and Fries ', queue[0].atISO)?.id).toBe('p1');
  });

  it('treats the same dish eaten at another time as another meal', () => {
    const queue = [row()];
    expect(findDuplicate(queue, 'cheeseburger and fries', new Date(2026, 3, 1, 19).toISOString())).toBeNull();
  });
});

describe('ordering', () => {
  it('sorts by when the meal was eaten, then by when it was saved', () => {
    const dinner = row({ id: 'dinner', atISO: new Date(2026, 3, 1, 19).toISOString() });
    const lunchLate = row({ id: 'b', createdAt: new Date(2026, 3, 1, 12, 5).toISOString() });
    const lunch = row({ id: 'a' });
    expect(sortPending([dinner, lunchLate, lunch]).map(p => p.id)).toEqual(['a', 'b', 'dinner']);
  });

  it('asks only about meals still waiting, leaving a failed one for a manual retry', () => {
    const queue = [
      row({ id: 'waiting' }),
      row({ id: 'ready', status: 'ready', estimate: estimate({ calorieKcal: 600 }) }),
      row({ id: 'failed', status: 'failed', error: 'Check your API key in Settings.' }),
    ];
    expect(awaitingEstimate(queue).map(p => p.id)).toEqual(['waiting']);
  });
});

describe('describePending', () => {
  it('says each state apart, ready first', () => {
    const queue = [
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c', status: 'ready', estimate: estimate({ calorieKcal: 1 }) }),
      row({ id: 'd', status: 'failed' }),
    ];
    expect(describePending(queue)).toBe('1 ready to log, 2 waiting for a connection, 1 could not be estimated');
  });

  it('omits a state nothing is in', () => {
    expect(describePending([row()])).toBe('1 waiting for a connection');
  });
});

describe('summarizeEstimate', () => {
  it('lists the headline figures it was given', () => {
    expect(summarizeEstimate(estimate({ calorieKcal: 1180.4, proteinG: 41, carbsG: 120, fatG: 58 })))
      .toBe('1,180 cal · 41 g protein · 120 g carbs · 58 g fat');
  });

  it('leaves out a figure the model did not state rather than showing zero', () => {
    expect(summarizeEstimate(estimate({ calorieKcal: 300, fatG: 12 }))).toBe('300 cal · 12 g fat');
  });

  it('keeps a stated zero', () => {
    expect(summarizeEstimate(estimate({ calorieKcal: 5, fatG: 0 }))).toBe('5 cal · 0 g fat');
  });
});
