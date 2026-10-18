import { useCallback } from 'react';
import { startWorkout, type StartWorkoutInput } from '../utils/startWorkout';

export type { StartWorkoutInput } from '../utils/startWorkout';

/**
 * Starting a workout from a component: `startWorkout`, held stable so a row
 * passing it down keeps its memo. The rules (one live session at a time, a
 * program's next routine) are in src/utils/startWorkout.ts, which the Siri
 * drain calls directly.
 */
export function useStartWorkout(): (input?: StartWorkoutInput) => void {
  return useCallback((input: StartWorkoutInput = {}) => {
    startWorkout(input);
  }, []);
}
