import type { Task } from '../types';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { distanceMeters, PLACE_MATCH_RADIUS_M, PLACE_MAX_FIX_ERROR_M, type PlaceFix } from './moodPlaces';
import type { SavedPlace } from './savedPlaces';

/**
 * Limiting a daily target's reminders to saved places (`Task.quotaPlaceIds`).
 *
 * **The app never reads location in the background** (`backgroundRefresh.ts`
 * forbids it, and there is no always-on permission), so nothing can ask where
 * the phone is when a reminder is due. What it can do is remember the last
 * foreground fix and schedule reminders only while that fix is recent and
 * inside one of the task's places. (A reminder that rings on arriving or
 * leaving is the other answer, `placeReminders.ts`: the system watches the
 * place and the app reads nothing.) Two consequences are the design, not gaps:
 *
 * - **A fix that can't be vouched for allows nothing.** A stale fix, a coarse
 *   one, no permission and demo mode all read as "unknown", and unknown
 *   schedules no reminders. Reminders you asked to be limited to the office
 *   arriving at home because the phone couldn't tell is the wrong failure.
 * - **Leaving a place stops the reminders only once the app is next opened or
 *   the fix expires**, whichever comes first (`PLACE_FIX_TTL_MS`). Nothing is
 *   scheduled to fire past the fix's expiry (`placeTrustedUntil`), however much
 *   room the queue has: a slow cadence's six nudges, or a run given the queue's
 *   spare slots, would otherwise reach hours past the last time the phone was
 *   known to be there.
 *
 * Pure rule up top, the one persisted fix below. The fix is device-local: it
 * is a statement about where this phone is, so it is not in
 * `SYNCED_SETTING_KEYS`.
 */
export const PLACE_FIX_TTL_MS = 2 * 60 * 60 * 1000;
export const PLACE_FIX_KEY = 'lastPlaceFix';

/** Where the phone was at `at` (epoch ms): a saved place's id, or null for anywhere else. */
export interface StoredPlaceFix {
  placeId: string | null;
  at: number;
}

/** Places a fix can be matched against: any with a pin, opted in to mood tags or not. */
export function pinnedPlaces(places: readonly SavedPlace[]): SavedPlace[] {
  return places.filter(p => p.latitude !== null && p.longitude !== null);
}

/** The nearest pinned place the fix is inside, or null. Same radius and accuracy floor as the mood tag. */
export function placeIdAt(places: readonly SavedPlace[], fix: PlaceFix | null): string | null {
  if (!fix || fix.accuracyM === null || !Number.isFinite(fix.accuracyM) || fix.accuracyM > PLACE_MAX_FIX_ERROR_M) {
    return null;
  }
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const place of pinnedPlaces(places)) {
    const d = distanceMeters(fix, { latitude: place.latitude!, longitude: place.longitude! });
    if (d <= PLACE_MATCH_RADIUS_M && d < bestDistance) {
      best = place.id;
      bestDistance = d;
    }
  }
  return best;
}

/** True when a task's reminders are limited to places at all. */
export function isPlaceLimited(task: Pick<Task, 'quotaPlaceIds' | 'quotaReminders'>): boolean {
  return !!task.quotaReminders && (task.quotaPlaceIds?.length ?? 0) > 0;
}

/**
 * Whether a task's reminders may be scheduled for an instant at `now`, given
 * the last stored fix. A task with no places always may.
 */
export function placeGateAllows(
  task: Pick<Task, 'quotaPlaceIds' | 'quotaReminders'>,
  fix: StoredPlaceFix | null,
  now: Date,
): boolean {
  if (!isPlaceLimited(task)) return true;
  if (!fix || fix.placeId === null) return false;
  const age = +now - fix.at;
  if (!Number.isFinite(age) || age < 0 || age > PLACE_FIX_TTL_MS) return false;
  return task.quotaPlaceIds!.includes(fix.placeId);
}

/**
 * The last instant (epoch ms) a place-limited task's reminder may fire at, on
 * the strength of `fix`: its expiry. Infinity for a task with no places, which
 * the fix says nothing about. Gating only the moment of scheduling isn't
 * enough, since a reminder laid down now fires later, and the fix has to still
 * be trusted when it does.
 */
export function placeTrustedUntil(
  task: Pick<Task, 'quotaPlaceIds' | 'quotaReminders'>,
  fix: StoredPlaceFix | null,
): number {
  if (!isPlaceLimited(task)) return Infinity;
  return fix ? fix.at + PLACE_FIX_TTL_MS : -Infinity;
}

export function readPlaceFix(): StoredPlaceFix | null {
  try {
    const raw = dbGetSetting(PLACE_FIX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPlaceFix>;
    if (typeof parsed.at !== 'number') return null;
    return { placeId: typeof parsed.placeId === 'string' ? parsed.placeId : null, at: parsed.at };
  } catch {
    return null;
  }
}

export function writePlaceFix(fix: StoredPlaceFix | null): void {
  dbSetSetting(PLACE_FIX_KEY, fix ? JSON.stringify(fix) : '');
}

/** Task ids whose reminders are limited to places, for the foreground refresh to know whether to read at all. */
export function placeLimitedTasks<T extends Pick<Task, 'quotaPlaceIds' | 'quotaReminders' | 'completed' | 'archived'>>(
  tasks: readonly T[],
): T[] {
  return tasks.filter(t => !t.completed && !t.archived && isPlaceLimited(t));
}
