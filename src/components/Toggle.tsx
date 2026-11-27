import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
 * One native spring moves the knob and cross-fades the colours (an on-coloured
 * layer fading in over the off-coloured one, since `backgroundColor` can't run
 * on the native driver), so nothing waits on the JS thread.
 *
 * Reduce Motion, and a value it mounts with, draw the settled state.
 */
export function Toggle({ value, onColor, look = 'plain', style }: Props) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  // One value drives the knob and both colours, so they cannot disagree about
  // which state the switch is in. They used to be two (a native spring for the
  // knob, a JS timing for the colours) and a stalled or interrupted colour
  // animation left the knob on "on" with the "off" track still showing.
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const to = value ? 1 : 0;
    progress.stopAnimation();
    if (reduceMotion) {
      progress.setValue(to);
      return;
    }
    Animated.spring(progress, { toValue: to, ...animation.spring.snappy, useNativeDriver: true }).start(({ finished }) => {
      // A spring that was cut off by anything but the next change to `value`
      // must not leave the switch between states.
      if (!finished) progress.setValue(to);
    });
  }, [value, reduceMotion, progress]);

  const settings = look === 'settings';
  const trackOff = settings ? colors.bgTertiary : colors.bgQuaternary;
  const trackOn = onColor ?? colors.accent;
  const knobOff = settings ? colors.textSecondary : colors.bg;
  const knobOn = settings ? colors.onAccent : colors.bg;

  // The spring may overshoot 1; a colour layer's opacity must not.
  const fade = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const knobX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] });

  return (
    <View style={[styles.track, { backgroundColor: trackOff }, style]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: trackOn, opacity: fade }]} />
      <Animated.View style={[styles.knob, { transform: [{ translateX: knobX }] }]}>
        <View style={[styles.knobFace, { backgroundColor: knobOff }]} />
        {knobOn !== knobOff && (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.knobFace, { backgroundColor: knobOn, opacity: fade }]} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: INSET,
    justifyContent: 'center',
    overflow: 'hidden',
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
