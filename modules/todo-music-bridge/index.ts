import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface TodoMusicNativeModule {
  isAvailable(): boolean;
  pickSong(): Promise<string>;
  playSong(persistentId: string): Promise<boolean>;
  stopSong(): Promise<boolean>;
}

// Resolved lazily and once, like the other bridges: a build without the
// module (Android, Expo Go, an older dev build) reads as unavailable rather
// than throwing.
let nativeModule: TodoMusicNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoMusicNativeModule>('TodoMusic');
  } catch {
    nativeModule = null;
  }
}

export type PickedSong =
  | { status: 'ok'; persistentId: string; title: string; artist: string }
  | { status: 'canceled' }
  | { status: 'denied' }
  | { status: 'unavailable' };

export function isMusicAvailable(): boolean {
  try {
    return nativeModule?.isAvailable() === true;
  } catch {
    return false;
  }
}

/** Apple's music picker, asking for library access first if it hasn't been answered. */
export async function pickSong(): Promise<PickedSong> {
  if (!nativeModule) return { status: 'unavailable' };
  try {
    const parsed = JSON.parse(await nativeModule.pickSong()) as { status?: unknown; persistentId?: unknown; title?: unknown; artist?: unknown };
    if (parsed.status === 'ok' && typeof parsed.persistentId === 'string') {
      return {
        status: 'ok',
        persistentId: parsed.persistentId,
        title: typeof parsed.title === 'string' ? parsed.title : '',
        artist: typeof parsed.artist === 'string' ? parsed.artist : '',
      };
    }
    if (parsed.status === 'canceled' || parsed.status === 'denied') return { status: parsed.status };
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Plays a library song on repeat. False when it can't (no access, the song is gone). */
export async function playSong(persistentId: string): Promise<boolean> {
  if (!nativeModule) return false;
  try {
    return (await nativeModule.playSong(persistentId)) === true;
  } catch {
    return false;
  }
}

export async function stopSong(): Promise<void> {
  if (!nativeModule) return;
  try {
    await nativeModule.stopSong();
  } catch {
    // Nothing was playing.
  }
}
