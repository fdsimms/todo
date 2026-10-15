import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { animation } from '../theme';

/** How long the strike takes to cross the title, left to right. */
const SWEEP_MS = 220;

interface Props {
  /** The title reads as done. */
  struck: boolean;
  /** Play the change. False draws the settled state at once (Reduce Motion, a row swapping to its next step). */
  animate: boolean;
  /** The title as it normally reads. Faded out under the struck copy. */
  children: React.ReactNode;
  /**
   * The same title drawn done: dimmed and struck through. It has to lay out
   * exactly as `children` does (same component, same text, same props), since
   * it's drawn over it glyph for glyph.
   */
  struckCopy: React.ReactNode;
}

/**
 * A title that gets struck through when its task is done, the strike crossing
 * it left to right while the plain title fades out underneath.
 *
 * There is no way to animate `textDecorationLine` itself, so this draws a
 * second copy of the title already struck and dimmed, over the first, and
 * reveals it through a window that slides in from the left. The window and
 * the copy inside it move in opposite directions by the same amount (the
 * copy stays put on screen while its clip grows), which keeps both on the
 * native driver: a clip that grew by animating `width` would run on JS.
 *
 * The copy is laid out at the measured width of the original plus a point,
 * so it breaks lines where the original did. A narrower box couldn't break
 * any earlier (every original line fits in it) and the extra point is too
 * little for another word to fit, so rounding can't move a word between
 * lines. Until that width is known the copy is invisible, so it never paints
 * a frame laid out wrong.
 */
export function StrikeReveal({ struck, animate, children, struckCopy }: Props) {
  const reveal = useRef(new Animated.Value(struck ? 1 : 0)).current;
  // Mounted while struck, and for as long as the strike takes to leave again.
  const [shown, setShown] = useState(struck);
  const [width, setWidth] = useState(0);
  // A sweep asked for before the copy had a width to sweep across.
  const pendingSweep = useRef(false);

  const sweepIn = () => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: SWEEP_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    if (struck) {
      setShown(true);
      if (!animate) {
        reveal.stopAnimation();
        reveal.setValue(1);
        pendingSweep.current = false;
      } else if (width > 0) {
        sweepIn();
      } else {
        pendingSweep.current = true;
      }
      return;
    }
    pendingSweep.current = false;
    if (!animate) {
      reveal.stopAnimation();
      reveal.setValue(0);
      setShown(false);
      return;
    }
    Animated.timing(reveal, {
      toValue: 0,
      duration: animation.duration.fast,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShown(false);
    });
    // Keyed on the flip alone: `animate` is read at the moment it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [struck]);

  // The first sweep waits for this render: the interpolations below only
  // know the width once state has it.
  useEffect(() => {
    if (width > 0 && pendingSweep.current) {
      pendingSweep.current = false;
      sweepIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent?.layout?.width;
    if (w && Math.abs(w - width) > 0.5) setWidth(w);
  };

  const plainOpacity = reveal.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const windowX = reveal.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });
  const copyX = reveal.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });

  return (
    <View>
      <Animated.View style={{ opacity: plainOpacity }}>{children}</Animated.View>
      {shown && (
        <View
          pointerEvents="none"
          // The title is read once, from the original underneath.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, styles.clip, width === 0 && styles.unmeasured]}
          onLayout={onLayout}
        >
          <Animated.View style={[styles.window, { transform: [{ translateX: windowX }] }]}>
            <Animated.View style={{ width: width + 1, transform: [{ translateX: copyX }] }}>
              {struckCopy}
            </Animated.View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  window: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  unmeasured: { opacity: 0 },
});
