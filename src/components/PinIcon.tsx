import React from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

interface Props {
  /** Pinned state — filled thumbtack when true, outline when false. */
  filled: boolean;
  size: number;
  color: string;
}

/**
 * The pin glyph, everywhere pinning is shown or toggled: the task row's
 * expanded actions, the bulk bar, the editor's Pin row, the category header's
 * pin-all, and the Pinned Tasks section header.
 *
 * The one place the app reaches outside Ionicons, and deliberately: Ionicons'
 * `pin` is a *map* pin — a thin needle with a round head — which reads as a
 * location, not as "hold this at the top", and at iconSize.sm it's visibly
 * lighter than the icons beside it. MaterialCommunityIcons has an actual
 * thumbtack with a matching outline variant, so the on/off pair carries the
 * state on its own. Everything else stays on Ionicons; don't fold this back
 * in "for consistency" without looking at the two glyphs side by side first.
 *
 * It costs nothing in the bundle: @expo/vector-icons exports every family's
 * .ttf as an asset whether or not it's imported, so MaterialCommunityIcons was
 * already shipping (verified — `expo export` produces the same 45 assets with
 * and without this file). The only cost is the font being loaded at runtime
 * the first time a pin renders.
 */
export function PinIcon({ filled, size, color }: Props) {
  return (
    <MaterialCommunityIcons
      name={filled ? 'pin' : 'pin-outline'}
      size={size}
      color={color}
    />
  );
}
