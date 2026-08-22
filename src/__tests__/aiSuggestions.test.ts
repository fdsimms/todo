/**
 * Tests for src/services/aiSuggestions.ts.
 *
 * All network calls are intercepted via a jest.spyOn on global.fetch —
 * no real API tokens are used or required.
 */

import {
  suggestTemplateItems,
  suggestGroceryAisles,
  suggestRecipeGroceries,
  extractRecipe,
  suggestMealIdeas,
  suggestMealIngredients,
  suggestSubstitutes,
  describeAIError,
} from '../services/aiSuggestions';
import { MAX_MEAL_IDEAS } from '../utils/mealIdeas';
import type { Task } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const TEST_AI_FEATURE_CONFIG = {
  templateSuggestions: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  groceryAisles: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  recipeExtraction: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  mealIdeas: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  substitutes: { enabled: true, model: 'claude-haiku-4-5-20251001' },
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
  allowOvershoot: false,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
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
  emailAddress: null,
  blockedById: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  ...overrides,
});

/** Wrap a tool-use payload in the shape the Anthropic API returns. */
const toolUseResponse = (toolName: string, input: Record<string, unknown>) => ({
  content: [{ type: 'tool_use', input }],
});

/** Make fetch resolve once with the given body (default: 200 OK). */
function mockFetchOnce(body: object, status = 200) {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce({
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
// suggestTemplateItems
// ============================================================================


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
      json: () => Promise.resolve(toolUseResponse('suggest_tasks', { tasks: [] })),
    } as Response);

    await suggestTemplateItems('Weekly reset', []);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBeUndefined();
    expect(body.model).toBe(TEST_AI_FEATURE_CONFIG.templateSuggestions.model);
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

    const promise = suggestTemplateItems('Weekly reset', []);
    const assertion = expect(promise).rejects.toThrow('Request timed out');
    await jest.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('throws when the response was truncated at max_tokens', async () => {
    mockFetchOnce({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', input: { tasks: [] } }] });

    await expect(
      suggestTemplateItems('Weekly reset', []),
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
      { name: 'garlic', quantity: '1 bulb', aisle: 'Produce', section: null },
      { name: 'double cream', quantity: '300 ml', aisle: 'Dairy & Eggs', section: null },
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
      servingsMax: null,
      prepMinutes: 45,
      ingredients: [{ name: 'ground beef', quantity: '2 lb', aisle: 'Pantry', section: null }],
      references: [],
    });
  });

  it('reads the cross-references to other recipes off the page', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Carnitas tacos',
        items: [{ name: 'pork shoulder', quantity: '3 lb', aisle: 'Meat & Seafood' }],
        referencedRecipes: [
          { name: '  Salsa verde  ', reference: '  page 45  ' },
          { name: 'Mexican rice', reference: 'p. 112' },
        ],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.references).toEqual([
      { name: 'Salsa verde', reference: 'page 45' },
      { name: 'Mexican rice', reference: 'p. 112' },
    ]);
  });

  it('drops a reference the model gave no locator for', async () => {
    // "Serve with rice" names a dish and points nowhere. Without this the
    // closing line of every method becomes a recipe to go photograph.
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Carnitas tacos',
        items: [],
        referencedRecipes: [
          { name: 'Rice', reference: '' },
          { name: 'Salsa verde', reference: 'page 45' },
        ],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.references).toEqual([{ name: 'Salsa verde', reference: 'page 45' }]);
  });

  it('drops an unnamed reference and collapses two spellings of one name', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Carnitas tacos',
        items: [],
        referencedRecipes: [
          { name: '  ', reference: 'page 9' },
          { name: 'Salsa verde', reference: 'page 45' },
          { name: 'SALSA VERDE', reference: 'p. 45' },
          { name: 'Herb oil', reference: 12 },
        ],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.references).toEqual([{ name: 'Salsa verde', reference: 'page 45' }]);
  });

  it('caps how many references one page can claim', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Carnitas tacos',
        items: [],
        referencedRecipes: Array.from({ length: 10 }, (_, i) => ({
          name: `Side ${i}`,
          reference: `page ${i + 10}`,
        })),
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.references).toHaveLength(4);
  });

  it('comes back with no references when the model omits the field', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', { name: 'Chili', items: [] })
    );
    await expect(extractRecipe('some recipe', AISLES)).resolves.toMatchObject({ references: [] });
  });

  it('reads the model\'s component field into section', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Layer Cake',
        items: [
          { name: 'flour', quantity: '2 cups', aisle: 'Pantry', component: 'For the cake' },
          { name: 'butter', quantity: '1 cup', aisle: 'Dairy & Eggs', component: '  ' },
        ],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.ingredients).toEqual([
      { name: 'flour', quantity: '2 cups', aisle: 'Pantry', section: 'For the cake' },
      { name: 'butter', quantity: '1 cup', aisle: 'Dairy & Eggs', section: null },
    ]);
  });

  it('is null for servings and prep time the text did not state', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', { name: 'Chili', servings: 0, prepMinutes: 0, items: [] })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.servings).toBeNull();
    expect(result.servingsMax).toBeNull();
    expect(result.prepMinutes).toBeNull();
  });

  it('clamps servings to 1-99', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', { name: 'Chili', servings: 500, items: [] })
    );
    expect((await extractRecipe('some recipe', AISLES)).servings).toBe(99);
  });

  it('returns a servings range when the model gives a max above the low end', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', { name: 'Chili', servings: 4, servingsMax: 6, items: [] })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.servings).toBe(4);
    expect(result.servingsMax).toBe(6);
  });

  it('drops a servingsMax that does not exceed servings', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', { name: 'Chili', servings: 4, servingsMax: 4, items: [] })
    );
    expect((await extractRecipe('some recipe', AISLES)).servingsMax).toBeNull();
  });

  it('drops a servingsMax when there is no servings low end', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', { name: 'Chili', servings: 0, servingsMax: 6, items: [] })
    );
    expect((await extractRecipe('some recipe', AISLES)).servingsMax).toBeNull();
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
      name: '', servings: null, servingsMax: null, prepMinutes: null, ingredients: [],
      references: [],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when the model returns no tool use', async () => {
    mockFetchOnce({ content: [{ type: 'text' }] });
    await expect(extractRecipe('some recipe', AISLES)).rejects.toThrow('No suggestions returned');
  });

  it('sends pasted text as a bare string, not a content block array', async () => {
    const spy = mockFetchOnce(toolUseResponse('extract_recipe', { name: 'Chili', items: [] }));
    await extractRecipe('some recipe', AISLES);

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(typeof body.messages[0].content).toBe('string');
    expect(body.messages[0].content).toContain('Recipe:\nsome recipe');
  });

  describe('from a photo', () => {
    const PHOTO = { base64: 'QUJD', mediaType: 'image/jpeg' as const };

    it('sends the image block ahead of the text block', async () => {
      const spy = mockFetchOnce(toolUseResponse('extract_recipe', { name: 'Chili', items: [] }));
      await extractRecipe(PHOTO, AISLES);

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      const content = body.messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
      });
      expect(content[1].type).toBe('text');
      // The photo prompt, not the paste one — no text was pasted to quote back.
      expect(content[1].text).toContain('This is a photo of a recipe');
      expect(content[1].text).not.toContain('Recipe:\n');
    });

    it('returns the same shape the text path does', async () => {
      mockFetchOnce(
        toolUseResponse('extract_recipe', {
          name: 'Weeknight Chili',
          servings: 4,
          prepMinutes: 45,
          items: [{ name: 'ground beef', quantity: '2 lb', aisle: 'Pantry' }],
        })
      );
      await expect(extractRecipe(PHOTO, AISLES)).resolves.toEqual({
        name: 'Weeknight Chili',
        servings: 4,
        servingsMax: null,
        prepMinutes: 45,
        ingredients: [{ name: 'ground beef', quantity: '2 lb', aisle: 'Pantry', section: null }],
        references: [],
      });
    });

    it('runs the shopping list through the same validator', async () => {
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
      const result = await extractRecipe(PHOTO, AISLES);
      expect(result.ingredients).toHaveLength(2);
      expect(result.ingredients[0].aisle).toBe('Other');
    });

    it('does not call the network for an empty image', async () => {
      const spy = jest.spyOn(global, 'fetch');
      await expect(extractRecipe({ base64: '', mediaType: 'image/jpeg' }, AISLES)).resolves.toEqual({
        name: '', servings: null, servingsMax: null, prepMinutes: null, ingredients: [],
        references: [],
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('throws when the model returns no tool use', async () => {
      mockFetchOnce({ content: [{ type: 'text' }] });
      await expect(extractRecipe(PHOTO, AISLES)).rejects.toThrow('No suggestions returned');
    });

    it('allows longer than the 15s text timeout before aborting', async () => {
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

      const promise = extractRecipe(PHOTO, AISLES);
      const assertion = expect(promise).rejects.toThrow('Request timed out');

      // Still in flight where a pasted recipe would already have been abandoned.
      let settled = false;
      void promise.catch(() => { settled = true; });
      await jest.advanceTimersByTimeAsync(15_000);
      expect(settled).toBe(false);

      await jest.advanceTimersByTimeAsync(25_000);
      await assertion;
    });

    it('is accepted by suggestRecipeGroceries too', async () => {
      mockFetchOnce(
        toolUseResponse('extract_recipe', {
          name: 'Chili',
          items: [{ name: 'ground beef', quantity: '2 lb', aisle: 'Pantry' }],
        })
      );
      await expect(suggestRecipeGroceries(PHOTO, AISLES)).resolves.toEqual([
        { name: 'ground beef', quantity: '2 lb', aisle: 'Pantry', section: null },
      ]);
    });
  });
});

// ============================================================================
// suggestMealIdeas (#1063) — generation, not ranking
// ============================================================================

describe('suggestMealIdeas', () => {
  const ideasResponse = (meals: unknown[]) => toolUseResponse('suggest_meals', { meals });

  it('throws when no API key is configured', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({ anthropicApiKey: '' });

    await expect(suggestMealIdeas([], [], 3)).rejects.toThrow('No API key');
  });

  it('throws without hitting the network when the feature is turned off', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({
      anthropicApiKey: 'test-key-does-not-hit-network',
      aiFeatureConfig: { ...TEST_AI_FEATURE_CONFIG, mealIdeas: { enabled: false, model: 'claude-haiku-4-5-20251001' } },
    });
    const spy = jest.spyOn(global, 'fetch');

    await expect(suggestMealIdeas([], [], 3)).rejects.toThrow('AI feature disabled');
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetchOnce({}, 500);
    await expect(suggestMealIdeas([], [], 3)).rejects.toThrow('API error 500');
  });

  it('throws when the response contains no tool_use block', async () => {
    mockFetchOnce({ content: [{ type: 'text', text: 'hi' }] });
    await expect(suggestMealIdeas([], [], 3)).rejects.toThrow('No suggestions returned');
  });

  it('returns titles and blurbs from the tool_use response', async () => {
    mockFetchOnce(ideasResponse([
      { title: 'Lemon chicken traybake', blurb: 'One tray, thighs and potatoes' },
      { title: 'Black bean chilli', blurb: 'Storecupboard, freezes well' },
    ]));
    const result = await suggestMealIdeas([], [], 4);
    expect(result.map(i => i.title)).toEqual(['Lemon chicken traybake', 'Black bean chilli']);
    expect(result[0].blurb).toBe('One tray, thighs and potatoes');
  });

  it('drops an idea colliding case-insensitively with something already planned', async () => {
    mockFetchOnce(ideasResponse([{ title: 'fish PIE' }, { title: 'Chilli' }]));
    const result = await suggestMealIdeas(['Fish pie'], [], 3);
    expect(result.map(i => i.title)).toEqual(['Chilli']);
  });

  it('drops an idea colliding with something cooked recently', async () => {
    mockFetchOnce(ideasResponse([{ title: 'Chilli' }, { title: 'Fish pie' }]));
    const result = await suggestMealIdeas([], ['chilli'], 3);
    expect(result.map(i => i.title)).toEqual(['Fish pie']);
  });

  it('caps the set at MAX_MEAL_IDEAS however many come back', async () => {
    mockFetchOnce(ideasResponse(
      Array.from({ length: 20 }, (_, i) => ({ title: `Dish ${i}` })),
    ));
    const result = await suggestMealIdeas([], [], 20);
    expect(result).toHaveLength(MAX_MEAL_IDEAS);
  });

  it('names what is planned and what was cooked recently in the request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ideasResponse([])),
    } as Response);

    await suggestMealIdeas(['Fish pie'], ['Chilli'], 3);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('Fish pie');
    expect(content).toContain('Chilli');
  });

  it('passes the hint through to the prompt', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ideasResponse([])),
    } as Response);

    await suggestMealIdeas([], [], 3, 'something quick and vegetarian');

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content as string).toContain('something quick and vegetarian');
  });

  it('states excluded tags as a hard constraint, in the cook\'s own words', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ideasResponse([])),
    } as Response);

    await suggestMealIdeas([], [], 3, undefined, ['vegetarian', 'eggy']);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('vegetarian, eggy');
    expect(content).toContain('Must avoid');
  });

  it('adds no diet constraint when nothing is excluded', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ideasResponse([])),
    } as Response);

    await suggestMealIdeas([], [], 3);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content as string).not.toContain('Must avoid');
  });

  it('asks for a count clamped into the MIN/MAX band', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ideasResponse([])),
    } as Response);

    await suggestMealIdeas([], [], 99);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content as string).toContain(`Suggest ${MAX_MEAL_IDEAS} dinners`);
  });

  it('forces the suggest_meals tool', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ideasResponse([])),
    } as Response);

    await suggestMealIdeas([], [], 3);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'suggest_meals' });
  });
});

// ============================================================================
// suggestMealIngredients (#1063)
// ============================================================================

describe('suggestMealIngredients', () => {
  const AISLES = ['Produce', 'Meat', 'Pantry', 'Other'];
  const itemsResponse = (items: unknown[]) => toolUseResponse('draft_ingredients', { items });

  it('throws when no API key is configured', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({ anthropicApiKey: '' });

    await expect(suggestMealIngredients('Lemon chicken', AISLES, 4)).rejects.toThrow('No API key');
  });

  it('throws without hitting the network when the feature is turned off', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({
      anthropicApiKey: 'test-key-does-not-hit-network',
      aiFeatureConfig: { ...TEST_AI_FEATURE_CONFIG, mealIdeas: { enabled: false, model: 'claude-haiku-4-5-20251001' } },
    });
    const spy = jest.spyOn(global, 'fetch');

    await expect(suggestMealIngredients('Lemon chicken', AISLES, 4)).rejects.toThrow('AI feature disabled');
    expect(spy).not.toHaveBeenCalled();
  });

  it('makes no network call for an empty meal name', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(suggestMealIngredients('   ', AISLES, 4)).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns the drafted shopping list', async () => {
    mockFetchOnce(itemsResponse([
      { name: 'chicken thighs', quantity: '1 kg', aisle: 'Meat' },
      { name: 'lemons', quantity: '2', aisle: 'Produce' },
    ]));
    await expect(suggestMealIngredients('Lemon chicken', AISLES, 4)).resolves.toEqual([
      { name: 'chicken thighs', quantity: '1 kg', aisle: 'Meat', section: null },
      { name: 'lemons', quantity: '2', aisle: 'Produce', section: null },
    ]);
  });

  it('files an invented aisle under Other rather than trusting it', async () => {
    mockFetchOnce(itemsResponse([{ name: 'lemons', quantity: '2', aisle: 'Citrus Corner' }]));
    const result = await suggestMealIngredients('Lemon chicken', AISLES, 4);
    expect(result[0].aisle).toBe('Other');
  });

  it('dedupes two spellings of the same item on the catalog key', async () => {
    mockFetchOnce(itemsResponse([
      { name: 'Lemons', quantity: '2', aisle: 'Produce' },
      { name: 'lemons', quantity: '3', aisle: 'Produce' },
    ]));
    const result = await suggestMealIngredients('Lemon chicken', AISLES, 4);
    expect(result).toHaveLength(1);
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetchOnce({}, 401);
    await expect(suggestMealIngredients('Lemon chicken', AISLES, 4)).rejects.toThrow('API error 401');
  });

  it('throws when the response contains no tool_use block', async () => {
    mockFetchOnce({ content: [{ type: 'text', text: 'hi' }] });
    await expect(suggestMealIngredients('Lemon chicken', AISLES, 4)).rejects.toThrow('No suggestions returned');
  });

  it('names the meal, the serving count and the available aisles in the request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(itemsResponse([])),
    } as Response);

    await suggestMealIngredients('Lemon chicken', AISLES, 6);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('Lemon chicken');
    expect(content).toContain('feed 6');
    expect(content).toContain('Produce');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'draft_ingredients' });
  });

  it('falls back to a four-serving quantity when servings is unknown', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(itemsResponse([])),
    } as Response);

    await suggestMealIngredients('Lemon chicken', AISLES, null);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content as string).toContain('feed 4');
  });
});

// ============================================================================
// suggestSubstitutes (#1578)
// ============================================================================

describe('suggestSubstitutes', () => {
  it('throws when no API key is configured', async () => {
    jest.spyOn(require('../store/useSettingsStore').useSettingsStore, 'getState').mockReturnValueOnce({
      anthropicApiKey: '',
      aiFeatureConfig: TEST_AI_FEATURE_CONFIG,
    });
    await expect(suggestSubstitutes('Butter', [])).rejects.toThrow('No API key configured');
  });

  it('throws when the feature is disabled', async () => {
    jest.spyOn(require('../store/useSettingsStore').useSettingsStore, 'getState').mockReturnValueOnce({
      anthropicApiKey: 'test-key-does-not-hit-network',
      aiFeatureConfig: {
        ...TEST_AI_FEATURE_CONFIG,
        substitutes: { enabled: false, model: 'claude-haiku-4-5-20251001' },
      },
    });
    const spy = jest.spyOn(global, 'fetch');
    await expect(suggestSubstitutes('Butter', [])).rejects.toThrow('AI feature disabled');
    expect(spy).not.toHaveBeenCalled();
  });

  it('makes no network call for an empty item name', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(suggestSubstitutes('   ', [])).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns validated suggestions, ratio and all', async () => {
    mockFetchOnce(
      toolUseResponse('suggest_substitutes', {
        substitutes: [
          { name: 'Margarine' },
          { name: 'Garlic powder', ratio_from: '1 clove', ratio_to: '1/4 tsp' },
        ],
      })
    );
    await expect(suggestSubstitutes('Butter', [])).resolves.toEqual([
      { name: 'Margarine', ratioFrom: null, ratioTo: null },
      { name: 'Garlic powder', ratioFrom: '1 clove', ratioTo: '1/4 tsp' },
    ]);
  });

  it('drops a suggestion naming two ingredients', async () => {
    mockFetchOnce(
      toolUseResponse('suggest_substitutes', {
        substitutes: [{ name: 'Milk + lemon juice' }, { name: 'Sour cream' }],
      })
    );
    await expect(suggestSubstitutes('Buttermilk', [])).resolves.toEqual([
      { name: 'Sour cream', ratioFrom: null, ratioTo: null },
    ]);
  });

  it('excludes the item itself and whatever it already links to', async () => {
    mockFetchOnce(
      toolUseResponse('suggest_substitutes', {
        substitutes: [{ name: 'Butter' }, { name: 'Margarine' }, { name: 'Ghee' }],
      })
    );
    await expect(suggestSubstitutes('Butter', ['Margarine'])).resolves.toEqual([
      { name: 'Ghee', ratioFrom: null, ratioTo: null },
    ]);
  });

  it('throws when the response contains no tool_use block', async () => {
    mockFetchOnce({ content: [{ type: 'text', text: 'hi' }] });
    await expect(suggestSubstitutes('Butter', [])).rejects.toThrow('No suggestions returned');
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetchOnce({}, 401);
    await expect(suggestSubstitutes('Butter', [])).rejects.toThrow('API error 401');
  });

  it('names the item and excluded names in the request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('suggest_substitutes', { substitutes: [] })),
    } as Response);

    await suggestSubstitutes('Butter', ['Margarine']);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('Butter');
    expect(content).toContain('Margarine');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'suggest_substitutes' });
  });
});
