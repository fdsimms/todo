import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';
import { useTaskStore } from '../store/useTaskStore';
import { haptics } from './haptics';

const UPDATE_INTERVAL_MS = 100;
const SHAKE_THRESHOLD_G = 2.2;
const SHAKE_COOLDOWN_MS = 1500;

/**
 * Global "shake to undo" gesture. Subscribes to the accelerometer for as
 * long as the component using this hook is mounted, and calls
 * undoLastAction() whenever it detects a shake — but only if there's
 * actually something undoable queued up, so shaking the phone for
 * unrelated reasons never surprises the user with a reverted action.
 */
export function useShakeToUndo(): void {
  const lastShakeAt = useRef(0);

  useEffect(() => {
    Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (magnitude < SHAKE_THRESHOLD_G) return;

      const now = Date.now();
      if (now - lastShakeAt.current < SHAKE_COOLDOWN_MS) return;

      const { lastAction, undoLastAction } = useTaskStore.getState();
      if (!lastAction) return;

      lastShakeAt.current = now;
      haptics.success();
      undoLastAction();
    });

    return () => subscription.remove();
  }, []);
}
