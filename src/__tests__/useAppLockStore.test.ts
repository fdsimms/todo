import { isAppLocked, useAppLockStore } from '../store/useAppLockStore';
import { useSettingsStore } from '../store/useSettingsStore';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

jest.mock('../utils/secureApiKey', () => ({
  loadAnthropicApiKey: jest.fn().mockResolvedValue(''),
  saveAnthropicApiKey: jest.fn().mockResolvedValue(true),
}));

const NOW = 1_700_000_000_000;

beforeEach(() => {
  useAppLockStore.setState({ unlocked: false, leftAt: null, prompting: false });
  useSettingsStore.setState({ appLockEnabled: false, appLockGraceSeconds: 60 });
});

// ─── the derived lock ────────────────────────────────────────────────────────

describe('isAppLocked', () => {
  it('is unlocked while the setting is off, however the session sits', () => {
    expect(isAppLocked()).toBe(false);
  });

  it('is locked as soon as the setting is on and this session has not authenticated', () => {
    useSettingsStore.setState({ appLockEnabled: true });
    expect(isAppLocked()).toBe(true);
  });

  // The Settings toggle unlocks before it flips the setting, so there is no
  // moment where turning the lock on locks the person who just turned it on.
  it('stays open when the session is unlocked first and the setting flipped after', () => {
    useAppLockStore.getState().unlock();
    useSettingsStore.setState({ appLockEnabled: true });
    expect(isAppLocked()).toBe(false);
  });
});

// ─── leaving and coming back ─────────────────────────────────────────────────

describe('resuming', () => {
  beforeEach(() => {
    useSettingsStore.setState({ appLockEnabled: true });
    useAppLockStore.getState().unlock();
  });

  it('stays unlocked when the app comes back inside the grace period', () => {
    useAppLockStore.getState().noteInactive(NOW);
    useAppLockStore.getState().noteActive(NOW + 30_000, 60);
    expect(isAppLocked()).toBe(false);
  });

  it('locks when the grace period ran out while away', () => {
    useAppLockStore.getState().noteInactive(NOW);
    useAppLockStore.getState().noteActive(NOW + 61_000, 60);
    expect(isAppLocked()).toBe(true);
  });

  it('measures from the first departure, not the last', () => {
    // iOS reports inactive and then background for one leaving; taking the
    // later stamp would quietly shorten every grace period.
    useAppLockStore.getState().noteInactive(NOW);
    useAppLockStore.getState().noteInactive(NOW + 40_000);
    useAppLockStore.getState().noteActive(NOW + 61_000, 60);
    expect(isAppLocked()).toBe(true);
  });

  it('measures the next grace period from the next departure', () => {
    useAppLockStore.getState().noteInactive(NOW);
    useAppLockStore.getState().noteActive(NOW + 10_000, 60);
    expect(useAppLockStore.getState().leftAt).toBeNull();

    useAppLockStore.getState().noteInactive(NOW + 20_000);
    useAppLockStore.getState().noteActive(NOW + 70_000, 60);
    expect(isAppLocked()).toBe(false); // 50s away, not 70s
  });

  it('does not lock on a resume that follows no departure', () => {
    useAppLockStore.getState().noteActive(NOW + 999_999, 0);
    expect(isAppLocked()).toBe(false);
  });

  it('locks on any departure at all at a grace of zero', () => {
    useAppLockStore.getState().noteInactive(NOW);
    useAppLockStore.getState().noteActive(NOW, 0);
    expect(isAppLocked()).toBe(true);
  });
});

// ─── the prompt ──────────────────────────────────────────────────────────────

describe('unlocking', () => {
  it('clears the departure stamp, so the next resume is judged on its own', () => {
    useAppLockStore.getState().noteInactive(NOW);
    useAppLockStore.getState().unlock();
    expect(useAppLockStore.getState().leftAt).toBeNull();
  });

  it('tracks whether a prompt is on screen', () => {
    useAppLockStore.getState().setPrompting(true);
    expect(useAppLockStore.getState().prompting).toBe(true);
    useAppLockStore.getState().setPrompting(false);
    expect(useAppLockStore.getState().prompting).toBe(false);
  });

  it('re-locks on demand', () => {
    useAppLockStore.getState().unlock();
    useAppLockStore.getState().lock();
    expect(useAppLockStore.getState().unlocked).toBe(false);
  });
});
