/**
 * The Swift half can only be verified by a real build on a real device. What
 * *can* be checked here is the boundary: that a missing native module degrades
 * instead of throwing at import time, that failures propagate rather than
 * being swallowed into a false success, and that the transport satisfies the
 * shape runSync expects.
 */
import { runSync, type SyncLocal } from '../utils/syncEngine';
import { emptyApplyReport, type SyncChangeSet } from '../utils/syncMerge';

const mockBridge = {
  isCloudKitAvailable: jest.fn(() => true),
  cloudKitAccountStatus: jest.fn(
    async (): Promise<import('todo-cloudkit-bridge').CloudKitAccountStatus> => 'available'
  ),
  pushPayload: jest.fn(async (_payload: string) => {}),
  pullPayloads: jest.fn(async (_since: string | null) => ({ payloads: [] as string[], cursor: null as string | null })),
};

let mockBridgePresent = true;

jest.mock(
  'todo-cloudkit-bridge',
  () => {
    // Throwing from the factory is how a build without the native half
    // behaves: the require fails rather than returning something broken.
    if (!mockBridgePresent) throw new Error('Cannot find native module');
    return mockBridge;
  },
  { virtual: true }
);

/**
 * Loaded fresh per call, because jest caches a module once its factory has
 * run: without resetting the registry, the first successful require pins the
 * bridge as present and the "missing native module" cases silently test the
 * working one instead.
 */
function loadTransport(): typeof import('../utils/cloudKitTransport') {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../utils/cloudKitTransport') as typeof import('../utils/cloudKitTransport');
}

beforeEach(() => {
  mockBridgePresent = true;
  jest.clearAllMocks();
  // Implementations, not just call records: clearAllMocks leaves a
  // mockRejectedValue in place, so a failure injected by one test would
  // otherwise leak into every test after it.
  mockBridge.isCloudKitAvailable.mockReturnValue(true);
  mockBridge.cloudKitAccountStatus.mockResolvedValue('available');
  mockBridge.pushPayload.mockResolvedValue(undefined);
  mockBridge.pullPayloads.mockResolvedValue({ payloads: [], cursor: null });
});

describe('availability', () => {
  it('reports available when the native module is there', () => {
    expect(loadTransport().isCloudKitSyncAvailable()).toBe(true);
  });

  it('reports unavailable rather than throwing when the module is missing', () => {
    mockBridgePresent = false;
    expect(loadTransport().isCloudKitSyncAvailable()).toBe(false);
  });

  it('separates "this build cannot sync" from "sign in to iCloud"', async () => {
    // Two different things for the user to do, so they can't share a message.
    mockBridgePresent = false;
    expect(await loadTransport().cloudKitUnavailableReason()).toContain('build');

    mockBridgePresent = true;
    mockBridge.cloudKitAccountStatus.mockResolvedValue('noAccount');
    expect(await loadTransport().cloudKitUnavailableReason()).toContain('Sign in');
  });

  it('says nothing is wrong when the account is available', async () => {
    expect(await loadTransport().cloudKitUnavailableReason()).toBeNull();
  });

  it('treats a temporarily unavailable account as self-healing', async () => {
    mockBridge.cloudKitAccountStatus.mockResolvedValue('temporarilyUnavailable');
    const reason = await loadTransport().cloudKitUnavailableReason();
    expect(reason).toContain('resume');
  });
});

describe('transport', () => {
  it('forwards a push', async () => {
    await loadTransport().cloudKitTransport().push('{"format":1}');
    expect(mockBridge.pushPayload).toHaveBeenCalledWith('{"format":1}');
  });

  it('passes the cursor through untouched in both directions', async () => {
    // The cursor is a serialised CKServerChangeToken. Interpreting it here —
    // even parsing it to check it — is how it would eventually get mangled.
    const token = 'YnBsaXN0MDDUAQIDBAUGBwo=';
    mockBridge.pullPayloads.mockResolvedValue({ payloads: ['{}'], cursor: token });

    const result = await loadTransport().cloudKitTransport().pull(token);

    expect(mockBridge.pullPayloads).toHaveBeenCalledWith(token);
    expect(result.cursor).toBe(token);
  });

  it('lets a push failure propagate instead of reporting success', async () => {
    // A swallowed failure would advance the sync cursor past changes that
    // never left the device, and nothing would ever retry them.
    mockBridge.pushPayload.mockRejectedValue(new Error('network gone'));

    await expect(loadTransport().cloudKitTransport().push('{}')).rejects.toThrow('network gone');
  });

  it('throws rather than silently doing nothing when the module is missing', async () => {
    mockBridgePresent = false;
    await expect(loadTransport().cloudKitTransport().push('{}')).rejects.toThrow('not available');
  });
});

describe('driving runSync', () => {
  const local = (over: Partial<SyncLocal> = {}): SyncLocal => {
    const cursors = new Map<string, string>();
    return {
      deviceId: () => 'this-device',
      isSyncable: () => true,
      changesSince: (): SyncChangeSet => ({
        since: null,
        until: '2026-01-01T00:00:00.000Z',
        tables: { tasks: [{ id: 't1', updated_at: '2026-01-01T00:00:00.000Z' }] },
        deletions: [],
      }),
      apply: () => emptyApplyReport(),
      getCursor: k => cursors.get(k) ?? null,
      setCursor: (k, v) => void cursors.set(k, v),
      ...over,
    };
  };

  it('completes a round trip through the real engine', async () => {
    const result = await runSync(loadTransport().cloudKitTransport(), local());

    expect(result.status).toBe('ok');
    expect(result.pushed).toBe(true);
    expect(mockBridge.pushPayload).toHaveBeenCalledTimes(1);
  });

  it('reports failure and holds its cursor when CloudKit is down', async () => {
    mockBridge.pushPayload.mockRejectedValue(new Error('iCloud unreachable'));
    const l = local();

    const result = await runSync(loadTransport().cloudKitTransport(), l);

    expect(result.status).toBe('failed');
    expect(l.getCursor('cloudkit:push')).toBeNull();
  });

  it('keys its cursors under the transport name', async () => {
    mockBridge.pullPayloads.mockResolvedValue({ payloads: [], cursor: 'token-1' });
    const l = local();

    await runSync(loadTransport().cloudKitTransport(), l);

    expect(l.getCursor('cloudkit:pull')).toBe('token-1');
    expect(l.getCursor('cloudkit:push')).not.toBeNull();
  });
});
