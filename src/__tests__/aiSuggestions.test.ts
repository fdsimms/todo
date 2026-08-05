/**
 * Tests for src/services/aiSuggestions.ts.
 *
 * All network calls are intercepted via a jest.spyOn on global.fetch —
 * no real API tokens are used or required.
 */

import {
  suggestTaskAttributes,
  suggestPinTasks,
  suggestTemplateItems,
  MAX_SUGGESTED_PINS,
} from '../services/aiSuggestions';
import type { Category, Task } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ anthropicApiKey: 'test-key-does-not-hit-network' }),
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ categories: [] }),
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
// suggestPinTasks
// ============================================================================

describe('suggestPinTasks', () => {
  it('throws when no API key is configured', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({ anthropicApiKey: '' });

    await expect(suggestPinTasks([makeTask()], 0)).rejects.toThrow('No API key');
  });

  it('returns [] when the pinned list is already full', async () => {
    const result = await suggestPinTasks([makeTask()], MAX_SUGGESTED_PINS);
    expect(result).toEqual([]);
  });

  it('returns [] when there are no non-pinned candidate tasks', async () => {
    const result = await suggestPinTasks(
      [makeTask({ pinned: true })],
      0,
    );
    expect(result).toEqual([]);
  });

  it('returns all candidate IDs without calling the API when candidates ≤ needed', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    // 2 already pinned → need 1 more; only 1 unpinned candidate
    const result = await suggestPinTasks(
      [makeTask({ id: 'a', pinned: false })],
      2,
    );
    expect(result).toEqual(['a']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws on a non-OK HTTP response', async () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' }), makeTask({ id: 'd' })];
    mockFetchOnce({}, 500);
    await expect(suggestPinTasks(tasks, 2)).rejects.toThrow('API error 500');
  });

  it('throws when the response contains no tool_use block', async () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' }), makeTask({ id: 'd' })];
    mockFetchOnce({ content: [{ type: 'text' }] });
    await expect(suggestPinTasks(tasks, 2)).rejects.toThrow('No suggestion returned');
  });

  it('returns the suggested task IDs', async () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
      makeTask({ id: 'd' }),
    ];
    // none pinned → need 3, so all 4 candidates aren't auto-returned
    mockFetchOnce(toolUseResponse('pin', { task_ids: ['b', 'c', 'd'] }));
    const result = await suggestPinTasks(tasks, 0);
    expect(result).toEqual(['b', 'c', 'd']);
  });

  it('filters out IDs that are not valid candidate tasks', async () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' }), makeTask({ id: 'd' })];
    // Model returns a hallucinated ID alongside valid ones
    mockFetchOnce(toolUseResponse('pin', { task_ids: ['a', 'hallucinated-id', 'c'] }));
    const result = await suggestPinTasks(tasks, 0);
    expect(result).toContain('a');
    expect(result).toContain('c');
    expect(result).not.toContain('hallucinated-id');
  });

  it('never returns more IDs than needed to fill the pinned list', async () => {
    // 2 already pinned → need 1; model returns 3
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' }), makeTask({ id: 'd' })];
    mockFetchOnce(toolUseResponse('pin', { task_ids: ['a', 'b', 'c'] }));
    const result = await suggestPinTasks(tasks, 2);
    expect(result).toHaveLength(1);
  });

  it('excludes already-pinned tasks from the candidate list sent to the API', async () => {
    const tasks = [
      makeTask({ id: 'pinned', pinned: true }),
      makeTask({ id: 'unpinned-a' }),
      makeTask({ id: 'unpinned-b' }),
      makeTask({ id: 'unpinned-c' }),
      makeTask({ id: 'unpinned-d' }),
    ];
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('pin', { task_ids: ['unpinned-a'] })),
    } as Response);

    // none pinned → need 3, less than the 4 unpinned candidates, so the API is called
    await suggestPinTasks(tasks, 0);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).not.toContain('id:pinned');
    expect(content).toContain('id:unpinned-a');
  });

  describe('categories opted out of suggested pins', () => {
    const makeCategory = (name: string, exclude: boolean): Category => ({
      id: `cat-${name}`,
      name,
      scheduleDays: null,
      scheduleStart: null,
      scheduleEnd: null,
      hideOnVacation: false,
      excludeFromPinSuggestions: exclude,
      sortOrder: 1,
      emoji: null,
    });

    /** Point the mocked category store at a specific set of categories. */
    const withCategories = (categories: Category[]) => {
      jest.spyOn(
        require('../store/useCategoryStore').useCategoryStore,
        'getState',
      ).mockReturnValue({ categories });
    };

    it('keeps excluded-category tasks out of the candidate list sent to the API', async () => {
      withCategories([makeCategory('Routine', true), makeCategory('Work', false)]);
      const tasks = [
        makeTask({ id: 'shower', category: 'Routine' }),
        makeTask({ id: 'teeth', category: 'Routine' }),
        makeTask({ id: 'deck', category: 'Work' }),
        makeTask({ id: 'email', category: 'Work' }),
        makeTask({ id: 'review', category: 'Work' }),
        makeTask({ id: 'loose', category: null }),
      ];
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(toolUseResponse('pin', { task_ids: ['deck'] })),
      } as Response);

      await suggestPinTasks(tasks, 0);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      const content = body.messages[0].content as string;
      expect(content).not.toContain('id:shower');
      expect(content).not.toContain('id:teeth');
      expect(content).toContain('id:deck');
      expect(content).toContain('id:loose');
    });

    it('returns [] rather than calling the API when every candidate is excluded', async () => {
      withCategories([makeCategory('Routine', true)]);
      const fetchSpy = jest.spyOn(global, 'fetch');
      const result = await suggestPinTasks(
        [makeTask({ id: 'shower', category: 'Routine' }), makeTask({ id: 'teeth', category: 'Routine' })],
        0,
      );
      expect(result).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('counts remaining candidates after exclusion, not before', async () => {
      withCategories([makeCategory('Routine', true)]);
      const fetchSpy = jest.spyOn(global, 'fetch');
      // 5 tasks, but only 2 survive exclusion — under the 3 needed, so they
      // are returned wholesale instead of being sent to the model.
      const result = await suggestPinTasks(
        [
          makeTask({ id: 'shower', category: 'Routine' }),
          makeTask({ id: 'teeth', category: 'Routine' }),
          makeTask({ id: 'gym', category: 'Routine' }),
          makeTask({ id: 'deck', category: 'Work' }),
          makeTask({ id: 'email', category: 'Work' }),
        ],
        0,
      );
      expect(result).toEqual(['deck', 'email']);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('ignores the flag on categories that are not excluded', async () => {
      withCategories([makeCategory('Work', false)]);
      const fetchSpy = jest.spyOn(global, 'fetch');
      const result = await suggestPinTasks(
        [makeTask({ id: 'deck', category: 'Work' })],
        MAX_SUGGESTED_PINS - 1,
      );
      expect(result).toEqual(['deck']);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// buildCoCompletionHints (tested indirectly via suggestPinTasks)
// ============================================================================

describe('co-completion hints in suggestPinTasks prompt', () => {
  it('includes co-completion pairs that appear more than once within 2 hours', async () => {
    const base = new Date('2025-06-09T09:00:00.000Z').getTime();
    const hr = 60 * 60 * 1000;

    const completedTasks: Task[] = [
      // Session 1: A and B completed within 2 hrs of each other — twice
      makeTask({ id: 'a1', title: 'Task Alpha', completed: true, completedAt: new Date(base).toISOString() }),
      makeTask({ id: 'b1', title: 'Task Beta', completed: true, completedAt: new Date(base + hr).toISOString() }),
      // Session 2: same pair again
      makeTask({ id: 'a2', title: 'Task Alpha', completed: true, completedAt: new Date(base + 24 * hr).toISOString() }),
      makeTask({ id: 'b2', title: 'Task Beta', completed: true, completedAt: new Date(base + 25 * hr).toISOString() }),
    ];

    const candidates = [
      makeTask({ id: 'x1', title: 'Task Alpha' }),
      makeTask({ id: 'x2', title: 'Task Beta' }),
      makeTask({ id: 'x3', title: 'Other' }),
      makeTask({ id: 'x4', title: 'Another' }),
    ];

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('pin', { task_ids: ['x1', 'x2', 'x3'] })),
    } as Response);

    // 2 already pinned → need 3, less than the 4 candidates, so the API is called
    await suggestPinTasks(candidates, 2, completedTasks);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content.toLowerCase()).toContain('task alpha');
    expect(content.toLowerCase()).toContain('task beta');
  });

  it('omits co-completion hints when no pair appears more than once', async () => {
    const base = new Date('2025-06-09T09:00:00.000Z').getTime();
    const hr = 60 * 60 * 1000;

    // Only one co-completion session — count is 1, not > 1, so should be omitted
    const completedTasks: Task[] = [
      makeTask({ id: 'c1', title: 'Task Alpha', completed: true, completedAt: new Date(base).toISOString() }),
      makeTask({ id: 'c2', title: 'Task Beta', completed: true, completedAt: new Date(base + hr).toISOString() }),
    ];

    const candidates = [
      makeTask({ id: 'x1', title: 'Task Alpha' }),
      makeTask({ id: 'x2', title: 'Task Beta' }),
      makeTask({ id: 'x3', title: 'Other' }),
      makeTask({ id: 'x4', title: 'Another' }),
    ];

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('pin', { task_ids: ['x1'] })),
    } as Response);

    // 2 already pinned → need 3, less than the 4 candidates, so the API is called
    await suggestPinTasks(candidates, 2, completedTasks);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).not.toContain('historically completed together');
  });

  it('omits co-completion hints when tasks were completed more than 2 hours apart', async () => {
    const base = new Date('2025-06-09T09:00:00.000Z').getTime();
    const hr = 60 * 60 * 1000;

    const completedTasks: Task[] = [
      makeTask({ id: 'c1', title: 'Task Alpha', completed: true, completedAt: new Date(base).toISOString() }),
      // 3 hours apart — outside the 2-hour window
      makeTask({ id: 'c2', title: 'Task Beta', completed: true, completedAt: new Date(base + 3 * hr).toISOString() }),
      // Repeat — but still outside window
      makeTask({ id: 'c3', title: 'Task Alpha', completed: true, completedAt: new Date(base + 24 * hr).toISOString() }),
      makeTask({ id: 'c4', title: 'Task Beta', completed: true, completedAt: new Date(base + 27 * hr + 1).toISOString() }),
    ];

    const candidates = [
      makeTask({ id: 'x1', title: 'Task Alpha' }),
      makeTask({ id: 'x2', title: 'Task Beta' }),
      makeTask({ id: 'x3', title: 'C' }),
      makeTask({ id: 'x4', title: 'D' }),
    ];

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('pin', { task_ids: ['x1'] })),
    } as Response);

    // 2 already pinned → need 3, less than the 4 candidates, so the API is called
    await suggestPinTasks(candidates, 2, completedTasks);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).not.toContain('historically completed together');
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
