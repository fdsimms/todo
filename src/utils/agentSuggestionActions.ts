import type { CalendarRequest } from '../types';
import { useAgentSuggestionStore } from '../store/useAgentSuggestionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { drainCalendarRequests } from './calendarRequestDrain';
import { planTaskSuggestion } from './agentSuggestions';
import { askForReminderPermissionIfNeeded } from './reminderPermission';
import { isAlarmKitAvailable } from './notifications';
import { useAlarmStore } from '../store/useAlarmStore';
import { useSavedFocusStore } from '../store/useSavedFocusStore';
import { savedFocusNameKey } from './savedFocus';

/**
 * What the Inbox cards' two buttons do (`agentSuggestions.ts` has the rules).
 * Kept out of the store because applying a task suggestion reaches the task
 * store, which already imports the suggestion store to reload it.
 */

export type ApplyOutcome =
  /** Done: the row is answered. */
  | 'done'
  /** A deadline can't go on a calendar until one is picked; nothing was changed. */
  | 'needsCalendar'
  /** It couldn't be done, and the row says why. */
  | 'failed';

/** Skip: the request is taken back and nothing is written anywhere. */
export function skipSuggestion(id: string): void {
  useAgentSuggestionStore.getState().answer(id, 'cancelled');
}

/**
 * Add / change / remove for an event request. The row becomes `pending`, the
 * state a request had before asking first existed, and the writing device's
 * drain does the rest (this one, if it is the writer, straight away).
 */
export function approveEventSuggestion(id: string): void {
  useAgentSuggestionStore.getState().answer(id, 'pending');
  void drainCalendarRequests();
}

/** The tap on a `task_` card: write the task's fields the way the editor would. */
export async function applyTaskSuggestion(id: string): Promise<ApplyOutcome> {
  const store = useAgentSuggestionStore.getState();
  const request = store.requests.find(r => r.id === id);
  if (!request || request.status !== 'proposed') return 'failed';
  if (request.kind === 'new_alarm') return applyNewAlarmSuggestion(request);
  const task = request.taskId ? useTaskStore.getState().tasks.find(t => t.id === request.taskId) : undefined;
  const plan = planTaskSuggestion(request, task, {
    now: new Date(),
    deadlineCalendarId: useSettingsStore.getState().deadlineCalendarId,
    alarmKitAvailable: isAlarmKitAvailable(),
  });
  switch (plan.kind) {
    case 'needsCalendar':
      return 'needsCalendar';
    case 'fail':
      store.answer(id, 'failed', plan.reason);
      return 'failed';
    case 'already':
      store.answer(id, 'written');
      return 'done';
    case 'apply': {
      // The permission prompt the editor shows when a reminder is first set.
      if (request.kind === 'task_alarm') await askForReminderPermissionIfNeeded();
      useTaskStore.getState().updateTask(request.taskId!, plan.patch);
      store.answer(id, 'written');
      return 'done';
    }
  }
}

/** Why a new-alarm card can't be applied, said the way an alert would. */
export const NEW_ALARM_NEEDS_ALARMKIT_REASON = 'Alarms need iOS 26 or later, so nothing was set.';
export const NEW_ALARM_LIST_FULL_REASON = 'You already have the most saved focus sessions. Delete one, then ask again.';
const NEW_ALARM_UNREADABLE_REASON = 'That suggestion could not be read, so nothing was set.';

/**
 * The tap on a `new_alarm` card: keeps the saved focus session it names (or
 * the one the person already has under that name, used as it is), then sets an
 * alarm that offers it. Through the same stores the alarm editor writes, so
 * the alarm reaches the device the way any other does. Alarms are device-only,
 * so it is made on the phone that was tapped.
 */
function applyNewAlarmSuggestion(request: CalendarRequest): ApplyOutcome {
  const store = useAgentSuggestionStore.getState();
  const alarm = request.payload?.alarm;
  if (!alarm) {
    store.answer(request.id, 'failed', NEW_ALARM_UNREADABLE_REASON);
    return 'failed';
  }
  if (!isAlarmKitAvailable()) {
    store.answer(request.id, 'failed', NEW_ALARM_NEEDS_ALARMKIT_REASON);
    return 'failed';
  }
  let savedFocusId: string | null = null;
  const focus = request.payload?.savedFocus;
  if (focus) {
    const existing = useSavedFocusStore.getState().sessions.find(s => savedFocusNameKey(s.name) === savedFocusNameKey(focus.name));
    const session = existing ?? useSavedFocusStore.getState().save(focus);
    if (!session) {
      store.answer(request.id, 'failed', NEW_ALARM_LIST_FULL_REASON);
      return 'failed';
    }
    savedFocusId = session.id;
  }
  useAlarmStore.getState().saveAlarm({
    label: alarm.label, hour: alarm.hour, minute: alarm.minute, repeatDays: alarm.repeatDays, mission: null, savedFocusId,
  });
  store.answer(request.id, 'written');
  return 'done';
}
