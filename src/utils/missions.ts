import type { AlarmMission, Task } from '../types';
import type { NativeMission } from 'todo-alarmkit-bridge';
import { normalizePushupCount, PUSHUP_DEFAULT_COUNT } from './pushupCounter';

/**
 * Missions: what has to be done to stop an alarm, or to check off a task that
 * carries one. Pushups is the first kind; a new kind is a new arm of
 * `AlarmMission`, a case in `normalizeMission`/`describeMission`, and a sheet
 * in `MissionSheet`.
 *
 * ## How a mission alarm keeps ringing
 *
 * iOS gives no app a way to hide an alarm's Stop button, so the loop is built
 * around it rather than against it. Pressing Stop on an alarm with a mission
 * runs the alarm's stop intent, which marks the mission pending and schedules
 * the next ring `MISSION_REARM_SECONDS` out (native, in
 * `todo-alarmkit-bridge`). That repeats with no limit until the app says the
 * mission is done (`completeMission`). While the counter is open the next ring
 * is pushed back `MISSION_COUNTING_GRACE_SECONDS` at a time, renewed every
 * `MISSION_HEARTBEAT_MS`, so it never rings mid-set but still comes back if
 * the app dies with the counter up.
 *
 * The one way out other than the mission is Give up, held for
 * `MISSION_GIVE_UP_HOLD_MS` and shown on the alarm's row, so a sensor that
 * misbehaves can't leave someone with an alarm they can never stop.
 */

/** Seconds from Stop to the next ring of an unfinished mission. */
export const MISSION_REARM_SECONDS = 15;

/** How far the next ring is pushed back while the counter is open. */
export const MISSION_COUNTING_GRACE_SECONDS = 60;

/** How often that push is renewed while the counter stays open. */
export const MISSION_HEARTBEAT_MS = 20_000;

/** How long Give up has to be held. */
export const MISSION_GIVE_UP_HOLD_MS = 10_000;

export const MISSION_KINDS = ['pushups'] as const;

/** The mission an editor starts from when one is first switched on. */
export const DEFAULT_MISSION: AlarmMission = { kind: 'pushups', count: PUSHUP_DEFAULT_COUNT };

/**
 * The practice run behind "Try pushups" on Alarms & Reminders: enough reps to
 * see the sensor count, few enough to try twice. Nothing rings or completes.
 */
export const PRACTICE_MISSION: AlarmMission = { kind: 'pushups', count: 5 };

/**
 * The stored form of a mission, or null for none. Anything malformed (an
 * unknown kind, a count of 0, a string count from the MCP) reads as none
 * rather than as a mission nobody can finish.
 */
export function normalizeMission(raw: unknown): AlarmMission | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { kind, count } = raw as { kind?: unknown; count?: unknown };
  if (kind === 'pushups') {
    const n = normalizePushupCount(count);
    return n === null ? null : { kind: 'pushups', count: n };
  }
  return null;
}

/** Reads a mission column (JSON text) back, tolerating anything malformed. */
export function parseMission(json: unknown): AlarmMission | null {
  if (typeof json !== 'string' || json === '') return null;
  try {
    return normalizeMission(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Whether a task or alarm has a mission to do. */
export function hasMission(holder: { mission?: AlarmMission | null }): boolean {
  return normalizeMission(holder.mission) !== null;
}

/** "20 pushups", for a row, a summary or an alert. */
export function describeMission(mission: AlarmMission): string {
  switch (mission.kind) {
    case 'pushups':
      return `${mission.count} pushup${mission.count === 1 ? '' : 's'}`;
  }
}

/** The label on the alarm's own button that opens the mission. */
export function missionButtonLabel(mission: AlarmMission): string {
  switch (mission.kind) {
    case 'pushups':
      return 'Pushups';
  }
}

/**
 * The key a mission is tracked under natively, one per thing that can ring:
 * a task or an alarm. The native side treats it as opaque.
 */
export type MissionKey = `task:${string}` | `alarm:${string}`;

export const missionKeyForTask = (taskId: string): MissionKey => `task:${taskId}`;
export const missionKeyForAlarm = (alarmId: string): MissionKey => `alarm:${alarmId}`;

/** What a mission key names, or null for one this build doesn't know. */
export function parseMissionKey(key: string): { kind: 'task' | 'alarm'; id: string } | null {
  const sep = key.indexOf(':');
  if (sep <= 0 || sep === key.length - 1) return null;
  const kind = key.slice(0, sep);
  if (kind !== 'task' && kind !== 'alarm') return null;
  return { kind, id: key.slice(sep + 1) };
}

/**
 * What the native side needs to keep an alarm ringing for a mission: its key,
 * what to do, and what the re-armed ring says. Null when there is no mission.
 */
export function nativeMission(key: MissionKey, mission: AlarmMission | null | undefined, title: string): NativeMission | null {
  const m = normalizeMission(mission);
  if (!m) return null;
  return { key, kind: m.kind, count: m.count, title, buttonLabel: missionButtonLabel(m) };
}

/** A task's alarm mission, titled the way its reminder is. */
export function nativeMissionForTask(task: Pick<Task, 'id' | 'title' | 'mission'>): NativeMission | null {
  return nativeMission(missionKeyForTask(task.id), task.mission, task.title);
}

/** A mission the app owes the person: one to open when it comes forward. */
export interface OwedMission {
  key: MissionKey;
  mission: AlarmMission;
  /** What it is for: the task's or the alarm's title. */
  title: string;
  source: 'task' | 'alarm';
  /** The task's or the alarm's id. */
  id: string;
}

interface PendingInput {
  key: string;
  kind: string;
  count: number;
  title: string;
}

/**
 * The missions owed right now, and the native ones to let go of.
 *
 * Two sources. The native pending list is the main one: a mission becomes
 * pending when its alarm's Stop (or its mission button) runs. The other is
 * an alarm whose ring the app can see passed with its mission undone
 * (`missedRing`, `missedMissionRing` in alarms.ts), for a ring whose Stop
 * never ran the re-arm.
 *
 * A native entry is stale, and returned to be completed, when what it was for
 * is gone or no longer asks it: a task completed, archived or deleted (on this
 * device or another), its mission removed, an alarm deleted. Without that a
 * task finished on the iPad would keep its phone ringing every 15 seconds.
 *
 * `ending` names missions just done or given up whose native entry is still
 * being cleared. They are neither owed nor stale: the pending list read before
 * the clear still names them, and owing one again in that gap reopened the
 * counter at once, whose heartbeat re-armed the alarm the person had just
 * stopped.
 */
export function owedMissions(input: {
  pending: readonly PendingInput[];
  taskById: (id: string) => Pick<Task, 'id' | 'title' | 'completed' | 'archived' | 'mission'> | undefined;
  alarmById: (id: string) => { id: string; label: string; mission: AlarmMission | null } | undefined;
  /** Alarms whose ring passed with the mission undone. */
  missedRingAlarmIds: readonly string[];
  /** Missions just done or given up, still being cleared natively. */
  ending?: ReadonlySet<string>;
}): { owed: OwedMission[]; stale: string[] } {
  const owed: OwedMission[] = [];
  const stale: string[] = [];
  const seen = new Set<string>();
  const ending = input.ending ?? new Set<string>();
  const add = (o: OwedMission) => {
    if (seen.has(o.key) || ending.has(o.key)) return;
    seen.add(o.key);
    owed.push(o);
  };
  for (const p of input.pending) {
    if (ending.has(p.key)) continue;
    const target = parseMissionKey(p.key);
    if (!target) {
      stale.push(p.key);
      continue;
    }
    if (target.kind === 'task') {
      const task = input.taskById(target.id);
      const mission = task ? normalizeMission(task.mission) : null;
      if (!task || task.completed || task.archived || !mission) {
        stale.push(p.key);
        continue;
      }
      add({ key: missionKeyForTask(task.id), mission, title: task.title, source: 'task', id: task.id });
    } else {
      const alarm = input.alarmById(target.id);
      const mission = alarm ? normalizeMission(alarm.mission) : null;
      if (!alarm || !mission) {
        stale.push(p.key);
        continue;
      }
      add({ key: missionKeyForAlarm(alarm.id), mission, title: p.title, source: 'alarm', id: alarm.id });
    }
  }
  for (const id of input.missedRingAlarmIds) {
    const alarm = input.alarmById(id);
    const mission = alarm ? normalizeMission(alarm.mission) : null;
    if (!alarm || !mission) continue;
    add({ key: missionKeyForAlarm(alarm.id), mission, title: alarm.label.trim() || 'Alarm', source: 'alarm', id: alarm.id });
  }
  return { owed, stale };
}
