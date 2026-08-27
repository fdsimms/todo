import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Person, Task } from '../types';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import type { HistoryEntry } from './personHistory';

/**
 * "Catch up with Sarah" — the nudge, and the most dangerous thing in the people
 * layer to get wrong.
 *
 * Read `docs/arch/people.md` before changing anything here. Structurally this
 * is `projectReviewTasks.ts` one shelf over and that file's header is worth
 * reading too, but the differences are where the care is: a project can be
 * behind and a person cannot, so nothing here ranks anybody, scores anybody, or
 * says how a relationship is going.
 *
 * Pure, and takes `today` rather than reading the clock.
 */

/**
 * How many rows the pass may write at once.
 *
 * Two, not three: these arrive uninvited and are about people rather than
 * work, so the ceiling is lower than `projectReview`'s. A fortnight away must
 * not produce a screen of them.
 */
export const MAX_REACH_OUT_TASKS = 2;

/**
 * How long a swipe-away holds for.
 *
 * `projectReview` scopes its decline to the *day*, which is right there and
 * nagging here: a project you put off is still sitting in your work, whereas a
 * nudge about Sarah returning tomorrow morning reads as the app disagreeing
 * with you about a friendship. A week is long enough to mean "not now" and
 * short enough that a real intention is not lost.
 *
 * Floored at the cadence, so somebody you asked to be reminded about every four
 * days is not silenced for seven by one swipe. That was the objection to
 * cadence-scoped declines in `projectReview` (a fortnightly project buried for
 * a fortnight by one tap) and it only bites in the other direction.
 */
export const REACH_OUT_DECLINE_DAYS = 7;

export function declineHoldDays(cadenceDays: number): number {
  return cadenceDays > 0 ? Math.min(REACH_OUT_DECLINE_DAYS, cadenceDays) : REACH_OUT_DECLINE_DAYS;
}

/** Whether this person's nudge was swiped away recently enough to still hold. */
export function declinedRecently(
  person: Pick<Person, 'reachOutDeclinedAt' | 'cadenceDays'>,
  today: Date
): boolean {
  if (!person.reachOutDeclinedAt) return false;
  const since = differenceInCalendarDays(today, new Date(person.reachOutDeclinedAt));
  return since < declineHoldDays(person.cadenceDays);
}

/**
 * The id a reach-out task speaks for, or null for any other task — a
 * personId for a solo nudge, or a `PersonGroup` id once
 * `collapseGroupedReachOuts` has folded several people into one row. The name
 * predates groups; callers that need to tell the two apart resolve the id
 * against `usePersonGroupStore` first, the same resolve-or-shrug every other
 * cross-entity pointer in this layer uses.
 */
export function reachOutPersonId(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'reachOut');
}

/**
 * The row's title.
 *
 * **The note wins when there is one**, which is rule 7 in miniature and most of
 * what keeps this warm: "Ask Ansley about the new job" is a reason to get in
 * touch, where "Catch up with Ansley" is only a prompt to. The clock decides
 * *when* to speak; what it says should come from something you wrote whenever
 * there is something to use.
 *
 * The fallback proposes an action rather than reporting a deficit. "Catch up
 * with Sarah" is a thing to do; "You haven't seen Sarah" is a scoreboard with
 * one entry, and it is the one string in the feature that arrives uninvited.
 */
export function reachOutTitle(person: Pick<Person, 'name' | 'nickname' | 'askAbout'>): string {
  const who = person.nickname.trim() || person.name.trim();
  const ask = person.askAbout.trim();
  if (ask) return `Ask ${who} about ${ask}`;
  return `Catch up with ${who}`;
}

/**
 * People whose nudge has already been dealt with, and for how long that counts.
 *
 * Ticking one off leaves no live task, so without this the next foreground
 * writes an identical row — the same blind spot `projectsReviewedToday` covers.
 * Archiving counts too, being the app's other explicit "I've dealt with this".
 *
 * Held for the same window a decline is, rather than for the day: completing
 * "Catch up with Sarah" without logging anything should not hand it straight
 * back tomorrow. A real catch-up usually also produces a history entry, which
 * resets the clock properly on its own.
 */
export function reachOutsHandledRecently(
  tasks: readonly Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'completedAt' | 'archived' | 'archivedAt'>[],
  today: Date,
  holdDays: number = REACH_OUT_DECLINE_DAYS
): Set<string> {
  const done = new Set<string>();
  for (const task of tasks) {
    const personId = reachOutPersonId(task);
    if (!personId) continue;
    const stamp = (task.completed && task.completedAt) || (task.archived && task.archivedAt) || null;
    if (!stamp) continue;
    if (differenceInCalendarDays(today, new Date(stamp)) < holdDays) done.add(personId);
  }
  return done;
}

/** One person who should have a reach-out task sitting on the list right now. */
export interface ReachOutWant {
  personId: string;
  title: string;
  phoneNumber: string | null;
}

/** What the pass needs to know about one person, with their history folded in. */
export interface ReachOutCandidate {
  person: Person;
  /** Null when nothing is on file, which counts as "it has been long enough". */
  lastTogether: Date | null;
}

/**
 * Who should have a nudge right now.
 *
 * **The order is the user's own, not a ranking of neglect.** This is the one
 * place the cap forces the app to choose between people, and sorting by
 * longest-since — the obvious answer — is precisely the thing
 * `docs/arch/people.md` rules out, even done invisibly. So the tie is broken by
 * `sortOrder`, the hand-drag on the People screen, which is the only ranking
 * the feature is allowed to contain because it is the one somebody made on
 * purpose.
 *
 * The cost, stated plainly: somebody at the bottom of a long list whose two
 * neighbours above are perpetually due could wait. In practice the set rotates,
 * because acting on a nudge resets that person's clock and drops them out. It
 * is the honest trade, and the alternative is the app quietly deciding which
 * friend it thinks you have let down most.
 *
 * Somebody with no history at all is measured against `cadenceSetAt` instead —
 * the day the cadence was turned on. Opting somebody in must not itself read as
 * "it has already been long enough": the first nudge waits out the cadence from
 * there, same as it eventually will from real history. A person with neither
 * (an install that opted in before this field existed) falls back to counting
 * as due immediately, which is the old behavior rather than a new one.
 */
export function wantedReachOuts(
  candidates: readonly ReachOutCandidate[],
  today: Date,
  handledRecently: ReadonlySet<string> = new Set(),
  cap: number = MAX_REACH_OUT_TASKS
): ReachOutWant[] {
  return candidates
    .filter(({ person, lastTogether }) => {
      // The real gate, and it is off on every new person: nothing about
      // somebody may appear in a nudge surface until this is explicitly true.
      if (!person.nudgeOptIn || person.cadenceDays <= 0) return false;
      if (person.archived) return false;
      if (handledRecently.has(person.id)) return false;
      if (declinedRecently(person, today)) return false;
      const anchor = lastTogether ?? (person.cadenceSetAt ? new Date(person.cadenceSetAt) : null);
      if (!anchor) return true;
      return differenceInCalendarDays(today, anchor) >= person.cadenceDays;
    })
    .sort((a, b) => a.person.sortOrder - b.person.sortOrder)
    .slice(0, Math.max(0, cap))
    .map(({ person }) => ({
      personId: person.id,
      title: reachOutTitle(person),
      phoneNumber: person.phoneNumber,
    }));
}

/**
 * The rows whose reason has gone.
 *
 * A nudge stops being wanted the moment anything lands in that person's history
 * — including from this very row — and nothing about completing a task knows a
 * "Catch up with Sarah" is sitting on Today. Same argument
 * `staleProjectReviewTasks` makes for running on a sweep.
 *
 * Judged against everybody still due rather than against the capped set: losing
 * the contest for a slot is no reason to delete a row the user already deferred
 * to Saturday.
 */
export function staleReachOutTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(tasks: readonly T[], stillDue: ReadonlySet<string>): T[] {
  return liveGeneratedTasksOfKind(tasks, 'reachOut').filter(task => {
    const personId = reachOutPersonId(task);
    return !personId || !stillDue.has(personId);
  });
}

/**
 * A `ReachOutWant` that may speak for more than one person — see
 * `collapseGroupedReachOuts`. `sourceId` is what gets written as the
 * generated task's `generatedSourceId`: a lone want's own `personId`, or the
 * shared group's id once collapsed.
 */
export interface GroupedReachOutWant extends ReachOutWant {
  sourceId: string;
}

/**
 * Folds simultaneous wants naming people in the same `PersonGroup` into one
 * row — a couple due for a nudge at once gets "Catch up with the Ortegas"
 * once, not "Catch up with Sam" and "Catch up with Jamie" back to back. See
 * the "Groups" section of `docs/arch/people.md`.
 *
 * Deliberately a pass over `wantedReachOuts`' own output rather than a change
 * to that function: `wantedReachOuts` is what the existing tests pin down —
 * the cadence gate, the decline hold, the sortOrder tie-break — and none of
 * that changes for a solo want or for a group with only one member currently
 * due. This only ever *merges* rows that function already decided were each
 * independently due.
 *
 * **Order is preserved from `wants`**, so pass the uncapped, already
 * `sortOrder`-sorted list (`wantedReachOuts(candidates, today, handled,
 * candidates.length)`) and cap the result of this instead — capping first
 * would cut a couple's second member out of the set before they had a chance
 * to collapse, silently defeating the whole point on a day both happen to be
 * due. A collapsed entry lands at its earliest-ranked member's position, so
 * the cap's own tie-break still runs on hand-order, never on who asked first.
 */
export function collapseGroupedReachOuts(
  wants: readonly ReachOutWant[],
  groupIdOf: (personId: string) => string | null,
  groupNameOf: (groupId: string) => string | null
): GroupedReachOutWant[] {
  const seen = new Set<string>();
  const collapsed: GroupedReachOutWant[] = [];
  for (const want of wants) {
    if (seen.has(want.personId)) continue;
    const groupId = groupIdOf(want.personId);
    if (!groupId) {
      seen.add(want.personId);
      collapsed.push({ ...want, sourceId: want.personId });
      continue;
    }
    const groupMates = wants.filter(w => !seen.has(w.personId) && groupIdOf(w.personId) === groupId);
    groupMates.forEach(w => seen.add(w.personId));
    if (groupMates.length === 1) {
      collapsed.push({ ...want, sourceId: want.personId });
      continue;
    }
    const name = groupNameOf(groupId);
    // personId and phoneNumber have to name the same person, or the row's
    // link button (built from personId) and its call/text buttons (built
    // from phoneNumber) would point at two different members of the group.
    const representative = groupMates.find(w => w.phoneNumber) ?? groupMates[0];
    collapsed.push({
      // Kept for readers that still expect a single person, not written
      // anywhere as this want's identity — `sourceId` is that.
      personId: representative.personId,
      title: name ? `Catch up with ${name}` : want.title,
      phoneNumber: representative.phoneNumber,
      sourceId: groupId,
    });
  }
  return collapsed;
}

/**
 * How often you two actually get together, in days, or null when there is not
 * enough to say so honestly.
 *
 * **This is what lets the app offer a cadence instead of asking you to declare
 * one**, which is rule 5 and the coldest interaction in the feature avoided.
 * Picking "every 14 days" for somebody you love is a small confession; being
 * shown a number that came out of your own history is not.
 *
 * `rhythms.ts`'s discipline, deliberately: a sample floor, and silence below
 * it. Three coffees is not a rhythm, and a suggestion built on two would be the
 * app inventing a fact about a friendship.
 *
 * The **median** gap rather than the mean, because one six-month stretch
 * between two otherwise-monthly visits should not double the answer. Rounded up
 * to a whole day, and never below one.
 */
export const MIN_CADENCE_SAMPLES = 4;

export function observedCadenceDays(entries: readonly HistoryEntry[]): number | null {
  // N entries give N-1 gaps, so the floor is on the gaps rather than the rows.
  if (entries.length < MIN_CADENCE_SAMPLES) return null;
  const times = entries.map(e => new Date(e.at).getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push(Math.max(1, Math.round((times[i] - times[i - 1]) / 86_400_000)));
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
  return Math.max(1, Math.round(median));
}

/**
 * The offer's own words, or null when there is nothing honest to say.
 *
 * Carries the reason it thinks so, the way every claim in `rhythms.ts` does:
 * the number came from your own history, and saying so is what stops it reading
 * as the app's opinion about how often you ought to see somebody.
 */
export function describeObservedCadence(days: number | null): string | null {
  if (days === null) return null;
  if (days <= 10) return `You two usually get together about every ${days} days`;
  if (days <= 24) return 'You two usually get together about every couple of weeks';
  if (days <= 45) return 'You two usually get together about once a month';
  if (days <= 100) return 'You two usually get together every couple of months';
  return 'You two usually get together a few times a year';
}
