import React from 'react';
import Svg, { G, Path } from 'react-native-svg';

interface Props {
  /** Thumbs-down when true. The same hand, mirrored top to bottom. */
  down?: boolean;
  /** Solid when true (a toggle that is on), outline otherwise. */
  filled?: boolean;
  size: number;
  color: string;
}

/** The hand: thumb, then the fist down to a flat base that meets the cuff. */
const HAND =
  'M7 11l3.4-6.4c.7-1.3 2.7-.8 2.6.7L12.6 9.2h5.3a2.1 2.1 0 0 1 2.1 2.4l-.9 6.2a2.1 2.1 0 0 1-2.1 1.8H7';
/** The cuff, its own closed shape so it stays distinct at `iconSize.xs`. */
const CUFF = 'M3.5 11h3.5v8.8H3.5z';

/**
 * The thumbs-up (and, mirrored, thumbs-down) mark for a rating: a recipe
 * marked loved, a grocery product that is loved or to be avoided.
 *
 * Drawn here for the reason `PinIcon` is: Ionicons' `thumbs-up` is a solid
 * glyph with a chunky, emoji-like silhouette beside an app of thin outline
 * icons, and its `-outline` sibling doesn't carry at 12pt. Same 24-unit grid
 * and 1.8 stroke as `PinIcon`, so it scales with `iconSize` like the Ionicons
 * around it.
 */
export function ThumbIcon({ down = false, filled = false, size, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G transform={down ? 'translate(0 24) scale(1 -1)' : undefined}>
        <Path
          d={HAND}
          fill={filled ? color : 'none'}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={CUFF}
          fill={filled ? color : 'none'}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    </Svg>
  );
}
