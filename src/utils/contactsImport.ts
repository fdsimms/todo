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
 * So: for a **full** grant, the picker opens on a search field with nothing
 * under it, there is no "select all" at any point, and nothing here ever
 * returns a whole address book — `searchContacts` refuses an empty query
 * outright rather than falling back to "everyone". You cannot bulk-select an
 * address book you are never shown.
 *
 * That is also simply the better control. A contact book is mostly dentists,
 * plumbers and somebody from a wedding in 2019, so browsing it for the people
 * you care about means wading through noise.
 *
 * **A `'limited'` grant is the one case where that noise is already gone**:
 * iOS's own picker is how the user chose that set, which makes it a list they
 * *did* write rather than the address book this feature refuses to show. So
 * `browsableContacts`/`filterBrowsableContacts` show it directly, no query
 * required — see `fetchLimitedContacts` in `contactsAccess.ts` for the read
 * this is paired with, and the "Filling one person in from Contacts" section
 * of `docs/arch/people.md` for the reasoning in full.
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
  /** Only ever copied alongside a month and day — see `contactBirthday`. */
  birthYear: number | null;
}

/** What gets written when one is picked. Deliberately a subset of `Person`. */
export type ContactPersonDraft = Pick<
  Person,
  'name' | 'phoneNumber' | 'email' | 'birthdayMonth' | 'birthdayDay' | 'birthYear'
>;

/**
 * The month, day and (if the contact has one) year off a native contact's
 * birthday, or nulls.
 *
 * **`month` arrives 0-indexed and `Person.birthdayMonth` is 1-12.** The native
 * module follows the JS `Date` convention and this app's column follows the
 * human one (`birthdayInYear` does `birthdayMonth - 1` to get back), so a
 * straight copy puts every birthday one month early — and silently, since
 * every value is still in range. This is the one conversion in the feature and
 * it has its own test.
 *
 * **The year rides along only when the month and day are both good.** `Person`
 * keeps a year (#2083 removed it for a display that no longer exists, but the
 * field itself came back for its own sake — see `Person.birthYear`), so a
 * contact's year is no longer dropped on principle. But it is still never kept
 * on its own: a year with no month/day is not a birthday anything can be
 * computed from, the same "both halves together" rule `PersonEditor`'s own
 * clear follows for month and day.
 */
export function contactBirthday(
  birthday: { month?: number | null; day?: number | null; year?: number | null } | null | undefined
): { birthdayMonth: number | null; birthdayDay: number | null; birthYear: number | null } {
  const rawMonth = birthday?.month;
  const day = birthday?.day;
  if (
    typeof rawMonth !== 'number' || typeof day !== 'number' ||
    !Number.isFinite(rawMonth) || !Number.isFinite(day)
  ) {
    return { birthdayMonth: null, birthdayDay: null, birthYear: null };
  }
  const month = rawMonth + 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { birthdayMonth: null, birthdayDay: null, birthYear: null };
  }
  const rawYear = birthday?.year;
  const year = typeof rawYear === 'number' && Number.isInteger(rawYear) && rawYear > 1900 && rawYear <= new Date().getFullYear()
    ? rawYear
    : null;
  return { birthdayMonth: month, birthdayDay: day, birthYear: year };
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
 * Shared by `rankContacts` and `filterBrowsableContacts`: everybody matching
 * `needle`, already-added people removed, ordered by where the query lands
 * rather than alphabetically. A name that *starts* with what you typed is
 * what you meant far more often than one that merely contains it, and a book
 * with a Dan and a Jordan should put Dan first for "dan". Ties keep the order
 * the candidates arrived in, which for a native query is the user's own
 * system sort setting.
 *
 * Contacts with no name at all are dropped: a row with nothing to read is a
 * row that can only be picked by accident. No cap here — each caller applies
 * its own, for its own reason.
 */
function scoreContacts(
  candidates: readonly ContactCandidate[],
  needle: string,
  people: readonly Pick<Person, 'name' | 'nickname' | 'phoneNumber'>[]
): ContactCandidate[] {
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
  return scored.sort((a, b) => a.rank - b.rank || a.order - b.order).map(s => s.candidate);
}

/**
 * The matches worth showing for a full-access search, capped.
 *
 * Nothing at all for a query too short to search — `MIN_CONTACT_QUERY_LENGTH`
 * is the floor a full address book needs, since a single letter matches a
 * large fraction of any book and a screen of near-everybody is the browse
 * view this half of the feature exists not to have.
 */
export function rankContacts(
  candidates: readonly ContactCandidate[],
  query: string,
  people: readonly Pick<Person, 'name' | 'nickname' | 'phoneNumber'>[],
  limit: number = MAX_CONTACT_RESULTS
): ContactCandidate[] {
  if (!canSearchContacts(query)) return [];
  return scoreContacts(candidates, query.trim().toLowerCase(), people).slice(0, Math.max(0, limit));
}

/**
 * The whole set, alphabetically, already-added people removed — the browse
 * view for a `'limited'` grant (see `contactsAccess.ts`'s
 * `fetchLimitedContacts`). Sorted by name rather than left in system order:
 * it is a list to *find* somebody in, not a run of taps, and unlike a search
 * match there is no query position to rank by.
 */
export function browsableContacts(
  candidates: readonly ContactCandidate[],
  people: readonly Pick<Person, 'name' | 'nickname' | 'phoneNumber'>[]
): ContactCandidate[] {
  return candidates
    .filter(c => c.name.trim() && !alreadyAdded(c, people))
    .sort((a, b) => a.name.trim().localeCompare(b.name.trim()));
}

/**
 * `browsableContacts`, narrowed by whatever has been typed so far.
 *
 * **No length floor**, unlike `rankContacts`. That floor exists to stop a
 * short query from reading as "everyone" against a full address book; here
 * the candidates are already the pre-selected set a `'limited'` grant is
 * bounded to, so narrowing it to one letter is filtering a list already
 * curated by the user, not opening a book nobody asked to see.
 */
export function filterBrowsableContacts(
  candidates: readonly ContactCandidate[],
  query: string,
  people: readonly Pick<Person, 'name' | 'nickname' | 'phoneNumber'>[]
): ContactCandidate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return browsableContacts(candidates, people);
  return scoreContacts(candidates, needle, people);
}

/**
 * "March 14", or "March 14, 1992" when the contact carries a year too, or
 * empty when there is no birthday on the contact.
 *
 * Built in a **leap year** when there's no real one to anchor to, so a
 * February 29 birthday renders as itself rather than being clamped to the 28th
 * by whichever year happened to be handy — the same trap `recurrenceAnchorDay`
 * exists to stop one shelf over.
 */
export function describeCandidateBirthday(
  candidate: Pick<ContactCandidate, 'birthdayMonth' | 'birthdayDay' | 'birthYear'>
): string {
  if (candidate.birthdayMonth === null || candidate.birthdayDay === null) return '';
  const date = new Date(candidate.birthYear ?? 2024, candidate.birthdayMonth - 1, candidate.birthdayDay, 12);
  return format(date, candidate.birthYear ? 'MMMM d, yyyy' : 'MMMM d');
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
    birthYear: candidate.birthYear,
  };
}
