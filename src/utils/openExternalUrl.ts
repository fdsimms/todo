import { Alert, Linking } from 'react-native';

/** What is being opened, which decides what a failure says. */
export type ExternalKind = 'link' | 'call' | 'message' | 'email' | 'directions';

/**
 * The kind a URL's scheme implies. Directions is the one that can't be read off
 * the URL (a maps link is https like any other), so a caller says it.
 */
export function externalKindFor(url: string): ExternalKind {
  const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
  if (scheme === 'tel' || scheme === 'telprompt' || scheme === 'facetime') return 'call';
  if (scheme === 'sms') return 'message';
  if (scheme === 'mailto') return 'email';
  return 'link';
}

/**
 * What a failed open says: what failed, then the one thing worth checking. Kept
 * apart from the Alert so the wording is testable and reads the same from every
 * row that opens something outside the app.
 */
export function externalFailureCopy(kind: ExternalKind): { title: string; message: string } {
  switch (kind) {
    case 'call':
      return { title: 'Couldn’t start the call', message: 'Check the number, and that this phone can place calls.' };
    case 'message':
      return { title: 'Couldn’t open Messages', message: 'Check the number, and that Messages is set up on this phone.' };
    case 'email':
      return { title: 'Couldn’t open Mail', message: 'Check the address, and that a mail app is set up on this phone.' };
    case 'directions':
      return { title: 'Couldn’t open Maps', message: 'Check the location, and the Maps app chosen in Settings.' };
    default:
      return { title: 'Couldn’t open that link', message: 'Check the address, and that an app on this phone can open it.' };
  }
}

/**
 * Opens a URL in whatever handles it and says so when nothing does.
 *
 * There is deliberately no `canOpenURL` check: on iOS it only returns true for
 * schemes declared up front in LSApplicationQueriesSchemes, which would refuse
 * both the preset link chips and any scheme a person types, while `openURL`
 * itself only throws when nothing handles the URL. That throw used to be
 * swallowed at every call site ("no toast infra"), so a tap on a bad link did
 * nothing at all. An alert is the app's existing way to say a thing failed.
 * Returns whether it opened, for a caller that has something to undo.
 *
 * Every open goes through here: `noSwallowedExternalOpen.test.ts` fails the
 * build on a direct `Linking.openURL` anywhere else.
 */
export async function openExternalUrl(url: string, kind: ExternalKind = externalKindFor(url)): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    const { title, message } = externalFailureCopy(kind);
    Alert.alert(title, message);
    return false;
  }
}
