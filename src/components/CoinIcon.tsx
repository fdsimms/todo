import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle, Rect } from 'react-native-svg';
import { useColors } from '../theme/ThemeContext';
import { COIN_ICON } from '../constants/coinIcon';

/** An Ionicons name, or the drawn coin. */
export type IconName = keyof typeof Ionicons.glyphMap | typeof COIN_ICON;

interface Props {
  size: number;
  /** The coin's own colour: the rim and mark when outlined, the face when `filled`. */
  color: string;
  /**
   * A solid face with the rim and mark cut out of it, for the places a coin is
   * the point (the balance, an empty state). Outlined is for sitting beside
   * Ionicons at their weight.
   */
  filled?: boolean;
  /** The rim and mark on a filled face. Defaults to `onDone`, the ink that reads on the gold `done` face in every theme. */
  markColor?: string;
}

/**
 * A coin, for everything that is a coin balance: the Rewards screen, the "+3"
 * toast, a bounty's extra coins. It replaced the trophy, which says "win" where
 * these say "currency", and which the Rewards screen's rewards (a thing you buy
 * with coins) were not.
 *
 * Drawn rather than taken from an icon set for the same reason `PinIcon` and
 * `TargetIcon` are: Ionicons has no coin (`cash` is a banknote, `ellipse` a
 * plain disc). A rim, a pressed-in inner edge and a center bar on the 24-unit
 * grid. The bar is what tells it from `TargetIcon`'s two rings and a dot, which
 * it would otherwise be at 14pt. Stroke 1.8, the weight of the icons beside it.
 */
export function CoinIcon({ size, color, filled = false, markColor }: Props) {
  const colors = useColors();
  const mark = markColor ?? colors.onDone;
  const line = filled ? mark : color;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={12}
        r={filled ? 10.5 : 9}
        fill={filled ? color : 'none'}
        stroke={line}
        strokeWidth={1.8}
      />
      <Circle cx={12} cy={12} r={6} fill="none" stroke={line} strokeWidth={1.4} strokeOpacity={filled ? 0.55 : 0.7} />
      <Rect x={11} y={8} width={2} height={8} rx={1} fill={line} />
    </Svg>
  );
}

/**
 * An icon named by `IconName`: the coin when it says so, an Ionicons glyph
 * otherwise. The one place a destination's icon is turned into a picture, so a
 * surface that lists screens doesn't each learn about the coin.
 */
export function NamedIcon({ name, size, color }: { name: string; size: number; color: string }) {
  if (name === COIN_ICON) return <CoinIcon size={size} color={color} />;
  return <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={size} color={color} />;
}
