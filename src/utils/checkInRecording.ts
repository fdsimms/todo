import { Alert } from 'react-native';
import type { CheckIn, CheckInAnswer } from '../types';
import { useCheckInStore } from '../store/useCheckInStore';
import { useMedicationStore } from '../store/useMedicationStore';
import { dbGetFoodLogEntry } from '../db/database';
import { getLogicalDayKey } from './dateUtils';
import { cancelCheckIn, requestNotificationPermissions, scheduleCheckIn } from './notifications';
import { alertPermissionOff } from './permissionAlert';
import { CHECK_IN_ANSWERS, answerLabel, checkInDueAt, checkInQuestion, checkInTitle } from './checkIns';

/**
 * Starting, answering and cancelling a check-in. The row is
 * `useCheckInStore`'s; this file is the part that touches the phone (the
 * notification and the alert), which is why it isn't in the store: the MCP
 * replica reads the store and can't load notifications.
 */

export interface StartCheckInInput {
  sourceKind: CheckIn['sourceKind'];
  sourceId: string;
  subject: string;
  about?: string | null;
  /** Minutes from `from` until the question is asked. */
  minutes: number;
  /** When the dose or food happened. Defaults to now. */
  from?: Date;
  /** The logical day of the dose or food, when `dayResetTime` makes it differ from the date. */
  dayKey?: string;
}

/**
 * Ask for notification permission before a check-in is started, and say so
 * when it was refused: a check-in with no notification would never ask.
 */
export async function allowCheckInNotification(): Promise<boolean> {
  const granted = await requestNotificationPermissions().catch(() => false);
  if (!granted) {
    alertPermissionOff(
      'Notifications are off',
      'Turn on notifications for dundundun in Settings to be asked how you feel.',
    );
  }
  return granted;
}

/** Create a check-in for a dose or food and schedule its notification. */
export function startCheckIn(input: StartCheckInInput): CheckIn {
  const from = input.from ?? new Date();
  const store = useCheckInStore.getState();
  // One per dose or food: a second start replaces the first.
  store.removeForSource(input.sourceKind, input.sourceId).forEach(id => cancelCheckIn(id).catch(() => {}));
  const checkIn = store.add({
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    subject: input.subject,
    about: input.about,
    dueAt: checkInDueAt(from, input.minutes).toISOString(),
    dayKey: input.dayKey ?? getLogicalDayKey(from),
  });
  // Caught rather than floating: a schedule refused for want of permission is
  // the person's setting, not an error to surface from here.
  scheduleCheckIn(checkIn).catch(() => {});
  return checkIn;
}

/** Drop the check-in about a dose or food that was deleted or undone. */
export function cancelCheckInFor(kind: CheckIn['sourceKind'], sourceId: string): void {
  useCheckInStore.getState().removeForSource(kind, sourceId).forEach(id => cancelCheckIn(id).catch(() => {}));
}

function loaded() {
  const store = useCheckInStore.getState();
  // A tap is often a cold launch, before the stores come up.
  if (!store.initialized) store.initialize();
  return useCheckInStore.getState();
}

/** Save an answer, from a notification button or the alert. */
export function answerCheckIn(id: string, answer: CheckInAnswer): CheckIn | null {
  const saved = loaded().answer(id, answer);
  if (saved) cancelCheckIn(id).catch(() => {});
  return saved;
}

/** Ask the question in the app, for a plain tap on the notification. */
export function askCheckIn(id: string): void {
  const checkIn = loaded().checkIns.find(c => c.id === id);
  if (!checkIn || checkIn.answer) return;
  // The dose or food it was about was deleted since: nothing left to ask about.
  // A tap is often a cold launch, so the dose log may not be loaded yet.
  const meds = useMedicationStore.getState();
  if (checkIn.sourceKind === 'medication' && !meds.initialized) meds.initialize();
  const exists = checkIn.sourceKind === 'food'
    ? !!dbGetFoodLogEntry(checkIn.sourceId)
    : useMedicationStore.getState().logs.some(l => l.id === checkIn.sourceId);
  if (!exists) {
    cancelCheckInFor(checkIn.sourceKind, checkIn.sourceId);
    return;
  }
  Alert.alert(
    checkInTitle(checkIn),
    checkInQuestion(checkIn),
    [
      ...CHECK_IN_ANSWERS.map(a => ({ text: answerLabel(a), onPress: () => { answerCheckIn(id, a); } })),
      { text: 'Not now', style: 'cancel' as const },
    ],
  );
}
