import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { Alarm } from '../types';
import { alarmAlertTitle, isRepeating, nextFireAt } from './alarms';
import { widgetBridge } from './widgetBridge';
import { useAlarmStore } from '../store/useAlarmStore';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Drives the "alarm coming up" Live Activity (Lock Screen + Dynamic Island) —
 * see targets/todo-widget/AlarmLiveActivity.swift. It counts down to a
 * repeating alarm's next ring from `ALARM_LIVE_ACTIVITY_LEAD_MINUTES` before
 * it, and its Skip today button opens the app on that alarm's skip prompt
 * (`dundundun://alarm-skip?id=…`, alarmSkipPrompt.ts). Zero-or-one on the
 * native side and nothing ever pushed to it, like the Leave activity.
 *
 * **Which alarms.** Repeating ones that are switched on, because skipping one
 * ring is what the button is for. A quick alarm or a one-off has nothing to
 * skip and is already a countdown of its own. `nextFireAt` is the source, so a
 * skipped day, a one-night time (`Alarm.override`) and a switched-off alarm
 * are already settled.
 *
 * **When it starts.** ActivityKit refuses a start from the background, and an
 * alarm that rings at 7 AM finds the app closed at 6:50. On iOS 26 and later
 * the app asks for the activity ahead of time with a start date
 * (`Activity.request(...start:)`), and the system starts it at that moment
 * with the app closed. That request is made whenever the app is in front, for
 * the next ring within `ALARM_LIVE_ACTIVITY_SCHEDULE_AHEAD_MS`, so the app
 * has to have been opened since the previous ring was set. Before iOS 26 the
 * activity can only start while the app is open inside the lead window.
 * `staleAtMs` is the ring time: the card then says the alarm rang and the
 * countdown stops, and the next sync (any launch or return to the app) ends it.
 */

/** How long before the ring the countdown starts. */
export const ALARM_LIVE_ACTIVITY_LEAD_MINUTES = 10;

/** How far ahead the next ring is requested, so a weekend away from the app still gets Monday's. */
export const ALARM_LIVE_ACTIVITY_SCHEDULE_AHEAD_MS = 72 * 60 * 60 * 1000;

export interface AlarmCountdownRun {
  alarmId: string;
  /** What the alarm is called ("Wake up", or "Alarm"). */
  title: string;
  ringAtMs: number;
  /** When the card appears: the ring time less the lead. */
  startAtMs: number;
  /** When the system flips the card to its rang state: the ring time. */
  staleAtMs: number;
}

const TITLE_MAX = 60;

/**
 * Pure. The activity's payload, or null when there is nothing to count down
 * to: the earliest ring, among switched-on repeating alarms, that is still
 * ahead and within the schedule-ahead window.
 */
export function buildAlarmCountdownRun(
  alarms: readonly Alarm[],
  now: Date,
  opts: { enabled: boolean },
): AlarmCountdownRun | null {
  if (!opts.enabled) return null;
  let best: { alarm: Alarm; at: Date } | null = null;
  for (const alarm of alarms) {
    if (!alarm.enabled || !isRepeating(alarm)) continue;
    const at = nextFireAt(alarm, now);
    if (!at || at.getTime() - now.getTime() > ALARM_LIVE_ACTIVITY_SCHEDULE_AHEAD_MS) continue;
    if (!best || at.getTime() < best.at.getTime()) best = { alarm, at };
  }
  if (!best) return null;
  const title = alarmAlertTitle(best.alarm);
  return {
    alarmId: best.alarm.id,
    title: title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title,
    ringAtMs: best.at.getTime(),
    startAtMs: best.at.getTime() - ALARM_LIVE_ACTIVITY_LEAD_MINUTES * 60_000,
    staleAtMs: best.at.getTime(),
  };
}

// Through widgetBridge(), the one door: it is shut in demo mode, which matters
// because a demo's alarms would otherwise put a countdown on the real lock screen.
function syncNativeAlarmActivity(run: AlarmCountdownRun | null): void {
  const sync = widgetBridge()?.syncAlarmLiveActivity;
  if (!sync) return;
  sync(run ? JSON.stringify(run) : '').catch(() => {});
}

function currentRun(): AlarmCountdownRun | null {
  return buildAlarmCountdownRun(
    useAlarmStore.getState().alarms,
    new Date(),
    { enabled: useSettingsStore.getState().alarmLiveActivity },
  );
}

// Keeps the activity in sync with the alarms. A clock tick changes nothing
// stored, so coming forward is the other trigger (a ring having passed, the
// lead window having opened).
export function useAlarmLiveActivitySync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const sync = () => syncNativeAlarmActivity(currentRun());
    sync();

    const unsubAlarms = useAlarmStore.subscribe((state, prev) => {
      if (state.alarms !== prev.alarms) sync();
    });
    const unsubSettings = useSettingsStore.subscribe((state, prev) => {
      if (state.alarmLiveActivity !== prev.alarmLiveActivity) sync();
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });

    return () => {
      unsubAlarms();
      unsubSettings();
      subscription.remove();
    };
  }, []);
}
