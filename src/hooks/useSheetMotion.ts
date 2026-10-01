import { useEffect, useRef } from 'react';
import { Animated, Easing, Keyboard, type LayoutChangeEvent } from 'react-native';
import { animation } from '../theme';
import { sheetTravel } from '../utils/sheetMotion';
import { useSheetHiddenOffset } from './useSheetHiddenOffset';

/** Accelerating out, the way a card leaves on iOS. */
const EXIT_EASING = Easing.bezier(0.4, 0, 1, 1);

/**
 * The entrance and exit of a hand-built bottom sheet: a `transparent`
 * `SheetModal` holding a dim backdrop and a card anchored to the bottom.
 *
 * Every one of those sheets used to write this out itself, parking the card a
 * whole window below rest and springing it in and out from there. See
 * `src/utils/sheetMotion.ts` for why that read as sluggish; this measures the
 * card instead, so the entrance starts with the card at the screen's edge and
 * the exit is a short timed curve that hands back control as soon as the card
 * is gone.
 *
 * - Put `onCardLayout` on the card's outer `Animated.View` (the one carrying
 *   `translateY`). The entrance waits for that first layout, since until then
 *   nobody knows how far the card has to come; it falls back to a window's
 *   travel if the layout hasn't arrived shortly after `show()`.
 * - Call `show()` from the sheet's open effect, `hide(after)` from its
 *   dismissal. `slideOut`/`slideIn` move the card alone, for a sheet that
 *   steps its card aside while another sheet is up and keeps its backdrop.
 * - Pass the sheet's `visible`. Its children unmount once it closes, so the
 *   next open measures afresh rather than trusting a card that may have
 *   changed size since.
 *
 * Don't re-arm `translateY` in `hide`'s callback; see `useSheetHiddenOffset`.
 */
export function useSheetMotion(visible: boolean) {
  const windowTravel = useSheetHiddenOffset();
  const translateY = useRef(new Animated.Value(windowTravel)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardHeight = useRef<number | null>(null);
  const awaitingLayout = useRef(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFallback = () => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
  };

  useEffect(() => {
    if (!visible) {
      cardHeight.current = null;
      awaitingLayout.current = false;
      clearFallback();
    }
  }, [visible]);
  useEffect(() => clearFallback, []);

  const travel = () => {
    const keyboard = Keyboard.isVisible() ? Keyboard.metrics()?.height ?? 0 : 0;
    return sheetTravel(cardHeight.current, windowTravel, keyboard);
  };

  const slideIn = (from?: number) => {
    if (from !== undefined) translateY.setValue(from);
    Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
  };

  const enter = () => {
    awaitingLayout.current = false;
    clearFallback();
    slideIn(sheetTravel(cardHeight.current, windowTravel));
  };

  const show = () => {
    translateY.setValue(windowTravel);
    backdropOpacity.setValue(0);
    Animated.timing(backdropOpacity, {
      toValue: 1, duration: animation.duration.sheetBackdropIn, useNativeDriver: true,
    }).start();
    if (cardHeight.current !== null) {
      enter();
      return;
    }
    awaitingLayout.current = true;
    clearFallback();
    fallback.current = setTimeout(() => {
      if (awaitingLayout.current) enter();
    }, animation.duration.slow);
  };

  const onCardLayout = (e: LayoutChangeEvent) => {
    cardHeight.current = e.nativeEvent.layout.height;
    if (awaitingLayout.current) enter();
  };

  const slideOut = (after?: () => void) => {
    awaitingLayout.current = false;
    clearFallback();
    Animated.timing(translateY, {
      toValue: travel(), duration: animation.duration.sheetExit, easing: EXIT_EASING, useNativeDriver: true,
    }).start(() => after?.());
  };

  const hide = (after?: () => void) => {
    awaitingLayout.current = false;
    clearFallback();
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: travel(), duration: animation.duration.sheetExit, easing: EXIT_EASING, useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0, duration: animation.duration.sheetBackdropOut, useNativeDriver: true,
      }),
    ]).start(() => after?.());
  };

  /** Settles the card back at rest, for a drag that didn't go far enough. */
  const restore = () => {
    Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
  };

  return { translateY, backdropOpacity, onCardLayout, show, hide, slideOut, slideIn, restore };
}
