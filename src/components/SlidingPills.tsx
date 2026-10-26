import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type TextStyle } from 'react-native';
import { animation } from '../theme';
import { AnimatedText } from '../theme/AppFont';
import { useReduceMotion } from '../utils/useReduceMotion';

/**
 * A row of separate pills whose highlight slides from one to the next, rather
 * than one pill restyling itself in a frame. Today's view switcher uses it;
 * `SegmentedControl` is the same idea for a track.
 *
 * Separate pills need more than one sliding shape behind them: each pill's
 * own grey background would hide a highlight passing behind it. So once the
 * pills are measured the row is drawn in three layers: grey capsules at each
 * pill's frame, the accent capsule sliding over them, and the pills on top
 * with no background of their own, their labels crossfading to the accent's
 * text colour as it passes under them. Until then each pill draws itself as it
 * always did, so nothing depends on a layout having happened.
 *
 * **Everything that moves is a transform or an opacity on Animated's native
 * driver, and that is the whole design.** The pills differ in width, and the
 * first version animated `width` (and the label's `color`) in Reanimated.
 * Those are props only a shadow-tree commit can apply, and Reanimated pauses
 * its commits while React is committing, which is exactly what the tap
 * starts: Today mounts a whole new list as it switches. The slide dropped
 * frames for as long as that render ran. The native driver writes transforms
 * and opacity straight to the views on the UI thread, so a busy JS thread or a
 * long commit can't touch it. Hence the capsule is drawn in three pieces (two
 * round caps that translate and a middle that translates and scales, so the
 * ends never stretch), and each label is drawn twice and crossfaded rather
 * than recoloured.
 *
 * The labels also keep one width whatever is chosen (the semibold copy is the
 * one in the layout), so choosing a pill no longer nudges every pill after it
 * mid-slide.
 */
export interface PillFrame { x: number; y: number; width: number; height: number }

export interface PillHighlight {
  /** Measured and placed: draw the layers, and pills without backgrounds. */
  ready: boolean;
  frames: ReadonlyMap<string, PillFrame>;
  /** The highlight's left and right edges, in the row's content coordinates. */
  left: Animated.Value;
  right: Animated.Value;
  onPillLayout: (key: string) => (e: LayoutChangeEvent) => void;
  /** The pill the highlight is aimed at. */
  activeKey: string;
}

export function usePillHighlight(activeKey: string): PillHighlight {
  const reduceMotion = useReduceMotion();
  const frames = useRef(new Map<string, PillFrame>()).current;
  const [, setMeasured] = useState(0);
  const left = useRef(new Animated.Value(0)).current;
  const right = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  const activeRef = useRef(activeKey);
  activeRef.current = activeKey;

  const jumpTo = (f: PillFrame) => {
    left.stopAnimation();
    right.stopAnimation();
    left.setValue(f.x);
    right.setValue(f.x + f.width);
    placed.current = true;
  };
  const slideTo = (f: PillFrame) => {
    if (!placed.current || reduceMotion) {
      jumpTo(f);
      return;
    }
    // A new spring on the same value replaces one still running, so a second
    // tap mid-slide retargets from wherever the highlight is.
    Animated.parallel([
      Animated.spring(left, { toValue: f.x, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.spring(right, { toValue: f.x + f.width, ...animation.spring.snappy, useNativeDriver: true }),
    ]).start();
  };

  useEffect(() => {
    const target = frames.get(activeKey);
    if (target) slideTo(target);
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
    // The chosen pill moved or changed size (a larger text size): follow it.
    if (key === activeRef.current) slideTo(frame);
    setMeasured(n => n + 1);
  };

  return {
    ready: placed.current && frames.has(activeKey),
    frames,
    left,
    right,
    onPillLayout,
    activeKey,
  };
}

/** The middle piece's drawn width, scaled to whatever the gap between the caps is. */
const MIDDLE_BASE = 100;

/**
 * The bottom two layers: the resting capsules and the sliding highlight.
 * Rendered first inside the row's content container, so the pills sit on top.
 */
export function PillHighlightLayer({ highlight, keys, restColor, activeColor }: {
  highlight: PillHighlight;
  keys: readonly string[];
  restColor: string;
  activeColor: string;
}) {
  const { left, right } = highlight;
  // The row is one line, so every pill shares the active one's top and height,
  // and the caps are circles of that height.
  const base = highlight.frames.get(highlight.activeKey) ?? { x: 0, y: 0, width: 0, height: 0 };
  const h = base.height;
  const motion = useMemo(() => ({
    rightCap: Animated.subtract(right, h),
    // The middle runs from one cap's centre to the other's, inside both circles,
    // so no seam shows where the pieces meet.
    middleCentre: Animated.add(Animated.multiply(Animated.add(left, right), 0.5), -MIDDLE_BASE / 2),
    middleScale: Animated.multiply(Animated.subtract(Animated.subtract(right, left), h), 1 / MIDDLE_BASE),
  }), [left, right, h]);
  if (!highlight.ready) return null;
  const piece = { top: base.y, height: h, backgroundColor: activeColor };
  return (
    <>
      {keys.map(key => {
        const f = highlight.frames.get(key);
        if (!f) return null;
        return (
          <View
            key={key}
            pointerEvents="none"
            style={[styles.piece, { left: f.x, top: f.y, width: f.width, height: f.height, borderRadius: f.height / 2, backgroundColor: restColor }]}
          />
        );
      })}
      <Animated.View
        pointerEvents="none"
        style={[styles.piece, piece, { width: h, borderRadius: h / 2, transform: [{ translateX: left }] }]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.piece, piece, { width: h, borderRadius: h / 2, transform: [{ translateX: motion.rightCap }] }]}
      />
      {/* Translate and scale on separate views, so the order the two compose
          in can't be got wrong. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.piece, { top: base.y, height: h, width: MIDDLE_BASE, transform: [{ translateX: motion.middleCentre }] }]}
      >
        <Animated.View style={[styles.middle, { backgroundColor: activeColor, transform: [{ scaleX: motion.middleScale }] }]} />
      </Animated.View>
    </>
  );
}

/**
 * A pill's label, crossfading to `activeStyle` as the highlight passes under
 * it: fully over its own pill it's the active copy, a pill's width away the
 * resting one. Before the row is ready, `active` alone decides.
 *
 * The active copy is the one in the layout and the resting one is laid over
 * it, so the pill is as wide chosen as not.
 */
export function PillLabel({ highlight, pillKey, active, style, activeStyle, children }: {
  highlight: PillHighlight;
  pillKey: string;
  active: boolean;
  style: StyleProp<TextStyle>;
  activeStyle: StyleProp<TextStyle>;
  children: React.ReactNode;
}) {
  const frame = highlight.frames.get(pillKey);
  const fx = frame?.x ?? 0;
  const fw = Math.max(1, frame?.width ?? 1);
  const { left } = highlight;
  const opacity = useMemo(() => {
    const range = { inputRange: [fx - fw, fx, fx + fw], extrapolate: 'clamp' as const };
    return {
      active: left.interpolate({ ...range, outputRange: [0, 1, 0] }),
      rest: left.interpolate({ ...range, outputRange: [1, 0, 1] }),
    };
  }, [left, fx, fw]);
  const tracking = highlight.ready && !!frame;
  return (
    <View>
      <AnimatedText style={[style, activeStyle, { opacity: tracking ? opacity.active : active ? 1 : 0 }]}>
        {children}
      </AnimatedText>
      <AnimatedText
        style={[style, styles.restLabel, { opacity: tracking ? opacity.rest : active ? 0 : 1 }]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {children}
      </AnimatedText>
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', left: 0 },
  middle: { flex: 1 },
  restLabel: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
});
