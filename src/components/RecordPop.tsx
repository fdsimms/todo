import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { animation, radius } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

interface Props {
  /** True for the set that just earned a record. The moment plays when this turns true, or on mount while true. */
  celebrate: boolean;
  children: React.ReactNode;
}

/** How far the ring spreads past the badge before it has faded out. */
const RING_SCALE = 2.1;
/** The trophy starts this small and springs past 1 on its way in. */
const START_SCALE = 0.3;

/**
 * Wraps a record badge so a set that has just set a record arrives with a
 * moment rather than appearing like any other chip: the badge springs in
 * from small with a little tilt, and a ring spreads out from it and fades.
 * The haptic is not here: workout mode's tick already buzzes success.
 *
 * Only `celebrate` animates. A badge on a set that was already a record when
 * the sheet opened is drawn at rest, and Reduce Motion drops the pop and the
 * ring and keeps a short fade.
 *
 * JS-driven on purpose: the badge mounts in the same render that makes room
 * for it in the row, and a native-driven entrance can start before that
 * layout is on screen and jump a frame later (`ui-sheets-and-lists.md`).
 */
export function RecordPop({ celebrate, children }: Props) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const pop = useRef(new Animated.Value(celebrate ? 0 : 1)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const playedRef = useRef(false);

  useEffect(() => {
    if (!celebrate) {
      playedRef.current = false;
      pop.setValue(1);
      ring.setValue(0);
      return;
    }
    if (playedRef.current) return;
    playedRef.current = true;
    pop.setValue(0);
    ring.setValue(0);
    if (reduceMotion) {
      Animated.timing(pop, { toValue: 1, duration: animation.duration.fast, useNativeDriver: false }).start();
      return;
    }
    Animated.spring(pop, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: false }).start();
    Animated.timing(ring, { toValue: 1, duration: 650, useNativeDriver: false }).start();
    // Keyed on the flip alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebrate]);

  const scale = reduceMotion ? 1 : pop.interpolate({ inputRange: [0, 1], outputRange: [START_SCALE, 1] });
  const tilt = reduceMotion
    ? '0deg'
    : pop.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-25deg', '10deg', '0deg'], extrapolate: 'clamp' });
  const opacity = pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, RING_SCALE] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0], extrapolate: 'clamp' });

  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[styles.ring, { borderColor: colors.accent, opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
      />
      <Animated.View style={{ opacity, transform: [{ scale }, { rotate: tilt }] }}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderRadius: radius.full,
  },
});
