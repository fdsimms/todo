/**
 * Tests for src/services/aiSuggestions.ts.
 *
 * All network calls are intercepted via a jest.spyOn on global.fetch —
 * no real API tokens are used or required.
 */

import {
  suggestTaskAttributes,
  suggestTemplateItems,
} from '../services/aiSuggestions';
import type { Task } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ anthropicApiKey: 'test-key-does-not-hit-network' }),
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
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
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
