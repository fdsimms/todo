import { isSpeechAvailable } from 'todo-speech-bridge';

let supported: boolean | null = null;

/**
 * Whether this phone can turn speech into text on its own, read once. A row
 * asks this on every render, and the answer can't change while the app runs.
 * Kept out of `dictation.ts` so that file stays free of the native module and
 * its tests run without one.
 */
export function dictationSupported(): boolean {
  if (supported === null) supported = isSpeechAvailable();
  return supported;
}
