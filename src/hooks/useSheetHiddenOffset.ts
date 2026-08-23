import { useWindowDimensions } from 'react-native';

/**
 * How far down to translate a bottom sheet's card to park it off screen, for
 * the ~a dozen sheets built from the same `sheetOuter` + `translateY` +
 * backdrop shape.
 *
 * It has to be derived from the window, not guessed. These cards are
 * bottom-anchored and their height is data-driven — capped only by
 * `windowHeight - TOP_INSET` — so the 600/700 pair every one of them used to
 * hardcode did not clear the tall ones. A meal carrying every action, or a
 * recipe picker with a long list, stood taller than 700, which left its handle
 * and title band sitting at the bottom of the screen for the whole dismissal.
 *
 * The card can never be taller than the window it is measured against, and a
 * keyboard-lifted one is capped at `windowHeight - keyboardHeight - TOP_INSET`
 * before the lift is added back, so the window's own height always clears it.
 *
 * The other half of the rule lives at the call sites: **do not re-arm the value
 * in the dismiss animation's completion callback.** Setting it to a *lower*
 * hidden offset there moves the card back up into view, and it stays there
 * until the modal actually unmounts — which, when the callback also navigates,
 * is however long the destination screen takes to render. Every one of these
 * sheets parks the card at this offset in its open effect already, so there is
 * nothing to re-arm.
 */
export function useSheetHiddenOffset(): number {
  const { height } = useWindowDimensions();
  return height;
}
