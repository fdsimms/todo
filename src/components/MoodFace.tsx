import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { useColors } from '../theme/ThemeContext';
import { flattenOverlay, type Colors } from '../theme';
import type { MoodLevel } from '../types';

interface Props {
  level: MoodLevel;
  size: number;
  /** Fades the face, for the choices not picked once one has been. */
  dimmed?: boolean;
}

/**
 * Brows and mouth per level, on a 24-unit grid. The brows slant up toward the
 * nose on the two low faces (sad), never down (which reads as angry).
 */
const BROWS: Record<MoodLevel, string | null> = {
  1: 'M6.4 8.6 L10 6.8 M17.6 8.6 L14 6.8',
  2: null,
  3: null,
  4: null,
  5: null,
};
const MOUTH: Record<MoodLevel, string> = {
  1: 'M7.5 17.2 Q12 12.6 16.5 17.2',
  2: 'M8.3 16.4 Q12 14 15.7 16.4',
  3: 'M8.5 15.6 H15.5',
  4: 'M8.3 14.4 Q12 17 15.7 14.4',
  5: 'M7.3 13.6 Q12 19.2 16.7 13.6 Z',
};

/**
 * Red, orange, grey, then two greens: the one place a mood colour is chosen.
 * Built from the status hues and the grey of an empty control, so it follows
 * the theme and no new colour token exists for it.
 */
export function moodFaceFill(level: MoodLevel, colors: Colors): string {
  switch (level) {
    case 1: return colors.red;
    case 2: return colors.orange;
    case 3: return colors.controlBorder;
    case 4: return flattenOverlay(colors.green + 'B3', colors.controlBorder);
    case 5: return colors.green;
  }
}

/**
 * The mood scale's face, wherever a rating is shown or picked. Drawn rather
 * than an emoji so it looks the same on every device and takes the theme's
 * colours. The face carries the meaning; the colour only backs it up, and the
 * label is always spoken or printed beside it (`moodLabel`).
 */
export function MoodFace({ level, size, dimmed = false }: Props) {
  const colors = useColors();
  const fill = moodFaceFill(level, colors);
  const feature = colors.onFill;
  const brows = BROWS[level];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={dimmed ? { opacity: 0.55 } : undefined}
    >
      <Circle cx={12} cy={12} r={10} fill={fill} />
      <Circle cx={8.6} cy={9.6} r={1.1} fill={feature} />
      <Circle cx={15.4} cy={9.6} r={1.1} fill={feature} />
      {brows && (
        <Path d={brows} stroke={feature} strokeWidth={1.6} strokeLinecap="round" fill="none" />
      )}
      <Path
        d={MOUTH[level]}
        stroke={feature}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={level === 5 ? feature : 'none'}
      />
    </Svg>
  );
}
