import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { EditorRow } from './EditorRow';
import { useAlarmStore } from '../store/useAlarmStore';
import { describeSound } from '../utils/alarmSounds';

interface Props {
  sound: string | null;
  /** Opens the ringtone picker, which the caller renders inside its own sheet. */
  onOpenRingtones: () => void;
}

/** The Ringtone row, shared by the alarm editor and the quick alarm so the two can't drift. */
export function AlarmSoundRows({ sound, onOpenRingtones }: Props) {
  const imported = useAlarmStore(useShallow(s => s.sounds));
  return (
    <EditorRow
      icon="notifications-outline"
      label="Ringtone"
      value={describeSound(sound, imported)}
      onPress={onOpenRingtones}
    />
  );
}
