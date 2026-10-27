/**
 * The device half of alarm sounds (alarmSounds.ts has the rules): installing a
 * sound where an alarm can ring with it, importing one from Files, and
 * playing a preview in the picker. `require`d where used, like
 * `taskFilePick.ts`'s pickers, so the audio and picker modules load only when
 * somebody actually picks or plays a sound, and a build without one degrades
 * to the default sound rather than throwing.
 */
import type { AudioPlayer } from 'expo-audio';
import { alarmSoundUri, deleteAlarmSound, hasAlarmSound, installAlarmSound } from 'todo-alarmkit-bridge';
import type { AlarmSoundFile } from '../types';
import { ALARM_SOUND_MAX_SECONDS, customSoundId, isBuiltInSound, soundFileName, type BuiltInSoundId } from './alarmSounds';

/** The bundled file behind a built-in tone, for playing it or installing it. */
function builtInModule(id: BuiltInSoundId): number {
  switch (id) {
    case 'chime': return require('../../assets/sounds/alarm-chime.wav');
    case 'beacon': return require('../../assets/sounds/alarm-beacon.wav');
    case 'rise': return require('../../assets/sounds/alarm-rise.wav');
  }
}

/** A built-in tone as a local file, for the native install to read. */
async function builtInFileUri(id: BuiltInSoundId): Promise<string | null> {
  try {
    const { Asset } = require('expo-asset') as typeof import('expo-asset');
    const asset = Asset.fromModule(builtInModule(id));
    await asset.downloadAsync();
    return asset.localUri ?? null;
  } catch {
    return null;
  }
}

/**
 * The file an alarm with `sound` should ring with, installing a built-in tone
 * the first time it is used. Null means the system's sound: the default, or
 * a sound that couldn't be installed or has since been deleted, since ringing
 * with the default beats not being scheduled at all.
 */
export async function soundFileForAlarm(sound: string | null): Promise<string | null> {
  const fileName = soundFileName(sound);
  if (fileName === null || sound === null) return null;
  if (hasAlarmSound(fileName)) return fileName;
  if (!isBuiltInSound(sound)) return null;
  const uri = await builtInFileUri(sound);
  if (uri === null) return null;
  return (await installAlarmSound(uri, fileName, ALARM_SOUND_MAX_SECONDS)) ? fileName : null;
}

export type PickedSound =
  | { status: 'ok'; uri: string; fileName: string }
  | { status: 'canceled' }
  | { status: 'failed' };

/** Asks for one audio file from Files. */
export async function pickSoundFile(): Promise<PickedSound> {
  try {
    const picker = require('expo-document-picker') as typeof import('expo-document-picker');
    const result = await picker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.length) return { status: 'canceled' };
    const asset = result.assets[0];
    return { status: 'ok', uri: asset.uri, fileName: asset.name ?? '' };
  } catch (e) {
    require('./errorLog').logError('alarm-sound-pick', e);
    return { status: 'failed' };
  }
}

/** Converts a picked file into the sound an imported `AlarmSoundFile` rings with. */
export function installImportedSound(uri: string, soundRef: string): Promise<boolean> {
  const fileName = soundFileName(soundRef);
  if (fileName === null) return Promise.resolve(false);
  return installAlarmSound(uri, fileName, ALARM_SOUND_MAX_SECONDS);
}

/** Deletes an imported sound's file. */
export async function removeImportedSound(soundRef: string): Promise<void> {
  const fileName = soundFileName(soundRef);
  if (fileName !== null) await deleteAlarmSound(fileName);
}

let preview: AudioPlayer | null = null;
let previewing: string | null = null;
const previewListeners = new Set<(sound: string | null) => void>();

function setPreviewing(sound: string | null): void {
  if (previewing === sound) return;
  previewing = sound;
  previewListeners.forEach(listener => listener(sound));
}

/**
 * Calls back with the sound being previewed, or null once it stops (stopped by
 * hand, replaced, or played to the end), so the picker can show a pause button
 * on the playing row. Returns the unsubscribe.
 */
export function subscribeSoundPreview(listener: (sound: string | null) => void): () => void {
  previewListeners.add(listener);
  listener(previewing);
  return () => { previewListeners.delete(listener); };
}

/**
 * Plays a sound in the picker, stopping whichever one was playing. Plays with
 * the ring/silent switch on, like the Clock app's picker, because a preview
 * that makes no sound reads as a sound that doesn't work. Returns whether it
 * started.
 */
export async function playSoundPreview(sound: string, imported: readonly AlarmSoundFile[]): Promise<boolean> {
  stopSoundPreview();
  try {
    const Audio = require('expo-audio') as typeof import('expo-audio');
    let source: number | { uri: string } | null = null;
    if (isBuiltInSound(sound)) {
      source = builtInModule(sound);
    } else {
      const id = customSoundId(sound);
      const fileName = id !== null && imported.some(s => s.id === id) ? soundFileName(sound) : null;
      const uri = fileName ? alarmSoundUri(fileName) : null;
      if (uri) source = { uri };
    }
    if (source === null) return false;
    await Audio.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
    const player = Audio.createAudioPlayer(source);
    preview = player;
    player.addListener('playbackStatusUpdate', status => {
      if (status.didJustFinish && preview === player) stopSoundPreview();
    });
    player.play();
    setPreviewing(sound);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops the preview, and puts the audio mode back to the one the app's other
 * cue (beatSound.ts) plays under, so that one doesn't start sounding through
 * the silent switch.
 */
export function stopSoundPreview(): void {
  setPreviewing(null);
  if (!preview) return;
  try {
    preview.pause();
    preview.remove();
    const Audio = require('expo-audio') as typeof import('expo-audio');
    void Audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
  } catch {
    // Nothing was playing that can be stopped.
  }
  preview = null;
}
