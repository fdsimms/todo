import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { useWatchHealthStore } from '../store/useWatchHealthStore';
import { isDemoModeActive } from '../utils/demoState';
import { openHealthApp } from '../utils/healthBridge';

/** One alert on screen at a time, across every mount. */
let telling = false;

/**
 * Says once, while the app is in front, that the Apple Watch couldn't find a
 * workout it was asked to take out of Apple Health (`useWatchHealthStore`'s
 * `notFound`). watchOS keeps only recent samples on the watch, so an older
 * workout deleted on the phone is out of the watch's reach and may still be in
 * Health: only the person can take it out there. Mounted once in App.tsx,
 * beside `useWatchClashPrompt`, for the same reasons.
 */
export function useWatchRetractNotice(): void {
  useEffect(() => {
    const tell = () => {
      if (telling || AppState.currentState !== 'active' || isDemoModeActive()) return;
      const count = useWatchHealthStore.getState().notFound;
      if (count === 0) return;
      telling = true;
      const done = () => {
        telling = false;
        useWatchHealthStore.getState().clearNotFound();
      };
      Alert.alert(
        'Couldn’t remove from Health',
        count === 1
          ? 'Your Apple Watch couldn’t find a workout you deleted, so it may still be in Apple Health. If it is, delete it in the Health app.'
          : `Your Apple Watch couldn’t find ${count} workouts you deleted, so they may still be in Apple Health. If they are, delete them in the Health app.`,
        [
          { text: 'Not now', style: 'cancel', onPress: done },
          { text: 'Open Health', onPress: () => { done(); void openHealthApp(); } },
        ],
      );
    };

    // What a background launch in this process may have written before
    // anything here was listening.
    useWatchHealthStore.getState().reload();
    tell();
    const unsub = useWatchHealthStore.subscribe((state, prev) => {
      if (state.notFound !== prev.notFound) tell();
    });
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        useWatchHealthStore.getState().reload();
        tell();
      }
    });
    return () => {
      unsub();
      sub.remove();
    };
  }, []);
}
