import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { openHealthApp } from '../utils/healthBridge';

/**
 * Says once that Health is refusing the meals this app tries to write.
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
  const pending = useFoodLogStore(s => s.pendingHealthWriteRefusal);
  const setPending = useFoodLogStore(s => s.setPendingHealthWriteRefusal);

  // Alert.alert is imperative, so a re-render while one is up would stack a
  // second copy on top of the first. Same guard FinishLeftoverPrompt keeps.
  const showing = useRef(false);

  useEffect(() => {
    if (!pending || showing.current) return;
    showing.current = true;
    // Cleared as the alert is raised rather than in the buttons, so dismissing
    // it by any route (including a system interruption) still counts as said.
    setPending(false);

    Alert.alert(
      'Your meals are not reaching Health',
      'Health is not allowing this app to write nutrition, so the meals you log are being kept here only. Open Health, find this app under Sharing, and allow it to write nutrition.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => { showing.current = false; } },
        {
          text: 'Open Health',
          onPress: () => { showing.current = false; void openHealthApp(); },
        },
      ],
      { onDismiss: () => { showing.current = false; } },
    );
  }, [pending, setPending]);

  return null;
}
