import { useAgentSuggestionStore } from '../store/useAgentSuggestionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { drainCalendarRequests } from './calendarRequestDrain';
import { planTaskSuggestion } from './agentSuggestions';
import { askForReminderPermissionIfNeeded } from './reminderPermission';
import { isAlarmKitAvailable } from './notifications';

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
