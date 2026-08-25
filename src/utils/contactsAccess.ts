import { Platform } from 'react-native';
import type { ExistingContact } from 'expo-contacts/legacy';
import { isDemoModeActive } from './demoState';
import {
  contactBirthday,
  MAX_CONTACT_RESULTS,
  canSearchContacts,
  type ContactCandidate,
} from './contactsImport';

/**
 * The device contact book, read one search at a time — see
 * `docs/arch/people.md` and `contactsImport.ts`, which holds every rule.
 *
 * The native half only: permission, and one narrowed fetch. Everything about
 * *which* contacts count, how they rank and what gets copied off them is in the
 * pure module, exactly the split `calendarSync.ts` and `calendarBusy.ts` keep.
 *
 * **Nothing here can return the whole address book.** The name filter is passed
 * to the native query rather than applied afterwards, so an unqueried picker
 * doesn't merely hide the book, it never reads it. That is the "you cannot
 * bulk-select an address book you are never shown" rule made structural rather
 * than a UI decision one refactor could undo.
 */

/**
 * Required where it's used rather than imported at the top, for the reason
 * `calendarSync.ts` and `remindersImportSync.ts` give: an Expo native module
 * resolves its native half with `requireNativeModule` at module scope, and a
 * static import would hoist that throw into the app's own bundle evaluation —
 * killing the whole bundle before React mounts rather than just this feature.
 * The type-only import above is erased at compile time and carries no such risk.
 */
function contacts(): typeof import('expo-contacts/legacy') {
  return require('expo-contacts/legacy');
}

export type ContactsPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** Mirrors getCalendarPermission(), including the canAskAgain line. */
export async function getContactsPermission(): Promise<ContactsPermission> {
  if (Platform.OS !== 'ios') return 'unsupported';
  try {
    const existing = await contacts().getPermissionsAsync();
    if (existing.granted) return 'granted';
    return existing.status === 'undetermined' || existing.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function requestContactsPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const existing = await contacts().getPermissionsAsync();
    if (existing.granted) return true;
    const result = await contacts().requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

/**
 * One contact, flattened.
 *
 * `ExistingContact` rather than `Contact`: the id is only on rows that came
 * *out* of the store, which is exactly what a query returns, and it is what
 * keys the list. It is deliberately never written onto the person — the import
 * is a copy, not a link (see the arch doc), so nothing on a person points back
 * at the address book.
 *
 * Exported for its test rather than for a caller.
 */
export function toCandidate(contact: ExistingContact): ContactCandidate | null {
  const name = (contact.name ?? '').trim();
  if (!contact.id || !name) return null;
  const phone = contact.phoneNumbers?.find(p => !!p.number)?.number ?? null;
  const email = contact.emails?.find(e => !!e.email)?.email ?? null;
  return {
    id: contact.id,
    name,
    phoneNumber: phone,
    email,
    ...contactBirthday(contact.birthday),
  };
}

/**
 * Contacts whose name matches, or an empty list.
 *
 * Returns nothing rather than everything for a query too short to search
 * (`canSearchContacts`), a platform without contacts, a refused permission, or
 * a read that threw. **All five collapse to the same answer on purpose**: an
 * empty picker is the honest rendering of every one of them, and the sheet says
 * which it is from the permission it already asked for rather than from a
 * distinction drawn here.
 *
 * **Demo mode reads nothing.** The seed invents people, and a picker offering
 * the real address book inside a demo would put real names on a screen handed
 * to somebody else — the same reason the past-calendar read is gated
 * (`shouldReadPastCalendar`), and the one direction the demo rule runs in for a
 * read that consumes nothing.
 */
export async function searchContacts(query: string): Promise<ContactCandidate[]> {
  if (Platform.OS !== 'ios') return [];
  if (isDemoModeActive()) return [];
  if (!canSearchContacts(query)) return [];
  try {
    const permission = await contacts().getPermissionsAsync();
    if (!permission.granted) return [];
    const { Fields } = contacts();
    const result = await contacts().getContactsAsync({
      // Narrowed in the query, not after it — see the note at the top.
      name: query.trim(),
      fields: [Fields.Name, Fields.PhoneNumbers, Fields.Emails, Fields.Birthday],
      // A ceiling on what is fetched as well as on what is shown, so a query
      // like "a" that slipped past the length floor still can't pull a book
      // into memory.
      pageSize: MAX_CONTACT_RESULTS * 4,
      pageOffset: 0,
    });
    return result.data
      .map(toCandidate)
      .filter((c): c is ContactCandidate => c !== null);
  } catch {
    return [];
  }
}
