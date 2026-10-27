import type { SpeechStartFailure } from 'todo-speech-bridge';

/** How many bars the recording waveform draws. */
export const DICTATION_BARS = 28;

/**
 * Puts what was just said after the words already on the page.
 *
 * `base` is what the field held when listening began (the draft, or what the
 * person typed before tapping Keep talking) and `spoken` is the recognizer's
 * whole transcript for this recording, so the result is recomputed from the two
 * at every partial result rather than appended to: a word the recognizer
 * revises mid-sentence replaces itself instead of piling up. A space goes
 * between them unless the page already ends in whitespace, and a page that
 * would pass `max` is cut there, because the field can't hold more.
 */
export function joinDictation(base: string, spoken: string, max: number): string {
  const heard = spoken.trim();
  if (!heard) return base;
  const joined = base.length === 0 || /\s$/.test(base) ? base + heard : `${base} ${heard}`;
  return joined.length > max ? joined.slice(0, max).trimEnd() : joined;
}

/**
 * Whether the recognizer started its transcript over. After a pause the
 * on-device recognizer can begin a fresh transcript holding only what is said
 * next, so the "whole transcript so far" suddenly shrinks to a word or two.
 * A revision never cuts a long transcript to under half its length, so that is
 * the signal.
 */
export function transcriptRestarted(previous: string, next: string): boolean {
  const before = previous.trim().length;
  return before >= 12 && next.trim().length < before / 2;
}

/**
 * `joinDictation` for a whole recording: a function from each partial result to
 * the page. When the recognizer restarts its transcript, what it had heard so
 * far is kept on the page and the new words go after it, instead of replacing it.
 */
export function dictationJoiner(base: string, max: number): (spoken: string) => string {
  let committed = base;
  let last = '';
  return spoken => {
    if (transcriptRestarted(last, spoken)) committed = joinDictation(committed, last, max);
    last = spoken;
    return joinDictation(committed, spoken, max);
  };
}

/** The waveform's levels with a new one at the end, keeping the newest `cap`. */
export function pushLevel(levels: readonly number[], level: number, cap: number = DICTATION_BARS): number[] {
  const clamped = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const next = [...levels, clamped];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** A bar's height for a level, so silence is still a visible stub rather than nothing. */
export function barHeight(level: number, min: number, max: number): number {
  const clamped = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  return Math.round(min + (max - min) * clamped);
}

export interface DictationRefusal {
  title: string;
  message: string;
  /** Whether the way out is the Settings app, so the alert offers to open it. */
  offerSettings: boolean;
}

/**
 * What to tell someone whose recording didn't start. Says what happened, then
 * what to do, the way every alert here does. The "unavailable" case is the one
 * that is deliberately a refusal and not a fallback: when the phone can't
 * recognize speech without the internet, the app does not send the audio to a
 * server instead.
 */
export function dictationRefusal(failure: SpeechStartFailure): DictationRefusal {
  switch (failure) {
    case 'permission':
      return {
        title: 'Couldn’t start recording',
        message: 'dundundun needs the microphone and speech recognition to turn your voice into text. Turn them on in Settings, then try again.',
        offerSettings: true,
      };
    case 'unavailable':
      return {
        title: 'Voice entry isn’t available',
        message: 'This phone can’t turn speech into text without the internet, and dundundun never sends your voice anywhere. You can type this one instead.',
        offerSettings: false,
      };
    default:
      return {
        title: 'Couldn’t start recording',
        message: 'The microphone may be in use by a call or another app. Try again in a moment.',
        offerSettings: false,
      };
  }
}
