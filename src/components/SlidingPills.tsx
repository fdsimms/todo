import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type TextStyle } from 'react-native';
import Reanimated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { animation } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

/**
 * A row of separate pills whose highlight slides from one to the next, rather
 * than one pill restyling itself in a frame. Today's view switcher and the
 * hubs' pill rows use it; `SegmentedControl` is the same idea for a track.
 *
 * Separate pills need more than one sliding shape behind them: each pill's
 * own grey background would hide a highlight passing behind it. So once the
 * pills are measured the row is drawn in three layers: grey capsules at each
 * pill's frame, the accent capsule sliding over them, and the pills on top
 * with no background of their own, their labels taking the accent's text
 * colour as it passes under them. Until then each pill draws itself as it
 * always did, so nothing depends on a layout having happened.
 *
 * It runs on Reanimated rather than Animated because the pills differ in
 * width and a width can't animate on Animated's native driver. Today's switch
 * renders a whole new list as it happens, which is exactly when an animation
 * left on the JS thread would stutter.
 */
export interface PillFrame { x: number; y: number; width: number; height: number }

export interface PillHighlight {
  /** Measured and placed: draw the layers, and pills without backgrounds. */
  ready: boolean;
  frames: ReadonlyMap<string, PillFrame>;
  x: SharedValue<number>;
  y: SharedValue<number>;
  width: SharedValue<number>;
  height: SharedValue<number>;
  onPillLayout: (key: string) => (e: LayoutChangeEvent) => void;
  /** Puts the highlight on `from` at once and slides it to the active pill. */
  slideFrom: (from: string) => void;
}

export function usePillHighlight(activeKey: string): PillHighlight {
  const reduceMotion = useReduceMotion();
  const frames = useRef(new Map<string, PillFrame>()).current;
  const [, setMeasured] = useState(0);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const placed = useRef(false);
  const pendingFrom = useRef<string | null>(null);
  const activeRef = useRef(activeKey);
  activeRef.current = activeKey;

  const jumpTo = (f: PillFrame) => {
    x.value = f.x;
    y.value = f.y;
    width.value = f.width;
    height.value = f.height;
    placed.current = true;
  };
  const slideTo = (f: PillFrame) => {
    if (!placed.current || reduceMotion) {
      jumpTo(f);
      return;
    }
    x.value = withSpring(f.x, animation.spring.snappy);
    y.value = withSpring(f.y, animation.spring.snappy);
    width.value = withSpring(f.width, animation.spring.snappy);
    height.value = withSpring(f.height, animation.spring.snappy);
  };
  // Anything waiting on a frame: a first placement, or a hand-over from
  // another screen's row (slideFrom) whose pills weren't measured yet.
  const settle = () => {
    const target = frames.get(activeRef.current);
    if (!target) return;
    if (pendingFrom.current !== null) {
      const from = frames.get(pendingFrom.current);
      if (!from) return;
      pendingFrom.current = null;
      jumpTo(from);
      slideTo(target);
      return;
    }
    if (!placed.current) jumpTo(target);
  };

  useEffect(() => {
    const target = frames.get(activeKey);
    if (target && pendingFrom.current === null) slideTo(target);
    // Only a change of pill slides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const onPillLayout = (key: string) => (e: LayoutChangeEvent) => {
    const l = e.nativeEvent?.layout;
    if (!l) return;
    const prev = frames.get(key);
    if (prev && prev.x === l.x && prev.y === l.y && prev.width === l.width && prev.height === l.height) return;
    const frame = { x: l.x, y: l.y, width: l.width, height: l.height };
    frames.set(key, frame);
    // The chosen pill changed shape (its label turns semibold, a badge
    // arrived): follow it rather than snapping, so an in-flight slide retargets.
    if (placed.current && key === activeRef.current && pendingFrom.current === null) slideTo(frame);
    settle();
    setMeasured(n => n + 1);
  };

  const slideFrom = (from: string) => {
    if (from === activeRef.current || reduceMotion) return;
    pendingFrom.current = from;
    settle();
  };

  return {
    ready: placed.current && frames.has(activeKey),
    frames,
    x,
    y,
    width,
    height,
    onPillLayout,
    slideFrom,
  };
}

/**
 * The bottom two layers: the resting capsules and the sliding highlight.
 * Rendered first inside the row's content container, so the pills sit on top.
 */
export function PillHighlightLayer({ highlight, keys, restColor, activeColor, radius }: {
  highlight: PillHighlight;
  keys: readonly string[];
  restColor: string;
  activeColor: string;
  radius: number;
}) {
  const { x, y, width, height } = highlight;
  const sliding = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
    width: width.value,
    height: height.value,
  }));
  if (!highlight.ready) return null;
  return (
    <>
      {keys.map(key => {
        const f = highlight.frames.get(key);
        if (!f) return null;
        return (
          <View
            key={key}
            pointerEvents="none"
            style={[styles.capsule, { left: f.x, top: f.y, width: f.width, height: f.height, borderRadius: radius, backgroundColor: restColor }]}
          />
        );
      })}
      <Reanimated.View
        pointerEvents="none"
        style={[styles.capsule, { left: 0, top: 0, borderRadius: radius, backgroundColor: activeColor }, sliding]}
      />
    </>
  );
}

/**
 * A pill's label, taking the highlight's text colour as the highlight passes
 * under it: fully over its own pill it's `activeColor`, a pill's width away
 * it's `restColor`. Before the row is ready, `style` alone decides.
 */
export function PillLabel({ highlight, pillKey, style, restColor, activeColor, children }: {
  highlight: PillHighlight;
  pillKey: string;
  style: StyleProp<TextStyle>;
  restColor: string;
  activeColor: string;
  children: React.ReactNode;
}) {
  const frame = highlight.frames.get(pillKey);
  const fx = frame?.x ?? 0;
  const fw = Math.max(1, frame?.width ?? 1);
  const { x } = highlight;
  const tinted = useAnimatedStyle(() => {
    const t = Math.max(0, 1 - Math.abs(x.value - fx) / fw);
    return { color: interpolateColor(t, [0, 1], [restColor, activeColor]) };
  });
  return (
    <Reanimated.Text style={[style, highlight.ready && frame ? tinted : null]}>
      {children}
    </Reanimated.Text>
  );
}

const styles = StyleSheet.create({
  capsule: { position: 'absolute' },
});
