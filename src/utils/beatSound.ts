import type { AudioPlayer } from 'expo-audio';

/**
 * Plays the All clear beat's three notes (`assets/sounds/beat.wav`, made by
 * `scripts/generate-beat-sound.js`). The caller decides whether the setting
 * allows it; this only plays.
 *
 * Follows the ring/silent switch (`playsInSilentMode: false`) and mixes with
 * whatever else is playing rather than pausing it, because it's a cue, not
 * something anyone asked to listen to.
 *
 * `expo-audio` is required lazily and inside a try: a build made before the
 * native module was added would throw on import, and losing the sound is the
 * right failure, since the haptic plays either way.
 */
let player: AudioPlayer | null = null;
let modeSet = false;

export async function playBeatSound(): Promise<void> {
  try {
    const Audio = require('expo-audio') as typeof import('expo-audio');
    if (!modeSet) {
      await Audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
      modeSet = true;
    }
    if (!player) player = Audio.createAudioPlayer(require('../../assets/sounds/beat.wav'));
    await player.seekTo(0);
    player.play();
  } catch {
    // No sound on this build; the haptic still carries the moment.
  }
}
