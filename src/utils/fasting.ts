/**
 * Fasting: a span with no food, started and ended by hand, read against a goal
 * in hours. The record is `Fast` (`useFastStore`); this file is its rules.
 *
 * - **The start is the person's, never inferred.** The food log's times are
 *   when an entry was logged, not when it was eaten (`logInstantFor` stamps a
 *   past day at midday), so the last entry is offered as a starting point
 *   ("Start from 7:45 PM") and never taken as one without a tap.
 * - **Nothing here judges.** No streak, no colour for under or over the goal,
 *   no "you broke your fast". Reaching the goal changes the line under the
 *   timer and sends one notification, and ending early is the same tap as
 *   ending late. The health-data rules against a figure that reads as a scold
 *   (docs/arch/health-data.md) are why.
 */
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import type { Fast, FoodLogEntry } from '../types';

/** The goal a new fast starts with, the common 16:8. */
export const DEFAULT_FAST_GOAL_HOURS = 16;
export const MIN_FAST_GOAL_HOURS = 1;
export const MAX_FAST_GOAL_HOURS = 72;

/** How far back a start may be set. Past this it is a record of the past, not a fast running now. */
export const MAX_FAST_START_AGE_HOURS = 72;

const HOUR_MS = 3_600_000;

/** A goal within the allowed range, in whole hours. */
export function clampFastGoalHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_FAST_GOAL_HOURS;
  return Math.min(MAX_FAST_GOAL_HOURS, Math.max(MIN_FAST_GOAL_HOURS, Math.round(hours)));
}

/** The fast still running, if any. Only one can be (the store refuses a second). */
export function activeFast(fasts: readonly Fast[]): Fast | null {
  return fasts.find(f => f.endedAt === null) ?? null;
}

/** The most recent fast that has ended, or null. */
export function lastEndedFast(fasts: readonly Fast[]): Fast | null {
  let latest: Fast | null = null;
  for (const fast of fasts) {
    if (fast.endedAt === null) continue;
    if (!latest || fast.endedAt > latest.endedAt!) latest = fast;
  }
  return latest;
}

/** How long a fast has run: to now while it is open, to its end once it has one. Never negative. */
export function fastElapsedMs(fast: Pick<Fast, 'startedAt' | 'endedAt'>, now: Date): number {
  const end = fast.endedAt ? new Date(fast.endedAt).getTime() : now.getTime();
  return Math.max(0, end - new Date(fast.startedAt).getTime());
}

/** The moment the goal is reached. */
export function fastGoalAt(fast: Pick<Fast, 'startedAt' | 'goalHours'>): Date {
  return new Date(new Date(fast.startedAt).getTime() + fast.goalHours * HOUR_MS);
}

/** How far through the goal, 0 to 1. Holds at 1 past it rather than overflowing the bar. */
export function fastProgress(fast: Pick<Fast, 'startedAt' | 'endedAt' | 'goalHours'>, now: Date): number {
  const goal = fast.goalHours * HOUR_MS;
  if (goal <= 0) return 1;
  return Math.min(1, fastElapsedMs(fast, now) / goal);
}

/** "13:42": hours and minutes, hours unpadded and allowed past 24. */
export function formatFastElapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "15 hours 40 minutes", for a fast that has ended and for screen readers. */
export function describeFastLength(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 1 ? '1 hour' : `${h} hours`;
  const mins = m === 1 ? '1 minute' : `${m} minutes`;
  if (h === 0) return mins;
  return m === 0 ? hours : `${hours} ${mins}`;
}

/**
 * A clock time with the day it falls on when that isn't today: "8:10 PM",
 * "8:10 PM yesterday", "8:10 PM Mon". The formatter is passed in so the 12- or
 * 24-hour setting stays the caller's business and this stays pure.
 */
export function describeFastMoment(at: Date, now: Date, time: (d: Date) => string): string {
  const days = differenceInCalendarDays(now, at);
  if (days === 0) return time(at);
  if (days === 1) return `${time(at)} yesterday`;
  if (days === -1) return `${time(at)} tomorrow`;
  return `${time(at)} ${format(at, 'EEE')}`;
}

/**
 * Why a start can't be saved, or null when it can: not in the future, not
 * longer ago than `MAX_FAST_START_AGE_HOURS`, and before the end when there is
 * one.
 */
export function fastStartProblem(start: Date, now: Date, endedAt: Date | null = null): string | null {
  if (start.getTime() > now.getTime() + 60_000) return 'A fast can’t start in the future.';
  if (now.getTime() - start.getTime() > MAX_FAST_START_AGE_HOURS * HOUR_MS) {
    return `A fast can start at most ${MAX_FAST_START_AGE_HOURS} hours ago.`;
  }
  if (endedAt && start.getTime() >= endedAt.getTime()) return 'The start has to be before the end.';
  return null;
}

/**
 * When the last meal was logged, offered as a fast's start. Water doesn't
 * break a fast, so a glass logged after dinner isn't the answer; nor is an
 * entry stamped later than now. Null when nothing in the window qualifies.
 */
export function lastMealLoggedAt<E extends Pick<FoodLogEntry, 'atISO'>>(
  entries: readonly E[],
  now: Date,
  isWater: (entry: E) => boolean
): Date | null {
  let latest: number | null = null;
  const floor = now.getTime() - MAX_FAST_START_AGE_HOURS * HOUR_MS;
  for (const entry of entries) {
    if (isWater(entry)) continue;
    const at = new Date(entry.atISO).getTime();
    if (!Number.isFinite(at) || at > now.getTime() || at < floor) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest === null ? null : new Date(latest);
}

/**
 * Whether the Food log shows the fasting card: while a fast runs, and through
 * the rest of the day one ended on, so ending a fast doesn't make the card
 * vanish under the finger. Otherwise nothing, so somebody who never fasts never
 * sees it.
 */
export function showsFastingCard(fasts: readonly Fast[], dayStart: Date): boolean {
  if (activeFast(fasts)) return true;
  const last = lastEndedFast(fasts);
  return !!last && new Date(last.endedAt!).getTime() >= dayStart.getTime();
}
