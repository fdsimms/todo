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
  show: () => void;
  hide: () => void;
}

export const useWorkoutModeStore = create<WorkoutModeState>(set => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
