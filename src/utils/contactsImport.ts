import { format } from 'date-fns/format';
import type { Person } from '../types';

/**
 * Filling one person in from the system contact book — see
 * `docs/arch/people.md`, "Where the two lines actually fall".
 *
 * **This is not the bulk import the non-goals rule out, and the difference is
 * the picker's default view rather than a count.** The objection was never to
 * the contact book, it was to *a list you did not write*: 400 people you do not
 * think about, which then has to be sorted somehow. Filling in one person is
 * the same deliberate act as typing their name, minus the typing.
 *
 * So: the picker opens on a search field with nothing under it, there is no
 * "select all" at any point, and nothing here ever returns a whole address
 * book — `searchContacts` refuses an empty query outright rather than falling
 * back to "everyone". You cannot bulk-select an address book you are never
 * shown.
 *
 * That is also simply the better control. A contact book is mostly dentists,
 * plumbers and somebody from a wedding in 2019, so browsing it for the people
 * you care about means wading through noise.
 *
 * Pure. The permission and the native read are `contactsAccess.ts`, the same
 * split `calendarBusy.ts` and `calendarSync.ts` keep.
 */

/**
 * The shortest query that will search at all.
 *
 * Two, not one: a single letter matches a large fraction of any address book,
 * and a screen of near-everybody is the browse view this feature exists not to
 * have. It is a floor on the *query*, not on the results.
 */
export const MIN_CONTACT_QUERY_LENGTH = 2;

/** How many matches are ever shown. A search that returns a book is a book. */
export const MAX_CONTACT_RESULTS = 12;

/** One contact, flattened to the fields a person is filled in from. */
export interface ContactCandidate {
  /** The system contact id. Used to key the list, never stored on the person. */
  id: string;
  name: string;
  phoneNumber: string | null;
  email: string | null;
  /** 1-12, already converted off the native module's 0-11 — see `contactBirthday`. */
  birthdayMonth: number | null;
  birthdayDay: number | null;
}

/** What gets written when one is picked. Deliberately a subset of `Person`. */
export type ContactPersonDraft = Pick<
  Person,
  'name' | 'phoneNumber' | 'email' | 'birthdayMonth' | 'birthdayDay'
>;

/**
 * The month and day off a native contact's birthday, or nulls.
 *
 * **`month` arrives 0-indexed and `Person.birthdayMonth` is 1-12.** The native
 * module follows the JS `Date` convention and this app's column follows the
 * human one (`birthdayInYear` does `birthdayMonth - 1` to get back), so a
 * straight copy puts every birthday one month early — and silently, since
 * every value is still in range. This is the one conversion in the feature and
 * it has its own test.
 *
 * **The year is dropped, and that is not data loss.** `Person` has no birth
 * year any more (#2083 removed it), so there is nothing to put it in. A
 * year-less birthday was always the common case here anyway — which is why the
 * month and day were stored apart from it in the first place.
 *
 * Both halves together or neither: a month with no day is not a date anything
 * can be computed from, the same rule `PersonEditor`'s own clear follows.
 */
export function contactBirthday(
  birthday: { month?: number | null; day?: number | null } | null | undefined
): { birthdayMonth: number | null; birthdayDay: number | null } {
  const rawMonth = birthday?.month;
  const day = birthday?.day;
  if (
    typeof rawMonth !== 'number' || typeof day !== 'number' ||
    !Number.isFinite(rawMonth) || !Number.isFinite(day)
  ) {
    return { birthdayMonth: null, birthdayDay: null };
  }
  const month = rawMonth + 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { birthdayMonth: null, birthdayDay: null };
  }
  return { birthdayMonth: month, birthdayDay: day };
}

/** Digits only, so "(555) 018-2277" and "5550182277" are the same number. */
export function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/**
 * Whether this contact is somebody already on the People screen.
 *
 * **Matched on name or phone, never on a stored contact id**, because there is
 * no stored contact id: the import is a copy, not a link (see the arch doc), so
 * there is nothing on the person pointing back at the address book. Name is
 * compared trimmed and case-insensitively against both the name and the
 * nickname, since "Mom" in Contacts and "Mom" as a nickname are the same
 * person.
 *
 * A phone match alone counts, which is what catches the same person filed under
 * a different name. The last seven digits rather than the whole string, so a
 * number stored with a country code on one side and without on the other still
 * matches.
 */
export function alreadyAdded(
  candidate: Pick<ContactCandidate, 'name' | 'phoneNumber'>,
  people: readonly Pick<Person, 'name' | 'nickname' | 'phoneNumber'>[]
): boolean {
  const name = candidate.name.trim().toLowerCase();
  const digits = normalizePhone(candidate.phoneNumber);
  const tail = digits.length >= 7 ? digits.slice(-7) : null;
  return people.some(person => {
    if (name && (person.name.trim().toLowerCase() === name || person.nickname.trim().toLowerCase() === name)) {
      return true;
    }
    if (!tail) return false;
    const theirs = normalizePhone(person.phoneNumber);
    return theirs.length >= 7 && theirs.slice(-7) === tail;
  });
}

/**
 * Whether the query has enough in it to search at all.
 *
 * Trimmed first, so a field holding only spaces is an empty field. This is the
 * gate that keeps the sheet showing nothing until somebody types.
 */
export function canSearchContacts(query: string): boolean {
  return query.trim().length >= MIN_CONTACT_QUERY_LENGTH;
}

/**
 * The matches worth showing, already-added people removed and capped.
 *
 * Ordered by where the query lands rather than alphabetically: a name that
 * *starts* with what you typed is what you meant far more often than one that
 * merely contains it, and a book with a Dan and a Jordan should put Dan first
 * for "dan". Ties keep the order the system gave them, which on iOS is the
 * user's own sort setting.
 *
 * Contacts with no name at all are dropped: a row with nothing to read is a row
 * that can only be picked by accident.
 */
export function rankContacts(
  candidates: readonly ContactCandidate[],
  query: string,
  people: readonly Pick<Person, 'name' | 'nickname' | 'phoneNumber'>[],
  limit: number = MAX_CONTACT_RESULTS
): ContactCandidate[] {
  const needle = query.trim().toLowerCase();
  if (!canSearchContacts(query)) return [];

  const scored: { candidate: ContactCandidate; rank: number; order: number }[] = [];
  candidates.forEach((candidate, order) => {
    const name = candidate.name.trim();
    if (!name) return;
    if (alreadyAdded(candidate, people)) return;
    const haystack = name.toLowerCase();
    const at = haystack.indexOf(needle);
    if (at < 0) return;
    // 0 for the start of the name, 1 for the start of any other word in it,
    // 2 for anywhere else. Three buckets rather than the index itself, so
    // "Ansley Reyes" and "Bo Ansley" rank together on "ansley".
    const rank = at === 0 ? 0 : /\s/.test(haystack[at - 1]) ? 1 : 2;
    scored.push({ candidate, rank, order });
  });

  return scored
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(s => s.candidate);
}

/**
 * "March 14", or empty when there is no birthday on the contact.
 *
 * Month and day only, because that is all `Person` keeps (#2083 removed the
 * birth year) and all the row needs to say. Built in a **leap year** so a
 * February 29 birthday renders as itself rather than being clamped to the 28th
 * by whichever year happened to be handy — the same trap `recurrenceAnchorDay`
 * exists to stop one shelf over.
 */
export function describeCandidateBirthday(
  candidate: Pick<ContactCandidate, 'birthdayMonth' | 'birthdayDay'>
): string {
  if (candidate.birthdayMonth === null || candidate.birthdayDay === null) return '';
  return format(new Date(2024, candidate.birthdayMonth - 1, candidate.birthdayDay, 12), 'MMMM d');
}

/**
 * What gets written onto the new person.
 *
 * The name is trimmed and everything else is optional. **A blank string is
 * stored as null**, not as "": every other writer of these fields does the
 * same, and an empty-string phone number would light up the row's call button
 * with nothing behind it.
 */
export function contactPersonDraft(candidate: ContactCandidate): ContactPersonDraft {
  const phone = candidate.phoneNumber?.trim();
  const email = candidate.email?.trim();
  return {
    name: candidate.name.trim(),
    phoneNumber: phone ? phone : null,
    email: email ? email : null,
    birthdayMonth: candidate.birthdayMonth,
    birthdayDay: candidate.birthdayDay,
  };
}
