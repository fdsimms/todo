import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  /** Pinned state — solid thumbtack head when true, outline when false. */
  filled: boolean;
  size: number;
  color: string;
}

/** The head: sloped shoulders down to a flat plate. Filled when pinned. */
const HEAD = 'M8 3h8l-1 6 3 3v3H6v-3l3-3z';
/** The needle below the plate. Always a stroke, in both states. */
const NEEDLE = 'M12 22v-7';

/**
 * The pin glyph, everywhere pinning is shown or toggled: the task row, the
 * bulk bar, the editor's Pin row, the category header's pin-all, and the
 * Pinned Tasks section header.
 *
 * Drawn here rather than taken from an icon set, which is why this is the one
 * icon in the app that isn't an `Ionicons` name. Ionicons has no thumbtack at
 * all — its `pin` is a *map* pin, a thin needle with a round head, which reads
 * as a location rather than "hold this at the top" and goes wispy at
 * `iconSize.sm`. MaterialCommunityIcons has one, but it's narrower and more
 * angular; this shape has wider shoulders and carries better at the 13pt used
 * by the Pinned Tasks header.
 *
 * Sized on a 24-unit grid at every call site, so it scales with `iconSize`
 * like the Ionicons around it. The stroke deliberately stays at 1.8 grid units
 * — going heavier closes up the outline's counter at 13pt.
 */
export function PinIcon({ filled, size, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={HEAD}
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d={NEEDLE}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
