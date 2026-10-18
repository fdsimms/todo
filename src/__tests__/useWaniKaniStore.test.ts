/**
 * The store holding the last read of the person's WaniKani account.
 *
 * Scoped to the part with branching of its own: when a read happens, what it
 * asks for, what a failure leaves behind, and whether one that lands late may
 * still be written. The read itself is `services/wanikani.ts`'s, tested there.
 */
const settings: Record<string, unknown> = {};
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));
jest.mock('../services/wanikani', () => ({ fetchWaniKani: jest.fn() }));
jest.mock('../utils/secureApiKey', () => ({
  WANIKANI_TOKEN_SECURE_KEY: 'wanikaniApiToken',
  loadSecureKey: jest.fn(),
  saveSecureKey: jest.fn(),
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));

import { useWaniKaniStore } from '../store/useWaniKaniStore';
import { fetchWaniKani } from '../services/wanikani';
import { loadSecureKey, saveSecureKey } from '../utils/secureApiKey';
import { isDemoModeActive } from '../utils/demoState';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  fetchedAt: new Date().toISOString(),
  reviewsNow: 12,
  upcoming: [],
  lessonsNow: 3,
  dayKey: dayKeyOf(getCurrentDayStart()),
  lessonsDone: null,
  apprentice: null,
  ...overrides,
});

const reset = () =>
  useWaniKaniStore.setState({ snapshot: null, user: null, problem: null, hasToken: false, refreshing: false });

beforeEach(() => {
  jest.clearAllMocks();
  reset();
  Object.assign(settings, {
    dayResetTime: '00:00',
    wanikaniTasks: true,
    wanikaniLessonsPerDay: null,
    wanikaniApprenticeCap: 100,
    wanikaniLessonsLastDayKey: null,
  });
  (isDemoModeActive as jest.Mock).mockReturnValue(false);
  (loadSecureKey as jest.Mock).mockResolvedValue('token');
  (saveSecureKey as jest.Mock).mockResolvedValue(true);
  (fetchWaniKani as jest.Mock).mockResolvedValue({ ok: true, snapshot: snapshot(), user: { username: 'fdsimms', level: 14 } });
});

describe('refresh', () => {
  it('stores the read, the account and that a token is saved', async () => {
    await useWaniKaniStore.getState().refresh();
    const state = useWaniKaniStore.getState();
    expect(state.snapshot?.reviewsNow).toBe(12);
    expect(state.user).toEqual({ username: 'fdsimms', level: 14 });
    expect(state.hasToken).toBe(true);
    expect(state.problem).toBeNull();
    expect(state.refreshing).toBe(false);
  });

  it('asks for the account only until it has it', async () => {
    await useWaniKaniStore.getState().refresh();
    await useWaniKaniStore.getState().refresh(true);
    expect((fetchWaniKani as jest.Mock).mock.calls[0][1].user).toBe(true);
    expect((fetchWaniKani as jest.Mock).mock.calls[1][1].user).toBe(false);
  });

  it('asks for lessons and Apprentice only while the lessons task wants them', async () => {
    await useWaniKaniStore.getState().refresh(true);
    expect((fetchWaniKani as jest.Mock).mock.calls[0][1]).toMatchObject({ lessons: false, apprentice: false });

    settings.wanikaniLessonsPerDay = 5;
    await useWaniKaniStore.getState().refresh(true);
    expect((fetchWaniKani as jest.Mock).mock.calls[1][1]).toMatchObject({ lessons: true, apprentice: true });

    // Today's lessons task is written, so the cap has nothing left to decide.
    settings.wanikaniLessonsLastDayKey = dayKeyOf(getCurrentDayStart());
    await useWaniKaniStore.getState().refresh(true);
    expect((fetchWaniKani as jest.Mock).mock.calls[2][1]).toMatchObject({ lessons: true, apprentice: false });
  });

  it('leaves a fresh read alone unless forced', async () => {
    await useWaniKaniStore.getState().refresh();
    await useWaniKaniStore.getState().refresh();
    expect(fetchWaniKani).toHaveBeenCalledTimes(1);
    await useWaniKaniStore.getState().refresh(true);
    expect(fetchWaniKani).toHaveBeenCalledTimes(2);
  });

  it('reads again once the held read is for an earlier day', async () => {
    useWaniKaniStore.setState({ snapshot: snapshot({ dayKey: '2020-01-01' }) as never });
    await useWaniKaniStore.getState().refresh();
    expect(fetchWaniKani).toHaveBeenCalledTimes(1);
  });

  it('does nothing while switched off, in demo mode, or without a token', async () => {
    settings.wanikaniTasks = false;
    await useWaniKaniStore.getState().refresh(true);
    settings.wanikaniTasks = true;
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    await useWaniKaniStore.getState().refresh(true);
    (isDemoModeActive as jest.Mock).mockReturnValue(false);
    (loadSecureKey as jest.Mock).mockResolvedValue('');
    await useWaniKaniStore.getState().refresh(true);
    expect(fetchWaniKani).not.toHaveBeenCalled();
    expect(useWaniKaniStore.getState().hasToken).toBe(false);
  });

  it('drops the read and the account when the token is refused', async () => {
    await useWaniKaniStore.getState().refresh();
    (fetchWaniKani as jest.Mock).mockResolvedValue({ ok: false, problem: 'unauthorized' });
    await useWaniKaniStore.getState().refresh(true);
    const state = useWaniKaniStore.getState();
    expect(state.problem).toBe('unauthorized');
    expect(state.snapshot).toBeNull();
    expect(state.user).toBeNull();
  });

  it('keeps the last read through an outage, and says so', async () => {
    await useWaniKaniStore.getState().refresh();
    (fetchWaniKani as jest.Mock).mockResolvedValue({ ok: false, problem: 'unavailable' });
    await useWaniKaniStore.getState().refresh(true);
    expect(useWaniKaniStore.getState().problem).toBe('unavailable');
    expect(useWaniKaniStore.getState().snapshot?.reviewsNow).toBe(12);
  });
});

describe('a read that lands after the feature was switched off', () => {
  it('is not written back', async () => {
    let release: (v: unknown) => void = () => {};
    (fetchWaniKani as jest.Mock).mockReturnValue(new Promise(resolve => { release = resolve; }));
    const inFlight = useWaniKaniStore.getState().refresh();
    // Let the token read resolve, so the fetch is the thing in flight.
    await Promise.resolve();
    await Promise.resolve();
    useWaniKaniStore.getState().clear();
    release({ ok: true, snapshot: snapshot(), user: null });
    await inFlight;
    expect(useWaniKaniStore.getState().snapshot).toBeNull();
    expect(useWaniKaniStore.getState().refreshing).toBe(false);
  });
});

describe('setToken', () => {
  it('saves a trimmed token, forgets the old account and reads with the new one', async () => {
    useWaniKaniStore.setState({ snapshot: snapshot() as never, user: { username: 'old', level: 3 } });
    (fetchWaniKani as jest.Mock).mockResolvedValue({ ok: true, snapshot: snapshot({ reviewsNow: 1 }), user: { username: 'new', level: 9 } });
    expect(await useWaniKaniStore.getState().setToken('  abc  ')).toBe(true);
    expect(saveSecureKey).toHaveBeenCalledWith('wanikaniApiToken', 'abc');
    await new Promise(resolve => setImmediate(resolve));
    expect(fetchWaniKani).toHaveBeenCalledTimes(1);
    expect(useWaniKaniStore.getState().user).toEqual({ username: 'new', level: 9 });
    expect(useWaniKaniStore.getState().snapshot?.reviewsNow).toBe(1);
  });

  it('removes the token on an empty one, without reading', async () => {
    useWaniKaniStore.setState({ hasToken: true, snapshot: snapshot() as never });
    expect(await useWaniKaniStore.getState().setToken('')).toBe(true);
    expect(saveSecureKey).toHaveBeenCalledWith('wanikaniApiToken', '');
    expect(useWaniKaniStore.getState().hasToken).toBe(false);
    expect(useWaniKaniStore.getState().snapshot).toBeNull();
    expect(fetchWaniKani).not.toHaveBeenCalled();
  });

  it('reports a token the keychain refused, and changes nothing', async () => {
    (saveSecureKey as jest.Mock).mockResolvedValue(false);
    useWaniKaniStore.setState({ hasToken: true, user: { username: 'kept', level: 2 } });
    expect(await useWaniKaniStore.getState().setToken('abc')).toBe(false);
    expect(useWaniKaniStore.getState().user).toEqual({ username: 'kept', level: 2 });
  });
});
