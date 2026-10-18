import type { RestTimer, WorkoutSession, WorkoutSet } from '../types';
import { nextSet } from './workoutSession';

/**
 * The workout's Lock Screen links: `dundundun://workout[?do=…&session=…]`,
 * what the workout Live Activity's buttons open (see `workoutLiveActivity.ts`
 * and targets/todo-widget/WorkoutLiveActivity.swift). Pure: the URL each
 * button carries, and what a tapped one may still do once the app has it.
 * deepLinks.ts parses the URL and applies the answer.
 *
 * **A Lock Screen can be showing a state the app has since moved past**, and a
 * button tapped there arrives later still: the app may have been closed, the
 * session finished, the set logged from the app, the rest replaced by the next
 * set's. So every link names what it was drawn about (the session, the set,
 * the rest), and `planWorkoutLink` acts only while that is still what the
 * workout is on. Anything else is answered by opening workout mode, which is
 * also what a tap anywhere else on the activity does. Logging the wrong set
 * from a stale Lock Screen is the failure this exists to rule out.
 */

/** What a workout link can ask for. A verb outside this list means "just open". */
export const WORKOUT_LINK_VERBS = ['set-done', 'rest-add', 'skip-rest'] as const;
export type WorkoutLinkVerb = (typeof WORKOUT_LINK_VERBS)[number];

/** A parsed workout link. Every field is null when the link didn't carry it. */
export interface WorkoutLink {
  verb: WorkoutLinkVerb | null;
  sessionId: string | null;
  setId: string | null;
  restId: string | null;
}

/** The bare link: opens workout mode and does nothing else. */
export const WORKOUT_OPEN_URL = 'dundundun://workout';

/**
 * The URL a button carries. `set` names the set "Done set" logs; `rest` names
 * the rest "+30 s" and "Skip rest" act on, so a rest replaced since the Lock
 * Screen was drawn is left alone rather than nudged in its place.
 */
export function workoutLinkUrl(
  verb: WorkoutLinkVerb,
  sessionId: string,
  target: { set?: string; rest?: string } = {},
): string {
  const params = [`do=${verb}`, `session=${encodeURIComponent(sessionId)}`];
  if (target.set) params.push(`set=${encodeURIComponent(target.set)}`);
  if (target.rest) params.push(`rest=${encodeURIComponent(target.rest)}`);
  return `${WORKOUT_OPEN_URL}?${params.join('&')}`;
}

/** What a tapped link does, decided against the workout as it is now. */
export type WorkoutLinkPlan =
  | { kind: 'setDone'; setId: string }
  | { kind: 'restAdd'; restId: string }
  | { kind: 'skipRest'; restId: string }
  /** Nothing to apply: open workout mode as it is. */
  | { kind: 'open' };

/**
 * Whether a link's action still applies, and to what.
 *
 * - **Only for the session in progress.** A link from a session finished,
 *   thrown away or replaced since does nothing.
 * - **"Done set" logs only the set it was drawn about, and only while that set
 *   is still the next one open** (`nextSet`, the order the Lock Screen reads
 *   from). Once it has been logged from the app, or another set has become the
 *   next one, the tap must not log whatever is next now.
 * - **"+30 s" and "Skip rest" act only on the rest they name**, and only while
 *   it is still this session's rest. A link that names no rest (an older
 *   build's) takes the session's current one.
 */
export function planWorkoutLink(
  link: WorkoutLink,
  live: Pick<WorkoutSession, 'id'> | null,
  sets: readonly WorkoutSet[],
  rest: Pick<RestTimer, 'id' | 'sessionId'> | null,
): WorkoutLinkPlan {
  if (link.verb === null || live === null || link.sessionId !== live.id) return { kind: 'open' };
  if (link.verb === 'set-done') {
    const next = nextSet(sets);
    if (!link.setId || !next || next.id !== link.setId || next.sessionId !== live.id) return { kind: 'open' };
    return { kind: 'setDone', setId: next.id };
  }
  if (!rest || rest.sessionId !== live.id) return { kind: 'open' };
  if (link.restId !== null && link.restId !== rest.id) return { kind: 'open' };
  return link.verb === 'rest-add' ? { kind: 'restAdd', restId: rest.id } : { kind: 'skipRest', restId: rest.id };
}
