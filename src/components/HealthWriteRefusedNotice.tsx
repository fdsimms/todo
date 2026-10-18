import { useEffect, useReducer, useRef } from 'react';
import { Alert } from 'react-native';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { openHealthApp } from '../utils/healthBridge';

/**
 * What each refusal says. A workout is refused apart from a meal (Health asks
 * about each share type on its own), so each has its own words and its own
 * "already said" flag, and the one alert below carries whichever came in.
 */
const REFUSALS = {
  meal: {
    title: 'Your meals are not reaching Health',
    message: 'Health is not allowing this app to write nutrition, so logged meals stay here only. Open Health, find this app under Sharing, and allow it to write nutrition.',
  },
  workout: {
    title: 'Your workouts are not reaching Health',
    message: 'Health is not allowing this app to write workouts, so saved workouts stay here only. Open Health, find this app under Sharing, and allow it to write workouts.',
  },
} as const;

/**
 * Says once that Health is refusing the meals, or the workouts, this app
 * tries to write.
 *
 * Renders nothing. It exists because a refused write is otherwise completely
 * invisible: `addEntry` saves the food log entry either way, which is right, so
 * the only evidence is a meal that never turns up in Health. Somebody who
 * turned "Log to Health" on and never granted sharing in Health's own sheet
 * loses every meal and is told nothing (#2516).
 *
 * **Mounted once in AppNavigator, beside `LogMealPrompt` and
 * `FinishLeftoverPrompt`, for the same reason they are**: a meal is logged from
 * the food log, a meal plan square, a cook task's prompt or a missed-log nudge,
 * and this has to reach whichever of those the person is standing on.
 *
 * Three decisions worth not re-deriving:
 *
 * - **Once, not per meal.** The failure is ongoing and identical every time, so
 *   a notice per meal would be a nag about a thing already said. What makes
 *   "once" safe rather than a way of going quiet forever is that a write which
 *   lands clears the flag, so a breakage that starts later gets its own notice.
 * - **An alert rather than a blocking sheet.** Nothing the person asked for
 *   failed: the meal is logged. Only the copy to Health did not happen, so this
 *   interrupts to the smallest degree that still arrives.
 * - **It does not offer to turn the switch off.** The switch is not what is
 *   wrong. Sharing is refused in Health, so the only useful action is to open
 *   Health, and offering a switch here would look like a fix and would instead
 *   turn off the thing the person wanted.
 */
export function HealthWriteRefusedNotice() {
  const mealPending = useFoodLogStore(s => s.pendingHealthWriteRefusal);
  const setMealPending = useFoodLogStore(s => s.setPendingHealthWriteRefusal);
  // A saved workout is refused the same invisible way: the session saves
  // either way, and only Health is missing it.
  const workoutPending = useWorkoutStore(s => s.pendingHealthWriteRefusal);
  const setWorkoutPending = useWorkoutStore(s => s.setPendingHealthWriteRefusal);

  // Alert.alert is imperative, so a re-render while one is up would stack a
  // second copy on top of the first. Same guard FinishLeftoverPrompt keeps.
  const showing = useRef(false);
  // Bumped when an alert goes, so a second refusal that arrived while the
  // first was up is said next rather than waiting for some later change.
  const [dismissals, dismissed] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if ((!mealPending && !workoutPending) || showing.current) return;
    showing.current = true;
    // One at a time: a meal first, and a workout refused alongside it once
    // this one is dismissed.
    const kind = mealPending ? 'meal' : 'workout';
    // Cleared as the alert is raised rather than in the buttons, so dismissing
    // it by any route (including a system interruption) still counts as said.
    if (kind === 'meal') setMealPending(false);
    else setWorkoutPending(false);

    const done = () => { showing.current = false; dismissed(); };
    Alert.alert(
      REFUSALS[kind].title,
      REFUSALS[kind].message,
      [
        { text: 'Not now', style: 'cancel', onPress: done },
        {
          text: 'Open Health',
          onPress: () => { done(); void openHealthApp(); },
        },
      ],
      { onDismiss: done },
    );
  }, [mealPending, workoutPending, setMealPending, setWorkoutPending, dismissals]);

  return null;
}
