import { COMPLETE_ACTION_IDENTIFIER, SNOOZE_ACTION_IDENTIFIER } from './notifications';

/**
 * The payload a notification carries, as far as a tap reads it. Each kind of
 * notification sets the fields it needs and nothing else, which is why every
 * one is optional; the schedulers in `notifications.ts` and `agendaRequest`
 * are what set them.
 */
export interface NotificationTapData {
  taskId?: string;
  dailyAgenda?: boolean;
  agendaSpoken?: string | null;
  completionTimer?: boolean;
  activeTripReminder?: boolean;
}

/** Where a tap on a notification lands, and what it does on the way. */
export type NotificationTapRoute =
  /** Nothing to act on: a payload with no task and no flag this build knows. */
  | { kind: 'none' }
  /** "Still shopping? Tap to wrap up your trip": the finish sheet the copy promises. */
  | { kind: 'activeTrip' }
  /** The daily agenda: Today, read aloud first when the notification carried a line. */
  | { kind: 'agenda'; spokenLine: string | null }
  /** The completion timer's own notification: dismiss the timer, then Today. */
  | { kind: 'completionTimer'; taskId: string }
  /** The Complete button on a task reminder. */
  | { kind: 'complete'; taskId: string }
  /** The Snooze button on a task reminder. */
  | { kind: 'snooze'; taskId: string }
  /** A plain tap on a task reminder (or a fired alarm): Today. */
  | { kind: 'open'; taskId: string };

/**
 * Which route a tap takes, by payload and button. `useNotificationTapSync`
 * carries each one out.
 *
 * The order is the whole rule. The trip reminder and the agenda carry no
 * `taskId`, so they are answered before the task gate, which is where both
 * used to fall through and leave the app on whatever screen it was last on.
 * The completion timer's payload does carry one, and is answered before the
 * reminder buttons are read: a tap on that notification is a dismissal, never
 * a Complete or a Snooze, whatever `actionIdentifier` says.
 */
export function routeNotificationTap(
  data: NotificationTapData | undefined,
  actionIdentifier: string,
): NotificationTapRoute {
  if (data?.activeTripReminder) return { kind: 'activeTrip' };
  if (data?.dailyAgenda) return { kind: 'agenda', spokenLine: data.agendaSpoken ? data.agendaSpoken : null };
  const taskId = data?.taskId;
  if (!taskId) return { kind: 'none' };
  if (data?.completionTimer) return { kind: 'completionTimer', taskId };
  if (actionIdentifier === COMPLETE_ACTION_IDENTIFIER) return { kind: 'complete', taskId };
  if (actionIdentifier === SNOOZE_ACTION_IDENTIFIER) return { kind: 'snooze', taskId };
  return { kind: 'open', taskId };
}
