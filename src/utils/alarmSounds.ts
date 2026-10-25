import type { AlarmSoundFile, WakeSong } from '../types';

/**
 * What an alarm rings with, and the song it plays once its mission opens.
 *
 * ## The ringtone
 *
 * AlarmKit plays an alert sound by file name only (`AlertSound.named`), and
 * looks for it where every notification sound is looked for: the app bundle
 * or `Library/Sounds`. Expo's assets aren't in the bundle by name, so every
 * sound the app rings with is put into `Library/Sounds` first, built-in tones
 * included, by the native `installAlarmSound`, which also converts it to
 * linear PCM and trims it under the system's 30-second limit (a longer file
 * plays the default sound instead). The three built-in tones are
 * `assets/sounds/alarm-*.wav`, made by `scripts/generate-alarm-tones.js`.
 *
 * An alarm whose sound file has gone (an imported sound deleted, a fresh
 * install) rings with the default rather than not at all: `syncAlarmToDevice`
 * asks for the file and falls back.
 *
 * ## The wake-up song
 *
 * An alarm's alert can't play a song: the sound is a file under 30 seconds,
 * and Apple Music tracks are protected and can't be copied into one. So the
 * song is played by the app, once the mission sheet opens (a mission is what
 * gets the app opened after the ring), and stopped when the mission is done or
 * given up. That is why only an alarm with a mission has one.
 */

/** The tones the app ships, in the order the picker lists them. */
export const BUILT_IN_SOUNDS = [
  { id: 'chime', label: 'Chime' },
  { id: 'beacon', label: 'Beacon' },
  { id: 'rise', label: 'Rise' },
] as const;

export type BuiltInSoundId = typeof BUILT_IN_SOUNDS[number]['id'];

/** How a sound imported from Files is named in `Alarm.sound`. */
export const CUSTOM_SOUND_PREFIX = 'custom:';

/** The longest an alarm sound is kept, in seconds (the system's limit is 30). */
export const ALARM_SOUND_MAX_SECONDS = 29;

/** The device-local setting the imported sounds are listed in. */
export const ALARM_SOUNDS_SETTING = 'alarmSounds';

/** What the picker calls the system's own sound. */
export const DEFAULT_SOUND_LABEL = 'Default';

const NAME_MAX = 40;

export function isBuiltInSound(sound: string): sound is BuiltInSoundId {
  return BUILT_IN_SOUNDS.some(s => s.id === sound);
}

/** The id of an imported sound named by `sound`, or null for anything else. */
export function customSoundId(sound: string | null): string | null {
  if (!sound?.startsWith(CUSTOM_SOUND_PREFIX)) return null;
  const id = sound.slice(CUSTOM_SOUND_PREFIX.length);
  return id === '' ? null : id;
}

export function customSoundRef(id: string): string {
  return `${CUSTOM_SOUND_PREFIX}${id}`;
}

/** A sound column read back: an unknown name reads as the default. */
export function parseAlarmSound(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (isBuiltInSound(raw) || customSoundId(raw) !== null) return raw;
  return null;
}

/**
 * The file a sound is installed as in Library/Sounds, or null for the
 * default. Prefixed so nothing else the app (or a library) puts there can
 * collide with it. An imported sound's id comes from `generateId`, which is
 * safe in a file name.
 */
export function soundFileName(sound: string | null): string | null {
  if (sound === null) return null;
  if (isBuiltInSound(sound)) return `dundundun-${sound}.caf`;
  const id = customSoundId(sound);
  return id === null ? null : `dundundun-custom-${id}.caf`;
}

/**
 * "Chime", an imported sound's name, or "Default". A sound that points at an
 * import since deleted reads as the default, since that is what it rings with.
 */
export function describeSound(sound: string | null, imported: readonly AlarmSoundFile[]): string {
  if (sound === null) return DEFAULT_SOUND_LABEL;
  const builtIn = BUILT_IN_SOUNDS.find(s => s.id === sound);
  if (builtIn) return builtIn.label;
  const id = customSoundId(sound);
  return imported.find(s => s.id === id)?.name ?? DEFAULT_SOUND_LABEL;
}

/** A sound's name for the picker, from the file picked: "Rooster.mp3" is "Rooster". */
export function soundNameFromFile(fileName: string | null | undefined): string {
  const base = (fileName ?? '').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const name = (dot > 0 ? base.slice(0, dot) : base).replace(/[_]+/g, ' ').trim();
  if (name === '') return 'Imported sound';
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
}

/** The imported sounds setting read back, dropping anything malformed. */
export function parseAlarmSoundFiles(json: string | null): AlarmSoundFile[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is AlarmSoundFile =>
      typeof s === 'object' && s !== null
      && typeof (s as AlarmSoundFile).id === 'string' && (s as AlarmSoundFile).id !== ''
      && typeof (s as AlarmSoundFile).name === 'string'
      && typeof (s as AlarmSoundFile).addedAt === 'string');
  } catch {
    return [];
  }
}

/** A wake-up song as stored or handed over, or null if it doesn't name one. */
export function normalizeWakeSong(raw: unknown): WakeSong | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { persistentId, title, artist } = raw as Record<string, unknown>;
  if (typeof persistentId !== 'string' || !/^\d+$/.test(persistentId) || persistentId === '0') return null;
  const name = typeof title === 'string' && title.trim() !== '' ? title.trim() : 'Untitled song';
  const by = typeof artist === 'string' && artist.trim() !== '' ? artist.trim() : null;
  return { persistentId, title: name, artist: by };
}

/** Reads a wake_song column (JSON text) back. */
export function parseWakeSong(json: unknown): WakeSong | null {
  if (typeof json !== 'string' || json === '') return null;
  try {
    return normalizeWakeSong(JSON.parse(json));
  } catch {
    return null;
  }
}

/** "Mr. Blue Sky · ELO", or the title alone. */
export function describeWakeSong(song: WakeSong): string {
  return song.artist ? `${song.title} · ${song.artist}` : song.title;
}
