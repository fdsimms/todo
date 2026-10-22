import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import {
  SpeechStartError,
  isSpeechAvailable,
  requestSpeechPermission,
  speechPermissionStatus,
  startSpeech,
  type SpeechSession,
} from 'todo-speech-bridge';
import { BUTTON_LABEL } from '../copy/shared';
import { DICTATION_BARS, dictationRefusal, joinDictation, pushLevel } from '../utils/dictation';

export type DictationState = 'idle' | 'starting' | 'listening' | 'stopping';

interface Options {
  /** The longest the field can hold, so a long recording is cut there. */
  maxLength: number;
  /** Called with the page as it should read, at every partial result. */
  onText: (text: string) => void;
}

/**
 * Speaking into a text field, on the device. See `docs/arch/journal.md`,
 * "Dictating an entry".
 *
 * `start(base)` listens and calls `onText` with `base` plus everything heard so
 * far, recomputed at each partial result so a word the recognizer revises
 * replaces itself. It asks for the microphone and speech recognition the first
 * time, and on a refusal explains why in an alert and goes back to idle, so a
 * caller has no failure branch of its own.
 *
 * `available` is false where the phone can't recognize speech without the
 * internet, which is the caller's cue to show no microphone at all.
 *
 * Every await re-checks a token before it writes anything, so closing the
 * sheet or tapping Stop while the permission prompt or the native start is
 * still in flight can't leave a recording running behind a sheet that is gone.
 */
export function useDictation({ maxLength, onText }: Options) {
  const available = useMemo(() => isSpeechAvailable(), []);
  const [state, setState] = useState<DictationState>('idle');
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const token = useRef(0);
  const session = useRef<SpeechSession | null>(null);
  const clock = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stopClock = () => {
    if (clock.current) clearInterval(clock.current);
    clock.current = null;
  };

  const refuse = (failure: Parameters<typeof dictationRefusal>[0]) => {
    const { title, message, offerSettings } = dictationRefusal(failure);
    Alert.alert(
      title,
      message,
      offerSettings
        ? [
            { text: BUTTON_LABEL.cancel, style: 'cancel' },
            { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
          ]
        : [{ text: 'OK' }],
    );
  };

  const start = useCallback(async (base: string) => {
    if (!available || state !== 'idle') return;
    const mine = ++token.current;
    setState('starting');
    setLevels([]);
    setElapsed(0);

    if (speechPermissionStatus() !== 'granted') {
      const answer = await requestSpeechPermission();
      if (mine !== token.current) return;
      if (answer !== 'granted') {
        setState('idle');
        refuse('permission');
        return;
      }
    }

    try {
      const started = await startSpeech({
        onTranscript: text => {
          if (mine === token.current) onTextRef.current(joinDictation(base, text, maxLength));
        },
        onLevel: level => {
          if (mine === token.current) setLevels(prev => pushLevel(prev, level, DICTATION_BARS));
        },
        onEnd: () => {
          if (mine !== token.current) return;
          stopClock();
          session.current = null;
          setState('idle');
        },
      });
      if (mine !== token.current) {
        void started.cancel();
        return;
      }
      session.current = started;
      setState('listening');
      const began = Date.now();
      stopClock();
      clock.current = setInterval(() => setElapsed(Math.floor((Date.now() - began) / 1000)), 1000);
    } catch (error) {
      if (mine !== token.current) return;
      setState('idle');
      refuse(error instanceof SpeechStartError ? error.failure : 'start');
    }
  }, [available, state, maxLength]);

  /** Stops listening and lets the last words come through. */
  const stop = useCallback(() => {
    if (!session.current) return;
    setState('stopping');
    void session.current.stop();
  }, []);

  /** Stops at once and drops what was in flight: a sheet closing, a Cancel. */
  const cancel = useCallback(() => {
    token.current += 1;
    stopClock();
    const current = session.current;
    session.current = null;
    if (current) void current.cancel();
    setState('idle');
  }, []);

  useEffect(() => cancel, [cancel]);

  return { available, state, levels, elapsed, start, stop, cancel };
}
