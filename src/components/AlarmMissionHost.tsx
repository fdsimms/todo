import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  completeNativeMission,
  deferNativeMission,
  pendingNativeMissions,
  type PendingNativeMission,
} from 'todo-alarmkit-bridge';
import { playSong, stopSong } from 'todo-music-bridge';
import { useTaskStore } from '../store/useTaskStore';
import { useAlarmStore } from '../store/useAlarmStore';
import { useDemoStore } from '../store/useDemoStore';
import { useMissionStore } from '../store/useMissionStore';
import { MissionSheet } from './MissionSheet';
import { DeliverablePromptSheet } from './DeliverablePromptSheet';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { requestDismissAllSheets } from '../utils/sheetModal';
import { animateLayout } from '../utils/layoutAnimation';
import { asksOnCompletion } from '../utils/deliverables';
import { missedMissionRing } from '../utils/alarms';
import { describeWakeSong } from '../utils/alarmSounds';
import {
  MISSION_COUNTING_GRACE_SECONDS,
  MISSION_HEARTBEAT_MS,
  MISSION_REARM_SECONDS,
  nativeMission,
  owedMissions,
  type OwedMission,
} from '../utils/missions';

/** How often the host re-reads the native pending list while the app is in front. */
const POLL_MS = 5_000;

/**
 * Runs the missions alarms are owed for, whatever screen is showing. Mounted
 * once beside the navigator, the way `WorkoutModeHost` is.
 *
 * - **Finds what is owed** (`owedMissions`): the native pending list, which a
 *   mission joins when its alarm's Stop runs, plus an alarm whose ring the
 *   app can see went by unfinished. Read on launch, on every return to the
 *   front, and every few seconds while in front, since a Stop pressed with
 *   the app already open changes nothing React can hear.
 * - **Lets go of the stale**: a pending mission for a task finished elsewhere
 *   (another device, the bulk bar, a miss) is completed natively, so it stops
 *   ringing.
 * - **Opens the first owed mission** over whatever is up, and keeps its next
 *   ring a minute out while it is open (renewed on a heartbeat, so the ring
 *   still comes back if the app dies mid-set). Cancel puts the next ring
 *   `MISSION_REARM_SECONDS` out and opens it again then; only done or the held
 *   Give up ends it.
 * - **Plays the alarm's wake-up song** while its mission is open, and stops it
 *   when the sheet closes for any reason (alarmSounds.ts).
 *
 * Nothing runs in demo mode: the pending list is the real device's, and the
 * demo's tasks and alarms are not the ones it names.
 */
export function AlarmMissionHost() {
  const demo = useDemoStore(s => s.active);
  const tasks = useTaskStore(s => s.tasks);
  const tasksReady = useTaskStore(s => s.initialized);
  const alarms = useAlarmStore(s => s.alarms);
  const alarmsReady = useAlarmStore(s => s.initialized);
  const activeKey = useMissionStore(s => s.activeKey);
  const [pending, setPending] = useState<PendingNativeMission[]>([]);
  const [inFront, setInFront] = useState(AppState.currentState === 'active');
  const [tick, setTick] = useState(0);
  // A mission cancelled a moment ago waits for its next ring before opening again.
  const quietUntil = useRef(new Map<string, number>());
  const [promptTaskId, setPromptTaskId] = useState<string | null>(null);

  const ready = tasksReady && alarmsReady && !demo;

  const refresh = useCallback(async () => {
    if (!ready) return;
    // A one-night alarm time whose day is over goes back to the alarm's own
    // (morningAlarm.ts), so the weekly schedule is whole again.
    useAlarmStore.getState().clearSpentOverrides();
    setPending(await pendingNativeMissions());
    setTick(t => t + 1);
  }, [ready]);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', state => {
      setInFront(state === 'active');
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!inFront || !ready) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [inFront, ready, refresh]);

  const { owed, stale } = useMemo(() => {
    if (!ready) return { owed: [] as OwedMission[], stale: [] as string[] };
    const now = new Date();
    const byId = new Map(tasks.map(t => [t.id, t]));
    const alarmById = new Map(alarms.map(a => [a.id, a]));
    return owedMissions({
      pending,
      taskById: id => byId.get(id),
      alarmById: id => alarmById.get(id),
      missedRingAlarmIds: alarms.filter(a => missedMissionRing(a, now) !== null).map(a => a.id),
    });
  }, [ready, pending, tasks, alarms, tick]);

  // Stale entries are completed natively, then read back so they leave `pending`.
  const staleKey = stale.join('|');
  useEffect(() => {
    if (stale.length === 0) return;
    void Promise.all(stale.map(key => completeNativeMission(key))).then(refresh);
  }, [staleKey]);

  useEffect(() => {
    useMissionStore.getState().setOwed(owed);
    // A quick alarm that has rung and owes nothing goes from the list.
    if (ready) {
      useAlarmStore.getState().pruneSpent(new Set(owed.filter(o => o.source === 'alarm').map(o => o.id)));
    }
  }, [owed]);

  // Opens the first owed mission that isn't waiting out a cancel.
  useEffect(() => {
    if (!inFront || activeKey !== null || promptTaskId !== null) return;
    const now = Date.now();
    const next = owed.find(o => (quietUntil.current.get(o.key) ?? 0) <= now);
    if (!next) return;
    requestDismissAllSheets();
    useMissionStore.getState().show(next.key);
  }, [owed, inFront, activeKey, promptTaskId, tick]);

  const current = owed.find(o => o.key === activeKey) ?? null;
  // A mission finished elsewhere while its sheet is up closes it.
  useEffect(() => {
    if (activeKey !== null && current === null && ready) useMissionStore.getState().hide();
  }, [activeKey, current, ready]);
  const shown = useSheetSubject(current);

  // While the sheet is up, the next ring stays a minute away.
  const currentKey = current?.key ?? null;
  useEffect(() => {
    if (!current) return;
    const native = nativeMission(current.key, current.mission, current.title);
    if (!native) return;
    void deferNativeMission(native, MISSION_COUNTING_GRACE_SECONDS);
    const timer = setInterval(() => void deferNativeMission(native, MISSION_COUNTING_GRACE_SECONDS), MISSION_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [currentKey]);

  // The alarm's wake-up song plays while its mission is open. Read once per
  // opening, so an edit to the alarm mid-mission doesn't restart the song.
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  useEffect(() => {
    if (!current || current.source !== 'alarm') return;
    const song = useAlarmStore.getState().alarms.find(a => a.id === current.id)?.wakeSong ?? null;
    if (!song) return;
    let open = true;
    void playSong(song.persistentId).then(started => {
      if (open && started) setNowPlaying(describeWakeSong(song));
    });
    return () => {
      open = false;
      setNowPlaying(null);
      void stopSong();
    };
  }, [currentKey]);

  const finish = (o: OwedMission, gaveUp: boolean) => {
    useMissionStore.getState().hide();
    quietUntil.current.delete(o.key);
    void completeNativeMission(o.key).then(refresh);
    if (o.source === 'alarm') {
      useAlarmStore.getState().markMissionDone(o.id, gaveUp);
      return;
    }
    // Giving up stops the alarm and leaves the task as it was.
    if (gaveUp) return;
    const task = useTaskStore.getState().tasks.find(t => t.id === o.id);
    if (!task || task.completed) return;
    if (asksOnCompletion(task)) {
      setPromptTaskId(task.id);
      return;
    }
    animateLayout();
    useTaskStore.getState().completeTask(task.id, { missionDone: true });
  };

  const cancel = (o: OwedMission) => {
    useMissionStore.getState().hide();
    quietUntil.current.set(o.key, Date.now() + MISSION_REARM_SECONDS * 1000);
    const native = nativeMission(o.key, o.mission, o.title);
    if (native) void deferNativeMission(native, MISSION_REARM_SECONDS);
  };

  const promptTask = useTaskStore(s => (promptTaskId ? s.tasks.find(t => t.id === promptTaskId && !t.completed) ?? null : null));
  const shownPrompt = useSheetSubject(promptTask);

  return (
    <>
      {shown && (
        <MissionSheet
          visible={current !== null}
          mission={shown.mission}
          title={shown.title}
          subjectKey={shown.key}
          doneNote={shown.source === 'task' ? `${shown.title} is checked off.` : 'The alarm is off.'}
          onDone={() => finish(shown, false)}
          onClose={() => cancel(shown)}
          onGiveUp={() => finish(shown, true)}
          nowPlaying={nowPlaying}
        />
      )}
      {shownPrompt && (
        <DeliverablePromptSheet
          visible={promptTask !== null}
          task={shownPrompt}
          onConfirm={(value, reasoning) => {
            setPromptTaskId(null);
            animateLayout();
            useTaskStore.getState().completeTask(shownPrompt.id, {
              deliverableValue: value,
              deliverableReasoning: reasoning,
              missionDone: true,
            });
          }}
          // The mission is done either way; cancelling only leaves the task
          // open, the way cancelling the question does anywhere else.
          onCancel={() => setPromptTaskId(null)}
        />
      )}
    </>
  );
}
