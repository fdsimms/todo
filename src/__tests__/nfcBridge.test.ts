/**
 * The one gate on reading a tag, and the parse of what the native side answers.
 * Both are worth testing directly: the screen and the native module they sit
 * between are not reachable from a node test env.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let mockPlatformOS = 'ios';
jest.mock('react-native', () => ({
  get Platform() {
    return { OS: mockPlatformOS };
  },
}));

let mockDemoMode = false;
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemoMode }));

const mockNative = { isNfcAvailable: jest.fn(() => true), scanTag: jest.fn() };
let mockNativeMissing = false;
jest.mock('todo-nfc-bridge', () => {
  if (mockNativeMissing) throw new Error('Cannot find native module');
  return mockNative;
});

import { isNfcSupported, nfcBridge, parseScanAnswer, scanKeyTag } from '../utils/nfcBridge';

beforeEach(() => {
  mockPlatformOS = 'ios';
  mockDemoMode = false;
  mockNativeMissing = false;
  mockNative.isNfcAvailable.mockReset();
  mockNative.isNfcAvailable.mockReturnValue(true);
});

describe('nfcBridge', () => {
  it('opens on iOS with the native module present', () => {
    expect(nfcBridge()).toBe(mockNative);
    expect(isNfcSupported()).toBe(true);
  });

  it('is closed off iOS', () => {
    mockPlatformOS = 'android';
    expect(nfcBridge()).toBeNull();
    expect(isNfcSupported()).toBe(false);
  });

  it('is closed in demo mode, re-read on every call', () => {
    expect(nfcBridge()).not.toBeNull();
    mockDemoMode = true;
    expect(nfcBridge()).toBeNull();
    mockDemoMode = false;
    expect(nfcBridge()).not.toBeNull();
  });

  it('is closed without the native module (Expo Go, an older build)', () => {
    mockNativeMissing = true;
    // The registry caches a module once it has resolved, so the factory only
    // throws again for a require that starts from nothing.
    jest.resetModules();
    const fresh = require('../utils/nfcBridge');
    expect(fresh.nfcBridge()).toBeNull();
    expect(fresh.isNfcSupported()).toBe(false);
  });

  it('reports unsupported on a phone without the reader', () => {
    mockNative.isNfcAvailable.mockReturnValue(false);
    expect(isNfcSupported()).toBe(false);
  });
});

describe('todo-nfc-bridge entry point', () => {
  const DIR = join(__dirname, '..', '..', 'modules', 'todo-nfc-bridge');
  const source = readFileSync(join(DIR, 'index.ts'), 'utf8');
  const swift = readFileSync(join(DIR, 'ios', 'TodoNfcBridgeModule.swift'), 'utf8');

  it('calls through to every native function', () => {
    const names = [...swift.matchAll(/\bA?(?:sync)?Function\("([^"]+)"\)/g)].map(m => m[1]);
    expect(names).toEqual(expect.arrayContaining(['isAvailable', 'scanTag']));
    for (const name of names) expect(source).toContain(`nativeModule.${name}(`);
  });

  it('answers only with strings the parser knows', () => {
    expect(swift).toContain('"unavailable"');
    expect(swift).toContain('"ended"');
    expect(swift).toContain('"uid:');
  });
});

describe('parseScanAnswer', () => {
  it('parses every answer the Swift side can give', () => {
    expect(parseScanAnswer('uid:04A1B2C3')).toEqual({ kind: 'tag', uid: '04A1B2C3' });
    expect(parseScanAnswer('ended')).toEqual({ kind: 'ended' });
    expect(parseScanAnswer('unavailable')).toEqual({ kind: 'unavailable' });
  });
  it('treats anything else as ended rather than a tag', () => {
    expect(parseScanAnswer('uid:xyz')).toEqual({ kind: 'ended' });
    expect(parseScanAnswer('uid:')).toEqual({ kind: 'ended' });
    expect(parseScanAnswer(undefined)).toEqual({ kind: 'ended' });
  });
});

describe('scanKeyTag', () => {
  it('reads through the bridge', async () => {
    mockNative.scanTag.mockResolvedValue('uid:04A1B2C3');
    await expect(scanKeyTag('Hold')).resolves.toEqual({ kind: 'tag', uid: '04A1B2C3' });
    expect(mockNative.scanTag).toHaveBeenCalledWith('Hold');
  });
  it('never touches the reader in demo mode', async () => {
    mockNative.scanTag.mockClear();
    mockDemoMode = true;
    await expect(scanKeyTag('Hold')).resolves.toEqual({ kind: 'unavailable' });
    expect(mockNative.scanTag).not.toHaveBeenCalled();
  });
});
