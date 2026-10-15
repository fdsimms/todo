import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { animation, spacing } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const KNOB = 22;
const INSET = spacing.xxs;
/** How far the knob travels from off to on. */
const TRAVEL = TRACK_WIDTH - INSET * 2 - KNOB;

interface Props {
  value: boolean;
  /** The track's colour when on. Defaults to the accent; vacation and a few rules use orange. */
  onColor?: string;
  /**
   * `settings` is the Settings rows' switch (and the Today options menu's):
   * a lighter track with a grey knob that turns white on the filled track.
   * `plain`, every editor's, has a page-coloured knob on a deeper track.
   */
  look?: 'plain' | 'settings';
  style?: StyleProp<ViewStyle>;
}

/**
 * The on/off switch drawn in a row whose whole surface is the button: the
 * editors' toggles and every Settings switch. Only the drawing lives here;
 * the press, its haptic and the `switch` role stay on the row, which is what
 * a person actually taps.
 *
 * It replaces seventeen hand-drawn copies that moved the knob with
 * `alignSelf`, so it jumped and the track changed colour in the same frame.
 * The knob slides on the snappy spring and the colours ease over 150ms. The
 * colours run on JS and the slide on the native driver, so each sits on its
 * own view: a JS-driven colour on a node with a native transform throws.
 *
 * Reduce Motion, and a value it mounts with, draw the settled state.
 */
export function Toggle({ value, onColor, look = 'plain', style }: Props) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  const tint = useRef(new Animated.Value(value ? 1 : 0)).current;
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const to = value ? 1 : 0;
    position.stopAnimation();
    tint.stopAnimation();
    if (reduceMotion) {
      position.setValue(to);
      tint.setValue(to);
      return;
    }
    Animated.spring(position, { toValue: to, ...animation.spring.snappy, useNativeDriver: true }).start();
    Animated.timing(tint, { toValue: to, duration: animation.duration.fast, useNativeDriver: false }).start();
  }, [value, reduceMotion, position, tint]);

  const settings = look === 'settings';
  const trackOff = settings ? colors.bgTertiary : colors.bgQuaternary;
  const trackOn = onColor ?? colors.accent;
  const knobOff = settings ? colors.textSecondary : colors.bg;
  const knobOn = settings ? colors.onAccent : colors.bg;

  const trackColor = tint.interpolate({ inputRange: [0, 1], outputRange: [trackOff, trackOn] });
  const knobColor = tint.interpolate({ inputRange: [0, 1], outputRange: [knobOff, knobOn] });
  const knobX = position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] });

  return (
    <Animated.View style={[styles.track, { backgroundColor: trackColor }, style]}>
      <Animated.View style={[styles.knob, { transform: [{ translateX: knobX }] }]}>
        <Animated.View style={[styles.knobFace, { backgroundColor: knobColor }]} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: INSET,
    justifyContent: 'center',
  },
  knob: {
    width: KNOB,
    height: KNOB,
  },
  knobFace: {
    flex: 1,
    borderRadius: KNOB / 2,
  },
});
