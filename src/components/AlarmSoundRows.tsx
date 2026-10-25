import React from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { pickSong } from 'todo-music-bridge';
import type { WakeSong } from '../types';
import { EditorRow } from './EditorRow';
import { useColors } from '../theme/ThemeContext';
import { spacing } from '../theme';
import { useAlarmStore } from '../store/useAlarmStore';
import { describeSound, describeWakeSong, normalizeWakeSong } from '../utils/alarmSounds';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  sound: string | null;
  wakeSong: WakeSong | null;
  /** The song row shows only with a mission: the mission is what opens the app to play it. */
  hasMission: boolean;
  /** Opens the ringtone picker, which the caller renders inside its own sheet. */
  onOpenRingtones: () => void;
  onWakeSong: (song: WakeSong | null) => void;
}

/**
 * The Ringtone and Wake-up song rows, shared by the alarm editor and the
 * quick alarm so the two can't drift. The song is picked with Apple's own
 * music picker (todo-music-bridge), which asks for library access itself.
 */
export function AlarmSoundRows({ sound, wakeSong, hasMission, onOpenRingtones, onWakeSong }: Props) {
  const imported = useAlarmStore(useShallow(s => s.sounds));
  const colors = useColors();

  const chooseSong = async () => {
    const picked = await pickSong();
    if (picked.status === 'ok') {
      onWakeSong(normalizeWakeSong(picked));
    } else if (picked.status === 'denied') {
      Alert.alert(
        'Couldn’t open your music library',
        'dundundun doesn’t have access to Apple Music. You can allow it in Settings.',
        [
          { text: BUTTON_LABEL.cancel, style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ],
      );
    } else if (picked.status === 'unavailable') {
      Alert.alert('Couldn’t open your music library', 'Picking a song needs a newer version of the app.');
    }
  };

  return (
    <>
      <EditorRow
        icon="notifications-outline"
        label="Ringtone"
        value={describeSound(sound, imported)}
        onPress={onOpenRingtones}
      />
      {hasMission && (
        // EditorGroup's divider, inset past the icon column.
        <View style={[styles.sep, { backgroundColor: colors.separator }]} />
      )}
      {hasMission && (
        <EditorRow
          icon="musical-notes-outline"
          label="Wake-up song"
          value={wakeSong ? describeWakeSong(wakeSong) : undefined}
          hint="Plays from Apple Music during the mission"
          onPress={() => void chooseSong()}
          onClear={wakeSong ? () => onWakeSong(null) : undefined}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md + 18 + spacing.md },
});
