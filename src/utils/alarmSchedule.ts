import {
  cancelNativeAlarm,
  completeNativeMission,
  isAlarmKitAvailable,
  requestAlarmAuthorization,
  scheduleNativeAlarm,
  scheduleWeeklyNativeAlarm,
} from 'todo-alarmkit-bridge';
import type { Alarm } from '../types';
import { alarmAlertTitle, alarmNativeUuid, atTime, isRepeating, isSkipSpent, nextFireAt } from './alarms';
import { isOverrideSpent, overrideAt, overrideDay } from './morningAlarm';
import { missionKeyForAlarm, nativeAlarmHold } from './missions';
import { isDemoModeActive } from './demoState';
import { soundFileForAlarm } from './alarmSoundDevice';

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
 * Its sound is installed first if it is a built-in tone not yet used, and
 * rings as the default if its file can't be had (alarmSoundDevice.ts).
 *
 * Returns whether the alarm is now scheduled.
 */
export async function syncAlarmToDevice(alarm: Alarm, now: Date = new Date()): Promise<boolean> {
  if (isDemoModeActive() || !isAlarmKitAvailable()) return false;
  const id = alarmNativeUuid(alarm.id);
  await cancelNativeAlarm(id);
  await cancelNativeAlarm(overrideUuid(alarm.id));
  await cancelNativeAlarm(fallbackUuid(alarm.id));
  await cancelNativeAlarm(skipFallbackUuid(alarm.id));
  if (!alarm.enabled || nextFireAt(alarm, now) === null) return false;
  await ensureAuthorized();
  const title = alarmAlertTitle(alarm);
  const mission = nativeAlarmHold(alarm, title);
  const sound = await soundFileForAlarm(alarm.sound);
  if (!isRepeating(alarm)) return scheduleNativeAlarm(id, nextFireAt(alarm, now)!, title, mission, sound);

  const override = alarm.override && !isOverrideSpent(alarm.override, now) ? alarm.override : null;
  const skipped = alarm.skippedOn && !isSkipSpent(alarm.skippedOn, now) ? alarm.skippedOn : null;
  if (!override && !skipped) {
    return scheduleWeeklyNativeAlarm(id, alarm.hour, alarm.minute, alarm.repeatDays, title, mission, sound);
  }
  // One day that isn't the usual: a morning at another time (morningAlarm.ts)
  // or a day skipped ("Skip today"). AlarmKit can't move or drop one
  // occurrence of a weekly alarm, so the weekly schedule leaves that weekday
  // out, an override rings as a one-off, and a one-off a week later rings that
  // weekday at the usual time: the app puts the full weekly back once the day
  // is over, but only when it next runs, and a week without opening it
  // shouldn't cost that day its alarm. A skipped day rings nothing of its own.
  const overrideDate = override ? overrideDay(override) : null;
  const skipDate = skipped ? dayOfKey(skipped) : null;
  const leftOut = [overrideDate, skipDate].filter((d): d is Date => d !== null);
  const others = alarm.repeatDays.filter(d => !leftOut.some(day => day.getDay() === d));
  const weekly = others.length === 0
    || await scheduleWeeklyNativeAlarm(id, alarm.hour, alarm.minute, others, title, mission, sound);
  // The override's own ring, unless that same day is the one skipped.
  const skipsOverrideDay = override !== null && skipped === override.date;
  const once = override && !skipsOverrideDay && overrideAt(override).getTime() > now.getTime()
    ? await scheduleNativeAlarm(overrideUuid(alarm.id), overrideAt(override), title, mission, sound)
    : true;
  const weekLater = (day: Date) => atTime(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 7), alarm.hour, alarm.minute);
  let fallbacks = true;
  if (overrideDate) {
    fallbacks = await scheduleNativeAlarm(fallbackUuid(alarm.id), weekLater(overrideDate), title, mission, sound);
  }
  if (skipDate && !skipsOverrideDay) {
    fallbacks = await scheduleNativeAlarm(skipFallbackUuid(alarm.id), weekLater(skipDate), title, mission, sound) && fallbacks;
  }
  return weekly && once && fallbacks;
}

/** Takes an alarm off the device, and ends any mission its ring left owed. */
export async function removeAlarmFromDevice(alarmId: string): Promise<void> {
  if (isDemoModeActive() || !isAlarmKitAvailable()) return;
  await cancelNativeAlarm(alarmNativeUuid(alarmId));
  await cancelNativeAlarm(overrideUuid(alarmId));
  await cancelNativeAlarm(fallbackUuid(alarmId));
  await cancelNativeAlarm(skipFallbackUuid(alarmId));
  await completeNativeMission(missionKeyForAlarm(alarmId));
}

/** The native ids of an override's one-off ring and its next-week stand-in. */
function overrideUuid(alarmId: string): string {
  return alarmNativeUuid(`${alarmId}:override`);
}
function fallbackUuid(alarmId: string): string {
  return alarmNativeUuid(`${alarmId}:fallback`);
}
/** The one-off that stands in a week after a skipped day. */
function skipFallbackUuid(alarmId: string): string {
  return alarmNativeUuid(`${alarmId}:skip-fallback`);
}

/** Midnight of a `YYYY-MM-DD` key. */
function dayOfKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
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
