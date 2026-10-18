import type { WorkoutSession } from '../types';
import { format } from 'date-fns/format';
import { clockTimeToken } from './clockTime';

/**
 * Two workouts at the same time: one the Apple Watch ran on its own (phone in
 * a locker) and one the phone logged over the same span. Both are kept when the
 * watch's arrives (`addWatchSession`), and the phone asks once, the next time
 * it is in front, which to keep. See docs/arch/workouts.md, "Phase 8, as built".
 *
 * The question outlives the app being closed, so a pending clash is a row in
 * the settings table (`useWatchClashStore`), and it is asked once per pair: the
 * pair leaves the list when it is answered, and a watch workout arriving twice
 * is written (and so compared) only once.
 */

/** A watch workout and the other session it overlaps. */
export interface WatchClash {
  watchSessionId: string;
  otherSessionId: string;
}

/** The settings key the pending clashes are kept under. Device-local: the question is this phone's. */
export const WATCH_CLASHES_SETTING = 'watchWorkoutClashes';

/** A ceiling for a list nobody should ever see grow, so a stuck one can't grow without bound. */
export const MAX_PENDING_CLASHES = 20;

/** The span a session covers: to its end, or to `now` while it is still going. */
function spanOf(session: Pick<WorkoutSession, 'startedAt' | 'endedAt'>, now: Date): [number, number] | null {
  const start = Date.parse(session.startedAt);
  const end = session.endedAt === null ? now.getTime() : Date.parse(session.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return [start, Math.max(start, end)];
}

/**
 * The sessions, other than this one, whose span overlaps its span, in the
 * order given (the store holds them newest first). Touching ends don't count:
 * a workout that ends at 7:00 and one that starts at 7:00 are two in a row,
 * not two at once. A session still in progress spans to `now`.
 */
export function overlappingSessions(
  session: Pick<WorkoutSession, 'id' | 'startedAt' | 'endedAt'>,
  sessions: readonly Pick<WorkoutSession, 'id' | 'startedAt' | 'endedAt'>[],
  now: Date,
): string[] {
  const mine = spanOf(session, now);
  if (!mine) return [];
  return sessions
    .filter(other => {
      if (other.id === session.id) return false;
      const theirs = spanOf(other, now);
      return theirs !== null && mine[0] < theirs[1] && theirs[0] < mine[1];
    })
    .map(other => other.id);
}

/** The pending list as stored, with anything malformed dropped. */
export function parseWatchClashes(raw: string | null): WatchClash[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: WatchClash[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { watchSessionId, otherSessionId } = entry as Record<string, unknown>;
    if (typeof watchSessionId !== 'string' || watchSessionId === '') continue;
    if (typeof otherSessionId !== 'string' || otherSessionId === '') continue;
    out.push({ watchSessionId, otherSessionId });
  }
  return out;
}

const samePair = (a: WatchClash, b: WatchClash) =>
  a.watchSessionId === b.watchSessionId && a.otherSessionId === b.otherSessionId;

/** The list with this pair added, once, newest last. */
export function withClash(list: readonly WatchClash[], clash: WatchClash): WatchClash[] {
  if (clash.watchSessionId === clash.otherSessionId || list.some(c => samePair(c, clash))) return [...list];
  return [...list, clash].slice(-MAX_PENDING_CLASHES);
}

/** The list without this pair, and without any other pair naming a session in `deleted`. */
export function withoutClash(list: readonly WatchClash[], clash: WatchClash, deleted: readonly string[] = []): WatchClash[] {
  const gone = new Set(deleted);
  return list.filter(c => !samePair(c, clash) && !gone.has(c.watchSessionId) && !gone.has(c.otherSessionId));
}

/** What the next question is about, with both sessions found, or the reason it can't be asked. */
export type ClashToAsk =
  | { kind: 'ask'; clash: WatchClash; watch: WorkoutSession; other: WorkoutSession }
  /** One of the two has been deleted since (here, or on another device): nothing left to ask. */
  | { kind: 'drop'; clash: WatchClash };

/** The first pending clash, read against the sessions as they are now. Null when none is pending. */
export function nextClash(list: readonly WatchClash[], sessions: readonly WorkoutSession[]): ClashToAsk | null {
  const clash = list[0];
  if (!clash) return null;
  const watch = sessions.find(s => s.id === clash.watchSessionId);
  const other = sessions.find(s => s.id === clash.otherSessionId);
  if (!watch || !other) return { kind: 'drop', clash };
  return { kind: 'ask', clash, watch, other };
}

/** How the question is answered. */
export type ClashChoice = 'keepBoth' | 'deleteWatch' | 'deleteOther';

/** The session an answer deletes, or null to keep both. */
export function sessionToDelete(clash: WatchClash, choice: ClashChoice): string | null {
  if (choice === 'deleteWatch') return clash.watchSessionId;
  if (choice === 'deleteOther') return clash.otherSessionId;
  return null;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * "6:02 to 6:54 PM"-style span in the person's clock style, with the day in
 * front when it isn't today ("Oct 16, 6:02 PM to 6:54 PM"). A session still in
 * progress says so instead of an end.
 */
export function describeSpan(session: Pick<WorkoutSession, 'startedAt' | 'endedAt'>, now: Date, use24Hour: boolean): string {
  const token = clockTimeToken(use24Hour);
  const start = new Date(session.startedAt);
  const day = sameDay(start, now) ? '' : `${format(start, 'MMM d')}, `;
  if (session.endedAt === null) return `${day}since ${format(start, token)}`;
  return `${day}${format(start, token)} to ${format(new Date(session.endedAt), token)}`;
}

/** The alert's words: what happened, then what each button does. */
export function clashPrompt(
  watch: Pick<WorkoutSession, 'title' | 'startedAt' | 'endedAt'>,
  other: Pick<WorkoutSession, 'title' | 'startedAt' | 'endedAt'>,
  now: Date,
  use24Hour: boolean,
  /** Either workout is in Apple Health, so deleting it takes it out of there too. */
  inHealth: boolean,
): { title: string; message: string; keepBoth: string; deleteWatch: string; deleteOther: string } {
  const theirs = other.endedAt === null
    ? `Your iPhone has “${other.title}” going ${describeSpan(other, now, use24Hour)}.`
    : `Your iPhone has “${other.title}” from ${describeSpan(other, now, use24Hour)}.`;
  return {
    title: 'Two workouts at the same time',
    message:
      `Your Apple Watch saved “${watch.title}” from ${describeSpan(watch, now, use24Hour)}. ${theirs} ` +
      'Keep both, or delete the one you don’t want.' +
      (inHealth ? ' Deleting a workout also takes it out of Apple Health.' : ''),
    keepBoth: 'Keep both',
    deleteWatch: 'Delete the watch’s',
    deleteOther: 'Delete the iPhone’s',
  };
}
