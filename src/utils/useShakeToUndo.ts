import { useEffect, useRef } from 'react';
import { Alert, AlertButton, AppState, AppStateStatus } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { useTaskStore } from '../store/useTaskStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { isAppLocked } from '../store/useAppLockStore';
import { haptics } from './haptics';
import {
  createShakeState,
  armShakeState,
  feedShakeSample,
  isUndoActionFresh,
  SHAKE_UPDATE_INTERVAL_MS,
} from './shakeDetect';
import { freshest, redoIsCurrent, topOf } from './undoHistory';

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
 *
 * `enabled` is a fourth gate, and the one that turns the sensor off rather
 * than just ignoring its output — the effect below never subscribes to the
 * Accelerometer at all while it's false, instead of subscribing and
 * discarding samples in the callback.
 */
export function useShakeToUndo(enabled: boolean): void {
  const confirmOpenRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

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

        // Tasks, grocery, meal plan and leftovers each keep an independent
        // undo history (see utils/undoHistory) — offer whichever of the four
        // is freshest, same as if there were one shared stack. Every entry is
        // stamped with when it landed, so freshest-first across the four is
        // the order the user actually did things in.
        const stores = [
          useTaskStore.getState(),
          useGroceryStore.getState(),
          useMealPlanStore.getState(),
          useLeftoverStore.getState(),
        ];
        const topUndos = stores.map(s => topOf(s.undoStack));
        const undoStore = freshest(stores, s => topOf(s.undoStack)?.at);
        const lastAction = undoStore ? topOf(undoStore.undoStack) : null;

        // The redo half is offered only while it is still the next step
        // forward — see redoIsCurrent for why the stamps decide that rather
        // than a clear broadcast to the other three stores.
        const redoStore = freshest(stores, s => topOf(s.redoStack)?.at);
        const redoEntry = redoStore ? topOf(redoStore.redoStack) : null;
        const canRedo =
          redoIsCurrent(redoEntry, topUndos) && isUndoActionFresh(redoEntry?.at, now);

        const canUndo = !!lastAction && isUndoActionFresh(lastAction.at, now);
        if (!canUndo && !canRedo) return;

        // Both halves get their own button when both are available. Undo stays
        // last, where it has always been, so the muscle memory of shake-then-
        // rightmost keeps doing the same thing.
        const buttons: AlertButton[] = [
          { text: 'Cancel', style: 'cancel', onPress: () => { confirmOpenRef.current = false; } },
        ];
        if (canRedo && redoStore) {
          buttons.push({
            text: `Redo "${redoEntry!.label}"`,
            onPress: async () => {
              confirmOpenRef.current = false;
              await haptics.success();
              redoStore.redoLastUndone();
            },
          });
        }
        if (canUndo && undoStore) {
          buttons.push({
            text: 'Undo',
            style: 'destructive',
            onPress: async () => {
              confirmOpenRef.current = false;
              await haptics.success();
              undoStore.undoLastAction();
            },
          });
        }

        confirmOpenRef.current = true;
        haptics.warning();
        Alert.alert(
          canUndo ? 'Undo last action' : 'Redo last undo',
          canUndo ? `Undo "${lastAction!.label}"?` : `Redo "${redoEntry!.label}"?`,
          buttons,
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
  }, [enabled]);
}
