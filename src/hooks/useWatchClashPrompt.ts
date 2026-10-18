import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { useWatchClashStore } from '../store/useWatchClashStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from '../utils/demoState';
import { clashPrompt, nextClash, sessionToDelete, type ClashChoice } from '../utils/watchWorkoutClash';

/** One question on screen at a time, across every mount. */
let asking = false;

/**
 * Asks "Two workouts at the same time" for each watch workout that arrived
 * overlapping another (`useWatchClashStore`), one at a time, while the app is
 * in front. Mounted once in App.tsx rather than on a screen: the workout can
 * arrive with any tab showing, and a frozen tab runs no effects.
 *
 * Asked once per pair: the pair leaves the list when it is answered. A pair
 * one of whose workouts has gone since (deleted here or on another device) is
 * dropped without asking. Deleting goes through `deleteSession`, so a workout
 * in Apple Health is taken out of it too.
 */
export function useWatchClashPrompt(): void {
  useEffect(() => {
    const ask = () => {
      if (asking || AppState.currentState !== 'active' || isDemoModeActive()) return;
      const workouts = useWorkoutStore.getState();
      if (!workouts.initialized) return;
      const clashes = useWatchClashStore.getState();
      const next = nextClash(clashes.pending, workouts.sessions);
      if (!next) return;
      if (next.kind === 'drop') {
        // resolve() changes `pending`, which the subscription below answers
        // with the next pair.
        clashes.resolve(next.clash);
        return;
      }
      const { use24HourTime } = useSettingsStore.getState();
      const inHealth = next.watch.healthWorkoutId !== null || next.other.healthWorkoutId !== null;
      const words = clashPrompt(next.watch, next.other, new Date(), use24HourTime, inHealth);
      asking = true;
      const answer = (choice: ClashChoice) => {
        asking = false;
        const doomed = sessionToDelete(next.clash, choice);
        if (doomed) useWorkoutStore.getState().deleteSession(doomed);
        useWatchClashStore.getState().resolve(next.clash, doomed ? [doomed] : []);
      };
      Alert.alert(words.title, words.message, [
        { text: words.deleteWatch, style: 'destructive', onPress: () => answer('deleteWatch') },
        { text: words.deleteOther, style: 'destructive', onPress: () => answer('deleteOther') },
        { text: words.keepBoth, style: 'cancel', onPress: () => answer('keepBoth') },
      ]);
    };

    // What a background launch in this process may have written before
    // anything here was listening.
    useWatchClashStore.getState().reload();
    ask();
    const unsubClashes = useWatchClashStore.subscribe((state, prev) => {
      if (state.pending !== prev.pending) ask();
    });
    const unsubWorkouts = useWorkoutStore.subscribe((state, prev) => {
      if (state.initialized !== prev.initialized) ask();
    });
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        useWatchClashStore.getState().reload();
        ask();
      }
    });
    return () => {
      unsubClashes();
      unsubWorkouts();
      sub.remove();
    };
  }, []);
}
