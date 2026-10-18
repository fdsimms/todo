import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { haptics } from '../utils/haptics';
import { programProgress } from '../utils/workoutProgram';
import { BUTTON_LABEL } from '../copy/shared';

export interface StartWorkoutInput {
  routineId?: string | null;
  /**
   * A program to start the next routine of (`programProgress`), in place of a
   * routine. One with nothing in its rotation starts nothing.
   */
  programId?: string | null;
  /** The task occurrence it is for, which finishing completes. */
  taskId?: string | null;
}

/**
 * Starting a workout from anywhere, and what happens when one is already
 * going: there is one live session at a time (`startSession` refuses a
 * second), so the answer is to open the one in progress, said in an alert
 * rather than done silently, since it is not the routine that was tapped.
 * The same task's workout already running just opens.
 *
 * A program starts its next routine, worked out from its finished sessions at
 * the moment of the tap, and the session carries the program's id so it counts
 * toward the program once finished.
 */
export function useStartWorkout(): (input?: StartWorkoutInput) => void {
  return useCallback((input: StartWorkoutInput = {}) => {
    const store = useWorkoutStore.getState();
    const show = useWorkoutModeStore.getState().show;
    const live = store.liveSession();
    if (live) {
      const same = input.taskId
        ? live.taskId === input.taskId
        : input.programId
          ? live.programId === input.programId
          : !!input.routineId && live.routineId === input.routineId;
      if (same) {
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
    let routineId = input.routineId ?? null;
    const program = input.programId ? store.programs.find(p => p.id === input.programId) ?? null : null;
    if (input.programId) {
      if (!program) return;
      routineId = programProgress(program, store.sessions, store.routines).nextRoutineId;
      if (!routineId) return;
    }
    const started = store.startSession({ routineId, programId: program?.id ?? null, taskId: input.taskId ?? null });
    if (typeof started === 'string') return;
    haptics.impactMedium();
    show();
  }, []);
}
