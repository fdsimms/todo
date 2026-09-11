import type { Person } from '../types';

/**
 * Finding people by place, for trip planning — see `Person.location` and
 * `docs/arch/people.md`. Deliberately the plainest possible match: a
 * case-insensitive substring, the same shape `filterEditorRows` and
 * `searchContacts`' name filter use elsewhere in the app. No geocoding, no
 * distance, no "near" — `location` is free text somebody typed once, and this
 * only ever answers "does the text I typed appear in the text they typed".
 *
 * Sorts by nickname-or-name itself rather than importing `displayNameOf` from
 * `usePersonStore` — that store pulls in expo-sqlite, which `peopleRegistry.ts`
 * exists specifically to keep out of plain `src/utils` modules.
 */
export function peopleNearLocation(people: Person[], query: string): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const nameOf = (p: Person) => p.nickname.trim() || p.name.trim();
  return people
    .filter(p => !p.archived && p.location && p.location.toLowerCase().includes(q))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }));
}

/** Whether anybody has a location on file at all — gates the trip planner entry point. */
export function anyoneHasLocation(people: Person[]): boolean {
  return people.some(p => !p.archived && p.location && p.location.trim().length > 0);
}
