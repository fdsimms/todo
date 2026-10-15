import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, useWindowDimensions } from 'react-native';
import { animation } from '../theme';
import { haptics } from '../utils/haptics';

// How far (points) or how fast (points/ms) a drag has to go to count as a
// dismissal rather than a nudge that springs back.
const DISTANCE = 70;
const VELOCITY = 0.5;
// A drag has to be this far along its axis before the bar claims it, so a tap
// on a button inside never turns into a drag.
const SLOP = 8;

/**
 * Lets a floating banner (undo bar, "Created X" toast, ready offer) be swiped
 * away by hand: sideways in either direction, or down toward the tab bar.
 *
 * Wraps the bar's visible card, inside the absolutely positioned `wrap` the
 * banner already has, so the banner keeps its own placement. `onDismiss` is
 * the banner's existing way of going away (the same one its timer calls), so
 * a swipe clears whatever timer or store flag the banner already owns and
 * nothing here has to know what that is. A drag that doesn't go far enough
 * springs back and the banner's timer carries on as before.
 */
export function SwipeDismiss({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  // The responder is built once, so it reads the latest props through refs.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const widthRef = useRef(width);
  widthRef.current = width;

  const responder = useMemo(() => {
    const springBack = () => {
      Animated.parallel([
        Animated.spring(x, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }),
        Animated.spring(y, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }),
      ]).start();
    };
    const flingOff = (toX: number, toY: number) => {
      haptics.tap();
      Animated.parallel([
        Animated.timing(x, { toValue: toX, duration: animation.duration.fast, useNativeDriver: true }),
        Animated.timing(y, { toValue: toY, duration: animation.duration.fast, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
      ]).start(() => onDismissRef.current());
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > SLOP || g.dy > SLOP,
      onPanResponderMove: (_, g) => {
        x.setValue(g.dx);
        // Down only: a bar dragged upward would slide into the content above.
        y.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_, g) => {
        const sideways = Math.abs(g.dx) >= Math.abs(g.dy);
        if (sideways && (Math.abs(g.dx) > DISTANCE || Math.abs(g.vx) > VELOCITY)) {
          flingOff(g.dx > 0 ? widthRef.current : -widthRef.current, 0);
        } else if (!sideways && (g.dy > DISTANCE / 2 || g.vy > VELOCITY)) {
          flingOff(0, 120);
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: springBack,
    });
  }, [x, y, opacity]);

  return (
    <Animated.View
      {...responder.panHandlers}
      style={{ opacity, transform: [{ translateX: x }, { translateY: y }] }}
    >
      {children}
    </Animated.View>
  );
}
