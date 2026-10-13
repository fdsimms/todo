import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { Task } from '../types';
import type { BusyEvent } from './calendarBusy';
import { isDemoModeActive } from './demoState';
import { liveGeneratedTasksOfKind } from './generatedTasks';
import {
  estimateFor,
  TRAVEL_ESTIMATE_STALE_MS,
  TRAVEL_ORIGIN_CURRENT,
  travelModeFor,
  travelOriginKey,
  travelSourceId,
  travelSourceOf,
  travelSourceStart,
  type TravelEstimates,
  type TravelMode,
} from './travelTasks';
import { widgetBridge } from './widgetBridge';
import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { travelOriginOfEvent, useTravelTimeStore } from '../store/useTravelTimeStore';

/**
 * Drives the "time to leave" Live Activity (Lock Screen + Dynamic Island) —
 * see targets/todo-widget/LeaveLiveActivity.swift. The fourth of the Live
 * Activities (timer, trip, focus are the others) and built the way
 * `tripLiveActivity.ts` is: zero-or-one on the native side, nothing ever
 * pushed to it, the app's only job is saying whether one is wanted.
 *
 * **The source is the "Leave for X" task, not the calendar.** The task already
 * carries everything this needs that the calendar can't give: the leave-by
 * time with the typed lead, the Apple Maps estimate, the per-event arrival
 * offset and the per-calendar lead are all folded into its `reminderTime`
 * (`checkTravelTasks`). Deriving the time again from events would be a second
 * copy of those rules. It also means the activity ends when the task does:
 * checking it off, deleting it or turning travel tasks off all remove it from
 * the live set this reads, with no switch of its own for any of them.
 *
 * **It can only start while the app is open.** ActivityKit refuses a start
 * from the background, and nothing here is pushed, so the activity appears the
 * next time the app is in front inside `LEAVE_WINDOW_MS` of leaving, not at
 * the moment the window opens. That is why the window is hours wide rather
 * than minutes: a window as narrow as the reminder's would almost never catch
 * the app open. `staleAtMs` is the leave-by time, so the card flips to "Time
 * to leave" on its own with nothing pushed (the mechanism the trip activity
 * uses at its six hours). It does not end itself at the event's start; that
 * waits for the next sync, which is the trade the trip activity makes too.
 *
 * **"Not already at" is a best-effort refusal, and only where the app can
 * tell.** With Apple Maps estimates on and the trip starting from where the
 * phone is, an estimate of `ALREADY_THERE_MINUTES` or less means the phone is
 * at the place, so nothing starts. Starting from a saved place, or with
 * estimates off, the app has no position to compare, so the activity starts
 * and the user ends it by finishing the task. Nothing here reads the location
 * itself.
 */

/** How long before leaving the activity may start. */
export const LEAVE_WINDOW_MS = 4 * 60 * 60 * 1000;

/** A phone-origin trip this short or shorter reads as "already there". */
export const ALREADY_THERE_MINUTES = 2;

const TITLE_MAX = 60;
const LOCATION_MAX = 80;

export interface LeaveRun {
  eventTitle: string;
  /** The event's location text, shortened to one line's worth; null when blank. */
  location: string | null;
  leaveAtMs: number;
  startMs: number;
  /** When the system flips the card to its "Time to leave" state: the leave-by time. */
  staleAtMs: number;
}

/** What the "already there" check reads; absent while estimates are off. */
export interface AlreadyThereCheck {
  estimates: TravelEstimates;
  mode: TravelMode;
  /** The `travelOriginKey` this event's trip starts from. */
  originKeyFor: (event: BusyEvent) => string;
  modeFor: (event: BusyEvent) => TravelMode;
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * Whether a fresh estimate from the phone's own position says the event is
 * where the phone already is. False for anything it can't tell: no check,
 * an origin that is a saved place, no held estimate or a stale one.
 */
export function isAlreadyThere(event: BusyEvent, check: AlreadyThereCheck | undefined, now: Date): boolean {
  if (!check) return false;
  if (check.originKeyFor(event) !== TRAVEL_ORIGIN_CURRENT) return false;
  const held = estimateFor(event, check.estimates, check.modeFor(event), TRAVEL_ORIGIN_CURRENT);
  if (!held || now.getTime() - held.at >= TRAVEL_ESTIMATE_STALE_MS) return false;
  return held.minutes <= ALREADY_THERE_MINUTES;
}

/**
 * Pure. The activity's payload, or null when there is nothing to show: the
 * earliest live travel task whose event is still ahead and whose leave-by time
 * is within `LEAVE_WINDOW_MS` (or already passed), unless the phone is
 * already at the place.
 */
export function buildLeaveRun(
  tasks: readonly Task[],
  events: readonly BusyEvent[],
  now: Date,
  opts: { enabled: boolean; check?: AlreadyThereCheck },
): LeaveRun | null {
  if (!opts.enabled) return null;
  const nowMs = now.getTime();

  const candidates: { event: BusyEvent; leaveAtMs: number; startMs: number }[] = [];
  for (const task of liveGeneratedTasksOfKind(tasks, 'travel')) {
    const sourceId = travelSourceOf(task);
    if (!sourceId || !task.reminderTime) continue;
    const startMs = travelSourceStart(sourceId);
    const leaveAtMs = Date.parse(task.reminderTime);
    if (startMs === null || !Number.isFinite(leaveAtMs)) continue;
    // The event has started: leaving is over, whatever the task still says.
    if (startMs <= nowMs) continue;
    if (leaveAtMs - nowMs > LEAVE_WINDOW_MS) continue;
    const event = events.find(e => travelSourceId(e) === sourceId);
    if (!event) continue;
    candidates.push({ event, leaveAtMs, startMs });
  }
  candidates.sort((a, b) => a.startMs - b.startMs);

  const next = candidates.find(c => !isAlreadyThere(c.event, opts.check, now));
  if (!next) return null;
  const location = (next.event.location ?? '').trim();
  return {
    eventTitle: clip(next.event.title, TITLE_MAX),
    location: location ? clip(location, LOCATION_MAX) : null,
    leaveAtMs: next.leaveAtMs,
    startMs: next.startMs,
    staleAtMs: next.leaveAtMs,
  };
}

// Through widgetBridge(), like the other three. The demo gate matters for the
// same reason as the trip's: nothing here would be real in the demo database,
// and travel tasks refuse demo mode, but the gate is the door, not this file.
function syncNativeLeaveActivity(run: LeaveRun | null): void {
  const bridge = widgetBridge();
  if (!bridge) return;
  bridge.syncLeaveLiveActivity(run ? JSON.stringify(run) : '').catch(() => {});
}

function currentRun(): LeaveRun | null {
  const settings = useSettingsStore.getState();
  if (isDemoModeActive()) return null;
  const enabled = settings.leaveLiveActivity && settings.travelTasks && settings.calendarReadEnabled;
  const check: AlreadyThereCheck | undefined = settings.travelEstimates
    ? {
        estimates: useTravelTimeStore.getState().estimates,
        mode: settings.travelMode,
        originKeyFor: event => travelOriginKey(travelOriginOfEvent(event.id)),
        modeFor: event => travelModeFor(event.id, settings.travelEventPrefs, settings.travelMode),
      }
    : undefined;
  return buildLeaveRun(
    useTaskStore.getState().tasks,
    useCalendarStore.getState().events,
    new Date(),
    { enabled, check },
  );
}

// Keeps the activity in sync with the travel tasks. Subscribed rather than
// threaded through checkTravelTasks, for the reason useTripLiveActivitySync
// gives. The task list, the calendar window and the held estimates are what
// the answer reads; a clock tick isn't, so coming forward is the other trigger
// (the window opening, or an event having started, changes nothing stored).
export function useLeaveLiveActivitySync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const sync = () => syncNativeLeaveActivity(currentRun());
    sync();

    const unsubTasks = useTaskStore.subscribe((state, prev) => {
      if (state.tasks !== prev.tasks) sync();
    });
    const unsubCalendar = useCalendarStore.subscribe((state, prev) => {
      if (state.events !== prev.events) sync();
    });
    const unsubEstimates = useTravelTimeStore.subscribe((state, prev) => {
      if (state.estimates !== prev.estimates) sync();
    });
    const unsubSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.leaveLiveActivity !== prev.leaveLiveActivity ||
        state.travelTasks !== prev.travelTasks ||
        state.calendarReadEnabled !== prev.calendarReadEnabled ||
        state.travelEstimates !== prev.travelEstimates
      ) sync();
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });

    return () => {
      unsubTasks();
      unsubCalendar();
      unsubEstimates();
      unsubSettings();
      subscription.remove();
    };
  }, []);
}
