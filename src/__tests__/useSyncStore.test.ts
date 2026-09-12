import { useSyncStore, isSyncSupported } from '../store/useSyncStore';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { cloudKitTransport, cloudKitUnavailableReason, isCloudKitSyncAvailable } from '../utils/cloudKitTransport';
import { databaseSyncLocal } from '../utils/syncLocal';
import { runSyncAll } from '../utils/syncEngine';
import { loadSecureKey, saveSecureKey } from '../utils/secureApiKey';
import { emptyApplyReport } from '../utils/syncMerge';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
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
    serverUrl: '',
    hasServerToken: false,
  });
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

describe('isSyncSupported', () => {
  it('mirrors the transport availability check, independent of store state', () => {
    (isCloudKitSyncAvailable as jest.Mock).mockReturnValue(false);
    expect(isSyncSupported()).toBe(false);
    (isCloudKitSyncAvailable as jest.Mock).mockReturnValue(true);
    expect(isSyncSupported()).toBe(true);
  });
});
