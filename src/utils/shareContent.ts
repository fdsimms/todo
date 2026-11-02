import { Alert, Share } from 'react-native';

/**
 * Opens the system share sheet and says so when it can't.
 *
 * Backing out of the sheet is not a failure: on iOS `Share.share` resolves with
 * a dismissed action then, and rejects only when the sheet could not be
 * presented. Six call sites used to end in `.catch(() => {})`, one of them
 * claiming a rejection meant the person backed out, so a share that never
 * opened looked identical to a button that did nothing. Returns whether it
 * opened, for a caller that has something to undo. A direct `Share.share`
 * elsewhere fails `noSwallowedExternalOpen.test.ts`.
 */
export async function shareContent(content: { message: string; url?: string }): Promise<boolean> {
  try {
    await Share.share(content);
    return true;
  } catch {
    Alert.alert('Couldn’t share that', 'The share sheet didn’t open. Try again in a moment.');
    return false;
  }
}
