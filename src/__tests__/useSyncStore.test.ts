import { useSyncStore, isSyncSupported } from '../store/useSyncStore';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { cloudKitTransport, cloudKitUnavailableReason, isCloudKitSyncAvailable } from '../utils/cloudKitTransport';
import { databaseSyncLocal } from '../utils/syncLocal';
import { runSync } from '../utils/syncEngine';
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

jest.mock('../utils/syncEngine', () => ({
  runSync: jest.fn(),
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
  });
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
    (runSync as jest.Mock).mockResolvedValue(okResult());
    await useSyncStore.getState().setEnabled(true);
    expect(dbSetSetting).toHaveBeenCalledWith('syncEnabled', '1');
    expect(cloudKitUnavailableReason).toHaveBeenCalled();
    expect(runSync).toHaveBeenCalled();
    expect(useSyncStore.getState().enabled).toBe(true);
    expect(useSyncStore.getState().phase).toBe('idle');
  });

  it('stops at the account check and records why, without starting a sync', async () => {
    (cloudKitUnavailableReason as jest.Mock).mockResolvedValue('Sign in to iCloud to turn this on.');
    await useSyncStore.getState().setEnabled(true);
    expect(useSyncStore.getState().problem).toBe('Sign in to iCloud to turn this on.');
    expect(runSync).not.toHaveBeenCalled();
  });

  it('writes the flag and clears the problem without syncing when turned off', async () => {
    useSyncStore.setState({ problem: 'Sync failed.' });
    await useSyncStore.getState().setEnabled(false);
    expect(dbSetSetting).toHaveBeenCalledWith('syncEnabled', '0');
    expect(useSyncStore.getState().enabled).toBe(false);
    expect(useSyncStore.getState().problem).toBeNull();
    expect(cloudKitUnavailableReason).not.toHaveBeenCalled();
    expect(runSync).not.toHaveBeenCalled();
  });
});

describe('syncNow', () => {
  it('refuses to run when the feature is off', async () => {
    useSyncStore.setState({ enabled: false });
    const result = await useSyncStore.getState().syncNow();
    expect(result).toBeNull();
    expect(runSync).not.toHaveBeenCalled();
  });

  it('refuses a second run while one is already in flight', async () => {
    useSyncStore.setState({ enabled: true, phase: 'syncing' });
    const result = await useSyncStore.getState().syncNow();
    expect(result).toBeNull();
    expect(runSync).not.toHaveBeenCalled();
  });

  it('records the summary and clears any problem on a clean result', async () => {
    (runSync as jest.Mock).mockResolvedValue(okResult({ inserted: 3, updated: 1 }));
    useSyncStore.setState({ enabled: true, problem: 'Sync failed.' });
    const result = await useSyncStore.getState().syncNow();
    expect(result?.status).toBe('ok');
    expect(dbSetSetting).toHaveBeenCalledWith('syncLastSyncedAt', expect.any(String));
    const state = useSyncStore.getState();
    expect(state.problem).toBeNull();
    expect(state.lastSummary).toBe('3 added, 1 updated');
    expect(state.phase).toBe('idle');
  });

  it('names an unreadable batch as the problem even on an otherwise clean sync', async () => {
    (runSync as jest.Mock).mockResolvedValue({ ...okResult(), unreadable: 2 });
    useSyncStore.setState({ enabled: true });
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().problem).toBe('Some changes need a newer version of the app.');
  });

  it('records a failure reason and leaves lastSyncedAt untouched', async () => {
    (runSync as jest.Mock).mockResolvedValue({
      status: 'failed', pushed: false, applied: emptyApplyReport(), unreadable: 0, reason: 'Network unavailable.',
    });
    useSyncStore.setState({ enabled: true, lastSyncedAt: '2026-08-01T00:00:00.000Z' });
    await useSyncStore.getState().syncNow();
    const state = useSyncStore.getState();
    expect(state.problem).toBe('Network unavailable.');
    expect(state.lastSyncedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(dbSetSetting).not.toHaveBeenCalled();
  });

  it('always returns the phase to idle, even when runSync throws', async () => {
    (runSync as jest.Mock).mockRejectedValue(new Error('boom'));
    useSyncStore.setState({ enabled: true });
    await expect(useSyncStore.getState().syncNow()).rejects.toThrow('boom');
    expect(useSyncStore.getState().phase).toBe('idle');
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
