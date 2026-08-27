import type { Person, PersonGroup, Task } from '../types';
import type { GroupMentionToken } from './parseTaskInput';

/**
 * How a row resolves the people a task names, and how a person finds the tasks
 * that name them, without importing either store.
 *
 * Exactly the shape `blockerRegistry.ts` uses, for exactly its reasons:
 * `usePersonStore` pulls in `src/db/database.ts` and therefore expo-sqlite,
 * which doesn't exist under Jest's `node` environment, and the row renderers
 * that need this are imported from modules the store already imports. So the
 * store pushes a *getter* in here at module load and this leaf module — which
 * imports nothing but types — hands the answer back on demand.
 *
 * Pull-based rather than a pushed snapshot, so there is no listener to wire up
 * and no moment where the index can be stale: it reads the live array each
 * time and rebuilds only when that array's identity changes, which the stores
 * guarantee by always replacing the array on mutation.
 *
 * **The index matters more here than it looks.** `Task.personIds` is an array
 * on the row precisely so that copying a task copies its people (see the field
 * note), and the price of that choice is that "every task naming Dustin" has
 * no SQL index behind it. Answered by scanning, it would be O(n) per row per
 * render, and a person chip renders on every row that has one — the same
 * O(n²) `waitingCountFor` exists to avoid.
 */

let personSource: (() => Person[]) | null = null;
let cachedPeople: Person[] | null = null;
let cachedById: Map<string, Person> | null = null;

let taskSource: (() => Task[]) | null = null;
let cachedTasks: Task[] | null = null;
let cachedByPerson: Map<string, Task[]> | null = null;

let personGroupSource: (() => PersonGroup[]) | null = null;
let cachedGroups: PersonGroup[] | null = null;
let cachedGroupById: Map<string, PersonGroup> | null = null;

/** Called once by usePersonStore at module load. Tests can point it at a fixture. */
export function registerPersonSource(fn: (() => Person[]) | null): void {
  personSource = fn;
  cachedPeople = null;
  cachedById = null;
}

/** Called once by usePersonGroupStore at module load. Tests can point it at a fixture. */
export function registerPersonGroupSource(fn: (() => PersonGroup[]) | null): void {
  personGroupSource = fn;
  cachedGroups = null;
  cachedGroupById = null;
}

/** Called once by useTaskStore at module load, for the reverse direction. */
export function registerPersonTaskSource(fn: (() => Task[]) | null): void {
  taskSource = fn;
  cachedTasks = null;
  cachedByPerson = null;
}

/**
 * Resolves a person id, or undefined when there's no source registered yet.
 *
 * Undefined is the safe answer and every reader is resolve-or-shrug about it:
 * a row naming somebody who has been deleted renders no chip rather than a
 * blank one, the same way `canBlock(undefined)` reads as "can't block". Ids in
 * `Task.personIds` are deliberately never cleaned up when a person is deleted,
 * for the reason the retention note gives about dangling pointers: rewriting
 * rows the delete isn't otherwise touching costs more than shrugging does.
 */
export function resolvePerson(id: string): Person | undefined {
  const people = personSource?.();
  if (!people) return undefined;
  if (people !== cachedPeople) {
    cachedPeople = people;
    cachedById = new Map(people.map(p => [p.id, p]));
  }
  return cachedById!.get(id);
}

/** The people a task names, in the order it names them, skipping any that have gone. */
export function peopleOn(task: Pick<Task, 'personIds'>): Person[] {
  const out: Person[] = [];
  for (const id of task.personIds) {
    const person = resolvePerson(id);
    if (person) out.push(person);
  }
  return out;
}

/**
 * Every live task naming this person, newest first — the raw material the
 * person's history is built from (#2045).
 *
 * Indexed once per store change rather than scanned per call, for the reason
 * in the header. Includes completed rows, which is the entire point: a
 * completed task carrying somebody's id *is* the record that something
 * happened with them, which is why there is no interactions table.
 */
export function tasksNaming(personId: string): Task[] {
  const tasks = taskSource?.();
  if (!tasks) return [];
  if (tasks !== cachedTasks) {
    cachedTasks = tasks;
    const index = new Map<string, Task[]>();
    for (const task of tasks) {
      for (const id of task.personIds) {
        const bucket = index.get(id);
        if (bucket) bucket.push(task);
        else index.set(id, [task]);
      }
    }
    cachedByPerson = index;
  }
  return cachedByPerson!.get(personId) ?? [];
}

/** Resolves a group id, or undefined — the same resolve-or-shrug rule `resolvePerson` follows. */
export function resolvePersonGroup(id: string): PersonGroup | undefined {
  const groups = personGroupSource?.();
  if (!groups) return undefined;
  if (groups !== cachedGroups) {
    cachedGroups = groups;
    cachedGroupById = new Map(groups.map(g => [g.id, g]));
  }
  return cachedGroupById!.get(id);
}

/** Every person currently filed under this group, in their own hand-drag order. */
export function groupMembers(groupId: string): Person[] {
  const people = personSource?.() ?? [];
  return people.filter(p => p.groupId === groupId).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Every group with at least one member, as a mention-matching token — the
 * same shape `matchPersonMentions` already takes for individual people, so an
 * "@name" naming a group expands to a mention for each of its members rather
 * than needing a shape of its own.
 *
 * `restrictToPersonIds`, when given, keeps only the groups whose *entire*
 * current membership is already in that set — the same restriction
 * `TaskItem`/`LogbookScreen`/etc. already apply to individual people by
 * matching only against `peopleOn(task)`, never the whole roster. Without it
 * a group mention would relight on a saved task even after the group grew a
 * new member the task never named.
 */
export function groupMentionTokens(restrictToPersonIds?: readonly string[]): GroupMentionToken[] {
  const groups = personGroupSource?.() ?? [];
  const restrict = restrictToPersonIds ? new Set(restrictToPersonIds) : null;
  const tokens: GroupMentionToken[] = [];
  for (const group of groups) {
    const memberIds = groupMembers(group.id).map(p => p.id);
    if (memberIds.length === 0) continue;
    if (restrict && !memberIds.every(id => restrict.has(id))) continue;
    tokens.push({ id: group.id, name: group.name, memberIds });
  }
  return tokens;
}
