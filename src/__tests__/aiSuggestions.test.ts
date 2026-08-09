/**
 * Tests for src/services/aiSuggestions.ts.
 *
 * All network calls are intercepted via a jest.spyOn on global.fetch —
 * no real API tokens are used or required.
 */

import {
  suggestTaskAttributes,
  suggestTemplateItems,
  suggestGroceryAisles,
  suggestRecipeGroceries,
  extractRecipe,
  describeAIError,
} from '../services/aiSuggestions';
import type { Task } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const TEST_AI_FEATURE_CONFIG = {
  taskSuggestions: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  templateSuggestions: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  groceryAisles: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  recipeExtraction: { enabled: true, model: 'claude-haiku-4-5-20251001' },
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      anthropicApiKey: 'test-key-does-not-hit-network',
      aiFeatureConfig: TEST_AI_FEATURE_CONFIG,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Task object. */
const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  phoneNumber: null,
  blockedById: null,
  pendingImport: null,
  ...overrides,
});

/** Wrap a tool-use payload in the shape the Anthropic API returns. */
const toolUseResponse = (toolName: string, input: Record<string, unknown>) => ({
  content: [{ type: 'tool_use', input }],
});

/** Make fetch resolve once with the given body (default: 200 OK). */
function mockFetchOnce(body: object, status = 200) {
  jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ============================================================================
// suggestTaskAttributes
// ============================================================================

describe('suggestTaskAttributes', () => {
  it('throws when no API key is configured', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({ anthropicApiKey: '' });

    await expect(
      suggestTaskAttributes('Buy milk', '', [], []),
    ).rejects.toThrow('No API key');
  });

  it('throws without hitting the network when the feature is turned off', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({
      anthropicApiKey: 'test-key-does-not-hit-network',
      aiFeatureConfig: { ...TEST_AI_FEATURE_CONFIG, taskSuggestions: { enabled: false, model: 'claude-haiku-4-5-20251001' } },
    });
    const spy = jest.spyOn(global, 'fetch');

    await expect(
      suggestTaskAttributes('Buy milk', '', [], []),
    ).rejects.toThrow('AI feature disabled');
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetchOnce({}, 429);
    await expect(
      suggestTaskAttributes('title', '', [], []),
    ).rejects.toThrow('API error 429');
  });

  it('throws when the response contains no tool_use block', async () => {
    mockFetchOnce({ content: [{ type: 'text', text: 'hello' }] });
    await expect(
      suggestTaskAttributes('title', '', [], []),
    ).rejects.toThrow('No suggestion returned');
  });

  it('returns tags, effort and category from the tool_use response', async () => {
    mockFetchOnce(
      toolUseResponse('suggest', { tags: ['work', 'urgent'], effort: 3, category: 'Work' }),
    );
    const result = await suggestTaskAttributes(
      'Finish quarterly report',
      '',
      ['work', 'urgent', 'home'],
      ['Work', 'Personal'],
    );
    expect(result.tags).toEqual(['work', 'urgent']);
    expect(result.effort).toBe(3);
    expect(result.category).toBe('Work');
  });

  it('filters out tags not present in availableTags', async () => {
    mockFetchOnce(
      toolUseResponse('suggest', { tags: ['work', 'invented-tag'], effort: 1, category: '' }),
    );
    const result = await suggestTaskAttributes('task', '', ['work'], []);
    expect(result.tags).toEqual(['work']);
    expect(result.tags).not.toContain('invented-tag');
  });

  it('returns null category when the model returns one not in availableCategories', async () => {
    mockFetchOnce(
      toolUseResponse('suggest', { tags: [], effort: 0, category: 'Hallucinated' }),
    );
    const result = await suggestTaskAttributes('task', '', [], ['Work', 'Home']);
    expect(result.category).toBeNull();
  });

  it('returns null category when the model returns an empty string', async () => {
    mockFetchOnce(
      toolUseResponse('suggest', { tags: [], effort: 0, category: '' }),
    );
    const result = await suggestTaskAttributes('task', '', [], ['Work']);
    expect(result.category).toBeNull();
  });

  it('clamps effort below 0 to 0', async () => {
    mockFetchOnce(toolUseResponse('suggest', { tags: [], effort: -5, category: '' }));
    const result = await suggestTaskAttributes('task', '', [], []);
    expect(result.effort).toBe(0);
  });

  it('clamps effort above 6 to 6', async () => {
    mockFetchOnce(toolUseResponse('suggest', { tags: [], effort: 99, category: '' }));
    const result = await suggestTaskAttributes('task', '', [], []);
    expect(result.effort).toBe(6);
  });

  it('handles null/missing tags field gracefully', async () => {
    mockFetchOnce(toolUseResponse('suggest', { tags: null, effort: 2, category: '' }));
    const result = await suggestTaskAttributes('task', '', ['work'], []);
    expect(result.tags).toEqual([]);
  });

  it('sends the task title and notes in the request body', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('suggest', { tags: [], effort: 0, category: '' })),
    } as Response);

    await suggestTaskAttributes('Write tests', 'Cover the happy path', ['work'], ['Work']);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userMessage = body.messages[0].content as string;
    expect(userMessage).toContain('Write tests');
    expect(userMessage).toContain('Cover the happy path');
  });

  it('describes available tags and categories in the request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('suggest', { tags: [], effort: 0, category: '' })),
    } as Response);

    await suggestTaskAttributes('task', '', ['work', 'home'], ['Work', 'Personal']);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('work');
    expect(content).toContain('Work');
  });

  it('returns newCategory when the model proposes a name not in availableCategories', async () => {
    mockFetchOnce(
      toolUseResponse('suggest', { tags: [], effort: 0, category: '', newCategory: 'Errands' }),
    );
    const result = await suggestTaskAttributes('Renew passport', '', [], ['Work', 'Home']);
    expect(result.category).toBeNull();
    expect(result.newCategory).toBe('Errands');
  });

  it('suppresses newCategory when an existing category was also chosen', async () => {
    mockFetchOnce(
      toolUseResponse('suggest', { tags: [], effort: 0, category: 'Work', newCategory: 'Errands' }),
    );
    const result = await suggestTaskAttributes('task', '', [], ['Work']);
    expect(result.category).toBe('Work');
    expect(result.newCategory).toBeNull();
  });

  it('promotes a case-insensitive collision to the existing category', async () => {
    mockFetchOnce(
      toolUseResponse('suggest', { tags: [], effort: 0, category: '', newCategory: 'work' }),
    );
    const result = await suggestTaskAttributes('task', '', [], ['Work']);
    expect(result.category).toBe('Work');
    expect(result.newCategory).toBeNull();
  });

  it('returns null newCategory for a whitespace-only proposal', async () => {
    mockFetchOnce(
      toolUseResponse('suggest', { tags: [], effort: 0, category: '', newCategory: '   ' }),
    );
    const result = await suggestTaskAttributes('task', '', [], ['Work']);
    expect(result.category).toBeNull();
    expect(result.newCategory).toBeNull();
  });

  it('returns null newCategory when the field is missing', async () => {
    mockFetchOnce(
      toolUseResponse('suggest', { tags: [], effort: 0, category: '' }),
    );
    const result = await suggestTaskAttributes('task', '', [], ['Work']);
    expect(result.newCategory).toBeNull();
  });

  it('instructs the model to prefer existing categories over inventing one', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('suggest', { tags: [], effort: 0, category: '', newCategory: '' })),
    } as Response);

    await suggestTaskAttributes('task', '', [], ['Work']);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('newCategory');
    expect(content).toContain('Strongly prefer an existing category');
  });
});

// ============================================================================
// suggestTemplateItems
// ============================================================================

describe('suggestTemplateItems', () => {
  it('throws when no API key is configured', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValueOnce({ anthropicApiKey: '' });

    await expect(suggestTemplateItems('Vacation prep', [])).rejects.toThrow('No API key');
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetchOnce({}, 500);
    await expect(suggestTemplateItems('Vacation prep', [])).rejects.toThrow('API error 500');
  });

  it('throws when the response contains no tool_use block', async () => {
    mockFetchOnce({ content: [{ type: 'text', text: 'hi' }] });
    await expect(suggestTemplateItems('Vacation prep', [])).rejects.toThrow('No suggestions returned');
  });

  it('returns normalized suggestions from the tool payload', async () => {
    mockFetchOnce(toolUseResponse('suggest_tasks', {
      tasks: [
        { title: '  Pack passport  ', notes: 'Check expiry' },
        { title: 'Stop the mail', notes: '' },
      ],
    }));

    const result = await suggestTemplateItems('Vacation prep', []);
    expect(result).toEqual([
      { title: 'Pack passport', notes: 'Check expiry' },
      { title: 'Stop the mail', notes: '' },
    ]);
  });

  it('drops blank titles', async () => {
    mockFetchOnce(toolUseResponse('suggest_tasks', {
      tasks: [
        { title: '   ', notes: 'nothing' },
        { title: 'Water the plants', notes: '' },
      ],
    }));

    const result = await suggestTemplateItems('Home checklist', []);
    expect(result).toEqual([{ title: 'Water the plants', notes: '' }]);
  });

  it('filters out duplicates of existing items and repeated suggestions (case-insensitively)', async () => {
    mockFetchOnce(toolUseResponse('suggest_tasks', {
      tasks: [
        { title: 'Pack Passport', notes: '' }, // dup of existing
        { title: 'Buy sunscreen', notes: '' },
        { title: 'buy sunscreen', notes: '' }, // dup of prior suggestion
      ],
    }));

    const result = await suggestTemplateItems('Vacation prep', ['pack passport']);
    expect(result).toEqual([{ title: 'Buy sunscreen', notes: '' }]);
  });

  it('passes the template name and existing titles to the model', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('suggest_tasks', { tasks: [] })),
    } as Response);

    await suggestTemplateItems('Camping trip', ['Pitch the tent']);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('Camping trip');
    expect(content).toContain('Pitch the tent');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'suggest_tasks' });
  });
});

// ============================================================================
// Shared request behavior (temperature, timeout, truncation)
// ============================================================================

describe('shared Anthropic request handling', () => {
  it('sends the feature\'s configured model and no temperature override', async () => {
    // No `temperature` — Opus 5 / Sonnet 5 reject a non-default value, and the
    // tool-forced extraction below doesn't need one for determinism.
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('suggest', { tags: [], effort: 0, category: '' })),
    } as Response);

    await suggestTaskAttributes('task', '', [], []);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBeUndefined();
    expect(body.model).toBe(TEST_AI_FEATURE_CONFIG.taskSuggestions.model);
  });

  it('aborts the request after 15s and reports a timeout', async () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = suggestTaskAttributes('task', '', [], []);
    const assertion = expect(promise).rejects.toThrow('Request timed out');
    await jest.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('throws when the response was truncated at max_tokens', async () => {
    mockFetchOnce({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', input: { tags: [], effort: 0, category: '' } }] });

    await expect(
      suggestTaskAttributes('task', '', [], []),
    ).rejects.toThrow('Response was truncated');
  });
});

// ============================================================================
// describeAIError
// ============================================================================

describe('describeAIError', () => {
  it('points at Settings for a missing API key', () => {
    expect(describeAIError(new Error('No API key'))).toContain('Settings');
  });

  it('names the feature as turned off for a disabled feature', () => {
    expect(describeAIError(new Error('AI feature disabled'))).toContain('turned off');
  });

  it('points at Settings for an unauthorized response', () => {
    expect(describeAIError(new Error('API error 401'))).toContain('API key');
  });

  it('mentions rate limiting for a 429', () => {
    expect(describeAIError(new Error('API error 429'))).toContain('Rate limited');
  });

  it('mentions Anthropic having issues for a 5xx', () => {
    expect(describeAIError(new Error('API error 503'))).toContain('Anthropic');
  });

  it('mentions timing out for an aborted request', () => {
    expect(describeAIError(new Error('Request timed out'))).toContain('timed out');
  });

  it('mentions truncation for a max_tokens cutoff', () => {
    expect(describeAIError(new Error('Response was truncated'))).toContain('cut off');
  });

  it('falls back to a network message for an unrecognized error', () => {
    expect(describeAIError(new Error('Network request failed'))).toContain('connection');
  });

  it('falls back to a network message for a non-Error throw', () => {
    expect(describeAIError('some string')).toContain('connection');
  });
});

// ---------------------------------------------------------------------------
// Groceries
// ---------------------------------------------------------------------------

const AISLES = ['Produce', 'Dairy & Eggs', 'Pantry', 'Other'];

describe('suggestGroceryAisles', () => {
  it('maps each name to its aisle', async () => {
    mockFetchOnce(
      toolUseResponse('assign_aisles', {
        assignments: [
          { name: 'nduja', aisle: 'Pantry' },
          { name: 'harissa paste', aisle: 'Pantry' },
        ],
      })
    );
    await expect(suggestGroceryAisles(['nduja', 'harissa paste'], AISLES)).resolves.toEqual({
      nduja: 'Pantry',
      'harissa paste': 'Pantry',
    });
  });

  // Never trust a returned string as an identifier: an aisle outside the walk
  // order would render its items in an unordered heap at the bottom.
  it('drops an aisle the app does not have', async () => {
    mockFetchOnce(
      toolUseResponse('assign_aisles', {
        assignments: [
          { name: 'nduja', aisle: 'Charcuterie' },
          { name: 'kale', aisle: 'Produce' },
        ],
      })
    );
    await expect(suggestGroceryAisles(['nduja', 'kale'], AISLES)).resolves.toEqual({
      kale: 'Produce',
    });
  });

  it('promotes a case-mismatched aisle to the canonical spelling', async () => {
    mockFetchOnce(
      toolUseResponse('assign_aisles', { assignments: [{ name: 'kale', aisle: 'produce' }] })
    );
    await expect(suggestGroceryAisles(['kale'], AISLES)).resolves.toEqual({ kale: 'Produce' });
  });

  it('drops a name it was never given', async () => {
    mockFetchOnce(
      toolUseResponse('assign_aisles', {
        assignments: [
          { name: 'kale', aisle: 'Produce' },
          { name: 'a thing nobody asked about', aisle: 'Produce' },
        ],
      })
    );
    await expect(suggestGroceryAisles(['kale'], AISLES)).resolves.toEqual({ kale: 'Produce' });
  });

  it('matches a name back case-insensitively but returns the original spelling', async () => {
    mockFetchOnce(
      toolUseResponse('assign_aisles', { assignments: [{ name: 'KALE', aisle: 'Produce' }] })
    );
    await expect(suggestGroceryAisles(['Kale'], AISLES)).resolves.toEqual({ Kale: 'Produce' });
  });

  it('does not call the network for an empty list', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(suggestGroceryAisles(['  ', ''], AISLES)).resolves.toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces a rate limit through the shared error copy', async () => {
    mockFetchOnce({}, 429);
    await expect(suggestGroceryAisles(['kale'], AISLES)).rejects.toThrow('API error 429');
    expect(describeAIError(new Error('API error 429'))).toBe(
      'Rate limited by Anthropic. Try again in a moment.'
    );
  });
});

describe('suggestRecipeGroceries', () => {
  it('returns items with quantity and aisle', async () => {
    mockFetchOnce(
      toolUseResponse('extract_groceries', {
        items: [
          { name: 'garlic', quantity: '1 bulb', aisle: 'Produce' },
          { name: 'double cream', quantity: '300 ml', aisle: 'Dairy & Eggs' },
        ],
      })
    );
    await expect(suggestRecipeGroceries('some recipe', AISLES)).resolves.toEqual([
      { name: 'garlic', quantity: '1 bulb', aisle: 'Produce' },
      { name: 'double cream', quantity: '300 ml', aisle: 'Dairy & Eggs' },
    ]);
  });

  it('falls back to Other for an aisle the app does not have', async () => {
    mockFetchOnce(
      toolUseResponse('extract_groceries', {
        items: [{ name: 'nduja', quantity: '', aisle: 'Charcuterie' }],
      })
    );
    const result = await suggestRecipeGroceries('some recipe', AISLES);
    expect(result[0].aisle).toBe('Other');
  });

  // Deduped on the catalog's own key, so two spellings of one thing aren't
  // both offered and then both added.
  it('dedupes on the grocery name key', async () => {
    mockFetchOnce(
      toolUseResponse('extract_groceries', {
        items: [
          { name: 'Garlic', quantity: '1 bulb', aisle: 'Produce' },
          { name: 'garlic', quantity: '2 cloves', aisle: 'Produce' },
        ],
      })
    );
    const result = await suggestRecipeGroceries('some recipe', AISLES);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Garlic');
  });

  it('drops blank and non-string names', async () => {
    mockFetchOnce(
      toolUseResponse('extract_groceries', {
        items: [
          { name: '   ', quantity: '', aisle: 'Produce' },
          { name: 42, quantity: '', aisle: 'Produce' },
          { name: 'kale', quantity: '', aisle: 'Produce' },
        ],
      })
    );
    const result = await suggestRecipeGroceries('some recipe', AISLES);
    expect(result.map(r => r.name)).toEqual(['kale']);
  });

  it('coerces a missing quantity to an empty string', async () => {
    mockFetchOnce(
      toolUseResponse('extract_groceries', { items: [{ name: 'kale', aisle: 'Produce' }] })
    );
    const result = await suggestRecipeGroceries('some recipe', AISLES);
    expect(result[0].quantity).toBe('');
  });

  it('does not call the network for empty text', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(suggestRecipeGroceries('   ', AISLES)).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when the model returns no tool use', async () => {
    mockFetchOnce({ content: [{ type: 'text' }] });
    await expect(suggestRecipeGroceries('some recipe', AISLES)).rejects.toThrow(
      'No suggestions returned'
    );
  });
});

describe('extractRecipe', () => {
  it('returns the name, servings, prep time, and shopping list', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Weeknight Chili',
        servings: 4,
        prepMinutes: 45,
        items: [{ name: 'ground beef', quantity: '2 lb', aisle: 'Pantry' }],
      })
    );
    await expect(extractRecipe('some recipe', AISLES)).resolves.toEqual({
      name: 'Weeknight Chili',
      servings: 4,
      prepMinutes: 45,
      ingredients: [{ name: 'ground beef', quantity: '2 lb', aisle: 'Pantry' }],
    });
  });

  it('is null for servings and prep time the text did not state', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', { name: 'Chili', servings: 0, prepMinutes: 0, items: [] })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.servings).toBeNull();
    expect(result.prepMinutes).toBeNull();
  });

  it('clamps servings to 1-99', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', { name: 'Chili', servings: 500, items: [] })
    );
    expect((await extractRecipe('some recipe', AISLES)).servings).toBe(99);
  });

  it('is an empty name when the text did not give one', async () => {
    mockFetchOnce(toolUseResponse('extract_recipe', { items: [] }));
    expect((await extractRecipe('some recipe', AISLES)).name).toBe('');
  });

  it('validates the shopping list the same way suggestRecipeGroceries does', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili',
        items: [
          { name: 'nduja', quantity: '', aisle: 'Charcuterie' },
          { name: 'Garlic', quantity: '1 bulb', aisle: 'Produce' },
          { name: 'garlic', quantity: '2 cloves', aisle: 'Produce' },
        ],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.ingredients).toHaveLength(2);
    expect(result.ingredients[0].aisle).toBe('Other');
    expect(result.ingredients[1].name).toBe('Garlic');
  });

  it('does not call the network for empty text', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(extractRecipe('   ', AISLES)).resolves.toEqual({
      name: '', servings: null, prepMinutes: null, ingredients: [],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when the model returns no tool use', async () => {
    mockFetchOnce({ content: [{ type: 'text' }] });
    await expect(extractRecipe('some recipe', AISLES)).rejects.toThrow('No suggestions returned');
  });
});
