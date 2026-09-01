/**
 * Tests for src/services/aiSuggestions.ts.
 *
 * All network calls are intercepted via a jest.spyOn on global.fetch —
 * no real API tokens are used or required.
 */

import {
  suggestTemplateItems,
  suggestProjectTasks,
  suggestGroceryAisles,
  suggestRecipeGroceries,
  extractRecipe,
  extractReceipt,
  suggestMealIdeas,
  draftMealRecipe,
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
  projectTaskSuggestions: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  groceryAisles: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  recipeExtraction: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  mealIdeas: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  substitutes: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  receiptImport: { enabled: true, model: 'claude-sonnet-5' },
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
  recurrenceAnchorDay: null,
  recurrenceAnchorDate: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  supplyCount: null,
  supplyUnit: null,
  supplyRefillCount: null,
  supplyReorderAt: 1,
  supplyLeadDays: null,
  supplyDeclinedAtCount: null,
  supplyGroceryItemId: null,
  targetCount: null,
  targetUnit: null,
  allowOvershoot: false,
  quotaIntervalMinutes: null,
  quotaReminders: false,
  quotaStartedAt: null, quotaAlwaysVisible: false,
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
  priorBestStreak: 0,
  showStreak: false,
  streakRequiresWindow: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  vacationPause: false, excludeFromSuggestions: false,
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
  emailAddress: null, location: null,
  blockedById: null,
  waitingOnPersonId: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  backfillDismissedFields: [],
  personIds: [],
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
// suggestProjectTasks
// ============================================================================

describe('suggestProjectTasks', () => {
  it('throws when no API key is configured', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValueOnce({ anthropicApiKey: '' });

    await expect(suggestProjectTasks('Repaint the hallway', '', [])).rejects.toThrow('No API key');
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetchOnce({}, 500);
    await expect(suggestProjectTasks('Repaint the hallway', '', [])).rejects.toThrow('API error 500');
  });

  it('throws when the response contains no tool_use block', async () => {
    mockFetchOnce({ content: [{ type: 'text', text: 'hi' }] });
    await expect(suggestProjectTasks('Repaint the hallway', '', [])).rejects.toThrow('No suggestions returned');
  });

  it('returns normalized suggestions from the tool payload', async () => {
    mockFetchOnce(toolUseResponse('suggest_tasks', {
      tasks: [
        { title: '  Buy paint  ', notes: 'Match the trim color' },
        { title: 'Move the furniture', notes: '' },
      ],
    }));

    const result = await suggestProjectTasks('Repaint the hallway', '', []);
    expect(result).toEqual([
      { title: 'Buy paint', notes: 'Match the trim color' },
      { title: 'Move the furniture', notes: '' },
    ]);
  });

  it('drops blank titles', async () => {
    mockFetchOnce(toolUseResponse('suggest_tasks', {
      tasks: [
        { title: '   ', notes: 'nothing' },
        { title: 'Sand the walls', notes: '' },
      ],
    }));

    const result = await suggestProjectTasks('Repaint the hallway', '', []);
    expect(result).toEqual([{ title: 'Sand the walls', notes: '' }]);
  });

  it('filters out duplicates of existing tasks and repeated suggestions (case-insensitively)', async () => {
    mockFetchOnce(toolUseResponse('suggest_tasks', {
      tasks: [
        { title: 'Buy Paint', notes: '' }, // dup of existing
        { title: 'Tape the edges', notes: '' },
        { title: 'tape the edges', notes: '' }, // dup of prior suggestion
      ],
    }));

    const result = await suggestProjectTasks('Repaint the hallway', '', ['buy paint']);
    expect(result).toEqual([{ title: 'Tape the edges', notes: '' }]);
  });

  it('passes the project title, notes, and existing titles to the model', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('suggest_tasks', { tasks: [] })),
    } as Response);

    await suggestProjectTasks('Repaint the hallway', 'Two coats, satin finish', ['Buy paint']);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('Repaint the hallway');
    expect(content).toContain('Two coats, satin finish');
    expect(content).toContain('Buy paint');
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
      { name: 'garlic', quantity: '1 bulb', aisle: 'Produce', section: null, prep: null },
      { name: 'double cream', quantity: '300 ml', aisle: 'Dairy & Eggs', section: null, prep: null },
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

  // It never reads .steps/.prepTasks, so it shouldn't pay for a longer
  // response asking the model to produce them either.
  it('does not ask the model for a method or prep tasks', async () => {
    const spy = mockFetchOnce(toolUseResponse('extract_groceries', { items: [] }));
    await suggestRecipeGroceries('some recipe', AISLES);

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).not.toContain('prep task');
    expect(body.tools[0].input_schema.properties.steps).toBeUndefined();
    expect(body.tools[0].input_schema.properties.prepTasks).toBeUndefined();
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
      recipeYield: null,
      ingredients: [{ name: 'ground beef', quantity: '2 lb', aisle: 'Pantry', section: null, prep: null }],
      sourceTitle: null,
      sourceAuthor: null,
      sourcePage: null,
      sourceType: null,
      references: [],
      steps: [],
      prepTasks: [],
    });
  });

  it('reads a non-serving yield alongside servings', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Sourdough loaf',
        servings: 8,
        recipeYield: '2 loaves',
        items: [{ name: 'flour', quantity: '1 kg', aisle: 'Pantry' }],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.servings).toBe(8);
    expect(result.recipeYield).toBe('2 loaves');
  });

  it('trims and clamps a long recipeYield', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Cookies',
        recipeYield: `  ${'a'.repeat(100)}  `,
        items: [],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.recipeYield).toHaveLength(60);
    expect(result.recipeYield).toBe('a'.repeat(60));
  });

  it('reads an empty recipeYield as null', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili',
        servings: 4,
        recipeYield: '',
        items: [],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.recipeYield).toBeNull();
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
      { name: 'flour', quantity: '2 cups', aisle: 'Pantry', section: 'For the cake', prep: null },
      { name: 'butter', quantity: '1 cup', aisle: 'Dairy & Eggs', section: null, prep: null },
    ]);
  });

  it('reads the model\'s prep field, clamped to PREP_MAX_LENGTH', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Tempeh Stir-Fry',
        items: [
          { name: 'tempeh', quantity: '1 block', aisle: 'Pantry', prep: 'pressed and cubed' },
          { name: 'garlic', quantity: '2 cloves', aisle: 'Produce', prep: '  ' },
        ],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.ingredients).toEqual([
      { name: 'tempeh', quantity: '1 block', aisle: 'Pantry', section: null, prep: 'pressed and cubed' },
      { name: 'garlic', quantity: '2 cloves', aisle: 'Produce', section: null, prep: null },
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
      name: '', servings: null, servingsMax: null, prepMinutes: null, recipeYield: null, ingredients: [],
      sourceTitle: null, sourceAuthor: null, sourcePage: null, sourceType: null,
      references: [], steps: [], prepTasks: [],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when the model returns no tool use', async () => {
    mockFetchOnce({ content: [{ type: 'text' }] });
    await expect(extractRecipe('some recipe', AISLES)).rejects.toThrow('No suggestions returned');
  });

  it('extracts the method as an ordered list of steps', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili',
        items: [],
        steps: ['Brown the beef.', 'Add the beans and simmer.'],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.steps).toEqual(['Brown the beef.', 'Add the beans and simmer.']);
  });

  it('drops blank and non-string steps', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili', items: [], steps: ['Brown the beef.', '   ', 42, 'Simmer.'],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.steps).toEqual(['Brown the beef.', 'Simmer.']);
  });

  it('caps steps at 30', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili', items: [], steps: Array.from({ length: 40 }, (_, i) => `Step ${i}`),
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.steps).toHaveLength(30);
  });

  it('extracts prep tasks, turning daysAhead into a negative offsetDays', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili',
        items: [],
        prepTasks: [{ title: 'Soak the beans overnight', daysAhead: 1 }],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.prepTasks).toEqual([{ title: 'Soak the beans overnight', offsetDays: -1 }]);
  });

  it('clamps daysAhead to 1-7, and defaults a missing one to 1', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili',
        items: [],
        prepTasks: [
          { title: 'Brine the turkey', daysAhead: 30 },
          { title: 'Defrost the lamb' },
        ],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.prepTasks).toEqual([
      { title: 'Brine the turkey', offsetDays: -7 },
      { title: 'Defrost the lamb', offsetDays: -1 },
    ]);
  });

  it('drops a prep task with no title', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili', items: [], prepTasks: [{ daysAhead: 1 }, { title: '   ', daysAhead: 1 }],
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.prepTasks).toEqual([]);
  });

  it('caps prep tasks at 8', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili',
        items: [],
        prepTasks: Array.from({ length: 12 }, (_, i) => ({ title: `Task ${i}`, daysAhead: 1 })),
      })
    );
    const result = await extractRecipe('some recipe', AISLES);
    expect(result.prepTasks).toHaveLength(8);
  });

  it('sends pasted text as a bare string, not a content block array', async () => {
    const spy = mockFetchOnce(toolUseResponse('extract_recipe', { name: 'Chili', items: [] }));
    await extractRecipe('some recipe', AISLES);

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(typeof body.messages[0].content).toBe('string');
    expect(body.messages[0].content).toContain('Recipe:\nsome recipe');
  });

  it('asks for the method and prep tasks by default', async () => {
    const spy = mockFetchOnce(toolUseResponse('extract_recipe', { name: 'Chili', items: [] }));
    await extractRecipe('some recipe', AISLES);

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).toContain('prep task');
    expect(body.tools[0].input_schema.properties.steps).toBeDefined();
    expect(body.tools[0].input_schema.properties.prepTasks).toBeDefined();
  });

  it('skips the method and prep-task instructions when includeMethod is false', async () => {
    const spy = mockFetchOnce(toolUseResponse('extract_recipe', { name: 'Chili', items: [] }));
    await extractRecipe('some recipe', AISLES, { includeMethod: false });

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).not.toContain('prep task');
    expect(body.tools[0].input_schema.properties.steps).toBeUndefined();
    expect(body.tools[0].input_schema.properties.prepTasks).toBeUndefined();
  });

  it('returns no steps or prep tasks when includeMethod is false, even if the model sends them', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili', items: [], steps: ['Brown the beef.'], prepTasks: [{ title: 'Soak', daysAhead: 1 }],
      })
    );
    const result = await extractRecipe('some recipe', AISLES, { includeMethod: false });
    expect(result.steps).toEqual([]);
    expect(result.prepTasks).toEqual([]);
  });

  it('skips the cross-reference instructions when includeReferences is false', async () => {
    const spy = mockFetchOnce(toolUseResponse('extract_recipe', { name: 'Chili', items: [] }));
    await extractRecipe('some recipe', AISLES, { includeReferences: false });

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).not.toContain('referencedRecipes');
    expect(body.tools[0].input_schema.properties.referencedRecipes).toBeUndefined();
  });

  it('returns no references when includeReferences is false, even if the model sends them', async () => {
    mockFetchOnce(
      toolUseResponse('extract_recipe', {
        name: 'Chili', items: [], referencedRecipes: [{ name: 'Salsa verde', reference: 'page 45' }],
      })
    );
    const result = await extractRecipe('some recipe', AISLES, { includeReferences: false });
    expect(result.references).toEqual([]);
  });

  describe('from a photo', () => {
    const PHOTO = { base64: 'QUJD', mediaType: 'image/jpeg' as const };

    it('reads the source off the page it was photographed from', async () => {
      mockFetchOnce(toolUseResponse('extract_recipe', {
        name: 'Weeknight Chili',
        items: [],
        sourceTitle: 'Nothing Fancy',
        sourceAuthor: 'Alison Roman',
        sourcePage: '142',
        sourceKind: 'cookbook',
      }));
      const result = await extractRecipe(PHOTO, AISLES);
      expect(result.sourceTitle).toBe('Nothing Fancy');
      expect(result.sourceAuthor).toBe('Alison Roman');
      expect(result.sourcePage).toBe('142');
      expect(result.sourceType).toBe('cookbook');
    });

    it('asks for the page furniture rather than telling the model to ignore it', async () => {
      const spy = mockFetchOnce(toolUseResponse('extract_recipe', { name: 'Chili', items: [] }));
      await extractRecipe(PHOTO, AISLES);
      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      const text = body.messages[0].content[1].text;
      // It still must not reach the recipe itself — that half was never in
      // question, and is what the original "ignore page numbers" line was for.
      expect(text).toContain('must never appear in its name, ingredients or method');
      expect(text).toContain('read them into the source fields');
    });

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
        recipeYield: null,
        ingredients: [{ name: 'ground beef', quantity: '2 lb', aisle: 'Pantry', section: null, prep: null }],
        sourceTitle: null,
        sourceAuthor: null,
        sourcePage: null,
        sourceType: null,
        references: [],
        steps: [],
        prepTasks: [],
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
        name: '', servings: null, servingsMax: null, prepMinutes: null, recipeYield: null, ingredients: [],
        sourceTitle: null, sourceAuthor: null, sourcePage: null, sourceType: null,
        references: [], steps: [], prepTasks: [],
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('extracts steps and prep tasks from a photo too', async () => {
      mockFetchOnce(
        toolUseResponse('extract_recipe', {
          name: 'Chili',
          items: [],
          steps: ['Brown the beef.'],
          prepTasks: [{ title: 'Soak the beans overnight', daysAhead: 1 }],
        })
      );
      const result = await extractRecipe(PHOTO, AISLES);
      expect(result.steps).toEqual(['Brown the beef.']);
      expect(result.prepTasks).toEqual([{ title: 'Soak the beans overnight', offsetDays: -1 }]);
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
        { name: 'ground beef', quantity: '2 lb', aisle: 'Pantry', section: null, prep: null },
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

  it('names what is about to go bad as inspiration, not a requirement', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ideasResponse([])),
    } as Response);

    await suggestMealIdeas([], [], 3, undefined, ['Spinach — Use by today', 'Mushrooms — 2 days left']);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('Spinach — Use by today');
    expect(content).toContain('Mushrooms — 2 days left');
    expect(content).toContain('never force one in');
    expect(content).toContain('completely fine');
  });

  it('adds no expiring-items text when none are given', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ideasResponse([])),
    } as Response);

    await suggestMealIdeas([], [], 3);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content as string).not.toContain('close to going bad');
  });

  it('caps the expiring items named in the prompt', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ideasResponse([])),
    } as Response);
    const many = Array.from({ length: 20 }, (_, i) => `Item ${i}`);

    await suggestMealIdeas([], [], 3, undefined, many);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('Item 0');
    expect(content).not.toContain('Item 19');
  });
});

// ============================================================================
// draftMealRecipe (#1063)
// ============================================================================

describe('draftMealRecipe', () => {
  const AISLES = ['Produce', 'Meat', 'Pantry', 'Other'];
  const recipeResponse = (input: Record<string, unknown>) => toolUseResponse('draft_recipe', {
    items: [], steps: [], prepTasks: [], ...input,
  });
  const EMPTY_DRAFT = { ingredients: [], steps: [], prepTasks: [] };

  it('throws when no API key is configured', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({ anthropicApiKey: '' });

    await expect(draftMealRecipe('Lemon chicken', AISLES, 4)).rejects.toThrow('No API key');
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

    await expect(draftMealRecipe('Lemon chicken', AISLES, 4)).rejects.toThrow('AI feature disabled');
    expect(spy).not.toHaveBeenCalled();
  });

  it('makes no network call for an empty meal name', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(draftMealRecipe('   ', AISLES, 4)).resolves.toEqual(EMPTY_DRAFT);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns the drafted shopping list', async () => {
    mockFetchOnce(recipeResponse({
      items: [
        { name: 'chicken thighs', quantity: '1 kg', aisle: 'Meat' },
        { name: 'lemons', quantity: '2', aisle: 'Produce' },
      ],
    }));
    const result = await draftMealRecipe('Lemon chicken', AISLES, 4);
    expect(result.ingredients).toEqual([
      { name: 'chicken thighs', quantity: '1 kg', aisle: 'Meat', section: null, prep: null },
      { name: 'lemons', quantity: '2', aisle: 'Produce', section: null, prep: null },
    ]);
  });

  it('files an invented aisle under Other rather than trusting it', async () => {
    mockFetchOnce(recipeResponse({ items: [{ name: 'lemons', quantity: '2', aisle: 'Citrus Corner' }] }));
    const result = await draftMealRecipe('Lemon chicken', AISLES, 4);
    expect(result.ingredients[0].aisle).toBe('Other');
  });

  it('dedupes two spellings of the same item on the catalog key', async () => {
    mockFetchOnce(recipeResponse({
      items: [
        { name: 'Lemons', quantity: '2', aisle: 'Produce' },
        { name: 'lemons', quantity: '3', aisle: 'Produce' },
      ],
    }));
    const result = await draftMealRecipe('Lemon chicken', AISLES, 4);
    expect(result.ingredients).toHaveLength(1);
  });

  it('returns the method and any prep tasks', async () => {
    mockFetchOnce(recipeResponse({
      steps: ['Sear the chicken thighs.', 'Roast with the lemons at 200C for 30 minutes.'],
      prepTasks: [{ title: 'Marinate the chicken', daysAhead: 1 }],
    }));
    const result = await draftMealRecipe('Lemon chicken', AISLES, 4);
    expect(result.steps).toEqual(['Sear the chicken thighs.', 'Roast with the lemons at 200C for 30 minutes.']);
    expect(result.prepTasks).toEqual([{ title: 'Marinate the chicken', offsetDays: -1 }]);
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetchOnce({}, 401);
    await expect(draftMealRecipe('Lemon chicken', AISLES, 4)).rejects.toThrow('API error 401');
  });

  it('throws when the response contains no tool_use block', async () => {
    mockFetchOnce({ content: [{ type: 'text', text: 'hi' }] });
    await expect(draftMealRecipe('Lemon chicken', AISLES, 4)).rejects.toThrow('No suggestions returned');
  });

  it('names the meal, the serving count and the available aisles in the request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(recipeResponse({})),
    } as Response);

    await draftMealRecipe('Lemon chicken', AISLES, 6);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('Lemon chicken');
    expect(content).toContain('feed 6');
    expect(content).toContain('Produce');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'draft_recipe' });
  });

  it('falls back to a four-serving quantity when servings is unknown', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(recipeResponse({})),
    } as Response);

    await draftMealRecipe('Lemon chicken', AISLES, null);

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
          { name: 'margarine' },
          { name: 'garlic powder', ratio_from: '1 clove', ratio_to: '1/4 tsp' },
        ],
      })
    );
    await expect(suggestSubstitutes('butter', [])).resolves.toEqual([
      { name: 'margarine', ratioFrom: null, ratioTo: null },
      { name: 'garlic powder', ratioFrom: '1 clove', ratioTo: '1/4 tsp' },
    ]);
  });

  it('drops a suggestion naming two ingredients', async () => {
    mockFetchOnce(
      toolUseResponse('suggest_substitutes', {
        substitutes: [{ name: 'milk + lemon juice' }, { name: 'sour cream' }],
      })
    );
    await expect(suggestSubstitutes('buttermilk', [])).resolves.toEqual([
      { name: 'sour cream', ratioFrom: null, ratioTo: null },
    ]);
  });

  it('excludes the item itself and whatever it already links to', async () => {
    mockFetchOnce(
      toolUseResponse('suggest_substitutes', {
        substitutes: [{ name: 'butter' }, { name: 'margarine' }, { name: 'ghee' }],
      })
    );
    await expect(suggestSubstitutes('butter', ['margarine'])).resolves.toEqual([
      { name: 'ghee', ratioFrom: null, ratioTo: null },
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

describe('extractRecipe source provenance', () => {
  const AISLES2 = ['Produce', 'Pantry'];

  it('refuses a book title that is just the recipe name read twice', async () => {
    // A page whose running head is the chapter gives the model nothing to put
    // there, and the most available string on the page is the dish's own name.
    mockFetchOnce(toolUseResponse('extract_recipe', {
      name: 'Chocolate cake',
      items: [],
      sourceTitle: '  chocolate  cake ',
    }));
    const result = await extractRecipe('some recipe', AISLES2);
    expect(result.sourceTitle).toBeNull();
  });

  it('strips a "p." the schema asked the model to leave off', async () => {
    mockFetchOnce(toolUseResponse('extract_recipe', { name: 'Chili', items: [], sourcePage: 'p. 142' }));
    await expect(extractRecipe('x', AISLES2)).resolves.toMatchObject({ sourcePage: '142' });
  });

  it('keeps a spread as a range and roman numerals as they are', async () => {
    mockFetchOnce(toolUseResponse('extract_recipe', { name: 'A', items: [], sourcePage: '112 - 115' }));
    await expect(extractRecipe('x', AISLES2)).resolves.toMatchObject({ sourcePage: '112-115' });
    mockFetchOnce(toolUseResponse('extract_recipe', { name: 'B', items: [], sourcePage: 'xii' }));
    await expect(extractRecipe('x', AISLES2)).resolves.toMatchObject({ sourcePage: 'xii' });
  });

  it("refuses a locator that isn't a page number", async () => {
    // Same refusal referencePageNumber makes, at the other end of the pipe.
    mockFetchOnce(toolUseResponse('extract_recipe', { name: 'A', items: [], sourcePage: 'see overleaf' }));
    await expect(extractRecipe('x', AISLES2)).resolves.toMatchObject({ sourcePage: null });
  });

  it('refuses a source kind outside the known set', async () => {
    mockFetchOnce(toolUseResponse('extract_recipe', { name: 'A', items: [], sourceKind: 'zine' }));
    await expect(extractRecipe('x', AISLES2)).resolves.toMatchObject({ sourceType: null });
  });

  it('clamps a long title to a byline’s ceiling', async () => {
    mockFetchOnce(toolUseResponse('extract_recipe', {
      name: 'A', items: [], sourceTitle: `  ${'b'.repeat(100)}  `,
    }));
    const result = await extractRecipe('x', AISLES2);
    expect(result.sourceTitle).toHaveLength(60);
  });

  it('neither asks for nor returns a source when the caller has nowhere to put one', async () => {
    const spy = mockFetchOnce(toolUseResponse('extract_recipe', {
      name: 'A', items: [], sourceTitle: 'Nothing Fancy',
    }));
    const result = await extractRecipe('x', AISLES2, { includeSource: false });
    expect(result.sourceTitle).toBeNull();
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools[0].input_schema.properties.sourceTitle).toBeUndefined();
  });
});

// ============================================================================
// extractReceipt
// ============================================================================

describe('extractReceipt', () => {
  const PHOTO = { base64: 'QUJD', mediaType: 'image/jpeg' as const };
  const OCR_TEXT = "TRADER JOE'S #453\nGV MLK 2% GAL\t3.48\nBANANAS\t1.29";

  const bodyOf = (spy: jest.SpyInstance) =>
    JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);

  describe('from text read on device', () => {
    it('sends a bare string rather than an image block', async () => {
      const spy = mockFetchOnce(toolUseResponse('extract_receipt', { storeName: '', lines: [] }));
      await extractReceipt(OCR_TEXT);

      const content = bodyOf(spy).messages[0].content;
      expect(typeof content).toBe('string');
      expect(content).toContain('read off a photo of it by on-device text recognition');
      expect(content).toContain(`Receipt:\n${OCR_TEXT}`);
    });

    it('explains the tab that separates a row from its price', async () => {
      const spy = mockFetchOnce(toolUseResponse('extract_receipt', { storeName: '', lines: [] }));
      await extractReceipt(OCR_TEXT);
      expect(bodyOf(spy).messages[0].content).toContain('separated from the rest by a tab');
    });

    it('warns that the recognition is uncorrected rather than clean', async () => {
      // The recogniser has language correction off on purpose, so shorthand
      // survives — at the cost of character noise the model has to see past.
      const spy = mockFetchOnce(toolUseResponse('extract_receipt', { storeName: '', lines: [] }));
      await extractReceipt(OCR_TEXT);
      expect(bodyOf(spy).messages[0].content).toContain('it does not correct what it reads');
    });

    it('still says what a receipt is, which is the half both paths share', async () => {
      const spy = mockFetchOnce(toolUseResponse('extract_receipt', { storeName: '', lines: [] }));
      await extractReceipt(OCR_TEXT);
      const content = bodyOf(spy).messages[0].content;
      expect(content).toContain('Include only lines that are a thing that was bought');
      expect(content).toContain('BNLS SKNLS CHKN BRST');
    });

    it('reads the store, lines and date back the same way the photo path does', async () => {
      mockFetchOnce(toolUseResponse('extract_receipt', {
        storeName: "Trader Joe's",
        total: '4.77',
        date: '2026-08-30',
        lines: [{ label: 'GV MLK 2% GAL', name: 'milk', quantity: '1', price: '3.48' }],
      }));
      await expect(extractReceipt(OCR_TEXT)).resolves.toEqual({
        storeName: "Trader Joe's",
        totalMinor: 477,
        date: '2026-08-30',
        lines: [{ label: 'GV MLK 2% GAL', name: 'milk', quantity: '1', priceMinor: 348 }],
      });
    });

    it('makes no request at all for an empty reading', async () => {
      const spy = jest.spyOn(global, 'fetch');
      await expect(extractReceipt('   ')).resolves.toEqual({
        storeName: '', lines: [], totalMinor: null, date: null,
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('caps a runaway reading rather than sending an unbounded request', async () => {
      const spy = mockFetchOnce(toolUseResponse('extract_receipt', { storeName: '', lines: [] }));
      await extractReceipt('X'.repeat(9_000));
      const content = bodyOf(spy).messages[0].content as string;
      expect(content).toContain('X'.repeat(6_000));
      expect(content).not.toContain('X'.repeat(6_001));
    });
  });

  describe('from a photo', () => {
    it('still sends the image block ahead of the text block', async () => {
      const spy = mockFetchOnce(toolUseResponse('extract_receipt', { storeName: '', lines: [] }));
      await extractReceipt(PHOTO);

      const content = bodyOf(spy).messages[0].content;
      expect(content[0]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
      });
      expect(content[1].type).toBe('text');
      // The photo prompt, not the recognised-text one.
      expect(content[1].text).toContain('This is a photo of a store receipt');
      expect(content[1].text).not.toContain('Receipt:\n');
    });

    it('keeps its own refusal, which is about the photo rather than the text', async () => {
      const spy = mockFetchOnce(toolUseResponse('extract_receipt', { storeName: '', lines: [] }));
      await extractReceipt(PHOTO);
      expect(bodyOf(spy).messages[0].content[1].text)
        .toContain('too blurry, too dark, cut off');
    });

    it('makes no request at all for an empty photo', async () => {
      const spy = jest.spyOn(global, 'fetch');
      await expect(extractReceipt({ base64: '', mediaType: 'image/jpeg' })).resolves.toEqual({
        storeName: '', lines: [], totalMinor: null, date: null,
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
