/**
 * Reminders at a place: "when I get home", "when I leave the office"
 * (`Task.reminderPlaceId` / `reminderPlaceOn`).
 *
 * **The app never reads a location for these.** Each is a notification with a
 * location trigger (`UNLocationNotificationTrigger`, scheduled through
 * `todo-eventkit-bridge`): the system watches the place and delivers it, and
 * when-in-use permission is all it needs. That keeps the promise the location
 * permission text and `placeGate.ts` make, that nothing here reads where
 * somebody is in the background.
 *
 * Which reminders are armed is decided here, purely, and rebuilt with the rest
 * of the reminder queue:
 *
 * - **Only while the task can be done.** Open, not archived, not withheld
 *   (vacation, a paused project, waiting on something), and with its day
 *   arrived: "when I get home" on a task dated Friday doesn't ring on Tuesday.
 * - **Only at a place with a pin.** A saved place typed as plain text has no
 *   coordinates to watch, and the editor offers only the ones that do.
 * - **At most `MAX_PLACE_REMINDERS` at once**, soonest due first. The system
 *   limits how many location triggers it schedules together without saying
 *   how many; twenty is the long-standing region-monitoring ceiling.
 * - **One-shot.** A delivered reminder is gone, and the next rebuild arms it
 *   again while the task is still open, so it rings on the next arrival too.
 */
import type { Task } from '../types';
import type { SavedPlace } from './savedPlaces';

/** Every place reminder's notification id starts with this. */
export const PLACE_REMINDER_PREFIX = 'place:';
/** The circle around the place, in meters. Under about 100 the system's own accuracy can miss it. */
export const PLACE_REMINDER_RADIUS_M = 150;
export const MAX_PLACE_REMINDERS = 20;

export function placeReminderId(taskId: string): string {
  return `${PLACE_REMINDER_PREFIX}${taskId}`;
}

/** The saved places a reminder can use: the ones with a pin. */
export function remindablePlaces(places: readonly SavedPlace[]): SavedPlace[] {
  return places.filter(p => p.latitude !== null && p.longitude !== null);
}

/** "Arriving at Home", "Leaving the office": the row's chip and the notification's line. */
export function describePlaceReminder(on: 'arrive' | 'leave' | null | undefined, placeName: string): string {
  return on === 'leave' ? `Leaving ${placeName}` : `Arriving at ${placeName}`;
}

export interface WantedPlaceReminder {
  id: string;
  taskId: string;
  title: string;
  body: string;
  latitude: number;
  longitude: number;
  radius: number;
  onEntry: boolean;
}

/**
 * The place reminders that should be pending now. `canRing` is the caller's
 * "open, not withheld, day arrived" check, passed in so this stays pure.
 */
export function wantedPlaceReminders(
  tasks: readonly Task[],
  places: readonly SavedPlace[],
  canRing: (task: Task) => boolean,
): WantedPlaceReminder[] {
  const byId = new Map(remindablePlaces(places).map(p => [p.id, p]));
  const wanted: { task: Task; place: SavedPlace }[] = [];
  for (const task of tasks) {
    if (!task.reminderPlaceId || task.completed || task.archived) continue;
    const place = byId.get(task.reminderPlaceId);
    if (!place || !canRing(task)) continue;
    wanted.push({ task, place });
  }
  // Soonest due first, undated last, so the cap drops what is furthest off.
  wanted.sort((a, b) => (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999'));
  return wanted.slice(0, MAX_PLACE_REMINDERS).map(({ task, place }) => ({
    id: placeReminderId(task.id),
    taskId: task.id,
    title: task.title,
    body: describePlaceReminder(task.reminderPlaceOn, place.name),
    latitude: place.latitude!,
    longitude: place.longitude!,
    radius: PLACE_REMINDER_RADIUS_M,
    onEntry: task.reminderPlaceOn !== 'leave',
  }));
}

/** The pending ids a rebuild should cancel: the ones no longer wanted. */
export function placeRemindersToCancel(pending: readonly string[], wanted: readonly WantedPlaceReminder[]): string[] {
  const keep = new Set(wanted.map(w => w.id));
  return pending.filter(id => id.startsWith(PLACE_REMINDER_PREFIX) && !keep.has(id));
}
