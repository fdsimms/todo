import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * The keyboard's current height on iOS (0 while it is down), for a bar that
 * floats just above it standing in for an `InputAccessoryView`. A real one
 * can't attach to a multiline field, which is why `TitleTokenAccessory`'s
 * floating mode and `JournalFormatBar` exist at all.
 *
 * `keyboardWillChangeFrame` as well as show and hide: the height goes stale the
 * moment the keyboard changes shape without a full show/hide (the "123" page,
 * the predictive-text row toggling), and a real accessory view never drifts
 * like that because iOS keeps it glued to the keyboard's frame itself.
 *
 * Pass `active` false while nothing can show the bar, so a mounted but unused
 * sheet doesn't re-render on every keyboard elsewhere in the app.
 */
export function useKeyboardHeight(active: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !active) return;
    const update = (e: { endCoordinates?: { height: number } }) => setHeight(e.endCoordinates?.height ?? 0);
    const showSub = Keyboard.addListener('keyboardWillShow', update);
    const changeSub = Keyboard.addListener('keyboardWillChangeFrame', update);
    const hideSub = Keyboard.addListener('keyboardWillHide', () => setHeight(0));
    return () => {
      showSub.remove();
      changeSub.remove();
      hideSub.remove();
    };
  }, [active]);
  return height;
}
