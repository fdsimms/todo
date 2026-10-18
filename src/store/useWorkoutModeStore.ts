import { create } from 'zustand';

/**
 * Whether workout mode is on screen. Its own store because three places open
 * it (the Workouts screen, a task row's Workout button, the live session's
 * Resume) and one place draws it (`WorkoutModeHost`, mounted once beside the
 * navigator), the way `CookRecap` is. Screen state only: never persisted, and
 * a session left running while it is closed stays live in `useWorkoutStore`.
 */
interface WorkoutModeState {
  open: boolean;
  /**
   * The exercise a tick made somewhere else asks the sheet to turn to, stamped
   * so asking twice for the same one still reads as a new request. Set by
   * `showExercise`: the Lock Screen's "Done set" ticks a set outside the sheet,
   * and the card has to move the way it would have for a tick in the sheet.
   */
  viewRequest: { exerciseId: string; at: number } | null;
  show: () => void;
  /** Opens workout mode on an exercise's card. */
  showExercise: (exerciseId: string) => void;
  hide: () => void;
}

export const useWorkoutModeStore = create<WorkoutModeState>(set => ({
  open: false,
  viewRequest: null,
  show: () => set({ open: true }),
  showExercise: exerciseId => set({ open: true, viewRequest: { exerciseId, at: Date.now() } }),
  hide: () => set({ open: false }),
}));
