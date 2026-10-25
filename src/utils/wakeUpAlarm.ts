import { useAlarmStore } from '../store/useAlarmStore';
import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { isDemoModeActive } from './demoState';
import { liveGeneratedTask } from './generatedTasks';
import { NEXT_ALARM_LINK, isOverrideSpent, morningAlarmFor, morningDate, overrideDay } from './morningAlarm';
import { pruneHandledEventTasks } from './eventTasks';
import { WAKE_OVERRIDE_PREFIX, matchedWakeUp, wakeAlarmKey, wakeAlarmPlan, wakeUpInputs } from './wakeUpTasks';

/**
 * Sets tomorrow's alarm for the wake-up task, on this device (wakeUpTasks.ts
 * says why it isn't on the task). Called after every sweep of the task.
 *
 * Once per answer: `wakeAlarmKey` carries the wake time, so a moved event sets
 * it again and nothing else does. A person who changes or deletes the alarm
 * afterwards is not overruled on the next sweep, and one who deleted the task
 * is not given an alarm for it (the same "handled" reading the task has).
 *
 * **It also takes an alarm back down.** What it set is remembered by task
 * (`wakeUpAlarmIds`), so an event that moved, was cancelled, or lost its place
 * to an earlier one has the alarm it set removed first (a one-off deleted, a
 * moved repeating alarm put back on its own time for that morning), and the
 * new answer is set from a clean morning. An alarm the person made themselves
 * is never in that record, so it is never touched.
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
  const found = matchedWakeUp(leads, prefs, calendar.events, now, morning, settings.wakeUpTaskHandled);
  const match = found && liveGeneratedTask(useTaskStore.getState().tasks, 'wakeUp', found.sourceId) ? found : null;

  const store = useAlarmStore.getState();
  const applied = pruneHandledEventTasks(settings.wakeUpAlarmApplied, now);
  const key = match ? wakeAlarmKey(match.sourceId, match.wakeAt) : null;

  // Take down what an earlier answer set. For the current task that is only
  // when the answer changed (its key is not recorded yet); for any other
  // source it is whenever one is still held, since that task is gone.
  const ids = { ...settings.wakeUpAlarmIds };
  for (const [sourceId, held] of Object.entries(ids)) {
    if (match && sourceId === match.sourceId && key !== null && key in applied) continue;
    const overridden = held.startsWith(WAKE_OVERRIDE_PREFIX);
    const alarmId = overridden ? held.slice(WAKE_OVERRIDE_PREFIX.length) : held;
    const alarm = useAlarmStore.getState().alarms.find(a => a.id === alarmId);
    if (alarm && overridden) {
      if (alarm.override && !isOverrideSpent(alarm.override, now)) {
        store.setOverride(alarm.id, overrideDay(alarm.override), alarm.hour, alarm.minute);
      }
    } else if (alarm) {
      store.deleteAlarm(alarm.id);
    }
    delete ids[sourceId];
  }
  const idsChanged = Object.keys(ids).length !== Object.keys(settings.wakeUpAlarmIds).length;

  if (!match || key === null) {
    if (idsChanged) settings.setWakeUpAlarmIds(ids);
    return false;
  }
  if (key in applied) {
    if (Object.keys(applied).length !== Object.keys(settings.wakeUpAlarmApplied).length) settings.setWakeUpAlarmApplied(applied);
    if (idsChanged) settings.setWakeUpAlarmIds(ids);
    return false;
  }

  const plan = wakeAlarmPlan(morningAlarmFor(NEXT_ALARM_LINK, useAlarmStore.getState().alarms, now, settings.dayResetTime), match.wakeAt, now);
  let set = false;
  if (plan.kind === 'override') {
    set = store.setOverride(plan.alarm.id, morning, match.wakeAt.getHours(), match.wakeAt.getMinutes());
    if (set) ids[match.sourceId] = `${WAKE_OVERRIDE_PREFIX}${plan.alarm.id}`;
  } else if (plan.kind === 'add') {
    const added = store.addOneOffAlarm(match.wakeAt, { mission: null, sound: null, wakeSong: null }, now);
    ids[match.sourceId] = added.id;
    set = true;
  }
  // 'covered' and 'none' are answers too: an alarm already rings in time, or
  // the one that rings is the person's own one-off, which is theirs to change
  // from the row. Recording them stops the next sweep asking again.
  settings.setWakeUpAlarmApplied({ ...applied, [key]: match.endsAt });
  if (idsChanged || ids[match.sourceId] !== settings.wakeUpAlarmIds[match.sourceId]) settings.setWakeUpAlarmIds(ids);
  return set;
}
