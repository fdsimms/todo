import { Alert } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { BUTTON_LABEL } from '../copy/shared';

interface ConfirmDeleteOptions {
  title: string;
  message?: string;
  /** Defaults to 'Delete' — override for a differently-worded destructive verb ('Forget', 'Clear', 'Merge', 'Unstack', 'Reset', 'Remove'). */
  confirmLabel?: string;
  onConfirm: () => void;
}

/**
 * The one Cancel/[destructive] confirm every simple delete in the app shows —
 * "Confirm before deleting" in Settings (`confirmBeforeDeleting`) is the
 * single gate for all of them, so turning it off skips the Alert everywhere
 * at once rather than call site by call site.
 *
 * Not for a dialog that's asking *which* delete to perform (a recurring
 * task's series-vs-occurrence, a non-empty stack/project's delete-this-vs-
 * delete-everything cascade) — those are a choice, not confirmation
 * friction, and stay as their own unconditional Alert.alert calls.
 */
export function confirmDelete({ title, message, confirmLabel = BUTTON_LABEL.delete, onConfirm }: ConfirmDeleteOptions): void {
  if (!useSettingsStore.getState().confirmBeforeDeleting) {
    onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: BUTTON_LABEL.cancel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
