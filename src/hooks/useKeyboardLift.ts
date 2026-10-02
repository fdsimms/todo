import { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Platform } from 'react-native';
import { animation } from '../theme';

/**
 * Lifts a hand-built bottom card (a `transparent` `SheetModal` holding a card
 * anchored to the bottom of the screen) clear of the keyboard.
 *
 * `useKeyboardInsetScroll` is the answer for a sheet whose content is one
 * scroll view filling the screen; it cannot help a card whose text fields sit
 * *outside* its scroll view, or whose scroll view is a small region inside a
 * card that the keyboard covers whole. Those need the card itself moved, which
 * `RecipePickerSheet`, `CategoryPicker` and friends each did with the same
 * dozen lines of listener. This is those lines, for the next one.
 *
 * - `offset` is an `Animated.Value` holding `-height`, to add into the card's
 *   `translateY` (`Animated.add(translateY, offset)`), sprung like the rest of
 *   the sheet.
 * - `height` is the keyboard's height while it is up and 0 otherwise, for
 *   capping the card to the room left above it (`maxHeight: windowHeight -
 *   height - topInset`) so a tall card shrinks its scroll region rather than
 *   running off the top of the screen.
 *
 * Pass the sheet's `visible`: sheets here stay mounted while closed, and one
 * listening then re-renders on every keyboard anywhere in the app. Going
 * inactive resets to rest, so a sheet closed with the keyboard up doesn't
 * reopen still lifted.
 */
export function useKeyboardLift(active: boolean) {
  const [height, setHeight] = useState(0);
  const offset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      offset.setValue(0);
      setHeight(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const next = e.endCoordinates?.height ?? 0;
      setHeight(next);
      Animated.spring(offset, { toValue: -next, ...animation.spring.smooth, useNativeDriver: true }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setHeight(0);
      Animated.spring(offset, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, [active, offset]);

  return { height, offset };
}
