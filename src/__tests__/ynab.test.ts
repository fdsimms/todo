const settings: Record<string, unknown> = { ynabTasks: true, ynabGroceryBudget: false };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));

import { fetchYnab, fetchYnabPlans, ynabProblemForStatus, ynabWanted } from '../services/ynab';
import { isDemoModeActive } from '../utils/demoState';
import type { YnabSnapshot } from '../utils/ynabPlan';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const NOW = new Date(Date.UTC(2026, 10, 5, 15));
const categoriesBody = (balance: number, knowledge = 7) => ({
  data: {
    server_knowledge: knowledge,
    category_groups: [{
      id: 'g1', name: 'Everyday', hidden: false, deleted: false, internal: false,
      categories: [{ id: 'c1', name: 'Groceries', balance, hidden: false, deleted: false, internal: false, category_group_id: 'g1' }],
    }],
  },
});
const transactionsBody = (ids: string[]) => ({ data: { server_knowledge: 3, transactions: ids.map(id => ({ id, deleted: false })) } });

let fetchMock: jest.Mock;
beforeEach(() => {
  Object.assign(settings, { ynabTasks: true, ynabGroceryBudget: false });
  (isDemoModeActive as jest.Mock).mockReturnValue(false);
  fetchMock = jest.fn(async (url: string) => {
    if (url.endsWith('/plans')) return jsonResponse({ data: { plans: [{ id: 'p1', name: 'Home' }] } });
    if (url.includes('/categories')) return jsonResponse(categoriesBody(36000));
    if (url.includes('type=unapproved')) return jsonResponse(transactionsBody(['t1', 't2']));
    if (url.includes('type=uncategorized')) return jsonResponse(transactionsBody(['t2', 't3']));
    return jsonResponse({}, 404);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const urls = () => fetchMock.mock.calls.map(call => String(call[0]));

describe('the gate', () => {
  it('reads nothing in demo mode, with every feature off, or without a token', async () => {
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    expect(await fetchYnab('token', { planId: 'p1', queue: true, previous: null, now: NOW })).toBeNull();
    expect(await fetchYnabPlans('token')).toBeNull();
    (isDemoModeActive as jest.Mock).mockReturnValue(false);
    Object.assign(settings, { ynabTasks: false, ynabGroceryBudget: false });
    expect(await fetchYnab('token', { planId: 'p1', queue: true, previous: null, now: NOW })).toBeNull();
    Object.assign(settings, { ynabGroceryBudget: true });
    expect(await fetchYnab('', { planId: 'p1', queue: true, previous: null, now: NOW })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is open with either feature on', () => {
    expect(ynabWanted({ ynabTasks: false, ynabGroceryBudget: true })).toBe(true);
    expect(ynabWanted({ ynabTasks: true, ynabGroceryBudget: false })).toBe(true);
    expect(ynabWanted({ ynabTasks: false, ynabGroceryBudget: false })).toBe(false);
  });
});

describe('fetchYnab', () => {
  it('reads the categories and the queue with the token, by GET on the plans paths', async () => {
    const result = await fetchYnab('secret', { planId: 'p1', queue: true, previous: null, now: NOW });
    expect(result).toEqual({
      ok: true,
      snapshot: {
        fetchedAt: NOW.toISOString(),
        planId: 'p1',
        monthKey: '2026-11',
        serverKnowledge: 7,
        queue: { unapproved: 2, uncategorized: 2, total: 3 },
        categories: [{ id: 'c1', name: 'Groceries', groupId: 'g1', groupName: 'Everyday', balanceMinor: 3600, hidden: false }],
      },
    });
    expect(urls()).toEqual([
      'https://api.ynab.com/v1/plans/p1/categories',
      'https://api.ynab.com/v1/plans/p1/transactions?type=unapproved',
      'https://api.ynab.com/v1/plans/p1/transactions?type=uncategorized',
    ]);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer secret' } });
    }
  });

  it('leaves the queue unread while the task is off', async () => {
    const result = await fetchYnab('t', { planId: 'p1', queue: false, previous: null, now: NOW });
    expect(result?.ok && result.snapshot.queue).toBeNull();
    expect(urls()).toEqual(['https://api.ynab.com/v1/plans/p1/categories']);
  });

  it('asks for a delta over a read of the same plan and month', async () => {
    const previous: YnabSnapshot = {
      fetchedAt: NOW.toISOString(), planId: 'p1', monthKey: '2026-11', serverKnowledge: 5, queue: null,
      categories: [{ id: 'c9', name: 'Gifts', groupId: 'g1', groupName: 'Everyday', balanceMinor: 100, hidden: false }],
    };
    const result = await fetchYnab('t', { planId: 'p1', queue: false, previous, now: NOW });
    expect(urls()).toEqual(['https://api.ynab.com/v1/plans/p1/categories?last_knowledge_of_server=5']);
    expect(result?.ok && result.snapshot.categories.map(c => c.id).sort()).toEqual(['c1', 'c9']);
  });

  it('reads in full for a new month or another plan', async () => {
    const previous: YnabSnapshot = {
      fetchedAt: NOW.toISOString(), planId: 'p1', monthKey: '2026-10', serverKnowledge: 5, queue: null, categories: [],
    };
    await fetchYnab('t', { planId: 'p1', queue: false, previous, now: NOW });
    await fetchYnab('t', { planId: 'p2', queue: false, previous: { ...previous, monthKey: '2026-11' }, now: NOW });
    expect(urls()).toEqual([
      'https://api.ynab.com/v1/plans/p1/categories',
      'https://api.ynab.com/v1/plans/p2/categories',
    ]);
  });

  it('names why a read failed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: {} }, 401));
    expect(await fetchYnab('t', { planId: 'p1', queue: true, previous: null, now: NOW })).toEqual({ ok: false, problem: 'unauthorized' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchYnab('t', { planId: 'p1', queue: true, previous: null, now: NOW })).toEqual({ ok: false, problem: 'unavailable' });
  });
});

describe('fetchYnabPlans', () => {
  it('reads the plans on the account', async () => {
    expect(await fetchYnabPlans('t')).toEqual({ ok: true, plans: [{ id: 'p1', name: 'Home' }] });
    expect(urls()).toEqual(['https://api.ynab.com/v1/plans']);
  });

  it('reports a refused token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    expect(await fetchYnabPlans('t')).toEqual({ ok: false, problem: 'unauthorized' });
  });
});

describe('ynabProblemForStatus', () => {
  it('maps the statuses YNAB documents', () => {
    expect(ynabProblemForStatus(401)).toBe('unauthorized');
    expect(ynabProblemForStatus(403)).toBe('unauthorized');
    expect(ynabProblemForStatus(404)).toBe('notFound');
    expect(ynabProblemForStatus(429)).toBe('rateLimited');
    expect(ynabProblemForStatus(503)).toBe('unavailable');
  });
});
