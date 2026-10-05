import React, { useEffect, useState } from 'react';
import { BeatMark } from './BeatMark';
import { useSettingsStore } from '../store/useSettingsStore';
import { shouldPlayBeat } from '../utils/allClear';
import { getLogicalDayKey } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import { playBeatSound } from '../utils/beatSound';
import { useReduceMotion } from '../utils/useReduceMotion';

/**
 * The mark on Today's All clear, and the one place the beat is played: the
 * animation, the light, light, heavy haptic and, with the setting on, the
 * three notes. `shouldPlayBeat` decides, once, at mount, so a re-render while
 * Today stays empty can't replay it; playing stamps the logical day so it
 * doesn't come back until tomorrow.
 *
 * Reduce Motion keeps the mark still and still plays the haptic, which is
 * feedback rather than motion.
 */
export function AllClearMark({ filtered, doneToday, size = 88 }: {
  filtered: boolean;
  doneToday: number;
  size?: number;
}) {
  const reduceMotion = useReduceMotion();
  const [play] = useState(() => {
    const s = useSettingsStore.getState();
    return shouldPlayBeat({
      filtered,
      doneToday,
      lastDayKey: s.beatLastDayKey,
      todayKey: getLogicalDayKey(new Date(), s.dayResetTime),
    });
  });

  useEffect(() => {
    if (!play) return;
    const s = useSettingsStore.getState();
    s.setBeatLastDayKey(getLogicalDayKey(new Date(), s.dayResetTime));
    haptics.beat();
    if (s.beatSoundEnabled) void playBeatSound();
  }, [play]);

  return <BeatMark size={size} play={play && !reduceMotion} />;
}
