import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

export interface StartWorkoutInput {
  routineId?: string | null;
  /** The task occurrence it is for, which finishing completes. */
  taskId?: string | null;
}

/**
 * Starting a workout from anywhere, and what happens when one is already
 * going: there is one live session at a time (`startSession` refuses a
 * second), so the answer is to open the one in progress, said in an alert
 * rather than done silently, since it is not the routine that was tapped.
 * The same task's workout already running just opens.
 */
export function useStartWorkout(): (input?: StartWorkoutInput) => void {
  return useCallback((input: StartWorkoutInput = {}) => {
    const store = useWorkoutStore.getState();
    const show = useWorkoutModeStore.getState().show;
    const live = store.liveSession();
    if (live) {
      if ((input.taskId && live.taskId === input.taskId) || (!input.taskId && input.routineId && live.routineId === input.routineId)) {
        haptics.tap();
        show();
        return;
      }
      Alert.alert(
        'A workout is in progress',
        `“${live.title}” is still going. Finish it or end it before starting another.`,
        [
          { text: BUTTON_LABEL.cancel, style: 'cancel' },
          { text: 'Open it', onPress: show },
        ],
      );
      return;
    }
    const started = store.startSession({ routineId: input.routineId ?? null, taskId: input.taskId ?? null });
    if (typeof started === 'string') return;
    haptics.impactMedium();
    show();
  }, []);
}
