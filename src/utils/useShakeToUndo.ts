import { useEffect, useRef } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { useTaskStore } from '../store/useTaskStore';
import { isAppLocked } from '../store/useAppLockStore';
import { haptics } from './haptics';
import {
  createShakeState,
  armShakeState,
  feedShakeSample,
  isUndoActionFresh,
  SHAKE_UPDATE_INTERVAL_MS,
} from './shakeDetect';

/**
 * Global "shake to undo" gesture. Prompts to confirm undoLastAction()
 * whenever it detects a shake — but only if there's actually something
 * recently undoable, so shaking the phone for unrelated reasons never
 * surprises the user with a reverted action. Confirming (rather than undoing
 * outright) also protects against incidental shakes, e.g. the phone getting
 * tossed onto a bed.
 *
 * Three separate things keep the dialog from appearing unprompted, and all
 * three are load-bearing — an earlier version had only the first and the
 * confirm still showed up on its own:
 *
 * 1. The accelerometer subscription exists *only* while the app is
 *    foregrounded, rather than running always and testing AppState per
 *    sample. Motion in a pocket then isn't sampled at all, instead of being
 *    sampled and discarded — and nothing is queued natively to be delivered
 *    after the app is already 'active'.
 * 2. The detector stays disarmed for a moment after foregrounding, because
 *    the motion that brings you to the app is still in flight when AppState
 *    flips (see SHAKE_ARM_DELAY_MS).
 * 3. Detection requires sustained oscillation, not one hard sample, so a
 *    pickup or a knock can't clear the bar however sharp it is (see
 *    shakeDetect.ts).
 */
export function useShakeToUndo(): void {
  const confirmOpenRef = useRef(false);

  useEffect(() => {
    const shake = createShakeState();
    let subscription: { remove: () => void } | null = null;

    const stop = () => {
      subscription?.remove();
      subscription = null;
    };

    const start = () => {
      if (subscription) return;
      armShakeState(shake, Date.now());
      Accelerometer.setUpdateInterval(SHAKE_UPDATE_INTERVAL_MS);
      subscription = Accelerometer.addListener(sample => {
        const now = Date.now();
        if (!feedShakeSample(shake, sample, now)) return;
        if (confirmOpenRef.current) return;

        // The confirm names the action ("Undo \"Complete Pay rent\"?"), which is
        // a task title on top of a lock screen. A locked app stays locked.
        if (isAppLocked()) return;

        const { lastAction, undoLastAction } = useTaskStore.getState();
        if (!lastAction) return;
        if (!isUndoActionFresh(lastAction.at, now)) return;

        confirmOpenRef.current = true;
        haptics.warning();
        Alert.alert(
          'Undo Last Action',
          `Undo "${lastAction.label}"?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => { confirmOpenRef.current = false; } },
            {
              text: 'Undo',
              style: 'destructive',
              onPress: async () => {
                confirmOpenRef.current = false;
                await haptics.success();
                undoLastAction();
              },
            },
          ],
          { onDismiss: () => { confirmOpenRef.current = false; } }
        );
      });
    };

    const handleAppState = (next: AppStateStatus) => {
      if (next === 'active') start();
      else stop();
    };

    if (AppState.currentState === 'active') start();
    const appStateSub = AppState.addEventListener('change', handleAppState);

    return () => {
      appStateSub.remove();
      stop();
    };
  }, []);
}
