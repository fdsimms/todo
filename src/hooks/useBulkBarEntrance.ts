import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { animation } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

/**
 * Rise-and-fade entrance shared by every floating bulk-action bar
 * (BulkActionBar, SimpleBulkBar, ListBulkBar, TemplateItemBulkBar). Each one
 * mounts fresh the moment selection starts and unmounts when it ends
 * (`{selectionMode && <Bar />}` at the call site), so a mount-time animation
 * is the whole entrance — there's no exit to animate, and no shared state to
 * coordinate beyond the spring itself.
 *
 * Returns an animated style to spread onto the bar's outer `Animated.View`
 * alongside its own `container` style.
 */
export function useBulkBarEntrance() {
  const reduceMotion = useReduceMotion();
  const entrance = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    Animated.spring(entrance, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }).start();
  }, [entrance, reduceMotion]);

  return {
    opacity: entrance,
    transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };
}
