import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { animation } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

/** How far a small box swells when it's checked. A task's 20pt circle uses 1.35. */
export const CHECK_POP_SCALE = 1.25;

/** Where the checkmark's entrance starts; it fades through the rest. */
const MARK_START_SCALE = 0.8;

interface Props {
  checked: boolean;
  /** The box, unchecked. */
  style: StyleProp<ViewStyle>;
  /** Added while checked: the filled look. */
  checkedStyle?: StyleProp<ViewStyle>;
  /** The mark drawn while checked, usually an Ionicons checkmark. */
  children: React.ReactNode;
  /** A static look for the mark, e.g. the same dimming `checkedStyle` gives the box. */
  markStyle?: StyleProp<ViewStyle>;
  popScale?: number;
}

/**
 * A small checkbox that answers a check the way a task's own circle does:
 * the box pops and the checkmark springs in, rather than both arriving in one
 * frame. For the boxes that aren't TaskItem's circle (a subtask, a grocery
 * row), so every check in the app feels like the same control.
 *
 * The mark is a sibling of the box, laid over it, not a child: a native scale
 * on an ancestor resamples a glyph's bitmap instead of redrawing it, which is
 * what made TaskItem's tick look jagged mid-pop (#1024). Out here only the
 * mark's own transform touches it, and that never exceeds 1.
 *
 * Only a change seen while mounted animates. A row that mounts checked draws
 * the settled state, and Reduce Motion keeps the fade and drops the pop.
 */
export function CheckPop({ checked, style, checkedStyle, children, markStyle, popScale = CHECK_POP_SCALE }: Props) {
  const reduceMotion = useReduceMotion();
  const boxScale = useRef(new Animated.Value(1)).current;
  const mark = useRef(new Animated.Value(checked ? 1 : 0)).current;
  // Mounted while checked, and for as long as an uncheck takes to fade it out.
  const [markShown, setMarkShown] = useState(checked);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    mark.stopAnimation();
    if (checked) {
      setMarkShown(true);
      mark.setValue(0);
      if (reduceMotion) {
        Animated.timing(mark, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }).start();
        return;
      }
      Animated.spring(mark, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: true }).start();
      boxScale.setValue(1);
      Animated.sequence([
        Animated.spring(boxScale, { toValue: popScale, ...animation.spring.snappy, useNativeDriver: true }),
        Animated.spring(boxScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
      ]).start();
      return;
    }
    Animated.timing(mark, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMarkShown(false);
    });
    // Keyed on the flip alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  // Clamped: the bouncy spring overshoots, and a glyph past 1 is a blown-up bitmap.
  const markOpacity = mark.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const markScale = mark.interpolate({ inputRange: [0, 1], outputRange: [MARK_START_SCALE, 1], extrapolate: 'clamp' });

  return (
    <View>
      <Animated.View style={[style, checked && checkedStyle, { transform: [{ scale: boxScale }] }]} />
      {markShown && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.markLayer,
            { opacity: markOpacity, transform: reduceMotion ? [] : [{ scale: markScale }] },
          ]}
        >
          {markStyle ? <View style={markStyle}>{children}</View> : children}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  markLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
