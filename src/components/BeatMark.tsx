import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '../theme/ThemeContext';
import { animation } from '../theme';
import { BEAT_STEP_MS, beatMarkGeometry } from '../utils/beatMark';

/**
 * The brand mark drawn in the app: two dots and a check on a gold tile, the
 * same construction as the app icon (`beatMarkGeometry`).
 *
 * With `play`, it arrives as the beat: the first dot, the second, then the
 * check, `BEAT_STEP_MS` apart, the tile giving a small thump on the third. The
 * haptic and the sound that go with it are the caller's (`AllClearMark`); this
 * only draws. Without `play` it sits at rest, and switching `play` off mid-way
 * (Reduce Motion resolving after the first render) snaps it to rest.
 *
 * Each part is its own layer the size of the whole mark, scaled about its own
 * centre with `transformOrigin`, because react-native-svg shapes can't take a
 * Reanimated style themselves. And the animated styles are attached on every
 * render, never conditionally, for the reason `EmptyState` gives.
 */

const GEOMETRY = beatMarkGeometry(0.7);
const TILE_RADIUS = 0.224;

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

interface Props {
  size: number;
  play: boolean;
}

export function BeatMark({ size, play }: Props) {
  const colors = useColors();
  const dot1 = useSharedValue(play ? 0 : 1);
  const dot2 = useSharedValue(play ? 0 : 1);
  const check = useSharedValue(play ? 0 : 1);
  const thump = useSharedValue(1);

  useEffect(() => {
    if (!play) {
      dot1.value = 1;
      dot2.value = 1;
      check.value = 1;
      thump.value = 1;
      return;
    }
    dot1.value = withSpring(1, animation.spring.bouncy);
    dot2.value = withDelay(BEAT_STEP_MS, withSpring(1, animation.spring.bouncy));
    check.value = withDelay(BEAT_STEP_MS * 2, withSpring(1, animation.spring.snappy));
    thump.value = withDelay(
      BEAT_STEP_MS * 2,
      withSequence(withTiming(1.06, { duration: 110 }), withSpring(1, animation.spring.smooth)),
    );
  }, [play]);

  const dot1Style = useAnimatedStyle(() => ({ opacity: Math.min(1, dot1.value * 2), transform: [{ scale: dot1.value }] }));
  const dot2Style = useAnimatedStyle(() => ({ opacity: Math.min(1, dot2.value * 2), transform: [{ scale: dot2.value }] }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, check.value * 1.5),
    transform: [{ scale: 0.6 + 0.4 * check.value }],
  }));
  const tileStyle = useAnimatedStyle(() => ({ transform: [{ scale: thump.value }] }));

  const [d1, d2] = GEOMETRY.dots;
  const [s, v, e] = GEOMETRY.check;
  const layer = { width: size, height: size };
  const stroke = GEOMETRY.halfStroke * 2 * size;
  const checkPath = `M${s[0] * size} ${s[1] * size} L${v[0] * size} ${v[1] * size} L${e[0] * size} ${e[1] * size}`;

  return (
    <Reanimated.View style={[layer, tileStyle]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Rect width={size} height={size} rx={size * TILE_RADIUS} fill={colors.brand} />
      </Svg>
      <Reanimated.View style={[styles.layer, layer, { transformOrigin: `${pct(d1.x)} ${pct(d1.y)}` }, dot1Style]}>
        <Svg width={size} height={size}>
          <Circle cx={d1.x * size} cy={d1.y * size} r={d1.r * size} fill={colors.onBrand} />
        </Svg>
      </Reanimated.View>
      <Reanimated.View style={[styles.layer, layer, { transformOrigin: `${pct(d2.x)} ${pct(d2.y)}` }, dot2Style]}>
        <Svg width={size} height={size}>
          <Circle cx={d2.x * size} cy={d2.y * size} r={d2.r * size} fill={colors.onBrand} />
        </Svg>
      </Reanimated.View>
      <Reanimated.View style={[styles.layer, layer, { transformOrigin: `${pct(v[0])} ${pct(v[1])}` }, checkStyle]}>
        <Svg width={size} height={size}>
          <Path
            d={checkPath}
            fill="none"
            stroke={colors.onBrand}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Reanimated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0 },
});
