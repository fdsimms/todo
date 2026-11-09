import type { Person } from '../types';
import type { PersonPatch } from '../store/usePersonStore';
import { formatPhoneInput } from './phone';
import { birthdayInYear, hasBirthday } from './birthdayTasks';

/**
 * The details a person's page edits in place, one at a time. Everything else
 * (type, dates, group, how often to keep in touch, archive) stays in the
 * person sheet behind the "…" menu.
 */
export type PersonFieldKey = 'name' | 'nickname' | 'phoneNumber' | 'email' | 'address' | 'birthday';

export interface PersonFieldSpec {
  key: PersonFieldKey;
  label: string;
  icon: string;
  placeholder: string;
  /** Name is the only one that can't be emptied: an unnamed row can't be told apart. */
  required: boolean;
}

/** In the order the page lists them. */
export const PERSON_FIELDS: readonly PersonFieldSpec[] = [
  { key: 'name', label: 'Name', icon: 'person-outline', placeholder: 'Name', required: true },
  { key: 'nickname', label: 'Nickname', icon: 'at-outline', placeholder: 'e.g. Tess, Tessie', required: false },
  { key: 'phoneNumber', label: 'Phone', icon: 'call-outline', placeholder: 'e.g. 555 123 4567', required: false },
  { key: 'email', label: 'Email', icon: 'mail-outline', placeholder: 'e.g. tessa@example.com', required: false },
  { key: 'address', label: 'Address', icon: 'location-outline', placeholder: 'e.g. 214 Elm St, Austin, TX', required: false },
  { key: 'birthday', label: 'Birthday', icon: 'gift-outline', placeholder: '', required: false },
];

/** "March 14", or "March 14, 1992" once a year is on file. */
export function describeBirthday(month: number | null, day: number | null, year: number | null): string | undefined {
  if (month === null || day === null) return undefined;
  const date = birthdayInYear({ birthdayMonth: month, birthdayDay: day }, year ?? 2024);
  if (!date) return undefined;
  return date.toLocaleDateString(
    undefined,
    year ? { month: 'long', day: 'numeric', year: 'numeric' } : { month: 'long', day: 'numeric' }
  );
}

/** What a field currently holds, as the row reads it back; undefined when empty. */
export function personFieldValue(person: Person, key: PersonFieldKey): string | undefined {
  switch (key) {
    case 'name': return person.name.trim() || undefined;
    case 'nickname': return person.nickname.trim() || undefined;
    case 'phoneNumber': return person.phoneNumber?.trim() || undefined;
    case 'email': return person.email?.trim() || undefined;
    case 'address': return person.address?.trim() || undefined;
    case 'birthday': return hasBirthday(person)
      ? describeBirthday(person.birthdayMonth, person.birthdayDay, person.birthYear)
      : undefined;
  }
}

/** The fields to list on the page: the name always, then whichever others have a value. */
export function filledPersonFields(person: Person): PersonFieldSpec[] {
  return PERSON_FIELDS.filter(f => f.key === 'name' || personFieldValue(person, f.key) !== undefined);
}

/**
 * The fields the "Add detail" menu offers: the ones with no value yet. A
 * business has no birthday (the person sheet hides it too), so it isn't offered.
 */
export function addablePersonFields(person: Person): PersonFieldSpec[] {
  return PERSON_FIELDS.filter(f =>
    f.key !== 'name'
    && personFieldValue(person, f.key) === undefined
    && !(f.key === 'birthday' && person.kind !== 'individual'));
}

/**
 * The patch for one typed value. Empty clears an optional field; a phone is
 * formatted the way the person sheet formats it, so the two screens save the
 * same text. Name is not handled for empty here: its sheet keeps Save off.
 */
export function personFieldPatch(key: Exclude<PersonFieldKey, 'birthday'>, typed: string): PersonPatch {
  const value = typed.trim();
  switch (key) {
    case 'name': return { name: value };
    case 'nickname': return { nickname: value };
    case 'phoneNumber': return { phoneNumber: formatPhoneInput(value) || null };
    case 'email': return { email: value || null };
    case 'address': return { address: value || null };
  }
}
