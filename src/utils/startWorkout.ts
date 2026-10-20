import { Alert } from 'react-native';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { haptics } from './haptics';
import { programProgress } from './workoutProgram';
import { applyLocationGym, defaultGymId } from './gymLocation';
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
  /**
   * The task names several workouts (a rotation's members), so the task alone
   * doesn't say it is this one running: a live session must match the routine
   * or program too to be opened rather than refused.
   */
  perWorkout?: boolean;
}

/** What a start did, for a caller that wants to know. */
export type StartWorkoutResult = 'started' | 'opened' | 'asked' | 'nothing';

/**
 * Starting a workout from anywhere, and what happens when one is already
 * going: there is one live session at a time (`startSession` refuses a
 * second), so the answer is to open the one in progress, said in an alert
 * rather than done silently, since it is not the routine that was asked for.
 * The same task's (or routine's, or program's) workout already running just
 * opens.
 *
 * A program starts its next routine, worked out from its finished sessions at
 * the moment of the tap, and the session carries the program's id so it counts
 * toward the program once finished.
 *
 * A plain function rather than only a hook so the Siri drain (widgetSync.ts)
 * can start one with no component to call it from; `useStartWorkout` wraps it.
 */
export function startWorkout(input: StartWorkoutInput = {}): StartWorkoutResult {
  const store = useWorkoutStore.getState();
  const show = useWorkoutModeStore.getState().show;
  const live = store.liveSession();
  if (live) {
    const same = input.taskId
      ? live.taskId === input.taskId
        && (!input.perWorkout
          || (input.routineId ? live.routineId === input.routineId : input.programId ? live.programId === input.programId : true))
      : input.programId
        ? live.programId === input.programId
        : !!input.routineId && live.routineId === input.routineId;
    if (same) {
      haptics.tap();
      show();
      return 'opened';
    }
    Alert.alert(
      'A workout is in progress',
      `“${live.title}” is still going. Finish it or end it before starting another.`,
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        { text: 'Open it', onPress: () => show() },
      ],
    );
    return 'asked';
  }
  let routineId = input.routineId ?? null;
  const program = input.programId ? store.programs.find(p => p.id === input.programId) ?? null : null;
  if (input.programId) {
    if (!program) return 'nothing';
    routineId = programProgress(program, store.sessions, store.routines).nextRoutineId;
    if (!routineId) return 'nothing';
  }
  const started = store.startSession({
    routineId, programId: program?.id ?? null, taskId: input.taskId ?? null, gymId: defaultGymId(),
  });
  if (typeof started === 'string') return 'nothing';
  // The workout opens at once at the gym last used; where the phone is follows
  // in a moment and moves it, so a slow fix never holds the start back.
  void applyLocationGym(started.id);
  haptics.impactMedium();
  show();
  return 'started';
}
