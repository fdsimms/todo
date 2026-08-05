import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Extra bottom padding a task list should add to its content while the
 * keyboard is up, so a row the keyboard covers (renaming the last task in a
 * list, say) can still be scrolled into view.
 *
 * Deliberately NOT `automaticallyAdjustKeyboardInsets`. That prop is handled
 * natively: it sets the scroll view's `contentInset` straight from the keyboard
 * notification's frame, and every mounted list reacts to every keyboard event —
 * including a keyboard raised by a Modal sitting on top of the list. When one
 * of those frames arrives in a different coordinate space (mid modal
 * transition, floating keyboard), the computed inset comes out far taller than
 * the keyboard — a whole screen of empty scrollable space under the content,
 * which the list then keeps until some later keyboard event happens to reset
 * it. That's what let you scroll every screen's content clean out of sight.
 *
 * Driving the same idea from JS keeps the number bounded by the reported
 * keyboard height and guarantees it drops back to 0 on every hide, so the list
 * can never end up scrollable past its own content.
 */
export function useKeyboardListInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    // iOS fires the `will` events alongside the keyboard animation, so the
    // padding lands in the same frame the keyboard slides in; Android only
    // reports `did`.
    const subs = [
      Keyboard.addListener(
        Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
        e => setInset(Math.max(0, e.endCoordinates?.height ?? 0)),
      ),
      Keyboard.addListener(
        Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
        () => setInset(0),
      ),
      // Belt and braces: an interactive (drag-to-dismiss) hide can land
      // without the `will` event, and stale padding is what this hook exists
      // to avoid.
      Keyboard.addListener('keyboardDidHide', () => setInset(0)),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);

  return inset;
}
