import { useEffect, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { spacing } from '../theme';
import { pillRevealOffset } from '../utils/pillReveal';

/**
 * Keeps a horizontally scrolling pill row's chosen pill on screen
 * (`pillRevealOffset` has the rule). The first reveal jumps, so a screen opens
 * already showing it; a later change of pill scrolls there.
 *
 * Each chosen pill is revealed once, so a person who scrolls the row away
 * isn't pulled back by a badge arriving or a pill relaying out.
 */
export function usePillRowReveal(activeKey: string) {
  const scrollRef = useRef<ScrollView>(null);
  const frames = useRef(new Map<string, { x: number; width: number }>()).current;
  const viewport = useRef(0);
  const content = useRef(0);
  const offset = useRef(0);
  const revealed = useRef<string | null>(null);
  const activeRef = useRef(activeKey);
  activeRef.current = activeKey;

  const reveal = () => {
    const key = activeRef.current;
    if (revealed.current === key) return;
    const pill = frames.get(key);
    if (!pill || viewport.current <= 0 || content.current <= 0) return;
    const first = revealed.current === null;
    revealed.current = key;
    const x = pillRevealOffset(pill, viewport.current, content.current, offset.current, spacing.md);
    if (x === null) return;
    offset.current = x;
    scrollRef.current?.scrollTo({ x, animated: !first });
  };

  useEffect(reveal, [activeKey]);

  const onPillLayout = (key: string) => (e: LayoutChangeEvent) => {
    const l = e.nativeEvent?.layout;
    if (!l) return;
    frames.set(key, { x: l.x, width: l.width });
    if (key === activeRef.current) reveal();
  };

  const settled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.x;
  };

  return {
    onPillLayout,
    scrollProps: {
      ref: scrollRef,
      onLayout: (e: LayoutChangeEvent) => {
        viewport.current = e.nativeEvent.layout.width;
        reveal();
      },
      onContentSizeChange: (w: number) => {
        content.current = w;
        reveal();
      },
      onScrollEndDrag: settled,
      onMomentumScrollEnd: settled,
    },
  };
}
