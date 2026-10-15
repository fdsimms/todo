import { Alert } from 'react-native';

interface ConfirmDiscardOptions {
  /** For a thing that was never saved at all (a new project), where "changes" is the wrong noun. */
  title?: string;
  message?: string;
  /** For a sheet that has to put something back when the answer is no (a dragged sheet snapping back up). */
  onKeepEditing?: () => void;
}

const DISCARD_TITLE = 'Discard changes?';
const DISCARD_MESSAGE = 'Your changes haven’t been saved yet. If you leave now, they’ll be lost.';

/**
 * The one "Keep editing / Discard" alert every sheet shows when it is closed
 * with unsaved work, wired in by `handleCancel` for both the header's Cancel
 * button and the pageSheet swipe-down (see CLAUDE.md on `onRequestClose`).
 *
 * The wording is written once, here, because it is meant to read identically
 * on every sheet, and hand-copied it took 39 edits to change a sentence.
 * `noHandWrittenDiscard.test.ts` fails the build on a copy. Each caller still
 * owns its own dirty check, since what counts as unsaved differs by sheet;
 * this only replaces the `Alert.alert` call that follows it.
 */
export function confirmDiscard(
  onDiscard: () => void,
  { title = DISCARD_TITLE, message = DISCARD_MESSAGE, onKeepEditing }: ConfirmDiscardOptions = {},
): void {
  Alert.alert(title, message, [
    { text: 'Keep editing', style: 'cancel', onPress: onKeepEditing },
    { text: 'Discard', style: 'destructive', onPress: onDiscard },
  ]);
}
