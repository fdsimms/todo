/**
 * Tests for src/services/aiSuggestions.ts.
 *
 * All network calls are intercepted via a jest.spyOn on global.fetch —
 * no real API tokens are used or required.
 */

import {
  suggestTaskAttributes,
  suggestTaskDate,
  suggestTaskEffort,
  suggestFocusTasks,
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
  dueDate: null,
  deferUntil: null,
  timeSegments: [],
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceEndDate: null,
  recurrenceFromCompletion: false,
  tags: [],
  category: null,
  sortOrder: 1,
  focused: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  parentId: null,
  reminderTime: null,
  cycleEnabled: false,
  cycleIndex: 0,
  cycleItems: [],
  vacationPause: false,
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

  it('clamps effort above 5 to 5', async () => {
    mockFetchOnce(toolUseResponse('suggest', { tags: [], effort: 99, category: '' }));
    const result = await suggestTaskAttributes('task', '', [], []);
    expect(result.effort).toBe(5);
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
// suggestTaskEffort
// ============================================================================

describe('suggestTaskEffort', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null minutes when the model is not confident', async () => {
    mockFetchOnce(toolUseResponse('estimate', { confident: false, minutes: 120, reason: 'Too vague to estimate.' }));
    const result = await suggestTaskEffort('do the thing', '');
    expect(result.minutes).toBeNull();
    expect(result.reason).toBe('Too vague to estimate.');
  });

  it('returns the estimated minutes when confident', async () => {
    mockFetchOnce(toolUseResponse('estimate', { confident: true, minutes: 45, reason: 'Short focused task.' }));
    const result = await suggestTaskEffort('Reply to 3 emails', '');
    expect(result.minutes).toBe(45);
    expect(result.reason).toBe('Short focused task.');
  });

  it('clamps an absurdly large estimate to the daily cap', async () => {
    mockFetchOnce(toolUseResponse('estimate', { confident: true, minutes: 99999, reason: 'Huge.' }));
    const result = await suggestTaskEffort('Build an OS', '');
    expect(result.minutes).toBe(1440);
  });

  it('treats a non-positive estimate as an abstain', async () => {
    mockFetchOnce(toolUseResponse('estimate', { confident: true, minutes: 0, reason: 'n/a' }));
    const result = await suggestTaskEffort('x', '');
    expect(result.minutes).toBeNull();
  });

  it('throws without an API error response', async () => {
    mockFetchOnce({}, 500);
    await expect(suggestTaskEffort('x', '')).rejects.toThrow('API error 500');
  });
});

// ============================================================================
// suggestTaskDate
// ============================================================================

describe('suggestTaskDate', () => {
  // Pin the clock so candidate dates are deterministic.
  // "today" = 2025-06-09 → candidates are 2025-06-10 … 2025-06-16
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-09T10:00:00.000Z'));
  });

  it('throws when no API key is configured', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({ anthropicApiKey: '' });

    await expect(suggestTaskDate('title', '', 0, [])).rejects.toThrow('No API key');
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetchOnce({}, 503);
    await expect(suggestTaskDate('title', '', 0, [])).rejects.toThrow('API error 503');
  });

  it('throws when the response contains no tool_use block', async () => {
    mockFetchOnce({ content: [] });
    await expect(suggestTaskDate('title', '', 0, [])).rejects.toThrow('No suggestion returned');
  });

  it('returns the date and reason from the tool_use response', async () => {
    mockFetchOnce(
      toolUseResponse('schedule', { date: '2025-06-12', reason: 'Light load on Thursday.' }),
    );
    const result = await suggestTaskDate('Review PR', '', 2, []);
    expect(result.date).toBe('2025-06-12');
    expect(result.reason).toBe('Light load on Thursday.');
  });

  it('falls back to the lightest day when the model returns an off-list date', async () => {
    // Load up 2025-06-10 heavily so it is NOT the lightest day
    const heavyTask = makeTask({ id: 'h', effort: 5, dueDate: '2025-06-10T00:00:00.000Z' });

    mockFetchOnce(
      toolUseResponse('schedule', { date: '1999-01-01', reason: 'Bad date.' }),
    );
    const result = await suggestTaskDate('task', '', 0, [heavyTask]);

    // Fallback should skip 2025-06-10 (effort=5) and pick the first day with load=0
    expect(result.date).not.toBe('1999-01-01');
    expect(result.date).not.toBe('2025-06-10');
    // The lightest day is 2025-06-11 (first day with zero load)
    expect(result.date).toBe('2025-06-11');
  });

  it('provides a default reason when the model returns an empty one', async () => {
    mockFetchOnce(
      toolUseResponse('schedule', { date: '2025-06-11', reason: '   ' }),
    );
    const result = await suggestTaskDate('task', '', 0, []);
    expect(result.reason).toBe('Balances your upcoming workload.');
  });

  it('only counts non-completed tasks with due dates in the load calculation', async () => {
    // These should NOT contribute to load
    const completed = makeTask({ id: 'c', completed: true, completedAt: '2025-06-09T10:00:00.000Z', dueDate: '2025-06-10T00:00:00.000Z', effort: 5 });
    const noDate = makeTask({ id: 'n', effort: 5, dueDate: null });
    // This one IS in the window and open
    const open = makeTask({ id: 'o', effort: 3, dueDate: '2025-06-10T00:00:00.000Z' });

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('schedule', { date: '2025-06-10', reason: 'ok' })),
    } as Response);

    await suggestTaskDate('task', '', 0, [completed, noDate, open]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    // 2025-06-10 should reflect only the open task's time (effort 3 → 90min → 1.5h),
    // not the completed/no-date tasks.
    expect(content).toContain('2025-06-10');
    expect(content).toContain('load 1.5h');
  });

  it('ignores tasks due outside the 7-day horizon', async () => {
    const farFuture = makeTask({ id: 'ff', effort: 5, dueDate: '2025-07-31T00:00:00.000Z' });

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('schedule', { date: '2025-06-10', reason: 'ok' })),
    } as Response);

    await suggestTaskDate('task', '', 0, [farFuture]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    // 2025-06-10 should show no load (0m), since the far-future task is out of window
    expect(content).toMatch(/2025-06-10.*load 0m/);
  });
});

// ============================================================================
// suggestFocusTasks
// ============================================================================

describe('suggestFocusTasks', () => {
  it('throws when no API key is configured', async () => {
    jest.spyOn(
      require('../store/useSettingsStore').useSettingsStore,
      'getState',
    ).mockReturnValue({ anthropicApiKey: '' });

    await expect(suggestFocusTasks([makeTask()], 0)).rejects.toThrow('No API key');
  });

  it('returns [] when already 3 tasks are focused', async () => {
    const result = await suggestFocusTasks([makeTask()], 3);
    expect(result).toEqual([]);
  });

  it('returns [] when there are no non-focused candidate tasks', async () => {
    const result = await suggestFocusTasks(
      [makeTask({ focused: true })],
      0,
    );
    expect(result).toEqual([]);
  });

  it('returns all candidate IDs without calling the API when candidates ≤ needed', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    // 2 already focused → need 1 more; only 1 unfocused candidate
    const result = await suggestFocusTasks(
      [makeTask({ id: 'a', focused: false })],
      2,
    );
    expect(result).toEqual(['a']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws on a non-OK HTTP response', async () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' }), makeTask({ id: 'd' })];
    mockFetchOnce({}, 500);
    await expect(suggestFocusTasks(tasks, 0)).rejects.toThrow('API error 500');
  });

  it('throws when the response contains no tool_use block', async () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' }), makeTask({ id: 'd' })];
    mockFetchOnce({ content: [{ type: 'text' }] });
    await expect(suggestFocusTasks(tasks, 0)).rejects.toThrow('No suggestion returned');
  });

  it('returns the suggested task IDs', async () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
      makeTask({ id: 'd' }),
    ];
    mockFetchOnce(toolUseResponse('focus', { task_ids: ['b', 'c', 'd'] }));
    const result = await suggestFocusTasks(tasks, 0);
    expect(result).toEqual(['b', 'c', 'd']);
  });

  it('filters out IDs that are not valid candidate tasks', async () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' }), makeTask({ id: 'd' })];
    // Model returns a hallucinated ID alongside valid ones
    mockFetchOnce(toolUseResponse('focus', { task_ids: ['a', 'hallucinated-id', 'c'] }));
    const result = await suggestFocusTasks(tasks, 0);
    expect(result).toContain('a');
    expect(result).toContain('c');
    expect(result).not.toContain('hallucinated-id');
  });

  it('never returns more IDs than needed to reach 3 focused', async () => {
    // 2 already focused → need 1; model returns 3
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' }), makeTask({ id: 'd' })];
    mockFetchOnce(toolUseResponse('focus', { task_ids: ['a', 'b', 'c'] }));
    const result = await suggestFocusTasks(tasks, 2);
    expect(result).toHaveLength(1);
  });

  it('excludes already-focused tasks from the candidate list sent to the API', async () => {
    const tasks = [
      makeTask({ id: 'focused', focused: true }),
      makeTask({ id: 'unfocused-a' }),
      makeTask({ id: 'unfocused-b' }),
      makeTask({ id: 'unfocused-c' }),
      makeTask({ id: 'unfocused-d' }),
    ];
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(toolUseResponse('focus', { task_ids: ['unfocused-a'] })),
    } as Response);

    await suggestFocusTasks(tasks, 0);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).not.toContain('id:focused');
    expect(content).toContain('id:unfocused-a');
  });
});

// ============================================================================
// buildCoCompletionHints (tested indirectly via suggestFocusTasks)
// ============================================================================

describe('co-completion hints in suggestFocusTasks prompt', () => {
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
      json: () => Promise.resolve(toolUseResponse('focus', { task_ids: ['x1', 'x2', 'x3'] })),
    } as Response);

    await suggestFocusTasks(candidates, 0, completedTasks);

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
      json: () => Promise.resolve(toolUseResponse('focus', { task_ids: ['x1'] })),
    } as Response);

    await suggestFocusTasks(candidates, 0, completedTasks);

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
      json: () => Promise.resolve(toolUseResponse('focus', { task_ids: ['x1'] })),
    } as Response);

    await suggestFocusTasks(candidates, 0, completedTasks);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content as string;
    expect(content).not.toContain('historically completed together');
  });
});
