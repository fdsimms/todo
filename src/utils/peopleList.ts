import type { Person } from '../types';
import { telUrl, smsUrl } from './phone';
import type { ReachOutKind } from './reachOutIntent';
import { directionsUrl, type DirectionsApp } from './maps';

/**
 * What the People screen's list shows, as pure rules so the screen only draws.
 *
 * The default order is alphabetical within two sections, people first and then
 * businesses. Both are neutral about the people in them (a name and a kind are
 * facts you typed), which is the line `docs/arch/people.md` rule 3 draws: no
 * order here ever comes from something that measures a person.
 */

export type PeopleSectionKind = Person['kind'] | 'pinned';

export interface PeopleSection {
  kind: PeopleSectionKind;
  title: string;
  people: Person[];
}

const SECTION_TITLES: Record<PeopleSectionKind, string> = {
  pinned: 'Pinned',
  individual: 'People',
  business: 'Businesses',
};

/** A–Z by the name shown on the row (the nickname when there is one), ignoring case and accents. */
export function sortPeopleAlphabetically(
  people: Person[],
  nameOf: (person: Person) => string,
): Person[] {
  return [...people].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' })
  );
}

/**
 * Pinned first (both kinds together, A to Z), then people, then businesses,
 * each A to Z. A pinned person appears only in Pinned, not again under their
 * kind. A section nobody is filed under is left out.
 */
export function peopleSections(
  people: Person[],
  nameOf: (person: Person) => string,
): PeopleSection[] {
  const sorted = sortPeopleAlphabetically(people, nameOf);
  const kinds: PeopleSectionKind[] = ['pinned', 'individual', 'business'];
  return kinds
    .map(kind => ({
      kind,
      title: SECTION_TITLES[kind],
      people: sorted.filter(p => (p.pinned ? kind === 'pinned' : p.kind === kind)),
    }))
    .filter(section => section.people.length > 0);
}

export type PersonContactKind = ReachOutKind | 'link' | 'directions';

export interface PersonContactAction {
  kind: PersonContactKind;
  icon: 'call-outline' | 'chatbubble-outline' | 'mail-outline' | 'link-outline' | 'navigate-outline';
  label: string;
  url: string;
}

/**
 * The reach-them buttons a row offers: only the ones the person has details
 * for, in the order the person's own screen shows them. Call, Text and Email
 * are attempts to reach somebody and stamp a pending reach-out; the link does
 * not (see "Tapping Call or Text" in `docs/arch/people.md`). Directions to
 * their address is a way of finding them, so it doesn't either.
 */
export function personContactActions(
  person: Pick<Person, 'phoneNumber' | 'email' | 'linkUrl'> & Partial<Pick<Person, 'address'>>,
  mapsApp: DirectionsApp = 'apple',
): PersonContactAction[] {
  const actions: PersonContactAction[] = [];
  const call = telUrl(person.phoneNumber);
  const text = smsUrl(person.phoneNumber);
  if (call) actions.push({ kind: 'call', icon: 'call-outline', label: 'Call', url: call });
  if (text) actions.push({ kind: 'text', icon: 'chatbubble-outline', label: 'Text', url: text });
  const email = person.email?.trim();
  if (email) actions.push({ kind: 'email', icon: 'mail-outline', label: 'Email', url: `mailto:${email}` });
  const link = person.linkUrl?.trim();
  if (link) actions.push({ kind: 'link', icon: 'link-outline', label: 'Open link', url: link });
  // The address is several lines for reading; a maps search wants one.
  const where = person.address?.split('\n').map(l => l.trim()).filter(Boolean).join(', ');
  const directions = directionsUrl(where, mapsApp);
  if (directions) actions.push({ kind: 'directions', icon: 'navigate-outline', label: 'Directions', url: directions });
  return actions;
}
