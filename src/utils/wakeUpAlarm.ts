import { useAlarmStore } from '../store/useAlarmStore';
import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { isDemoModeActive } from './demoState';
import { liveGeneratedTask } from './generatedTasks';
import { NEXT_ALARM_LINK, morningAlarmFor, morningDate } from './morningAlarm';
import { pruneHandledEventTasks } from './eventTasks';
import { matchedWakeUp, wakeAlarmKey, wakeAlarmPlan, wakeUpInputs } from './wakeUpTasks';

/**
 * Sets tomorrow's alarm for the wake-up task, on this device (wakeUpTasks.ts
 * says why it isn't on the task). Called after every sweep of the task.
 *
 * Once per answer: `wakeAlarmKey` carries the wake time, so a moved event sets
 * it again and nothing else does. A person who changes or deletes the alarm
 * afterwards is not overruled on the next sweep, and one who deleted the task
 * is not given an alarm for it (the same "handled" reading the task has).
 *
 * Returns whether an alarm was set or moved.
 */
export function syncWakeUpAlarm(now: Date = new Date()): boolean {
  const settings = useSettingsStore.getState();
  if (!settings.wakeUpTasks || !settings.calendarReadEnabled) return false;
  // The sweep's own refusals, for the same reasons: a demo's alarms are fiction
  // that would ring after it ended, and an unread window is not an empty one.
  if (isDemoModeActive()) return false;
  // Before the alarms are read, an empty list would look like "nothing rings"
  // and set a second alarm over one that does.
  if (!useAlarmStore.getState().initialized) return false;
  const calendar = useCalendarStore.getState();
  if (!calendar.loaded) return false;

  const { leads, prefs } = wakeUpInputs(settings);
  const morning = morningDate(now, settings.dayResetTime);
  const match = matchedWakeUp(leads, prefs, calendar.events, now, morning, settings.wakeUpTaskHandled);
  if (!match || !liveGeneratedTask(useTaskStore.getState().tasks, 'wakeUp', match.sourceId)) return false;

  const applied = pruneHandledEventTasks(settings.wakeUpAlarmApplied, now);
  const key = wakeAlarmKey(match.sourceId, match.wakeAt);
  if (key in applied) {
    if (Object.keys(applied).length !== Object.keys(settings.wakeUpAlarmApplied).length) settings.setWakeUpAlarmApplied(applied);
    return false;
  }

  const store = useAlarmStore.getState();
  const plan = wakeAlarmPlan(morningAlarmFor(NEXT_ALARM_LINK, store.alarms, now, settings.dayResetTime), match.wakeAt, now);
  let set = false;
  if (plan.kind === 'override') {
    set = store.setOverride(plan.alarm.id, morning, match.wakeAt.getHours(), match.wakeAt.getMinutes());
  } else if (plan.kind === 'add') {
    store.addOneOffAlarm(match.wakeAt, { mission: null, sound: null, wakeSong: null }, now);
    set = true;
  }
  // 'covered' and 'none' are answers too: an alarm already rings in time, or
  // the one that rings is the person's own one-off, which is theirs to change
  // from the row. Recording them stops the next sweep asking again.
  settings.setWakeUpAlarmApplied({ ...applied, [key]: match.endsAt });
  return set;
}
