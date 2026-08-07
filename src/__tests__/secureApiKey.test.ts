import * as SecureStore from 'expo-secure-store';
import { dbDeleteSetting, dbGetSetting } from '../db/database';
import {
  API_KEY_LEGACY_SETTING,
  API_KEY_SECURE_KEY,
  loadAnthropicApiKey,
  saveAnthropicApiKey,
} from '../utils/secureApiKey';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbDeleteSetting: jest.fn(),
}));

const getItem = SecureStore.getItemAsync as jest.Mock;
const setItem = SecureStore.setItemAsync as jest.Mock;
const deleteItem = SecureStore.deleteItemAsync as jest.Mock;
const getSetting = dbGetSetting as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getItem.mockResolvedValue(null);
  setItem.mockResolvedValue(undefined);
  deleteItem.mockResolvedValue(undefined);
  getSetting.mockReturnValue(null);
});

// ─── loading ─────────────────────────────────────────────────────────────────

describe('loadAnthropicApiKey', () => {
  it('returns an empty string when there is no key anywhere', async () => {
    await expect(loadAnthropicApiKey()).resolves.toBe('');
    expect(dbDeleteSetting).not.toHaveBeenCalled();
  });

  it('returns the keychain key', async () => {
    getItem.mockResolvedValue('sk-ant-secure');
    await expect(loadAnthropicApiKey()).resolves.toBe('sk-ant-secure');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('reads an empty string rather than throwing when the keychain is unreadable', async () => {
    getItem.mockRejectedValue(new Error('keychain unavailable'));
    await expect(loadAnthropicApiKey()).resolves.toBe('');
  });
});

// ─── migration ───────────────────────────────────────────────────────────────

describe('migrating the plaintext key', () => {
  it('moves a plaintext key into the keychain and clears the row', async () => {
    getSetting.mockReturnValue('sk-ant-plaintext');

    await expect(loadAnthropicApiKey()).resolves.toBe('sk-ant-plaintext');

    expect(setItem).toHaveBeenCalledWith(API_KEY_SECURE_KEY, 'sk-ant-plaintext');
    expect(dbDeleteSetting).toHaveBeenCalledWith(API_KEY_LEGACY_SETTING);
  });

  // The whole point of the ordering: a failed write must not be able to take
  // the only copy of the key with it.
  it('keeps the plaintext row when the keychain write fails', async () => {
    getSetting.mockReturnValue('sk-ant-plaintext');
    setItem.mockRejectedValue(new Error('keychain unavailable'));

    await expect(loadAnthropicApiKey()).resolves.toBe('sk-ant-plaintext');
    expect(dbDeleteSetting).not.toHaveBeenCalled();
  });

  it('finishes an interrupted migration on the next launch', async () => {
    getItem.mockResolvedValue('sk-ant-secure');
    getSetting.mockReturnValue('sk-ant-secure');

    await expect(loadAnthropicApiKey()).resolves.toBe('sk-ant-secure');
    expect(dbDeleteSetting).toHaveBeenCalledWith(API_KEY_LEGACY_SETTING);
  });

  // A restored backup, or a build that wrote one — the keychain is the
  // authority, and the row goes either way.
  it('prefers the keychain over a stale plaintext row', async () => {
    getItem.mockResolvedValue('sk-ant-secure');
    getSetting.mockReturnValue('sk-ant-old');

    await expect(loadAnthropicApiKey()).resolves.toBe('sk-ant-secure');
    expect(setItem).not.toHaveBeenCalled();
    expect(dbDeleteSetting).toHaveBeenCalledWith(API_KEY_LEGACY_SETTING);
  });

  it('drops a leftover empty row', async () => {
    getSetting.mockReturnValue('');
    await expect(loadAnthropicApiKey()).resolves.toBe('');
    expect(dbDeleteSetting).toHaveBeenCalledWith(API_KEY_LEGACY_SETTING);
  });
});

// ─── saving ──────────────────────────────────────────────────────────────────

describe('saveAnthropicApiKey', () => {
  it('writes to the keychain, never to the settings table', async () => {
    await expect(saveAnthropicApiKey('sk-ant-new')).resolves.toBe(true);
    expect(setItem).toHaveBeenCalledWith(API_KEY_SECURE_KEY, 'sk-ant-new');
  });

  it('deletes the keychain item when the key is cleared', async () => {
    await expect(saveAnthropicApiKey('')).resolves.toBe(true);
    expect(deleteItem).toHaveBeenCalledWith(API_KEY_SECURE_KEY);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('reports a failed write instead of falling back to plaintext', async () => {
    setItem.mockRejectedValue(new Error('keychain unavailable'));
    await expect(saveAnthropicApiKey('sk-ant-new')).resolves.toBe(false);
  });

  it('clears a plaintext row an earlier migration could not', async () => {
    getSetting.mockReturnValue('sk-ant-stranded');
    await saveAnthropicApiKey('sk-ant-new');
    expect(dbDeleteSetting).toHaveBeenCalledWith(API_KEY_LEGACY_SETTING);
  });
});
