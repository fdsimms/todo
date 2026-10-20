import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { useFocusedRouteStore } from '../store/useFocusedRouteStore';
import { MAX_CONTENT_WIDTH } from '../utils/frameWidth';
import { columnUncappedFor } from '../utils/twoPane';

/**
 * Draws its children in one centered column no wider than `MAX_CONTENT_WIDTH`,
 * on the page background. On a phone the column is the whole window, so this
 * is a pair of Views that change nothing. On an iPad or a resized Mac window
 * it is what keeps a row from stretching across the display.
 *
 * A screen with two panes lifts the cap (`columnUncappedFor`) when the window
 * has room for both, so pass `followRoute` for the app's own column.
 *
 * Touches inside it report `pageX` from the window's left edge, so anything
 * that turns one into a position in here subtracts `useFrameWidth().left`.
 * Whatever is positioned from window coordinates (a popover opened from a
 * long press) is drawn outside the frame instead.
 */
export function AppFrame({ children, followRoute = false }: { children: React.ReactNode; followRoute?: boolean }) {
  const colors = useColors();
  // Only the app's own column follows the route; a sheet's frame has no screen
  // to ask, and subscribing every one would re-render it on each tab switch.
  const route = useFocusedRouteStore(s => (followRoute ? s.route : null));
  const { width } = useWindowDimensions();
  const uncapped = followRoute && columnUncappedFor(width, route);
  return (
    <View style={[styles.window, { backgroundColor: colors.bg }]}>
      <View style={[styles.column, uncapped && styles.columnUncapped]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH },
  // A two-pane screen: the list and the page beside it are wider than one column.
  // An explicit number rather than `undefined`: a prop going from 720 to
  // undefined is "unset" in the style diff, and a native view can keep the old
  // cap, which left the two panes squeezed into one column's width.
  columnUncapped: { maxWidth: 100000 },
});
