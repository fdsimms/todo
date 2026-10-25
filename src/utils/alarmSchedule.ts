import {
  cancelNativeAlarm,
  completeNativeMission,
  isAlarmKitAvailable,
  requestAlarmAuthorization,
  scheduleNativeAlarm,
  scheduleWeeklyNativeAlarm,
} from 'todo-alarmkit-bridge';
import type { Alarm } from '../types';
import { alarmAlertTitle, alarmNativeUuid, isRepeating, nextFireAt } from './alarms';
import { missionKeyForAlarm, nativeMission } from './missions';
import { isDemoModeActive } from './demoState';

/**
 * Puts one alarm on the device the way the store holds it: cancelled, then
 * scheduled again if it is switched on and still has a ring ahead.
 *
 * The one door from the alarm store to AlarmKit, and it is shut in demo mode:
 * the demo's alarms live in a throwaway database, and one scheduled natively
 * would ring after the demo was gone (CLAUDE.md, "Nothing in demo mode may
 * write outside the demo database"). It also leaves the real alarms alone
 * while the demo runs, since nothing here cancels them either.
 *
 * Returns whether the alarm is now scheduled.
 */
export async function syncAlarmToDevice(alarm: Alarm, now: Date = new Date()): Promise<boolean> {
  if (isDemoModeActive() || !isAlarmKitAvailable()) return false;
  const id = alarmNativeUuid(alarm.id);
  await cancelNativeAlarm(id);
  if (!alarm.enabled || nextFireAt(alarm, now) === null) return false;
  await ensureAuthorized();
  const title = alarmAlertTitle(alarm);
  const mission = nativeMission(missionKeyForAlarm(alarm.id), alarm.mission, title);
  if (isRepeating(alarm)) {
    return scheduleWeeklyNativeAlarm(id, alarm.hour, alarm.minute, alarm.repeatDays, title, mission);
  }
  return scheduleNativeAlarm(id, nextFireAt(alarm, now)!, title, mission);
}

/** Takes an alarm off the device, and ends any mission its ring left owed. */
export async function removeAlarmFromDevice(alarmId: string): Promise<void> {
  if (isDemoModeActive() || !isAlarmKitAvailable()) return;
  await cancelNativeAlarm(alarmNativeUuid(alarmId));
  await completeNativeMission(missionKeyForAlarm(alarmId));
}

let authorizationAsked = false;

/**
 * Asks for alarm permission once per launch, before the first alarm is set.
 * AlarmKit refuses a schedule while the answer is "not determined", and
 * asking at the moment somebody sets an alarm is when the question makes
 * sense to them.
 */
async function ensureAuthorized(): Promise<void> {
  if (authorizationAsked) return;
  authorizationAsked = true;
  await requestAlarmAuthorization();
}
