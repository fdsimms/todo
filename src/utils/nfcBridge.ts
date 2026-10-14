import { Platform } from 'react-native';
import { isDemoModeActive } from './demoState';

/**
 * The one door to `todo-nfc-bridge`, and so the one place that decides whether
 * this app may read a tag.
 *
 * The same gate `screenTimeBridge()` is, for the reason that matters here: a
 * tag read enrolls a key that locks real apps, and in demo mode the key would
 * be written into a database about to be thrown away while the lock it raises
 * belongs to nobody. Returns null for every reason a caller has nothing to do
 * (not iOS, demo mode on, no native module in the binary), so a caller is one
 * `if`. The require stays lazy because the native half doesn't exist in Expo Go
 * or on Android, and a static import would throw at module scope.
 */
export type NfcBridge = typeof import('todo-nfc-bridge');

export function nfcBridge(): NfcBridge | null {
  if (Platform.OS !== 'ios') return null;
  // At the call, not at import: demo mode is entered and left while the app runs.
  if (isDemoModeActive()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('todo-nfc-bridge') as NfcBridge;
  } catch {
    return null;
  }
}

/** Whether a tag can be read here at all: iOS, outside demo mode, with the reader present. */
export function isNfcSupported(): boolean {
  return nfcBridge()?.isNfcAvailable() ?? false;
}

export type NfcScanResult =
  | { kind: 'tag'; uid: string }
  /** Cancelled, timed out or failed. The system sheet already said which. */
  | { kind: 'ended' }
  | { kind: 'unavailable' };

/** The native module's answer as a result; anything unexpected is `ended`. */
export function parseScanAnswer(answer: unknown): NfcScanResult {
  if (answer === 'unavailable') return { kind: 'unavailable' };
  if (typeof answer === 'string' && answer.startsWith('uid:')) {
    const uid = answer.slice(4);
    if (/^[0-9A-F]+$/.test(uid)) return { kind: 'tag', uid };
  }
  return { kind: 'ended' };
}

/**
 * Raise the system scan sheet and resolve with the first tag read. Goes through
 * the gate, so demo mode, Android and a build without the module all answer
 * `unavailable` and never touch the reader.
 */
export async function scanKeyTag(prompt: string): Promise<NfcScanResult> {
  const bridge = nfcBridge();
  if (!bridge) return { kind: 'unavailable' };
  return parseScanAnswer(await bridge.scanTag(prompt));
}
