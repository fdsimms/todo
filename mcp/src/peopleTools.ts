/**
 * The people layer: reading who the user keeps up with, and adding to the
 * history of what they did together. Same contract as tools.ts.
 *
 * **docs/arch/people.md's rules hold here too, and the tool shapes are how.**
 * People come back in the user's own hand order, never ranked by recency or
 * by anything else that measures them. The last time together is a date, a
 * fact; there is no "days since" count, which the doc keeps to the person's
 * own page. A birthday is a month and a day, with no age worked out from a
 * birth year. History is a write too, which in the app is a completed task
 * naming the person (there is no interactions table, so no second way to
 * record one here), and who someone is can be written (`createPerson`),
 * though never a cadence, nudge, group, archive or order.
 */
import type { Person } from '../../src/types';
import type { PersonFields, Replica } from './replica';
import { localDateInput } from './timeZone';

export const HISTORY_LIMIT = 20;
export const DEFAULT_BIRTHDAY_DAYS = 30;
export const MAX_BIRTHDAY_DAYS = 366;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const birthdayText = (p: Person): string | undefined =>
  p.birthdayMonth && p.birthdayDay ? `${MONTHS[p.birthdayMonth - 1]} ${p.birthdayDay}` : undefined;

/** A local calendar day as YYYY-MM-DD. Never via toISOString, which is UTC. */
const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface SerializedPerson {
  id: string;
  name: string;
  nickname?: string;
  kind?: 'business';
  group?: string;
  birthday?: string;
  /** Something to ask them about next time. */
  askAbout?: string;
  notes?: string;
  /** The day of the most recent thing in their history. A date, never a count. */
  lastTogether?: string;
}

function serializePerson(replica: Replica, p: Person, groups: Map<string, string>): SerializedPerson {
  const last = replica.personHistory(p.id)[0];
  return {
    id: p.id,
    name: p.name,
    ...(p.nickname ? { nickname: p.nickname } : {}),
    ...(p.kind === 'business' ? { kind: 'business' as const } : {}),
    ...(p.groupId && groups.has(p.groupId) ? { group: groups.get(p.groupId) } : {}),
    ...(birthdayText(p) ? { birthday: birthdayText(p) } : {}),
    ...(p.askAbout ? { askAbout: p.askAbout } : {}),
    ...(p.notes ? { notes: p.notes } : {}),
    ...(last ? { lastTogether: dayKey(new Date(last.at)) } : {}),
  };
}

/** Everyone not archived, in the user's own order (people.md rule 3). */
export function listPeople(replica: Replica): SerializedPerson[] {
  const groups = new Map(replica.personGroups().map(g => [g.id, g.name]));
  return replica
    .people()
    .filter(p => !p.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(p => serializePerson(replica, p, groups));
}

export interface PersonDetail extends SerializedPerson {
  phone?: string;
  email?: string;
  /** Where they live, as the free text the user (or Claude) wrote. */
  location?: string;
  /** What they did together, newest first, capped at HISTORY_LIMIT. */
  history: { title: string; date: string }[];
  giftIdeas?: string[];
  /** Food notes: what they like, can't eat, or are allergic to. */
  food?: string[];
  otherNotes?: string[];
}

export function getPerson(replica: Replica, id: string): PersonDetail | null {
  const p = replica.people().find(x => x.id === id);
  if (!p) return null;
  const groups = new Map(replica.personGroups().map(g => [g.id, g.name]));
  const notes = replica
    .personNotes()
    .filter(n => n.personId === id && !n.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const ofKind = (kind: string) => notes.filter(n => n.kind === kind).map(n => n.text);
  const gifts = ofKind('gift');
  const food = ofKind('food');
  const other = ofKind('note');
  return {
    ...serializePerson(replica, p, groups),
    ...(p.phoneNumber ? { phone: p.phoneNumber } : {}),
    ...(p.email ? { email: p.email } : {}),
    ...(p.location ? { location: p.location } : {}),
    history: replica
      .personHistory(id)
      .slice(0, HISTORY_LIMIT)
      .map(e => ({ title: e.title, date: dayKey(new Date(e.at)) })),
    ...(gifts.length > 0 ? { giftIdeas: gifts } : {}),
    ...(food.length > 0 ? { food } : {}),
    ...(other.length > 0 ? { otherNotes: other } : {}),
  };
}

/**
 * Birthdays coming up within `days`, soonest first. Ordered by the date, which
 * is a fact about the calendar, not a measure of the person.
 */
export function upcomingBirthdays(replica: Replica, days = DEFAULT_BIRTHDAY_DAYS): { name: string; id: string; date: string }[] {
  const span = Math.min(Math.max(days, 1), MAX_BIRTHDAY_DAYS);
  const limit = replica.shiftDayKey(replica.todayKey(), span - 1);
  return replica
    .people()
    .filter(p => !p.archived)
    .map(p => ({ p, next: replica.nextBirthday(p) }))
    .filter((x): x is { p: Person; next: Date } => x.next !== null && dayKey(x.next) <= limit)
    .sort((a, b) => +a.next - +b.next)
    .map(({ p, next }) => ({ id: p.id, name: p.nickname || p.name, date: dayKey(next) }));
}

/**
 * Add something to one or more people's history, as "Add to history" on a
 * person's page does: a task naming them, completed on that day.
 */
export function addPersonHistory(
  replica: Replica,
  input: { personIds: string[]; title: string; date?: string },
): { added: { title: string; date: string; people: string[] } } {
  const at = input.date ? new Date(localDateInput(input.date)) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error('date must be an ISO date or date-time.');
  const task = replica.addPersonHistory(input.personIds, input.title, at);
  const names = new Map(replica.people().map(p => [p.id, p.nickname || p.name]));
  return {
    added: {
      title: task.title,
      date: dayKey(new Date(task.completedAt ?? at)),
      people: input.personIds.map(id => names.get(id) ?? id),
    },
  };
}

/**
 * Add a person, or change who they are. The same contract as the rest of this
 * file: nothing here scores, ranks or declares a rhythm for anyone, so the
 * fields are identity and contact details only (see `Replica.createPerson`).
 */
export function createPerson(replica: Replica, fields: PersonFields): SerializedPerson {
  const person = replica.createPerson(fields);
  return serializePerson(replica, person, new Map(replica.personGroups().map(g => [g.id, g.name])));
}

export function updatePerson(replica: Replica, id: string, fields: PersonFields): SerializedPerson {
  const person = replica.updatePerson(id, fields);
  return serializePerson(replica, person, new Map(replica.personGroups().map(g => [g.id, g.name])));
}
