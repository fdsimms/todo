import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { useTaskStore } from '../store/useTaskStore';
import { haptics } from './haptics';

const UPDATE_INTERVAL_MS = 100;
const SHAKE_THRESHOLD_G = 2.2;
const SHAKE_COOLDOWN_MS = 1500;

/**
 * Global "shake to undo" gesture. Subscribes to the accelerometer for as
 * long as the component using this hook is mounted, and prompts to confirm
 * undoLastAction() whenever it detects a shake — but only if there's
 * actually something undoable queued up, so shaking the phone for
 * unrelated reasons never surprises the user with a reverted action.
 * Confirming (rather than undoing outright) also protects against
 * incidental shakes, e.g. the phone getting tossed onto a bed.
 */
export function useShakeToUndo(): void {
  const lastShakeAt = useRef(0);
  const confirmOpenRef = useRef(false);

  useEffect(() => {
    Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (magnitude < SHAKE_THRESHOLD_G) return;

      const now = Date.now();
      if (now - lastShakeAt.current < SHAKE_COOLDOWN_MS) return;
      if (confirmOpenRef.current) return;

      const { lastAction, undoLastAction } = useTaskStore.getState();
      if (!lastAction) return;

      lastShakeAt.current = now;
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

    return () => subscription.remove();
  }, []);
}
