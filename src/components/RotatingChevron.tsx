import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useReduceMotion } from '../utils/useReduceMotion';

/** animateLayout's own duration and curve, so the arrow turns with the content it opens. */
const TURN_MS = 220;

interface Props {
  open: boolean;
  /**
   * Which way it points while closed. `down` turns to point up when open (a
   * field that unfolds below), `forward` turns to point down (a section that
   * opens under its header).
   */
  closed?: 'down' | 'forward';
  size: number;
  color: string;
}

/**
 * A disclosure chevron that turns as its section opens and closes, instead
 * of being swapped for a different glyph in one frame while the content
 * beside it eases open. Used by EditorRow, CollapsibleField and a stack's
 * header. Reduce Motion, and the state it mounts in, draw the settled angle.
 */
export function RotatingChevron({ open, closed = 'down', size, color }: Props) {
  const reduceMotion = useReduceMotion();
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    turn.stopAnimation();
    if (reduceMotion) {
      turn.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: TURN_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [open, reduceMotion, turn]);

  const rotate = turn.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', closed === 'down' ? '180deg' : '90deg'],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name={closed === 'down' ? 'chevron-down' : 'chevron-forward'} size={size} color={color} />
    </Animated.View>
  );
}
