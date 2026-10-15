import { Alert } from 'react-native';
import { BLOCK_PICKER_NOTE_MESSAGE, BLOCK_PICKER_NOTE_TITLE } from './blockEditLock';

/**
 * Says what the app picker will and won't do for a group that is blocking, and
 * resolves true when the person wants to go on. Every picker for a live group
 * asks this first, so the rule (adds now, removals when the block ends) is
 * never learned by watching an app stay blocked.
 */
export function confirmLivePicker(): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      BLOCK_PICKER_NOTE_TITLE,
      BLOCK_PICKER_NOTE_MESSAGE,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Choose apps', onPress: () => resolve(true) },
      ],
      { onDismiss: () => resolve(false) },
    );
  });
}
