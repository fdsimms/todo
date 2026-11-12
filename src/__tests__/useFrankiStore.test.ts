/**
 * The store holding the last read of the person's Franki server. Scoped to
 * what has branching of its own: when a read happens, what a failure leaves
 * behind, and that a read landing after the key changed isn't written. The
 * read itself is `services/franki.ts`'s, tested there.
 */
const settings: Record<string, unknown> = {};
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));
jest.mock('../services/franki', () => ({ fetchFranki: jest.fn() }));
jest.mock('../utils/secureApiKey', () => ({
  FRANKI_TOKEN_SECURE_KEY: 'frankiStatusToken',
  loadSecureKey: jest.fn(),
  saveSecureKey: jest.fn(),
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));

import { useFrankiStore } from '../store/useFrankiStore';
import { fetchFranki } from '../services/franki';
import { loadSecureKey, saveSecureKey } from '../utils/secureApiKey';
import { isDemoModeActive } from '../utils/demoState';

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  fetchedAt: new Date().toISOString(),
  reviewsNow: 12,
  upcoming: [],
  dayEndsAt: new Date(Date.now() + 3600_000).toISOString(),
  readListen: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  useFrankiStore.setState({ snapshot: null, problem: null, problemDetail: null, hasToken: false, refreshing: false });
  Object.assign(settings, { frankiTasks: true });
  (isDemoModeActive as jest.Mock).mockReturnValue(false);
  (loadSecureKey as jest.Mock).mockResolvedValue('key');
  (saveSecureKey as jest.Mock).mockResolvedValue(true);
  (fetchFranki as jest.Mock).mockResolvedValue({ ok: true, snapshot: snapshot() });
});

describe('refresh', () => {
  it('stores the read and that a key is saved', async () => {
    await useFrankiStore.getState().refresh();
    const state = useFrankiStore.getState();
    expect(state.snapshot?.reviewsNow).toBe(12);
    expect(state.hasToken).toBe(true);
    expect(state.problem).toBeNull();
    expect(state.refreshing).toBe(false);
  });

  it('reads nothing switched off, in demo mode, or without a key', async () => {
    settings.frankiTasks = false;
    await useFrankiStore.getState().refresh(true);
    settings.frankiTasks = true;
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    await useFrankiStore.getState().refresh(true);
    (isDemoModeActive as jest.Mock).mockReturnValue(false);
    (loadSecureKey as jest.Mock).mockResolvedValue('');
    await useFrankiStore.getState().refresh(true);
    expect(fetchFranki).not.toHaveBeenCalled();
    expect(useFrankiStore.getState().hasToken).toBe(false);
  });

  it('skips a read while the last one is fresh, and reads again once Anki’s day has turned', async () => {
    await useFrankiStore.getState().refresh();
    await useFrankiStore.getState().refresh();
    expect(fetchFranki).toHaveBeenCalledTimes(1);
    useFrankiStore.setState({ snapshot: snapshot({ dayEndsAt: new Date(Date.now() - 1000).toISOString() }) });
    await useFrankiStore.getState().refresh();
    expect(fetchFranki).toHaveBeenCalledTimes(2);
  });

  it('drops the read on a refused key, and keeps it through an outage', async () => {
    await useFrankiStore.getState().refresh();
    (fetchFranki as jest.Mock).mockResolvedValue({ ok: false, problem: 'unavailable', detail: 'Couldn’t read Anki.' });
    await useFrankiStore.getState().refresh(true);
    expect(useFrankiStore.getState()).toMatchObject({ problem: 'unavailable', problemDetail: 'Couldn’t read Anki.' });
    expect(useFrankiStore.getState().snapshot).not.toBeNull();
    (fetchFranki as jest.Mock).mockResolvedValue({ ok: false, problem: 'unauthorized', detail: null });
    await useFrankiStore.getState().refresh(true);
    expect(useFrankiStore.getState().snapshot).toBeNull();
  });

  it('doesn’t write a read that lands after the key changed', async () => {
    let land: (value: unknown) => void = () => {};
    (fetchFranki as jest.Mock).mockReturnValue(new Promise(resolve => { land = resolve; }));
    const pending = useFrankiStore.getState().refresh(true);
    await Promise.resolve();
    await Promise.resolve();
    (fetchFranki as jest.Mock).mockResolvedValue({ ok: true, snapshot: snapshot({ reviewsNow: 3 }) });
    await useFrankiStore.getState().setToken('new key');
    land({ ok: true, snapshot: snapshot({ reviewsNow: 99 }) });
    await pending;
    await Promise.resolve();
    expect(useFrankiStore.getState().snapshot?.reviewsNow).not.toBe(99);
  });
});

describe('setToken', () => {
  it('saves the key readable while locked and reads with it; an empty one removes it', async () => {
    await useFrankiStore.getState().setToken(' key ');
    expect(saveSecureKey).toHaveBeenCalledWith('frankiStatusToken', 'key', { readableWhileLocked: true });
    expect(fetchFranki).toHaveBeenCalled();
    await useFrankiStore.getState().setToken('');
    expect(useFrankiStore.getState()).toMatchObject({ hasToken: false, snapshot: null });
  });
});
