import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { type LayoutChangeEvent } from 'react-native';
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTaskStore } from '../store/useTaskStore';
import { animation } from '../theme';

/**
 * Takes a section header away in the same motion as the completed rows under
 * it, so a category and its last tasks leave together instead of the header
 * outliving them by the rest of the completion hold.
 *
 * It reads the batch out of the store rather than taking a boolean prop, for the
 * reason TaskItem's own collapse does: the screen doesn't have to re-render for
 * a header to hear the call, and a header re-renders only when the answer for
 * its own section flips.
 *
 * Timing and easing match TaskItem's collapse exactly — the two are one motion
 * on screen, and they only look like one if they run on the same clock.
 */
export function CompletionCollapse({
  taskIds,
  children,
}: {
  /**
   * Every task under this header (see sectionTaskIds). Empty means the header
   * has nothing that could take it with it — a section holding a stack, or one
   * whose rows a collapsed category has filtered away — and never collapses.
   */
  taskIds: string[];
  children: ReactNode;
}) {
  // The length check first so the usual answer — no burst in flight — costs one
  // comparison rather than a walk of the section on every store change.
  const collapsing = useTaskStore(
    s =>
      s.completionCollapseIds.length > 0 &&
      taskIds.length > 0 &&
      taskIds.every(id => s.completionCollapseIds.includes(id)),
  );
  const progress = useSharedValue(1);
  const [height, setHeight] = useState<number | null>(null);
  const startedRef = useRef(false);
  // Remounts the wrapper on the way back. Putting `progress` back to 1 is not
  // enough on its own: at 1 the style below stops returning `height` and
  // `opacity` at all, and Reanimated only ever applies the keys an updater
  // *does* return — so the zeroes committed on the collapse's last frame stay on
  // the native view and the header never comes back. A freshly mounted view
  // carries none of them. (TaskItem's collapse keeps a generation of its own for
  // exactly this; AnimatedCollapsible's header is the long version of why.)
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (collapsing === startedRef.current) return;
    startedRef.current = collapsing;
    if (collapsing) {
      progress.value = withTiming(0, {
        duration: animation.duration.normal,
        easing: Easing.inOut(Easing.cubic),
      });
      return;
    }
    // The batch was called off — a completion taken back leaves the store's
    // hold, and this section has live work again. Snap back rather than animate:
    // the header is already at zero height, and growing it back in would read as
    // a new section arriving.
    setGeneration(g => g + 1);
    progress.value = 1;
  }, [collapsing]);

  // Measured while the header is at rest, for the same reason TaskItem measures
  // its row there: locking a height in mid-collapse would freeze the header at
  // whatever it had shrunk to if it ever came back.
  const handleLayout = (e: LayoutChangeEvent) => {
    if (!startedRef.current) setHeight(e.nativeEvent.layout.height);
  };

  const style = useAnimatedStyle(() => {
    if (progress.value >= 1) return {};
    const opacity = interpolate(progress.value, [0.3, 1], [0, 1], Extrapolation.CLAMP);
    if (height === null) return { opacity };
    return {
      height: interpolate(progress.value, [0, 1], [0, height], Extrapolation.CLAMP),
      opacity,
      overflow: 'hidden' as const,
    };
  });

  return (
    <Reanimated.View
      // Changes only to force a fresh view on the way back — see `generation`.
      key={generation}
      style={style}
      onLayout={handleLayout}
      pointerEvents={collapsing ? 'none' : 'auto'}
    >
      {children}
    </Reanimated.View>
  );
}
