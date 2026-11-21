import { create } from 'zustand';
import { navigationRef, runWhenReady, WORKOUT_MODE_ROUTE } from '../navigation/navigationRef';

/**
 * Workout mode is a page (`WorkoutModeScreen`, a card on the root stack), and
 * this is how everything else opens and leaves it. Four places open it (the
 * Workouts screen, a task row's Workout button, the live session's Resume and
 * the floating bar), plus the Lock Screen and widget, so they all call `show`
 * and none of them navigates for itself. Screen state only: never persisted,
 * and a session left running while the page is closed stays live in
 * `useWorkoutStore`.
 */
interface WorkoutModeState {
  /**
   * The exercise a tick made somewhere else asks the page to turn to, stamped
   * so asking twice for the same one still reads as a new request. Set by
   * `showExercise`: the Lock Screen's "Done set" ticks a set outside the page,
   * and the card has to move the way it would have for a tick on the page.
   */
  viewRequest: { exerciseId: string; at: number } | null;
  /**
   * The exercises folded on the page, kept here because leaving the page
   * unmounts it. Tied to a session so a new workout starts with every card open.
   */
  collapsed: { sessionId: string; ids: ReadonlySet<string> } | null;
  /**
   * The linked task whose question saving left for the host to ask. `ready`
   * flips once the page has finished leaving: a sheet presented while the pop
   * is still animating is dropped by UIKit, so the host waits for it.
   */
  ask: { taskId: string; ready: boolean } | null;
  /** Opens the page (nothing happens if it is already the one showing). */
  show: () => void;
  /** Opens the page on an exercise's card. */
  showExercise: (exerciseId: string) => void;
  /** Leaves the page. The session stays live unless it was finished or thrown away. */
  hide: () => void;
  setCollapsed: (sessionId: string, ids: ReadonlySet<string>) => void;
  askAfterClose: (taskId: string) => void;
  markAskReady: () => void;
  clearAsk: () => void;
}

function onWorkoutPage(): boolean {
  return navigationRef.isReady() && navigationRef.getCurrentRoute()?.name === WORKOUT_MODE_ROUTE;
}

function openPage(): void {
  runWhenReady(() => {
    if (!onWorkoutPage()) navigationRef.navigate(WORKOUT_MODE_ROUTE);
  });
}

export const useWorkoutModeStore = create<WorkoutModeState>(set => ({
  viewRequest: null,
  collapsed: null,
  ask: null,
  show: () => {
    // Cleared so a request left over from an earlier visit can't turn the
    // page's card when it mounts.
    set({ viewRequest: null });
    openPage();
  },
  showExercise: exerciseId => {
    set({ viewRequest: { exerciseId, at: Date.now() } });
    openPage();
  },
  hide: () => {
    if (onWorkoutPage() && navigationRef.canGoBack()) navigationRef.goBack();
  },
  setCollapsed: (sessionId, ids) => set({ collapsed: { sessionId, ids } }),
  askAfterClose: taskId => set({ ask: { taskId, ready: false } }),
  markAskReady: () => set(s => (s.ask && !s.ask.ready ? { ask: { ...s.ask, ready: true } } : s)),
  clearAsk: () => set({ ask: null }),
}));
