import { Platform } from 'react-native';

/**
 * Reading the daily agenda out loud.
 *
 * The text already existed and could only be looked at, which is the one thing
 * you are not doing while making coffee or finding your keys. What the agenda
 * *says* when spoken lives in `dailyAgenda.ts` beside the written wording
 * (`agendaSpokenBody`); this is only the door to the synthesiser, kept apart
 * for the reason every pure/impure split in this app is: the phrasing is worth
 * testing and a native module cannot be.
 *
 * **This is not an accessibility feature and must not be described as one.**
 * VoiceOver already reads every screen in this app, and it reads them better
 * than this could. This is for somebody who is not looking at the phone at all.
 *
 * `expo-speech` is required at the call site rather than imported at the top,
 * the same way `recipePhoto.ts` reaches `expo-image-picker`: a top-level import
 * of a native module pulls it into every Jest run that touches anything
 * importing this file.
 */

function speech(): typeof import('expo-speech') {
  return require('expo-speech');
}

/**
 * How fast it reads.
 *
 * Below the 1.0 default on purpose. The agenda is three counts in one sentence
 * with no redundancy in it, so there is nothing to catch up on if a number goes
 * past — and the whole point is that it is heard from across a room by somebody
 * doing something else.
 */
export const AGENDA_SPEECH_RATE = 0.92;

/**
 * Speak a line, replacing anything already being spoken.
 *
 * Stops first because `Speech.speak` *queues* rather than interrupts, and two
 * agendas read back to back is the one outcome nobody wants from tapping a
 * notification twice. Nothing awaits the stop: `speak` after it is queued
 * behind it either way, and awaiting would make the caller async for no answer
 * it uses.
 *
 * Every failure is swallowed. There is no device without a voice for English,
 * but there is a simulator without one, and a silent agenda is a disappointment
 * where a thrown error inside a notification handler is a crash on launch.
 */
export function speakAgenda(line: string): void {
  if (Platform.OS === 'web') return;
  try {
    const module = speech();
    module.stop();
    module.speak(line, { rate: AGENDA_SPEECH_RATE });
  } catch {
    // Nothing to report to: this runs from a notification tap, with no screen
    // of its own to put a message on.
  }
}

/** Stop reading, for a caller that wants the room quiet again. */
export function stopSpeakingAgenda(): void {
  if (Platform.OS === 'web') return;
  try {
    speech().stop();
  } catch {
    // As above.
  }
}
