import { create } from 'zustand';
import type { Alarm, AlarmMission } from '../types';
import { dbDeleteAlarm, dbGetAlarms, dbGetSetting, dbSaveAlarm, dbSetSetting } from '../db/database';
import { generateId } from '../utils/id';
import { isSpent, quickAlarmFields, scheduleFields } from '../utils/alarms';
import { normalizeMission, parseMission } from '../utils/missions';

/**
 * The mission the last quick alarm was set with, so the next one opens on it.
 * A device-local setting (not on the sync allowlist), like the alarms.
 */
const QUICK_MISSION_SETTING = 'quickAlarmMission';
import { removeAlarmFromDevice, syncAlarmToDevice } from '../utils/alarmSchedule';

/** What the alarm editor saves. */
export interface AlarmInput {
  /** Set to edit an existing alarm; absent to add one. */
  id?: string;
  label: string;
  hour: number;
  minute: number;
  repeatDays: number[];
  mission: AlarmMission | null;
}

/**
 * Alarms of their own (see utils/alarms.ts). Device-only, like the table they
 * live in. Every write goes to SQLite, then state, then the device through
 * `syncAlarmToDevice`, which is a no-op in demo mode.
 *
 * Held in memory, so demo mode has to `reload()` it when the database swaps
 * (see `useDemoStore`).
 *
 * A mission that is owed (its alarm rang and it isn't done) is the mission
 * host's to end, through `markMissionDone`. Nothing here refuses switching
 * such an alarm off; the screen hides that control while one is owed, because
 * the held Give up is the agreed way out (missions.ts).
 */
interface AlarmStore {
  alarms: Alarm[];
  initialized: boolean;
  initialize: () => void;
  /** Re-read from the current database, after a demo-mode swap. */
  reload: () => void;
  /** Adds or edits an alarm, and switches it on. */
  saveAlarm: (input: AlarmInput, now?: Date) => Alarm;
  /** A one-off alarm `minutes` from now. */
  addQuickAlarm: (minutes: number, mission: AlarmMission | null, now?: Date) => Alarm;
  /** The mission the last quick alarm was set with, or null. */
  lastQuickMission: () => AlarmMission | null;
  setEnabled: (id: string, enabled: boolean, now?: Date) => void;
  deleteAlarm: (id: string) => void;
  /** Its mission was done, or given up. A spent quick alarm goes with it. */
  markMissionDone: (id: string, gaveUp?: boolean, now?: Date) => void;
  /** Deletes quick alarms that have rung and owe nothing. Run on open. */
  pruneSpent: (owed: ReadonlySet<string>, now?: Date) => void;
  /** Puts every alarm on the device again, after launch or the demo ending. */
  syncAllToDevice: () => Promise<void>;
}

function write(alarm: Alarm): void {
  dbSaveAlarm(alarm);
  void syncAlarmToDevice(alarm);
}

export const useAlarmStore = create<AlarmStore>((set, get) => ({
  alarms: [],
  initialized: false,

  initialize() {
    set({ alarms: dbGetAlarms(), initialized: true });
  },

  reload() {
    set({ alarms: dbGetAlarms(), initialized: true });
  },

  saveAlarm(input, now = new Date()) {
    const existing = input.id ? get().alarms.find(a => a.id === input.id) : undefined;
    const alarm: Alarm = {
      id: existing?.id ?? generateId(),
      label: input.label.trim(),
      ...scheduleFields(input.hour, input.minute, input.repeatDays, now),
      enabled: true,
      mission: normalizeMission(input.mission),
      quick: false,
      armedAt: now.toISOString(),
      missionDoneAt: existing?.missionDoneAt ?? null,
      missionGaveUp: existing?.missionGaveUp ?? false,
      createdAt: existing?.createdAt ?? now.toISOString(),
    };
    write(alarm);
    set({ alarms: existing ? get().alarms.map(a => (a.id === alarm.id ? alarm : a)) : [...get().alarms, alarm] });
    return alarm;
  },

  addQuickAlarm(minutes, mission, now = new Date()) {
    const alarm: Alarm = {
      id: generateId(),
      label: '',
      ...quickAlarmFields(minutes, now),
      enabled: true,
      mission: normalizeMission(mission),
      armedAt: now.toISOString(),
      missionDoneAt: null,
      missionGaveUp: false,
      createdAt: now.toISOString(),
    };
    write(alarm);
    dbSetSetting(QUICK_MISSION_SETTING, alarm.mission ? JSON.stringify(alarm.mission) : '');
    set({ alarms: [...get().alarms, alarm] });
    return alarm;
  },

  lastQuickMission() {
    return parseMission(dbGetSetting(QUICK_MISSION_SETTING));
  },

  setEnabled(id, enabled, now = new Date()) {
    const current = get().alarms.find(a => a.id === id);
    if (!current || current.enabled === enabled && !(enabled && isSpent(current, now))) return;
    // Switching a one-off back on sets it for the next time its clock time
    // comes round, the way the Clock app does.
    const alarm: Alarm = enabled
      ? { ...current, ...scheduleFields(current.hour, current.minute, current.repeatDays, now), enabled, armedAt: now.toISOString() }
      : { ...current, enabled };
    write(alarm);
    set({ alarms: get().alarms.map(a => (a.id === id ? alarm : a)) });
  },

  deleteAlarm(id) {
    dbDeleteAlarm(id);
    void removeAlarmFromDevice(id);
    set({ alarms: get().alarms.filter(a => a.id !== id) });
  },

  markMissionDone(id, gaveUp = false, now = new Date()) {
    const current = get().alarms.find(a => a.id === id);
    if (!current) return;
    if (current.quick && isSpent(current, now)) {
      get().deleteAlarm(id);
      return;
    }
    const alarm = { ...current, missionDoneAt: now.toISOString(), missionGaveUp: gaveUp };
    dbSaveAlarm(alarm);
    set({ alarms: get().alarms.map(a => (a.id === id ? alarm : a)) });
  },

  pruneSpent(owed, now = new Date()) {
    const spent = get().alarms.filter(a => a.quick && isSpent(a, now) && !owed.has(a.id));
    if (spent.length === 0) return;
    for (const a of spent) dbDeleteAlarm(a.id);
    const gone = new Set(spent.map(a => a.id));
    set({ alarms: get().alarms.filter(a => !gone.has(a.id)) });
  },

  async syncAllToDevice() {
    for (const alarm of get().alarms) await syncAlarmToDevice(alarm);
  },
}));
