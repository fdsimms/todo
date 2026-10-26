import { create } from 'zustand';
import type { Alarm, AlarmMission, AlarmSoundFile } from '../types';
import { dbDeleteAlarm, dbGetAlarms, dbGetSetting, dbSaveAlarm, dbSetSetting } from '../db/database';
import { generateId } from '../utils/id';
import { isRepeating, isSpent, quickAlarmFields, repeatingRingOn, scheduleFields, soundOwesReroll } from '../utils/alarms';
import { isOverrideSpent, overrideFor } from '../utils/morningAlarm';
import { normalizeMission } from '../utils/missions';
import {
  ALARM_SOUNDS_SETTING,
  customSoundId,
  customSoundRef,
  parseAlarmSound,
  parseAlarmSoundFiles,
  parseSoundPool,
  pickFromPool,
  soundNameFromFile,
} from '../utils/alarmSounds';
import { removeAlarmFromDevice, syncAlarmToDevice } from '../utils/alarmSchedule';
import { installImportedSound, pickSoundFile, removeImportedSound } from '../utils/alarmSoundDevice';
import { isDemoModeActive } from '../utils/demoState';

/**
 * How the last quick alarm was set up (mission, sound), so the next one
 * opens on it. A device-local setting (not on the sync allowlist), like the
 * alarms.
 */
const QUICK_SETUP_SETTING = 'quickAlarmSetup';

/** What an alarm does when it goes off, beyond its time: shared by the editor and the quick alarm. */
export interface AlarmSetup {
  mission: AlarmMission | null;
  sound: string | null;
  /** Two or more sounds to pick between each time (`Alarm.soundPool`); absent or empty for none. */
  soundPool?: string[];
}

/** What the alarm editor saves. A sound left out is the default. */
export interface AlarmInput extends Partial<AlarmSetup> {
  mission: AlarmMission | null;
  /** Set to edit an existing alarm; absent to add one. */
  id?: string;
  label: string;
  hour: number;
  minute: number;
  repeatDays: number[];
}

export type ImportSoundResult =
  | { status: 'ok'; sound: AlarmSoundFile }
  | { status: 'canceled' }
  | { status: 'failed' };

/** The stored form of a setup, with nothing malformed. */
function normalizeSetup(setup: Partial<AlarmSetup>): AlarmSetup & { soundPool: string[] } {
  const soundPool = parseSoundPool(setup.soundPool);
  const sound = parseAlarmSound(setup.sound);
  return {
    mission: normalizeMission(setup.mission),
    sound: soundPool.length > 0 && !(sound !== null && soundPool.includes(sound)) ? soundPool[0] : sound,
    soundPool,
  };
}

/**
 * The sound fields an alarm is written with. A pool picks its sound now, so
 * the first ring is already a random one, and stamps when.
 */
function soundFields(
  setup: { sound: string | null; soundPool: string[] },
  now: Date,
  random: () => number = Math.random,
): Pick<Alarm, 'sound' | 'soundPool' | 'soundRolledAt'> {
  if (setup.soundPool.length === 0) return { sound: setup.sound, soundPool: [], soundRolledAt: null };
  return { sound: pickFromPool(setup.soundPool, null, random), soundPool: setup.soundPool, soundRolledAt: now.toISOString() };
}

function readQuickSetup(): AlarmSetup & { soundPool: string[] } {
  const raw = dbGetSetting(QUICK_SETUP_SETTING);
  if (!raw) return { mission: null, sound: null, soundPool: [] };
  try {
    return normalizeSetup(JSON.parse(raw) as Partial<AlarmSetup>);
  } catch {
    return { mission: null, sound: null, soundPool: [] };
  }
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
  /** Sounds imported from Files, newest last. */
  sounds: AlarmSoundFile[];
  initialized: boolean;
  initialize: () => void;
  /** Re-read from the current database, after a demo-mode swap. */
  reload: () => void;
  /** Adds or edits an alarm, and switches it on. */
  saveAlarm: (input: AlarmInput, now?: Date) => Alarm;
  /** A one-off alarm `minutes` from now. */
  addQuickAlarm: (minutes: number, setup: AlarmSetup, now?: Date) => Alarm;
  /** How the last quick alarm was set up. */
  lastQuickSetup: () => AlarmSetup & { soundPool: string[] };
  /** Picks an audio file from Files and installs it as a sound alarms can ring with. */
  importSound: (now?: Date) => Promise<ImportSoundResult>;
  /** Deletes an imported sound; alarms that rang with it go back to the default. */
  deleteSound: (id: string) => void;
  /**
   * Picks a new sound, from its pool, for each repeating alarm that has rung
   * since the last pick, and puts it on the device. Run on every launch and
   * foreground (maintenancePasses.ts), the only moments the sound can change.
   */
  rerollSounds: (now?: Date, random?: () => number) => void;
  setEnabled: (id: string, enabled: boolean, now?: Date) => void;
  deleteAlarm: (id: string) => void;
  /** Its mission was done, or given up. A spent quick alarm goes with it. */
  markMissionDone: (id: string, gaveUp?: boolean, now?: Date) => void;
  /** Deletes quick alarms that have rung and owe nothing. Run on open. */
  pruneSpent: (owed: ReadonlySet<string>, now?: Date) => void;
  /**
   * Rings a repeating alarm at `hour:minute` on `day` only (morningAlarm.ts).
   * Its own time clears the override. False for an alarm that doesn't repeat
   * or doesn't ring that day.
   */
  setOverride: (id: string, day: Date, hour: number, minute: number) => boolean;
  /** Puts back the alarms whose one-night change is over. Run on open. */
  clearSpentOverrides: (now?: Date) => void;
  /** A one-off alarm at `at` that deletes itself once it has rung, like a quick alarm. */
  addOneOffAlarm: (at: Date, setup: AlarmSetup, now?: Date) => Alarm;
  /** Puts every alarm on the device again, after launch or the demo ending. */
  syncAllToDevice: () => Promise<void>;
}

function write(alarm: Alarm): void {
  dbSaveAlarm(alarm);
  void syncAlarmToDevice(alarm);
}

export const useAlarmStore = create<AlarmStore>((set, get) => ({
  alarms: [],
  sounds: [],
  initialized: false,

  initialize() {
    set({ alarms: dbGetAlarms(), sounds: parseAlarmSoundFiles(dbGetSetting(ALARM_SOUNDS_SETTING)), initialized: true });
  },

  reload() {
    set({ alarms: dbGetAlarms(), sounds: parseAlarmSoundFiles(dbGetSetting(ALARM_SOUNDS_SETTING)), initialized: true });
  },

  saveAlarm(input, now = new Date()) {
    const existing = input.id ? get().alarms.find(a => a.id === input.id) : undefined;
    const setup = normalizeSetup(input);
    const alarm: Alarm = {
      id: existing?.id ?? generateId(),
      label: input.label.trim(),
      ...scheduleFields(input.hour, input.minute, input.repeatDays, now),
      enabled: true,
      mission: setup.mission,
      ...soundFields(setup, now),
      quick: false,
      armedAt: now.toISOString(),
      missionDoneAt: existing?.missionDoneAt ?? null,
      missionGaveUp: existing?.missionGaveUp ?? false,
      // A new time for every day it rings replaces any one-night change.
      override: null,
      createdAt: existing?.createdAt ?? now.toISOString(),
    };
    write(alarm);
    set({ alarms: existing ? get().alarms.map(a => (a.id === alarm.id ? alarm : a)) : [...get().alarms, alarm] });
    return alarm;
  },

  addQuickAlarm(minutes, setup, now = new Date()) {
    const normalized = normalizeSetup(setup);
    const alarm: Alarm = {
      id: generateId(),
      label: '',
      ...quickAlarmFields(minutes, now),
      enabled: true,
      mission: normalized.mission,
      ...soundFields(normalized, now),
      armedAt: now.toISOString(),
      missionDoneAt: null,
      missionGaveUp: false,
      override: null,
      createdAt: now.toISOString(),
    };
    write(alarm);
    dbSetSetting(QUICK_SETUP_SETTING, JSON.stringify(normalized));
    set({ alarms: [...get().alarms, alarm] });
    return alarm;
  },

  lastQuickSetup() {
    const setup = readQuickSetup();
    // An imported sound deleted since reads as the default, and drops out of a pool.
    const known = (s: string) => {
      const id = customSoundId(s);
      return id === null || get().sounds.some(f => f.id === id);
    };
    return normalizeSetup({
      mission: setup.mission,
      sound: setup.sound !== null && known(setup.sound) ? setup.sound : null,
      soundPool: setup.soundPool.filter(known),
    });
  },

  async importSound(now = new Date()) {
    // A sound file is written outside the database, so a demo can't make one
    // (CLAUDE.md, demo mode); the picker hides the row then too.
    if (isDemoModeActive()) return { status: 'canceled' };
    const picked = await pickSoundFile();
    if (picked.status !== 'ok') return picked;
    const sound: AlarmSoundFile = { id: generateId(), name: soundNameFromFile(picked.fileName), addedAt: now.toISOString() };
    if (!(await installImportedSound(picked.uri, customSoundRef(sound.id)))) return { status: 'failed' };
    const sounds = [...get().sounds, sound];
    dbSetSetting(ALARM_SOUNDS_SETTING, JSON.stringify(sounds));
    set({ sounds });
    return { status: 'ok', sound };
  },

  deleteSound(id) {
    const ref = customSoundRef(id);
    const sounds = get().sounds.filter(s => s.id !== id);
    dbSetSetting(ALARM_SOUNDS_SETTING, JSON.stringify(sounds));
    const alarms = get().alarms.map(a => {
      if (a.sound !== ref && !a.soundPool.includes(ref)) return a;
      // A pool that loses a sound keeps choosing among the rest, and is no
      // pool once only one is left.
      const soundPool = parseSoundPool(a.soundPool.filter(s => s !== ref));
      const sound = a.sound !== ref ? a.sound : soundPool.length > 0 ? pickFromPool(soundPool, null) : (a.soundPool.find(s => s !== ref) ?? null);
      const reset: Alarm = { ...a, sound, soundPool, soundRolledAt: soundPool.length > 0 ? a.soundRolledAt : null };
      write(reset);
      return reset;
    });
    set({ sounds, alarms });
    void removeImportedSound(ref);
  },

  rerollSounds(now = new Date(), random = Math.random) {
    // A background run has not loaded the store, and an empty one would find nothing to do.
    if (!get().initialized) get().initialize();
    const due = get().alarms.filter(a => soundOwesReroll(a, now));
    if (due.length === 0) return;
    const rerolled = new Map(due.map(a => [
      a.id,
      { ...a, sound: pickFromPool(a.soundPool, a.sound, random), soundRolledAt: now.toISOString() } as Alarm,
    ]));
    for (const alarm of rerolled.values()) write(alarm);
    set({ alarms: get().alarms.map(a => rerolled.get(a.id) ?? a) });
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

  setOverride(id, day, hour, minute) {
    const current = get().alarms.find(a => a.id === id);
    if (!current || !isRepeating(current) || repeatingRingOn({ ...current, override: null }, day) === null) return false;
    const alarm: Alarm = { ...current, enabled: true, override: overrideFor(current, day, hour, minute) };
    write(alarm);
    set({ alarms: get().alarms.map(a => (a.id === id ? alarm : a)) });
    return true;
  },

  clearSpentOverrides(now = new Date()) {
    const spent = get().alarms.filter(a => a.override && isOverrideSpent(a.override, now));
    if (spent.length === 0) return;
    const cleared = new Map(spent.map(a => [a.id, { ...a, override: null }]));
    for (const alarm of cleared.values()) write(alarm);
    set({ alarms: get().alarms.map(a => cleared.get(a.id) ?? a) });
  },

  addOneOffAlarm(at, setup, now = new Date()) {
    const ring = new Date(at);
    ring.setSeconds(0, 0);
    const alarm: Alarm = {
      id: generateId(),
      label: '',
      hour: ring.getHours(),
      minute: ring.getMinutes(),
      repeatDays: [],
      fireAt: ring.toISOString(),
      quick: true,
      enabled: true,
      ...(() => { const n = normalizeSetup(setup); return { mission: n.mission, ...soundFields(n, now) }; })(),
      armedAt: now.toISOString(),
      missionDoneAt: null,
      missionGaveUp: false,
      override: null,
      createdAt: now.toISOString(),
    };
    write(alarm);
    set({ alarms: [...get().alarms, alarm] });
    return alarm;
  },

  async syncAllToDevice() {
    get().clearSpentOverrides();
    for (const alarm of get().alarms) await syncAlarmToDevice(alarm);
  },
}));
