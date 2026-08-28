import { useEffect, type RefObject } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { RowScroller } from '../components/ReorderableList';

/**
 * The standard second-tap-on-the-active-tab gesture: pressing the tab you are
 * already on scrolls its list back to the top.
 *
 * It has to be wired per screen because iOS's own version of this — tapping
 * the status bar — does nothing in this app, and can't be made to. UIKit
 * ignores the tap whenever more than one scroll view in the hierarchy has
 * `scrollsToTop` on, and every tab screen here is mounted and laid out at all
 * times: `enableScreens(false)` (see the note in App.tsx and CLAUDE.md) sends
 * React Navigation down its non-native fallback, which renders a blurred tab
 * as a plain View at `absoluteFill` with `zIndex: -1` rather than unmounting
 * or hiding it. So every tab's list is a live candidate at once and the
 * gesture is dead app-wide.
 *
 * Gated on `isFocused()` on purpose: arriving from another tab is a plain
 * switch, and yanking a list the user left mid-scroll back to the top isn't
 * part of that. `tabPress` fires either way, unlike `useFocusEffect`.
 *
 * TodayScreen deliberately doesn't use this and keeps its own listener — its
 * tab press does double duty, returning to the Today sub-view first and only
 * scrolling once there's nowhere left to go. Don't collapse the two.
 */
export function useScrollToTopOnTabPress(scroller: RefObject<RowScroller | null>) {
  const navigation = useNavigation();
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as never, () => {
      if (navigation.isFocused()) scroller.current?.scrollToTop();
    });
    return unsubscribe;
  }, [navigation, scroller]);
}
