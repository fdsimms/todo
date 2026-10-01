import React from 'react';
import Svg, { Circle } from 'react-native-svg';

/**
 * The `icon` value that means "draw a `TargetIcon`" in the components that
 * otherwise take an Ionicons name (`ScreenHeader`, `InlineAction`,
 * `SettingsRow`). Not a real Ionicons glyph, which is why it needs naming.
 */
export const TARGET_ICON = 'target' as const;

interface Props {
  size: number;
  color: string;
}

/**
 * A bullseye, for anything that is a target the user sets and is measured
 * against: a weight goal, the daily nutrition targets. It replaced the flag,
 * which already means "priority" and "deadline" elsewhere in the app.
 *
 * Drawn rather than taken from an icon set for the same reason `PinIcon` is:
 * Ionicons has no bullseye (its `locate` is a crosshair, `radio-button-on` is a
 * plain dot in a ring). Two rings and a solid center on the same 24-unit grid,
 * with the 1.8 stroke the pin uses, so it sits at the weight of the Ionicons
 * beside it.
 */
export function TargetIcon({ size, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={1.8} />
      <Circle cx={12} cy={12} r={5} fill="none" stroke={color} strokeWidth={1.8} />
      <Circle cx={12} cy={12} r={1.6} fill={color} />
    </Svg>
  );
}
