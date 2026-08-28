import React from 'react';
import Svg, { Path } from 'react-native-svg';

/** Which of the three things a streak can be saying right now. */
export type FlameVariant =
  /** No streak running. Outline, the same off-state the Ionicons around it use. */
  | 'none'
  /** A streak is running, and it is not the longest this task has had. */
  | 'streak'
  /** The run standing right now has overtaken every run before it. */
  | 'record';

interface Props {
  variant: FlameVariant;
  size: number;
  color: string;
}

/**
 * One tongue with a lick off its left shoulder — an ordinary streak.
 *
 * The notch between the two peaks is the whole shape. A single smooth teardrop,
 * which is the obvious way to draw a flame, reads as a *water droplet* at the
 * 12–16pt this is used at; it was tried and thrown away. Two peaks is the
 * smallest thing that says fire at that size.
 */
const FLAME = 'M12 22c3.9 0 7-2.8 7-6.3 0-4.1-2.8-6.2-4.6-10.8-.35-.9-1.45-1.15-2-.35-1.05 1.6-1.4 3.75-.95 5.65-.8-.6-1.35-1.5-1.6-2.5-.25-.9-1.4-1.15-1.95-.35C6.4 9.9 5 12.3 5 15.7 5 19.2 8.1 22 12 22z';

/**
 * The same flame with a second lick off the right and a wider base — three
 * peaks instead of two.
 *
 * It differs from FLAME in *silhouette* rather than in detail, which is what
 * makes the two tellable apart at 12pt. Anything finer was not: a hollow core
 * reads as a hole, and a third peak without the wider base is nearly the same
 * outline as FLAME once it is that small (both were mocked and rejected).
 *
 * Drawn inside the same 24-unit box, so it burns bigger without occupying more
 * room — the meta row it sits in never reflows when a record is beaten.
 */
const FLAME_RECORD = 'M12 22.2c4.6 0 8.3-2.9 8.3-6.5 0-2.7-1.2-4.4-2.5-6.4-.45 1.1-1.25 1.9-2.2 2.35.5-2.7-.3-5.5-2.1-7.55-.6-.7-1.6-.45-1.95.4-.85 2.05-.9 4.35-.2 6.4-.8-.6-1.35-1.5-1.6-2.5-.25-.9-1.4-1.15-1.95-.35C6.4 10.4 3.7 12.5 3.7 15.7c0 3.6 3.7 6.5 8.3 6.5z';

/**
 * The flame, everywhere a streak is shown: the task row's chip and its expanded
 * panel, the editor's Streak row, and the streak leaderboard on Stats.
 *
 * The second icon in the app that isn't an `Ionicons` name, for a reason
 * `PinIcon` will recognise: Ionicons has exactly one flame, and a personal best
 * needs a second one that reads as *more fire* beside the first. Colour was the
 * alternative and there is nowhere to go — orange already means "streak" here,
 * and the app's other warm colour is red, which it spends on out-of-stock and
 * expired windows. A tinted pill behind the glyph was tried first and read as a
 * badge stuck on the row rather than as the flame itself burning harder.
 *
 * Sized on the same 24-unit grid `PinIcon` uses, so it scales with `iconSize`
 * like the Ionicons beside it, and the outline keeps that file's 1.8 stroke:
 * heavier closes up the notch between the peaks at 12pt, which is the one
 * feature stopping the shape reading as a droplet.
 */
export function FlameIcon({ variant, size, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={variant === 'record' ? FLAME_RECORD : FLAME}
        fill={variant === 'none' ? 'none' : color}
        stroke={variant === 'none' ? color : 'none'}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
