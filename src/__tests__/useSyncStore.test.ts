import {
  registerSyncReload,
  useSyncStore,
  isSyncSupported,
  markHealthLogsWithheld,
  settleHealthLogResend,
  NOTHING_OWED,
  SERVER_HEALTH_RESEND_KEY,
  SYNC_EPOCH,
} from '../store/useSyncStore';
import { dbGetSetting, dbGetSyncCursor, dbSetSetting, dbSetSyncCursor } from '../db/database';
import { HEALTH_SYNC_TABLES } from '../db/syncTracking';
import { cloudKitTransport, cloudKitUnavailableReason, isCloudKitSyncAvailable } from '../utils/cloudKitTransport';
import { databaseSyncLocal } from '../utils/syncLocal';
import { runSyncAll } from '../utils/syncEngine';
import { loadSecureKey, saveSecureKey } from '../utils/secureApiKey';
import { emptyApplyReport } from '../utils/syncMerge';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
  dbGetSyncCursor: jest.fn().mockReturnValue(null),
  dbSetSyncCursor: jest.fn(),
}));

jest.mock('../utils/cloudKitTransport', () => ({
  cloudKitTransport: jest.fn().mockReturnValue({}),
  cloudKitUnavailableReason: jest.fn().mockResolvedValue(null),
  isCloudKitSyncAvailable: jest.fn().mockReturnValue(true),
}));

jest.mock('../utils/syncLocal', () => ({
  databaseSyncLocal: jest.fn().mockReturnValue({}),
}));

// Only the loop is faked. `summarizeRuns` is the store's own collapse of
// several runs into one status line and is exactly what these cases are about,
// so it stays real.
jest.mock('../utils/syncEngine', () => ({
  ...jest.requireActual('../utils/syncEngine'),
  runSyncAll: jest.fn().mockResolvedValue([]),
}));

jest.mock('../utils/secureApiKey', () => ({
  SYNC_TOKEN_SECURE_KEY: 'syncServerToken',
  loadSecureKey: jest.fn().mockResolvedValue(''),
  saveSecureKey: jest.fn().mockResolvedValue(true),
}));

// Real describeApply — it's the store's own report-to-string call and has no
// reason to be faked; the report values below drive what it says.
jest.mock('../utils/syncMerge', () => jest.requireActual('../utils/syncMerge'));

const okResult = (overrides: Partial<ReturnType<typeof emptyApplyReport>> = {}) => ({
  status: 'ok' as const,
  pushed: true,
  applied: { ...emptyApplyReport(), ...overrides },
  unreadable: 0,
  imagesSent: 0,
  imagesReceived: 0,
});

/** One transport's run, as runSyncAll hands them back. */
const runs = (...results: ReturnType<typeof okResult>[] | Record<string, unknown>[]) =>
  results.map(result => ({ transport: 'cloudkit', result }));

/** The state of a device with a payload store configured and no iCloud. */
const withServer = () => {
  (loadSecureKey as jest.Mock).mockResolvedValue('a-token');
  useSyncStore.setState({ enabled: false, serverUrl: 'https://sync.example.com' });
};

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  (cloudKitUnavailableReason as jest.Mock).mockResolvedValue(null);
  (isCloudKitSyncAvailable as jest.Mock).mockReturnValue(true);
  useSyncStore.setState({
    initialized: false,
    enabled: false,
    supported: false,
    phase: 'idle',
    lastSyncedAt: null,
    problem: null,
    lastSummary: null,
    recipeImagesVersion: 0,
    serverUrl: '',
    hasServerToken: false,
    serverHealthLogs: false,
  });
  (dbGetSyncCursor as jest.Mock).mockReturnValue(null);
  (loadSecureKey as jest.Mock).mockResolvedValue('');
  (saveSecureKey as jest.Mock).mockResolvedValue(true);
});

describe('initialize', () => {
  it('reads the stored flag and last-synced stamp', () => {
    (dbGetSetting as jest.Mock).mockImplementation((key: string) =>
      key === 'syncEnabled' ? '1' : key === 'syncLastSyncedAt' ? '2026-08-20T00:00:00.000Z' : null
    );
    useSyncStore.getState().initialize();
    const state = useSyncStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.enabled).toBe(true);
    expect(state.supported).toBe(true);
    expect(state.lastSyncedAt).toBe('2026-08-20T00:00:00.000Z');
  });

  it('reads disabled and unsupported the same way', () => {
    (isCloudKitSyncAvailable as jest.Mock).mockReturnValue(false);
    useSyncStore.getState().initialize();
    const state = useSyncStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.supported).toBe(false);
  });
});

describe('setEnabled', () => {
  it('writes the flag, then checks the account and runs a sync', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    await useSyncStore.getState().setEnabled(true);
    expect(dbSetSetting).toHaveBeenCalledWith('syncEnabled', '1');
    expect(cloudKitUnavailableReason).toHaveBeenCalled();
    expect(runSyncAll).toHaveBeenCalled();
    expect(useSyncStore.getState().enabled).toBe(true);
    expect(useSyncStore.getState().phase).toBe('idle');
  });

  it('stops at the account check and records why, without starting a sync', async () => {
    (cloudKitUnavailableReason as jest.Mock).mockResolvedValue('Sign in to iCloud to turn this on.');
    await useSyncStore.getState().setEnabled(true);
    expect(useSyncStore.getState().problem).toBe('Sign in to iCloud to turn this on.');
    expect(runSyncAll).not.toHaveBeenCalled();
  });

  it('writes the flag and clears the problem without syncing when turned off', async () => {
    useSyncStore.setState({ problem: 'Sync failed.' });
    await useSyncStore.getState().setEnabled(false);
    expect(dbSetSetting).toHaveBeenCalledWith('syncEnabled', '0');
    expect(useSyncStore.getState().enabled).toBe(false);
    expect(useSyncStore.getState().problem).toBeNull();
    expect(cloudKitUnavailableReason).not.toHaveBeenCalled();
    expect(runSyncAll).not.toHaveBeenCalled();
  });
});

describe('syncNow', () => {
  it('refuses to run when nothing is configured', async () => {
    // No longer "the feature is off": the iCloud flag is one destination of
    // two, and what decides is whether any transport is set up at all.
    useSyncStore.setState({ enabled: false, serverUrl: '' });
    const result = await useSyncStore.getState().syncNow();
    expect(result).toBeNull();
    expect(runSyncAll).not.toHaveBeenCalled();
  });

  it('refuses a second run while one is already in flight', async () => {
    useSyncStore.setState({ enabled: true, phase: 'syncing' });
    const result = await useSyncStore.getState().syncNow();
    expect(result).toBeNull();
    expect(runSyncAll).not.toHaveBeenCalled();
  });

  it('runs once when a second call lands while the transports are still being read', async () => {
    // The foreground hook syncs on mount and again on 'active'; both used to
    // pass the phase check during the keychain read and run the loop twice.
    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    withServer();

    const [first, second] = await Promise.all([
      useSyncStore.getState().syncNow(),
      useSyncStore.getState().syncNow(),
    ]);

    expect(runSyncAll).toHaveBeenCalledTimes(1);
    expect([first, second].filter(r => r === null)).toHaveLength(1);

    // And the claim is released, so the next sync runs.
    await useSyncStore.getState().syncNow();
    expect(runSyncAll).toHaveBeenCalledTimes(2);
  });

  it('re-reads the stores after a sync that wrote something, and only then', async () => {
    const reload = jest.fn();
    registerSyncReload(reload);
    useSyncStore.setState({ enabled: true });

    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    await useSyncStore.getState().syncNow();
    expect(reload).not.toHaveBeenCalled();

    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult({ updated: 1 })));
    await useSyncStore.getState().syncNow();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // #2950: the meal calendar reconcile hangs off the reload and needs to know
  // which meals changed, across every transport that ran.
  it('hands the reload what the sync applied', async () => {
    const reload = jest.fn();
    registerSyncReload(reload);
    useSyncStore.setState({ enabled: true });

    (runSyncAll as jest.Mock).mockResolvedValue(runs(
      okResult({ updated: 1, mealEntryIds: ['m1'] }),
      okResult({ deleted: 1, removedMealEvents: [{ eventId: 'evt-2', externalId: null, date: '2026-08-13' }] }),
    ));
    await useSyncStore.getState().syncNow();

    expect(reload).toHaveBeenCalledWith(expect.objectContaining({
      mealEntryIds: ['m1'],
      removedMealEvents: [{ eventId: 'evt-2', externalId: null, date: '2026-08-13' }],
    }));
  });

  it('records the summary and clears any problem on a clean result', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult({ inserted: 3, updated: 1 })));
    useSyncStore.setState({ enabled: true, problem: 'Sync failed.' });
    const result = await useSyncStore.getState().syncNow();
    expect(result?.ok).toBe(true);
    expect(dbSetSetting).toHaveBeenCalledWith('syncLastSyncedAt', expect.any(String));
    const state = useSyncStore.getState();
    expect(state.problem).toBeNull();
    expect(state.lastSummary).toBe('3 added, 1 updated');
    expect(state.phase).toBe('idle');
  });

  it('names an unreadable batch as the problem even on an otherwise clean sync', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs({ ...okResult(), unreadable: 2 }));
    useSyncStore.setState({ enabled: true });
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().problem).toBe('Some changes need a newer version of the app.');
  });

  // #2704: a photo can arrive in a sync that changes no row, so the recipe
  // screens are told separately, and without a reload of every store.
  it('tells the recipe screens when photos arrived, without reloading the stores for them', async () => {
    const reload = jest.fn();
    registerSyncReload(reload);
    (runSyncAll as jest.Mock).mockResolvedValue(runs({ ...okResult(), imagesReceived: 2 }));
    useSyncStore.setState({ enabled: true });

    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().recipeImagesVersion).toBe(1);
    expect(reload).not.toHaveBeenCalled();

    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().recipeImagesVersion).toBe(1);
  });

  it('names photos that did not send, without calling a sync whose rows went a failure', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs({ ...okResult(), imageProblem: 'Payload too large' }));
    useSyncStore.setState({ enabled: true });
    const result = await useSyncStore.getState().syncNow();
    expect(result?.ok).toBe(true);
    expect(dbSetSetting).toHaveBeenCalledWith('syncLastSyncedAt', expect.any(String));
    expect(useSyncStore.getState().problem).toBe(
      "Some recipe photos didn't send (cloudkit: Payload too large). They go again with the next sync."
    );
  });

  it('records a failure reason and leaves lastSyncedAt untouched', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs({
      status: 'failed', pushed: false, applied: emptyApplyReport(), unreadable: 0, reason: 'Network unavailable.',
    }));
    useSyncStore.setState({ enabled: true, lastSyncedAt: '2026-08-01T00:00:00.000Z' });
    await useSyncStore.getState().syncNow();
    const state = useSyncStore.getState();
    // Named by transport, because with two destinations "Sync failed" does not
    // say which one to go and look at.
    expect(state.problem).toBe('cloudkit: Network unavailable.');
    expect(state.lastSyncedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(dbSetSetting).not.toHaveBeenCalled();
  });

  it('always returns the phase to idle, even when the loop throws', async () => {
    (runSyncAll as jest.Mock).mockRejectedValue(new Error('boom'));
    useSyncStore.setState({ enabled: true });
    await expect(useSyncStore.getState().syncNow()).rejects.toThrow('boom');
    expect(useSyncStore.getState().phase).toBe('idle');
  });
});

describe('the payload store as a second destination', () => {
  it('syncs with a server configured even though iCloud is off', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    withServer();

    expect(await useSyncStore.getState().syncNow()).not.toBeNull();
    // One transport, not two: iCloud is off, so only the server is reached.
    expect((runSyncAll as jest.Mock).mock.calls[0][0]).toHaveLength(1);
  });

  it('needs both the address and the token before it counts as configured', async () => {
    (loadSecureKey as jest.Mock).mockResolvedValue('');
    useSyncStore.setState({ enabled: false, serverUrl: 'https://sync.example.com' });

    expect(await useSyncStore.getState().syncNow()).toBeNull();
    expect(runSyncAll).not.toHaveBeenCalled();
  });

  it('runs both destinations when both are set up', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    (loadSecureKey as jest.Mock).mockResolvedValue('a-token');
    useSyncStore.setState({ enabled: true, serverUrl: 'https://sync.example.com' });

    await useSyncStore.getState().syncNow();
    expect((runSyncAll as jest.Mock).mock.calls[0][0]).toHaveLength(2);
  });

  it('stores the address but never the token', async () => {
    useSyncStore.getState().setServerUrl('  https://sync.example.com  ');
    expect(dbSetSetting).toHaveBeenCalledWith('syncServerUrl', 'https://sync.example.com');

    await useSyncStore.getState().setServerToken('a-token');
    // The token goes to the keychain. A settings row would sync, which would
    // hand the credential to every device through the store it authenticates.
    expect(saveSecureKey).toHaveBeenCalledWith('syncServerToken', 'a-token');
    expect(dbSetSetting).not.toHaveBeenCalledWith('syncServerToken', expect.anything());
    expect(useSyncStore.getState().hasServerToken).toBe(true);
  });
});

/**
 * Settings and cursors in a Map, so a test can read back what a step wrote.
 * The server's push cursor is stored under `server:push`.
 */
const storedSettings = () => {
  const settings = new Map<string, string>();
  const cursors = new Map<string, string>();
  (dbGetSetting as jest.Mock).mockImplementation((k: string) => settings.get(k) ?? null);
  (dbSetSetting as jest.Mock).mockImplementation((k: string, v: string) => settings.set(k, v));
  (dbGetSyncCursor as jest.Mock).mockImplementation((k: string) => cursors.get(k) ?? null);
  (dbSetSyncCursor as jest.Mock).mockImplementation((k: string, v: string) => cursors.set(k, v));
  return { settings, cursors };
};

const transportsPassed = (): { withhold?: { tables: readonly string[] } }[] =>
  (runSyncAll as jest.Mock).mock.calls[0][0];

describe('health logs', () => {
  it('are never sent to iCloud', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    useSyncStore.setState({ enabled: true });

    await useSyncStore.getState().syncNow();
    expect(transportsPassed()[0].withhold?.tables).toEqual(HEALTH_SYNC_TABLES);
  });

  it('are withheld from the server by default', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    withServer();

    await useSyncStore.getState().syncNow();
    expect(transportsPassed()[0].withhold?.tables).toEqual(HEALTH_SYNC_TABLES);
  });

  it('go to the server once the switch is on, while iCloud still withholds them', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    (loadSecureKey as jest.Mock).mockResolvedValue('a-token');
    useSyncStore.setState({ enabled: true, serverUrl: 'https://sync.example.com', serverHealthLogs: true });

    await useSyncStore.getState().syncNow();
    const [icloud, server] = transportsPassed();
    expect(icloud.withhold).toBeDefined();
    expect(server.withhold).toBeUndefined();
  });

  it('switch is stored per device and read back on launch', () => {
    const { settings } = storedSettings();
    useSyncStore.getState().setServerHealthLogs(true);
    expect(settings.get('syncServerHealthLogs')).toBe('1');

    useSyncStore.setState({ serverHealthLogs: false });
    useSyncStore.getState().initialize();
    expect(useSyncStore.getState().serverHealthLogs).toBe(true);
  });

  it('turned on rewinds nothing until the next sync, which is when it is safe to', async () => {
    const { cursors } = storedSettings();
    cursors.set('server:push', '2026-09-01T00:00:00.000Z');

    useSyncStore.getState().setServerHealthLogs(true);
    // A run already in the air would write its own cursor over a rewind made now.
    expect(cursors.get('server:push')).toBe('2026-09-01T00:00:00.000Z');

    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    (loadSecureKey as jest.Mock).mockResolvedValue('a-token');
    useSyncStore.setState({ serverUrl: 'https://sync.example.com' });
    await useSyncStore.getState().syncNow();
    expect(cursors.get('server:push')).toBe(SYNC_EPOCH);
  });
});

describe('recipe photos', () => {
  it('go to iCloud but not to the sync server', async () => {
    (runSyncAll as jest.Mock).mockResolvedValue(runs(okResult()));
    (loadSecureKey as jest.Mock).mockResolvedValue('a-token');
    useSyncStore.setState({ enabled: true, serverUrl: 'https://sync.example.com', serverHealthLogs: true });

    await useSyncStore.getState().syncNow();
    const [icloud, server] = (runSyncAll as jest.Mock).mock.calls[0][0];
    expect(icloud.sendsImages).toBeUndefined();
    expect(server.sendsImages).toBe(false);
  });
});

describe('settleHealthLogResend', () => {
  it('rewinds to the very start when nothing was ever sent', () => {
    const { settings, cursors } = storedSettings();
    cursors.set('server:push', '2026-09-01T00:00:00.000Z');

    settleHealthLogResend();
    expect(cursors.get('server:push')).toBe(SYNC_EPOCH);
    expect(settings.get(SERVER_HEALTH_RESEND_KEY)).toBe(NOTHING_OWED);
  });

  it('rewinds to where withholding began', () => {
    const { settings, cursors } = storedSettings();
    cursors.set('server:push', '2026-09-01T00:00:00.000Z');
    settings.set(SERVER_HEALTH_RESEND_KEY, '2026-08-01T00:00:00.000Z');

    settleHealthLogResend();
    expect(cursors.get('server:push')).toBe('2026-08-01T00:00:00.000Z');
  });

  it('does nothing once caught up', () => {
    const { settings, cursors } = storedSettings();
    cursors.set('server:push', '2026-09-01T00:00:00.000Z');
    settings.set(SERVER_HEALTH_RESEND_KEY, NOTHING_OWED);

    settleHealthLogResend();
    expect(cursors.get('server:push')).toBe('2026-09-01T00:00:00.000Z');
  });

  it('never moves a cursor forward, and leaves a server never synced to read everything', () => {
    const { settings, cursors } = storedSettings();
    cursors.set('server:push', '2026-07-01T00:00:00.000Z');
    settings.set(SERVER_HEALTH_RESEND_KEY, '2026-08-01T00:00:00.000Z');
    settleHealthLogResend();
    expect(cursors.get('server:push')).toBe('2026-07-01T00:00:00.000Z');

    cursors.clear();
    settings.delete(SERVER_HEALTH_RESEND_KEY);
    settleHealthLogResend();
    expect(cursors.has('server:push')).toBe(false);
  });
});

describe('markHealthLogsWithheld', () => {
  it('records where the server cursor stood when they were flowing', () => {
    const { settings, cursors } = storedSettings();
    cursors.set('server:push', '2026-09-01T00:00:00.000Z');
    settings.set(SERVER_HEALTH_RESEND_KEY, NOTHING_OWED);

    markHealthLogsWithheld();
    expect(settings.get(SERVER_HEALTH_RESEND_KEY)).toBe('2026-09-01T00:00:00.000Z');
  });

  it('keeps an earlier mark, which covers more', () => {
    const { settings, cursors } = storedSettings();
    cursors.set('server:push', '2026-09-01T00:00:00.000Z');
    settings.set(SERVER_HEALTH_RESEND_KEY, '2026-08-01T00:00:00.000Z');

    markHealthLogsWithheld();
    expect(settings.get(SERVER_HEALTH_RESEND_KEY)).toBe('2026-08-01T00:00:00.000Z');
  });

  it('owes everything when the server was never synced', () => {
    const { settings } = storedSettings();
    settings.set(SERVER_HEALTH_RESEND_KEY, NOTHING_OWED);

    markHealthLogsWithheld();
    expect(settings.get(SERVER_HEALTH_RESEND_KEY)).toBe(SYNC_EPOCH);
  });

  it('is what turning the switch off does', () => {
    const { settings, cursors } = storedSettings();
    cursors.set('server:push', '2026-09-01T00:00:00.000Z');
    settings.set(SERVER_HEALTH_RESEND_KEY, NOTHING_OWED);
    useSyncStore.setState({ serverHealthLogs: true });

    useSyncStore.getState().setServerHealthLogs(false);
    expect(settings.get(SERVER_HEALTH_RESEND_KEY)).toBe('2026-09-01T00:00:00.000Z');
    expect(settings.get('syncServerHealthLogs')).toBe('0');
  });
});

describe('isSyncSupported', () => {
  it('mirrors the transport availability check, independent of store state', () => {
    (isCloudKitSyncAvailable as jest.Mock).mockReturnValue(false);
    expect(isSyncSupported()).toBe(false);
    (isCloudKitSyncAvailable as jest.Mock).mockReturnValue(true);
    expect(isSyncSupported()).toBe(true);
  });
});
