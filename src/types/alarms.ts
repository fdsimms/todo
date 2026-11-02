/**
 * What has to be done to stop an alarm, or to check off a task that carries
 * one. A union so a new kind is a new arm; `pushups` is counted by the
 * proximity sensor (src/utils/pushupCounter.ts). See src/utils/missions.ts.
 */
export type AlarmMission = { kind: 'pushups'; count: number };

/**
 * An alarm of its own, not a task: a time, the days it repeats on, and an
 * optional mission. Device-only (never synced, never in a backup), because an
 * alarm set on the phone shouldn't also ring on the iPad. See
 * src/utils/alarms.ts.
 */
export interface Alarm {
  id: string;
  /** Empty for an unlabelled alarm. */
  label: string;
  /** The clock time it rings at, local. */
  hour: number;
  minute: number;
  /** Weekdays it repeats on, 0 = Sunday. Empty rings once. */
  repeatDays: number[];
  /**
   * The instant a one-off alarm rings at (a quick alarm, or one with no
   * repeat days), worked out when it was set. Null for a repeating alarm.
   */
  fireAt: string | null;
  enabled: boolean;
  mission: AlarmMission | null;
  /** A quick alarm ("in 30 minutes"), deleted once it has rung and its mission is done. */
  quick: boolean;
  /**
   * When it was last switched on or changed. A ring before this is not one
   * this alarm owes a mission for (see `missedMissionRing`).
   */
  armedAt: string;
  /** When its mission was last finished or given up, or null. */
  missionDoneAt: string | null;
  /** The last mission ended with Give up rather than being done. Shown on the row. */
  missionGaveUp: boolean;
  /**
   * What it rings with: null for the system's alarm sound, a built-in tone
   * (`chime`, `beacon`, `rise`), or `custom:<id>` for one imported from Files
   * (an `AlarmSoundFile`). See src/utils/alarmSounds.ts.
   */
  sound: string | null;
  /**
   * Two or more sounds the alarm picks between, or empty for no choice. When
   * set, `sound` is the one picked for the next ring and is re-picked after
   * each ring the next time the app runs (`rerollSounds`, alarms.ts
   * `soundOwesReroll`), since AlarmKit takes the sound when the alarm is
   * scheduled and plays it for every ring of a weekly schedule.
   */
  soundPool: string[];
  /** When `sound` was last picked from the pool, or null if it never was. */
  soundRolledAt: string | null;
  /**
   * A one-night change to a repeating alarm ("6:30 just tomorrow"): on that
   * calendar date it rings at this time instead, and after that day it goes
   * back to its own. Null for none. See src/utils/morningAlarm.ts.
   */
  override: AlarmOverride | null;
  createdAt: string;
}

/** A repeating alarm's time for one calendar date (Alarm.override). */
export interface AlarmOverride {
  /** YYYY-MM-DD, local. */
  date: string;
  hour: number;
  minute: number;
}

/**
 * A sound imported from Files for alarms to ring with, converted on the
 * device into the app's Library/Sounds (alarmSounds.ts). Device-only, kept in
 * a device-local setting beside the alarms that use it.
 */
export interface AlarmSoundFile {
  id: string;
  /** What the picker lists it as: the file's name without its extension. */
  name: string;
  addedAt: string;
}
