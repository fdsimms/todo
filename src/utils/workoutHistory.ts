import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import type { WorkoutSession } from '../types';
import { logicalDayStart } from './clockTime';
import { HEALTH_WORKOUT_ACTIVITY_LABEL, type HealthWorkout } from './healthWorkouts';

/**
 * The Workouts history with other apps' workouts from Health between the
 * sessions logged here (docs/arch/workouts.md, "Phase 5, as built").
 *
 * The Health rows are readings, so everything about them here is display:
 * they are read for the window the list shows, never stored, never counted
 * (the screen's "12 workouts" counts the app's own), and never handed to the
 * records, Stats or the mood contrast. An empty read adds nothing, since a
 * refusal and no workouts are one answer (`healthWorkouts.ts`).
 */

/**
 * How far back the history reads Health, in logical days counting today.
 * The list holds every session ever logged; reading Health back to the first
 * of them would be a query over years for rows nobody scrolls to.
 */
export const HEALTH_HISTORY_MAX_DAYS = 90;

/** One row of the history: a session logged here, or a workout another app recorded. */
export type WorkoutHistoryRow =
  | { kind: 'session'; key: string; session: WorkoutSession }
  | { kind: 'health'; key: string; workout: HealthWorkout };

/**
 * The window of logical days to read Health for: from the day of the oldest
 * session listed, but no more than `HEALTH_HISTORY_MAX_DAYS` back, through
 * today. Null with no sessions, since the history then shows its empty state
 * and nothing is read.
 */
export function healthHistoryWindow(
  sessions: readonly WorkoutSession[],
  dayResetTime: string,
  now: Date = new Date(),
): { anchor: Date; days: number } | null {
  if (sessions.length === 0) return null;
  const today = logicalDayStart(now, dayResetTime);
  const floor = addDays(today, -(HEALTH_HISTORY_MAX_DAYS - 1));
  let oldest = today;
  for (const s of sessions) {
    const start = new Date(s.startedAt);
    if (Number.isNaN(start.getTime())) continue;
    const day = logicalDayStart(start, dayResetTime);
    if (day < oldest) oldest = day;
  }
  const anchor = oldest < floor ? floor : oldest;
  return { anchor, days: differenceInCalendarDays(today, anchor) + 1 };
}

/**
 * How close two starts are, when one side has no usable end, for a Health
 * workout to count as the same workout as a session.
 */
export const SAME_WORKOUT_START_MS = 10 * 60_000;

/**
 * Whether a Health workout is one of the person's own sessions over again:
 * a session imported from Strong or Hevy is usually also in Health from that
 * app, and would otherwise show twice. The spans overlap (touching ends don't
 * count), or, when either has no usable end (a live session, one logged with
 * no length, a reading whose end isn't after its start), the two start within
 * `SAME_WORKOUT_START_MS` of each other. Pure, exported for its tests.
 */
export function overlapsSession(workout: HealthWorkout, session: WorkoutSession): boolean {
  const sStart = new Date(session.startedAt).getTime();
  if (!Number.isFinite(sStart)) return false;
  const sEnd = session.endedAt === null ? NaN : new Date(session.endedAt).getTime();
  const hStart = workout.start.getTime();
  const hEnd = workout.end.getTime();
  if (!Number.isFinite(hStart)) return false;
  const sUsable = Number.isFinite(sEnd) && sEnd > sStart;
  const hUsable = Number.isFinite(hEnd) && hEnd > hStart;
  if (sUsable && hUsable) return hStart < sEnd && sStart < hEnd;
  return Math.abs(hStart - sStart) <= SAME_WORKOUT_START_MS;
}

/**
 * The sessions (newest first, as the store holds them) with the Health
 * workouts between them, newest first by start. A Health workout that is one
 * of the sessions over again (`overlapsSession`) is left out, and so is one
 * before the window's anchor, so a list read for a wider window a moment ago
 * doesn't trail rows past the oldest session.
 *
 * A row's key holds the start, end, activity and source, and the workout's
 * place in the read as a last resort, since one source can record two
 * workouts of a kind starting together.
 */
export function interleaveHistory(
  sessions: readonly WorkoutSession[],
  health: readonly HealthWorkout[],
  windowStart: Date | null,
): WorkoutHistoryRow[] {
  const rows: { at: number; order: number; row: WorkoutHistoryRow }[] = [];
  sessions.forEach((session, i) => {
    rows.push({ at: new Date(session.startedAt).getTime(), order: i, row: { kind: 'session', key: session.id, session } });
  });
  if (windowStart) {
    const seen = new Set<string>();
    health.forEach((workout, i) => {
      if (workout.end < windowStart) return;
      if (sessions.some(session => overlapsSession(workout, session))) return;
      const base = `health:${workout.start.getTime()}:${workout.end.getTime()}:${workout.activity}:${workout.sourceName}`;
      const key = seen.has(base) ? `${base}:${i}` : base;
      seen.add(base);
      rows.push({
        at: workout.start.getTime(),
        order: sessions.length + i,
        row: { kind: 'health', key, workout },
      });
    });
  }
  return rows
    .sort((a, b) => b.at - a.at || (a.row.kind === b.row.kind ? a.order - b.order : a.row.kind === 'session' ? -1 : 1))
    .map(r => r.row);
}

/** "From Health · Strava", or "From Health" when the source gave no name. */
export function healthWorkoutSource(workout: HealthWorkout): string {
  return workout.sourceName ? `From Health · ${workout.sourceName}` : 'From Health';
}

/** What the row is called: the activity, never a claim about the person. */
export function healthWorkoutTitle(workout: HealthWorkout): string {
  return HEALTH_WORKOUT_ACTIVITY_LABEL[workout.activity];
}

/**
 * "Fri, Oct 16 · 31 min", the day and the source's own duration, in the words
 * a session's line uses. A workout that sent no duration shows the day alone:
 * its span would count pauses the source left out.
 */
export function healthWorkoutLine(workout: HealthWorkout): string {
  const parts = [format(workout.start, 'EEE, MMM d')];
  if (workout.durationSeconds !== null) {
    const minutes = Math.round(workout.durationSeconds / 60);
    if (minutes > 0) parts.push(`${minutes} min`);
  }
  return parts.join(' · ');
}
