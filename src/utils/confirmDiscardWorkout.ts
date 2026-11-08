import { Alert } from 'react-native';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { BUTTON_LABEL } from '../copy/shared';
import { haptics } from './haptics';

/**
 * Asks, then throws away the workout in progress and every set logged in it.
 * Shared by the trash can in workout mode's header and the one on the
 * in-progress bar (`WorkoutBar`), so the wording and the consequence read the
 * same from both. Always asks, whatever "Confirm before deleting" says: nothing
 * files an undo for it, and the sets can't be got back.
 */
export function confirmDiscardWorkout(onDiscarded?: () => void): void {
  haptics.tap();
  Alert.alert(
    'Discard workout?',
    'This deletes the workout and every set logged in it.',
    [
      { text: BUTTON_LABEL.cancel, style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          useWorkoutStore.getState().discardSession();
          haptics.success();
          onDiscarded?.();
        },
      },
    ],
  );
}
