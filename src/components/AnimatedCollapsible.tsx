import React, { useEffect, useState } from 'react';
import { View, LayoutChangeEvent, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  interpolate,
  Easing,
  Extrapolation,
} from 'react-native-reanimated';
import { animation } from '../theme';
import { nextMeasuredHeight } from '../utils/measuredHeight';

interface Props {
  expanded: boolean;
  /**
   * Set false to let content draw outside these bounds. Only safe while the
   * section is open and settled — the clip is what makes the collapse a
   * collapse — and that is the one case where it costs nothing, since
   * `maxHeight` then equals the content's own height and clips nothing.
   *
   * It exists for the floating card a drag inside the section lifts (see
   * SortableList): the card leaves these bounds by design when a row is pulled
   * out of the list, and clipped in half at the section's edge it reads as a
   * rendering fault rather than as a gesture.
   */
  clip?: boolean;
  children: React.ReactNode;
}

// A cap so far above any real section that it doesn't clamp anything. Used in
// the two states that must not be clamped: "open but not measured yet" (so it
// renders at the children's natural height instead of at zero), and settled
// open, where the measurement has no more work to do.
const UNMEASURED_MAX = 100000;

/**
 * Animates `children` open/closed on the UI thread — the same technique
 * TaskItem uses for its own detail panel. A plain
 * `LayoutAnimation.configureNext` reflow (the usual RN shortcut for this)
 * reads as an instant snap for content nested inside a
 * FlatList/ReorderableList row rather than a smooth grow/shrink.
 *
 * The clamp is `maxHeight`, not `height`, and the children stay in normal
 * flow. That combination is what makes the measurement optional rather than
 * load-bearing: the wrapper's own height is `min(natural, maxHeight)`, so an
 * unmeasured section falls back to exactly the height its children want, and
 * every state — first paint, mid-animation, settled — is driven by the one
 * animated style that has been attached since the very first render.
 *
 * The measured height only ever narrows the *animation*, never the section at
 * rest: the clamp is released once `progress` reaches 1. Parking it at the
 * measurement instead is what let a settled section be moved by a state value
 * a frame behind the layout — see the note on `maxHeight` below.
 *
 * **Don't reintroduce a conditional style** (`cond && animatedStyle`) to
 * special-case the unmeasured render. Reanimated records a style's initial
 * value only on a component's first render, and attaching/detaching the style
 * later moves the view in and out of its descriptor set — so a wrapper that
 * mounted without the animated style ends up with the animated height as the
 * only thing that can size it, and React's own style contributing nothing.
 * The last value Reanimated committed then sticks: after the first collapse
 * the section stayed pinned at zero and expanding it never brought the rows
 * back.
 *
 * The `restingOpen`/`restingClosed` swap below is not that rule being broken:
 * the animated style stays attached on every render, and what alternates is a
 * plain style sitting after it. See that pair's own note for what it is for.
 */
export function AnimatedCollapsible({ expanded, clip = true, children }: Props) {
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const progress = useSharedValue(expanded ? 1 : 0);
  // Which resting state React itself should commit — see `resting` below. Open
  // only once the animation has actually landed there, so a transition commits
  // the state it is coming *from*.
  const [settledOpen, setSettledOpen] = useState(expanded);

  useEffect(() => {
    // Closing leaves the open resting state at once; opening claims it only
    // when the animation finishes, in the callback below.
    if (!expanded) setSettledOpen(false);
    progress.value = withTiming(
      expanded ? 1 : 0,
      {
        duration: animation.duration.normal,
        easing: Easing.inOut(Easing.cubic),
      },
      // `finished` is false when a re-tap interrupts this, in which case the
      // next run of this effect is what settles the state instead.
      finished => {
        if (finished) runOnJS(setSettledOpen)(expanded);
      },
    );
  }, [expanded]);

  // A zero measurement is treated as no measurement: an empty section has
  // nothing to clamp anyway (its natural height is 0), and falling back to the
  // sentinel keeps a stale zero from being able to hide real content.
  const openHeight = contentHeight || UNMEASURED_MAX;

  const style = useAnimatedStyle(() => ({
    // Settled open, the clamp is released rather than parked at the measured
    // height. `maxHeight === contentHeight` is the same size on screen, but it
    // sizes an open section from a JS state value that trails native layout by
    // a frame — so every later measurement (a row inside expanding, a subtask
    // added, sub-pixel noise) both re-arms this worklet and commits React
    // *during* whatever else is animating in here. Above the sentinel it
    // clamps nothing and none of that can move the section. Still returned as
    // a key, never dropped: Reanimated only applies the keys an updater
    // returns, so a branch that omits maxHeight would leave the last animating
    // value pinned on the native view (see the header note).
    maxHeight: progress.value >= 1
      ? UNMEASURED_MAX
      : interpolate(progress.value, [0, 1], [0, openHeight], Extrapolation.CLAMP),
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
  }));

  // Guarded rather than compared exactly: layout lands on a pixel grid, and a
  // third of a point of rounding is not a content change. Accepting one would
  // commit React for nothing, which is the expensive half here (see
  // nextMeasuredHeight).
  const handleLayout = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    setContentHeight(prev => nextMeasuredHeight(prev, height));
  };

  return (
    // `resting` goes AFTER the animated style deliberately: it is the value
    // React commits, and the later entry is the one that wins the flatten.
    // Reanimated writes its own props straight to the view rather than through
    // this array, so the animation still overrides it frame by frame.
    <Reanimated.View style={[style, settledOpen ? styles.restingOpen : styles.restingClosed, clip && styles.clip]}>
      {/* In normal flow, so the wrapper falls back to exactly the open height
          whenever maxHeight isn't clamping it. The children keep their natural
          height regardless of the clamp above them (a View doesn't shrink
          below its content in RN), so this still measures the full open height
          even while collapsed. */}
      <View onLayout={handleLayout}>
        {children}
      </View>
    </Reanimated.View>
  );
}

/**
 * What React commits, as opposed to what Reanimated animates.
 *
 * An animated style contributes its *initial* value to the committed props,
 * and that value is captured once, on the component's very first render.
 * React re-commits it on every later render, and Reanimated re-applies the
 * real animated value afterwards — so a section whose clamp has since moved
 * away from where it started paints one frame back at its first-render value
 * on any re-render at all.
 *
 * That is most of a frame of the *whole open height* for a section that first
 * rendered open, because settled open releases the clamp to the sentinel. A
 * stack expanded, collapsed, and expanded again is exactly that: the tap that
 * re-opens it is a re-render, so the tray painted at full height for a frame
 * before the animation's own near-zero clamp landed, and everything below it
 * stepped down to the open position and straight back up. Reported as the
 * list flickering, and the jump is the giveaway that it is a committed value
 * rather than the animation.
 *
 * These two are the fix: they say the same thing the animated style says at
 * rest (0 closed, the released clamp open), so a re-render of a section that
 * isn't moving can't paint anything. Mid-transition they hold the state the
 * section is coming *from*, which is where the one re-render that reliably
 * lands — the tap's own — already is, so that frame is indistinguishable from
 * the correct one.
 */
const styles = StyleSheet.create({
  restingClosed: {
    maxHeight: 0,
    opacity: 0,
  },
  restingOpen: {
    maxHeight: UNMEASURED_MAX,
    opacity: 1,
  },
  clip: {
    overflow: 'hidden',
  },
});
