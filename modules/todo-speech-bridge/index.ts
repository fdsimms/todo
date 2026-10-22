import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface Subscription {
  remove(): void;
}

type SpeechEventName = 'onTranscript' | 'onLevel' | 'onEnd';

interface TodoSpeechNativeModule {
  isAvailable(): boolean;
  permissionStatus(): string;
  requestPermission(): Promise<string>;
  start(): Promise<number>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  addListener?(event: SpeechEventName, listener: (body: Record<string, unknown>) => void): Subscription;
}

export type SpeechPermission = 'granted' | 'denied' | 'undetermined';

/** Why a recording could not start, from the native error's code. */
export type SpeechStartFailure = 'permission' | 'unavailable' | 'start';

export interface SpeechHandlers {
  /** The whole transcript so far (not a delta). `isFinal` is true for the last one. */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** The microphone's loudness, 0..1, about a dozen times a second. */
  onLevel?: (level: number) => void;
  /** The recording ended, however it did. Fires exactly once. */
  onEnd: () => void;
}

export interface SpeechSession {
  /** Stops listening and lets the last words come through, then `onEnd`. */
  stop: () => Promise<void>;
  /** Stops at once and throws the rest away. `onEnd` still fires. */
  cancel: () => Promise<void>;
}

// Same lazy resolve as the other bridges: requireNativeModule throws when the
// module isn't linked (Android, web, Expo Go, a build from before this module
// existed), so every export below degrades to "not available" rather than
// throwing into a caller that has no branch for it.
let nativeModule: TodoSpeechNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoSpeechNativeModule>('TodoSpeech');
  } catch {
    nativeModule = null;
  }
}

/**
 * Can this phone turn speech into text without the network, in the language it
 * is set to? False wherever the module isn't linked, and false when the phone
 * can only do it by sending audio to a server, which this app never does.
 * Callers show no microphone at all on false, so there is no button that can
 * only fail.
 */
export function isSpeechAvailable(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isAvailable() === true;
  } catch {
    return false;
  }
}

export function speechPermissionStatus(): SpeechPermission {
  if (!nativeModule) return 'denied';
  try {
    const status = nativeModule.permissionStatus();
    return status === 'granted' || status === 'undetermined' ? status : 'denied';
  } catch {
    return 'denied';
  }
}

/** Asks for the microphone and speech recognition, one prompt after the other. */
export async function requestSpeechPermission(): Promise<'granted' | 'denied'> {
  if (!nativeModule) return 'denied';
  try {
    return (await nativeModule.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** The failure a native start rejected with, from its code, or 'start' for anything else. */
function failureOf(error: unknown): SpeechStartFailure {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  if (code.includes('E_PERMISSION')) return 'permission';
  if (code.includes('E_UNAVAILABLE')) return 'unavailable';
  return 'start';
}

export class SpeechStartError extends Error {
  constructor(public readonly failure: SpeechStartFailure) {
    super(`Speech could not start: ${failure}`);
  }
}

/**
 * Starts listening. Resolves with a session to stop, or rejects with a
 * `SpeechStartError`. Never prompts for permission; `requestSpeechPermission`
 * is the one place that does.
 *
 * Every event carries the number of the recording it came from, and the number
 * only reaches JS when `start` resolves, so an event that beats it is held and
 * replayed rather than dropped. An event from an earlier recording is ignored,
 * which is what stops a late result from one session landing on the next.
 */
export async function startSpeech(handlers: SpeechHandlers): Promise<SpeechSession> {
  const native = nativeModule;
  if (!native || typeof native.addListener !== 'function') throw new SpeechStartError('unavailable');

  let id: number | null = null;
  let ended = false;
  const held: Array<{ name: SpeechEventName; body: Record<string, unknown> }> = [];
  const subscriptions: Subscription[] = [];

  const finish = () => {
    if (ended) return;
    ended = true;
    for (const subscription of subscriptions) subscription.remove();
    handlers.onEnd();
  };

  const dispatch = (name: SpeechEventName, body: Record<string, unknown>) => {
    if (body.session !== id) return;
    if (name === 'onTranscript' && typeof body.text === 'string') {
      handlers.onTranscript(body.text, body.isFinal === true);
    } else if (name === 'onLevel' && typeof body.level === 'number') {
      handlers.onLevel?.(body.level);
    } else if (name === 'onEnd') {
      finish();
    }
  };

  const listen = (name: SpeechEventName) =>
    native.addListener!(name, body => {
      if (id === null) held.push({ name, body });
      else dispatch(name, body);
    });

  try {
    subscriptions.push(listen('onTranscript'), listen('onLevel'), listen('onEnd'));
    id = await native.start();
  } catch (error) {
    for (const subscription of subscriptions) subscription.remove();
    throw new SpeechStartError(failureOf(error));
  }
  for (const event of held.splice(0)) dispatch(event.name, event.body);

  return {
    stop: async () => {
      try { await native.stop(); } catch { finish(); }
    },
    cancel: async () => {
      try { await native.cancel(); } catch { /* the end below is what matters */ }
      finish();
    },
  };
}
