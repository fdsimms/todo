import type { WorkoutSession } from '../types';

/**
 * What the phone asks of the Apple Watch about the workouts the watch saves to
 * Apple Health (phase 9, "Watch W2"; docs/arch/workouts.md, "Phase 9, as
 * built", and docs/arch/health-data.md, "Heart rate during a workout").
 *
 * A workout the watch measured is saved by the watch, with its heart rate and
 * energy, and **retracting it is the watch's job too**: HealthKit lets an app
 * delete only what it saved, and whether an iPhone app counts as the saver of
 * what its watch app saved is not documented. So the phone never tries. It
 * keeps two short lists here, sent in the watch's workout section of the
 * snapshot (`buildWatchWorkout`), and the watch acts on them:
 *
 * - `retract`: workouts the watch saved that the person has since deleted (here,
 *   or on another device, heard of by sync: `askWatchAboutSyncedDeletes`), or
 *   whose times they changed (once the phone's own copy at the new times is
 *   in). The watch deletes each, with the energy saved with it, and says so
 *   with a `healthRetracted` tap, which takes it off the list; one it couldn't
 *   delete (the watch locked) it leaves unanswered and tries again. Kept until
 *   then, since the watch may be away for days; capped, oldest dropped, so a
 *   watch that is never seen again can't grow it for ever.
 * - `drop`: workouts deleted on the phone while the watch may still be
 *   measuring them, so it throws the measurement away rather than saving it.
 *   Only useful while that workout is going, so each is dropped after a day.
 *
 * Device-local (the sync allowlist doesn't name the setting): the watch is
 * paired with this phone. The store is `useWatchHealthStore`.
 */

/** The settings key the two lists are kept under, as JSON. */
export const WATCH_HEALTH_REQUESTS_SETTING = 'watchHealthRequests';

/** At most this many retractions wait for the watch; the oldest go first past it. */
export const WATCH_RETRACT_LIMIT = 50;

/** How long a dropped measurement is kept on the list: a day is longer than any workout. */
export const WATCH_DROP_HOURS = 24;

/** The workouts the section lists as finished lately, for the end the watch saves a measurement at. */
export const RECENTLY_FINISHED_HOURS = 24;
export const RECENTLY_FINISHED_LIMIT = 5;

export interface WatchHealthRequest {
  /** A Health workout's id (`retract`) or a session's id (`drop`). */
  id: string;
  /** When it was asked for, ISO. */
  at: string;
}

export interface WatchHealthRequests {
  retract: WatchHealthRequest[];
  drop: WatchHealthRequest[];
}

export const NO_WATCH_HEALTH_REQUESTS: WatchHealthRequests = { retract: [], drop: [] };

function readList(raw: unknown): WatchHealthRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchHealthRequest[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, at } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id.trim() === '' || seen.has(id)) continue;
    if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) continue;
    seen.add(id);
    out.push({ id, at });
  }
  return out;
}

/** The stored lists, with anything unreadable left out rather than the whole lot refused. */
export function parseWatchHealthRequests(raw: string | null | undefined): WatchHealthRequests {
  if (!raw) return NO_WATCH_HEALTH_REQUESTS;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NO_WATCH_HEALTH_REQUESTS;
    return { retract: readList(parsed.retract), drop: readList(parsed.drop) };
  } catch {
    return NO_WATCH_HEALTH_REQUESTS;
  }
}

/** Adds workouts for the watch to retract, each once, keeping the newest `WATCH_RETRACT_LIMIT`. */
export function withRetractions(requests: WatchHealthRequests, ids: readonly string[], now: Date): WatchHealthRequests {
  const known = new Set(requests.retract.map(r => r.id));
  const added: WatchHealthRequest[] = [];
  for (const id of ids) {
    if (id.trim() === '' || known.has(id)) continue;
    known.add(id);
    added.push({ id, at: now.toISOString() });
  }
  if (added.length === 0) return requests;
  return { ...requests, retract: [...requests.retract, ...added].slice(-WATCH_RETRACT_LIMIT) };
}

/** Takes a workout off the list once the watch says it has dealt with it. */
export function withoutRetraction(requests: WatchHealthRequests, id: string): WatchHealthRequests {
  if (!requests.retract.some(r => r.id === id)) return requests;
  return { ...requests, retract: requests.retract.filter(r => r.id !== id) };
}

/** Adds a session whose measurement the watch should throw away, and forgets ones over a day old. */
export function withDrop(requests: WatchHealthRequests, sessionId: string, now: Date): WatchHealthRequests {
  const fresh = currentWatchHealthRequests(requests, now);
  if (sessionId.trim() === '' || fresh.drop.some(d => d.id === sessionId)) return fresh;
  return { ...fresh, drop: [...fresh.drop, { id: sessionId, at: now.toISOString() }] };
}

/** The lists as the watch should see them now: a drop over `WATCH_DROP_HOURS` old is past mattering. */
export function currentWatchHealthRequests(requests: WatchHealthRequests, now: Date): WatchHealthRequests {
  const oldest = now.getTime() - WATCH_DROP_HOURS * 3_600_000;
  const drop = requests.drop.filter(d => Date.parse(d.at) >= oldest);
  return drop.length === requests.drop.length ? requests : { ...requests, drop };
}

/**
 * The phone's workouts finished in the last `RECENTLY_FINISHED_HOURS`, newest
 * first, at most `RECENTLY_FINISHED_LIMIT`: when the phone's workout leaves
 * the snapshot, this is where the watch measuring it reads the moment it
 * ended, so the workout it saves ends when the phone's did rather than when
 * the watch next heard.
 */
export function recentlyFinished(
  sessions: readonly Pick<WorkoutSession, 'id' | 'endedAt'>[],
  now: Date,
): { sessionId: string; endedAt: string }[] {
  const oldest = now.getTime() - RECENTLY_FINISHED_HOURS * 3_600_000;
  return sessions
    .filter((s): s is Pick<WorkoutSession, 'id'> & { endedAt: string } => s.endedAt !== null)
    .filter(s => {
      const ms = Date.parse(s.endedAt);
      return Number.isFinite(ms) && ms >= oldest;
    })
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))
    .slice(0, RECENTLY_FINISHED_LIMIT)
    .map(s => ({ sessionId: s.id, endedAt: new Date(Date.parse(s.endedAt)).toISOString() }));
}

/**
 * The times the watch saved a workout at, as its `healthWorkout` tap reports
 * them (ISO). Absent from a save made locked, which has no workout to read
 * them from, and from a watch older than this field.
 */
export interface WatchWorkoutSpan {
  start: string;
  end: string;
}

/**
 * How far the watch's saved times may sit from the row's and still be the
 * same workout. The watch saves at the times the phone gave it, read from
 * the snapshot, so they match to the millisecond unless something moved one
 * meanwhile; the slack covers the two clocks' rounding and nothing more. The
 * start is held to this always, since nothing but an edit moves it.
 */
export const WATCH_SPAN_TOLERANCE_MS = 2000;

/**
 * How far the watch's saved end may sit from the end of a row nobody retimed
 * and still be kept, with its heart rate: five minutes.
 *
 * The one way the ends part without an edit is a Finish tapped on both
 * devices. The phone's Finish reaches the watch in the snapshot, seconds
 * later with the two in reach, and a Finish tapped on the watch before that
 * saves at its own moment while the phone keeps the first. Either can be the
 * later one. Both taps come at the end of the same workout, so the gap is
 * seconds to a minute or two, and five minutes covers a watch slow to hear.
 * It is kept short because the copy kept is Health's record of how long the
 * workout took: past about the length of one long rest between heavy sets, a
 * copy that much longer or shorter than the workout misstates it, and the
 * phone's own at the row's times is the better record despite losing the
 * heart rate.
 */
export const WATCH_FINISH_SKEW_MS = 5 * 60_000;

/**
 * Whether the workout the watch saved is out of date for this finished row,
 * so the phone writes its own at the row's times in its place (the outcome a
 * retime has). True when the start differs beyond `WATCH_SPAN_TOLERANCE_MS`,
 * or the end does and either the person changed the times
 * (`WorkoutSession.timesEdited`) or the gap is past `WATCH_FINISH_SKEW_MS`.
 * An end that differs by less on a row nobody retimed is a Finish tapped on
 * both devices: the watch's copy stands as the session's, heart rate and
 * all, and the row keeps its own end.
 *
 * False when there is nothing to compare (no span, a workout still going, a
 * time that doesn't read).
 */
export function watchCopyStale(
  row: Pick<WorkoutSession, 'startedAt' | 'endedAt' | 'timesEdited'>,
  span: WatchWorkoutSpan | null | undefined,
): boolean {
  if (!span || row.endedAt === null) return false;
  const gap = (a: string, b: string) => {
    const x = Date.parse(a);
    const y = Date.parse(b);
    return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) : 0;
  };
  if (gap(row.startedAt, span.start) > WATCH_SPAN_TOLERANCE_MS) return true;
  const endGap = gap(row.endedAt, span.end);
  if (endGap <= WATCH_SPAN_TOLERANCE_MS) return false;
  return row.timesEdited || endGap > WATCH_FINISH_SKEW_MS;
}

/**
 * Whether a drain in the background applies the watch's `healthWorkout` tap
 * now, or leaves it for the next drain in front. What decides it is whether
 * applying it means a HealthKit call on the phone, which may be locked:
 *
 * - the phone wrote its own copy and the watch's matches the row: the
 *   phone's is retracted, a delete HealthKit refuses with the phone locked,
 *   which would leave it in Health with nothing pointing at it;
 * - the watch's is out of date for the row (`watchCopyStale`): the
 *   phone writes its own at the row's times, and a save made locked returns
 *   no id, so the row couldn't keep track of it.
 *
 * Everything else (the watch's taken, a second one retracted by the watch,
 * the phone's copy kept and the watch's stale one retracted by the watch)
 * needs nothing of the phone's HealthKit and applies at once.
 */
export function watchWorkoutTapTiming(
  row: Pick<WorkoutSession, 'startedAt' | 'endedAt' | 'timesEdited' | 'healthWorkoutId' | 'measuredOnWatch'> | null | undefined,
  workoutId: string | null,
  span: WatchWorkoutSpan | null | undefined,
): 'now' | 'front' {
  if (!row) return 'now';
  const stale = workoutId !== null && watchCopyStale(row, span);
  if (row.healthWorkoutId !== null) {
    if (row.measuredOnWatch) return 'now';
    return stale ? 'now' : 'front';
  }
  return stale ? 'front' : 'now';
}
