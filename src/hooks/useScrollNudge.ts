import { useCallback, useEffect, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { getLogicalDayKey } from '../utils/dateUtils';
import {
  INITIAL_SCROLL_NUDGE_STATE,
  isSwipe,
  isTap,
  noteAction,
  noteOffered,
  noteScroll,
  shouldOfferScrollNudge,
  type ScrollNudgeLimits,
  type ScrollNudgeState,
} from '../utils/scrollNudge';

interface Options {
  enabled: boolean;
  /** Seconds of unbroken scrolling before the offer, and the two limits on repeating it. */
  limits: ScrollNudgeLimits;
  dayResetTime?: string;
  /** True while something else owns the person's attention (a focus session, selecting rows). */
  suspended: boolean;
}

/**
 * Watches a screen's lists for the pattern `src/utils/scrollNudge.ts` describes
 * and says when to offer a focus session.
 *
 * Scrolling comes from the lists' own scroll events (`onScroll`), because a
 * touch handler on the container also hears a scroll inside any sheet raised
 * from it. Taps come from the container's touch events, which are passive:
 * they claim no responder, so rows, swipes and drags behave exactly as before.
 * A touch that ends having moved sideways is a row swipe (complete, move), so
 * it counts as an action; one that moved vertically is the list scrolling and
 * says nothing here.
 *
 * All state is in a ref and only `offered` is React state, so a scroll event
 * (sixty a second) never re-renders the screen.
 */
export function useScrollNudge({ enabled, limits, dayResetTime, suspended }: Options) {
  const active = enabled && !suspended;
  const stateRef = useRef<ScrollNudgeState>(INITIAL_SCROLL_NUDGE_STATE);
  const [offered, setOffered] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // Switching it off, or going into a focus session or selection, drops the
  // run and the offer rather than letting a stale one resume afterward.
  useEffect(() => {
    if (!active) {
      stateRef.current = noteAction(stateRef.current);
      setOffered(false);
    }
  }, [active]);

  const onUserScroll = useCallback(() => {
    if (!active) return;
    const now = Date.now();
    let next = noteScroll(stateRef.current, now);
    const dayKey = getLogicalDayKey(new Date(now), dayResetTime);
    if (shouldOfferScrollNudge(next, now, dayKey, limits)) {
      next = noteOffered(next, now, dayKey);
      setOffered(true);
    }
    stateRef.current = next;
  }, [active, limits, dayResetTime]);

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  }, []);

  const onTouchEnd = useCallback((e: GestureResponderEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.nativeEvent.pageX - start.x;
    const dy = e.nativeEvent.pageY - start.y;
    if (isTap(dx, dy) || isSwipe(dx, dy)) {
      stateRef.current = noteAction(stateRef.current);
    }
  }, []);

  const dismiss = useCallback(() => setOffered(false), []);

  return {
    offered: offered && active,
    dismiss,
    onUserScroll,
    touchProps: { onTouchStart, onTouchEnd },
  };
}
