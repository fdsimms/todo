/**
 * The store holding the last read of the person's YNAB plan. Scoped to the
 * part with branching of its own: when a read happens, what a failure leaves
 * behind, the rate-limit backoff, choosing the only plan, and whether a read
 * that lands late may still be written. The read itself is `services/ynab.ts`'s.
 */
const settings: Record<string, unknown> = {};
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));
jest.mock('../services/ynab', () => ({
  fetchYnab: jest.fn(),
  fetchYnabPlans: jest.fn(),
  ynabWanted: (s: { ynabTasks: boolean; ynabGroceryBudget: boolean }) => s.ynabTasks || s.ynabGroceryBudget,
}));
jest.mock('../utils/secureApiKey', () => ({
  YNAB_TOKEN_SECURE_KEY: 'ynabApiToken',
  loadSecureKey: jest.fn(),
  saveSecureKey: jest.fn(),
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));

import { resetYnabBackoffForTests, useYnabStore } from '../store/useYnabStore';
import { fetchYnab, fetchYnabPlans } from '../services/ynab';
import { loadSecureKey, saveSecureKey } from '../utils/secureApiKey';
import { isDemoModeActive } from '../utils/demoState';
import { ynabMonthKey } from '../utils/ynabPlan';

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  fetchedAt: new Date().toISOString(),
  planId: 'p1',
  monthKey: ynabMonthKey(new Date()),
  serverKnowledge: 3,
  queue: { unapproved: 2, uncategorized: 0, total: 2 },
  categories: [],
  ...overrides,
});

const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  resetYnabBackoffForTests();
  useYnabStore.setState({ snapshot: null, plans: null, problem: null, hasToken: false, refreshing: false });
  Object.assign(settings, {
    ynabTasks: true,
    ynabGroceryBudget: false,
    ynabPlanId: 'p1',
    setYnabPlanId: jest.fn((id: string) => { settings.ynabPlanId = id; }),
  });
  (isDemoModeActive as jest.Mock).mockReturnValue(false);
  (loadSecureKey as jest.Mock).mockResolvedValue('token');
  (saveSecureKey as jest.Mock).mockResolvedValue(true);
  (fetchYnab as jest.Mock).mockResolvedValue({ ok: true, snapshot: snapshot() });
  (fetchYnabPlans as jest.Mock).mockResolvedValue({ ok: true, plans: [{ id: 'p1', name: 'Home' }] });
});

describe('refresh', () => {
  it('stores the read and that a token is saved', async () => {
    await useYnabStore.getState().refresh();
    expect(useYnabStore.getState().snapshot?.queue?.total).toBe(2);
    expect(useYnabStore.getState().hasToken).toBe(true);
    expect(fetchYnab).toHaveBeenCalledWith('token', expect.objectContaining({ planId: 'p1', queue: true, previous: null }));
  });

  it('asks for the queue only while the task is on', async () => {
    Object.assign(settings, { ynabTasks: false, ynabGroceryBudget: true });
    await useYnabStore.getState().refresh();
    expect(fetchYnab).toHaveBeenCalledWith('token', expect.objectContaining({ queue: false }));
  });

  it('hands the last read over, so the next one can be a delta', async () => {
    await useYnabStore.getState().refresh();
    await useYnabStore.getState().refresh(true);
    expect((fetchYnab as jest.Mock).mock.calls[1][1].previous).toEqual(expect.objectContaining({ serverKnowledge: 3 }));
  });

  it('leaves a fresh read alone unless forced', async () => {
    await useYnabStore.getState().refresh();
    await useYnabStore.getState().refresh();
    expect(fetchYnab).toHaveBeenCalledTimes(1);
  });

  it('reads again for another plan or a new month', async () => {
    useYnabStore.setState({ snapshot: snapshot({ planId: 'p0' }) as never });
    await useYnabStore.getState().refresh();
    useYnabStore.setState({ snapshot: snapshot({ monthKey: '2000-01' }) as never });
    await useYnabStore.getState().refresh();
    expect(fetchYnab).toHaveBeenCalledTimes(2);
  });

  it('does nothing with both features off, in demo mode, or without a token', async () => {
    Object.assign(settings, { ynabTasks: false, ynabGroceryBudget: false });
    await useYnabStore.getState().refresh(true);
    settings.ynabTasks = true;
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    await useYnabStore.getState().refresh(true);
    (isDemoModeActive as jest.Mock).mockReturnValue(false);
    (loadSecureKey as jest.Mock).mockResolvedValue('');
    await useYnabStore.getState().refresh(true);
    expect(fetchYnab).not.toHaveBeenCalled();
    expect(useYnabStore.getState().hasToken).toBe(false);
  });

  it('reads the plans instead while none is chosen', async () => {
    settings.ynabPlanId = null;
    useYnabStore.setState({ hasToken: true });
    await useYnabStore.getState().refresh();
    await flush();
    expect(fetchYnabPlans).toHaveBeenCalledTimes(1);
    // The only plan on the account is chosen, and read.
    expect(settings.setYnabPlanId).toHaveBeenCalledWith('p1');
    expect(fetchYnab).toHaveBeenCalledTimes(1);
  });

  it('drops the read when the token is refused, and keeps it through an outage', async () => {
    await useYnabStore.getState().refresh();
    (fetchYnab as jest.Mock).mockResolvedValue({ ok: false, problem: 'unavailable' });
    await useYnabStore.getState().refresh(true);
    expect(useYnabStore.getState().snapshot).not.toBeNull();
    expect(useYnabStore.getState().problem).toBe('unavailable');
    (fetchYnab as jest.Mock).mockResolvedValue({ ok: false, problem: 'unauthorized' });
    await useYnabStore.getState().refresh(true);
    expect(useYnabStore.getState().snapshot).toBeNull();
    expect(useYnabStore.getState().problem).toBe('unauthorized');
  });

  it('stands down after YNAB says to slow down, even when forced', async () => {
    (fetchYnab as jest.Mock).mockResolvedValue({ ok: false, problem: 'rateLimited' });
    await useYnabStore.getState().refresh(true);
    await useYnabStore.getState().refresh(true);
    expect(fetchYnab).toHaveBeenCalledTimes(1);
    expect(useYnabStore.getState().problem).toBe('rateLimited');
  });
});

describe('a read that lands late', () => {
  it('is not written back after the store was cleared', async () => {
    let release: (v: unknown) => void = () => {};
    (fetchYnab as jest.Mock).mockReturnValue(new Promise(resolve => { release = resolve; }));
    const inFlight = useYnabStore.getState().refresh();
    await Promise.resolve();
    await Promise.resolve();
    useYnabStore.getState().clear();
    release({ ok: true, snapshot: snapshot() });
    await inFlight;
    expect(useYnabStore.getState().snapshot).toBeNull();
    expect(useYnabStore.getState().refreshing).toBe(false);
  });

  it('is not written back once another plan was chosen', async () => {
    let release: (v: unknown) => void = () => {};
    (fetchYnab as jest.Mock).mockReturnValue(new Promise(resolve => { release = resolve; }));
    const inFlight = useYnabStore.getState().refresh();
    await Promise.resolve();
    await Promise.resolve();
    settings.ynabPlanId = 'p2';
    release({ ok: true, snapshot: snapshot() });
    await inFlight;
    expect(useYnabStore.getState().snapshot).toBeNull();
  });
});

describe('loadPlans', () => {
  it('says so when the chosen plan is gone from the account', async () => {
    settings.ynabPlanId = 'gone';
    await useYnabStore.getState().loadPlans();
    expect(useYnabStore.getState().problem).toBe('notFound');
    expect(fetchYnab).not.toHaveBeenCalled();
  });

  it('chooses nothing when the account has several plans', async () => {
    settings.ynabPlanId = null;
    (fetchYnabPlans as jest.Mock).mockResolvedValue({ ok: true, plans: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    await useYnabStore.getState().loadPlans();
    expect(settings.setYnabPlanId).not.toHaveBeenCalled();
    expect(useYnabStore.getState().plans).toHaveLength(2);
  });
});

describe('setToken', () => {
  it('saves a trimmed token readable while locked, forgets the old read and checks the new one', async () => {
    useYnabStore.setState({ snapshot: snapshot() as never, plans: [{ id: 'x', name: 'Old' }] });
    expect(await useYnabStore.getState().setToken('  abc  ')).toBe(true);
    expect(saveSecureKey).toHaveBeenCalledWith('ynabApiToken', 'abc', { readableWhileLocked: true });
    expect(useYnabStore.getState().snapshot).toBeNull();
    await flush();
    expect(fetchYnabPlans).toHaveBeenCalledTimes(1);
    expect(useYnabStore.getState().plans).toEqual([{ id: 'p1', name: 'Home' }]);
  });

  it('removes the token on an empty one, without reading', async () => {
    useYnabStore.setState({ hasToken: true });
    expect(await useYnabStore.getState().setToken('')).toBe(true);
    expect(useYnabStore.getState().hasToken).toBe(false);
    expect(fetchYnabPlans).not.toHaveBeenCalled();
  });
});
