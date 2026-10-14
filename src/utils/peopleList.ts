import type { Person } from '../types';
import { telUrl, smsUrl } from './phone';
import type { ReachOutKind } from './reachOutIntent';

/**
 * What the People screen's list shows, as pure rules so the screen only draws.
 *
 * The default order is alphabetical within two sections, people first and then
 * businesses. Both are neutral about the people in them (a name and a kind are
 * facts you typed), which is the line `docs/arch/people.md` rule 3 draws: no
 * order here ever comes from something that measures a person.
 */

export type PeopleSectionKind = Person['kind'];

export interface PeopleSection {
  kind: PeopleSectionKind;
  title: string;
  people: Person[];
}

const SECTION_TITLES: Record<PeopleSectionKind, string> = {
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

/** People, then businesses, each A–Z. A kind nobody is filed under has no section. */
export function peopleSections(
  people: Person[],
  nameOf: (person: Person) => string,
): PeopleSection[] {
  const sorted = sortPeopleAlphabetically(people, nameOf);
  const kinds: PeopleSectionKind[] = ['individual', 'business'];
  return kinds
    .map(kind => ({
      kind,
      title: SECTION_TITLES[kind],
      people: sorted.filter(p => p.kind === kind),
    }))
    .filter(section => section.people.length > 0);
}

export type PersonContactKind = ReachOutKind | 'link';

export interface PersonContactAction {
  kind: PersonContactKind;
  icon: 'call-outline' | 'chatbubble-outline' | 'mail-outline' | 'link-outline';
  label: string;
  url: string;
}

/**
 * The reach-them buttons a row offers: only the ones the person has details
 * for, in the order the person's own screen shows them. Call, Text and Email
 * are attempts to reach somebody and stamp a pending reach-out; the link does
 * not (see "Tapping Call or Text" in `docs/arch/people.md`).
 */
export function personContactActions(
  person: Pick<Person, 'phoneNumber' | 'email' | 'linkUrl'>,
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
  return actions;
}
