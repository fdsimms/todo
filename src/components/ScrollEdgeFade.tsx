import React, { useMemo, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SCROLL_FADE_HEIGHT } from '../utils/scrollFade';
import { generateId } from '../utils/id';

interface Props {
  /** Which edge of the scrolling region the band sits against. */
  edge: 'top' | 'bottom';
  /**
   * How opaque the band is right now — drive it with `useScrollEdgeFade`,
   * which ramps it to zero as the list reaches that end.
   */
  opacity: Animated.Value | Animated.AnimatedInterpolation<number>;
  /**
   * Solid colour of the surface *behind* the list, which is what the content
   * dissolves into. A translucent one can't be used: the band is drawn as a
   * gradient in this colour from zero alpha to `maxOpacity`, so the alpha has
   * to be the gradient's to give.
   */
  color: string;
  /** Height of the band. Defaults to `SCROLL_FADE_HEIGHT`. */
  height?: number;
  /**
   * Alpha the band reaches at the edge itself. Left under 1 where the surface
   * behind the list is itself translucent — a drawer or sheet over a blur —
   * so the band settles into `colors.blurFallback` rather than punching an
   * opaque strip through the frosting.
   */
  maxOpacity?: number;
  /**
   * Layout on top of the edge anchoring — an offset for chrome that overlaps
   * the list's own bounds, say.
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * The band that says a scrolling region continues past its own edge.
 *
 * Reach for it whenever a list is bounded by chrome rather than by the screen:
 * a pinned footer, a sheet's bottom edge, a card with a `maxHeight`. Those all
 * end at a hard line whether or not there is more below it, and the app hides
 * the scroll indicator nearly everywhere, so a region two thirds full looks
 * exactly like a full one — which is how the side menu shipped with five rows
 * nobody could tell were there.
 *
 * Pair it with `useScrollEdgeFade`, spread that hook's `scrollProps` onto the
 * list, and render the band as a **sibling after** the list inside a
 * `position: relative` wrapper. It is `pointerEvents="none"`, so the rows
 * under it stay tappable — which is the whole reason it is a fade and not a
 * spacer.
 *
 * Drawn with `react-native-svg` (already in the tree for `PinIcon`) because a
 * real gradient is the only honest way to do this over a blurred surface: a
 * stack of stepped translucent views bands visibly against the frosting, and
 * a single flat scrim reads as a shadow rather than as content running out.
 */
export function ScrollEdgeFade({ edge, opacity, color, height = SCROLL_FADE_HEIGHT, maxOpacity = 1, style }: Props) {
  // Gradient ids are resolved per `Svg` root, but two roots sharing an id
  // have historically leaked into each other — and several of these render at
  // once on a screen. One id per instance costs nothing and can't collide.
  const gradientId = useRef(`scroll-fade-${generateId()}`).current;
  // Bottom band: transparent at its top, solid where it meets the edge. Top
  // band: the same gradient stood on its head.
  const [y1, y2] = edge === 'bottom' ? ['0', '1'] : ['1', '0'];
  const anchor = useMemo<ViewStyle>(
    () => (edge === 'bottom' ? { bottom: 0 } : { top: 0 }),
    [edge],
  );

  return (
    <Animated.View pointerEvents="none" style={[styles.band, anchor, { height, opacity }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1={y1} x2="0" y2={y2}>
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="1" stopColor={color} stopOpacity={maxOpacity} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
