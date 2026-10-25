import { Alert } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { BUTTON_LABEL } from '../copy/shared';

interface ConfirmDeleteOptions {
  title: string;
  message?: string;
  /** Defaults to 'Delete' — override for a differently-worded destructive verb ('Forget', 'Clear', 'Merge', 'Unstack', 'Reset', 'Remove'). */
  confirmLabel?: string;
  /**
   * The delete files an undo the undo bar offers (a `destructive` or
   * `announce` entry), so it runs at once and the bar is the way back. An
   * alert in front of an action that can already be taken back costs every
   * delete a tap to guard against the rare one that was a mistake, which the
   * undo covers anyway. Only pass it when the store action really does file
   * one: an undo reachable only by shaking is not one the person can see.
   */
  undoable?: boolean;
  onConfirm: () => void;
}

/**
 * The one Cancel/[destructive] confirm every simple delete in the app shows —
 * "Confirm before deleting" in Settings (`confirmBeforeDeleting`) is the
 * single gate for all of them, so turning it off skips the Alert everywhere
 * at once rather than call site by call site. A delete with an undo behind it
 * (`undoable`) never asks, whatever the setting says.
 *
 * Not for a dialog that's asking *which* delete to perform (a recurring
 * task's series-vs-occurrence, a non-empty stack/project's delete-this-vs-
 * delete-everything cascade) — those are a choice, not confirmation
 * friction, and stay as their own unconditional Alert.alert calls.
 */
export function confirmDelete({ title, message, confirmLabel = BUTTON_LABEL.delete, undoable = false, onConfirm }: ConfirmDeleteOptions): void {
  if (undoable || !useSettingsStore.getState().confirmBeforeDeleting) {
    onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: BUTTON_LABEL.cancel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
