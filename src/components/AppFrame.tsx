import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { useFocusedRouteStore } from '../store/useFocusedRouteStore';
import { columnCapFor } from '../utils/columnCap';

/**
 * Draws its children in one centered column, usually no wider than
 * `MAX_CONTENT_WIDTH`, on the page background. On a phone the column is the
 * whole window, so this is a pair of Views that change nothing. On an iPad or a
 * resized Mac window it is what keeps a row from stretching across the display.
 *
 * A screen with two panes lifts the cap when the window has room for both, and
 * a list or a dashboard raises it once the sidebar shows (`columnCapFor`), so
 * pass `followRoute` for the app's own column.
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
  // Always a number, never `undefined`: a prop going from 720 to undefined is
  // "unset" in the style diff, and a native view can keep the old cap, which left
  // two panes squeezed into one column's width.
  const maxWidth = columnCapFor(width, route);
  return (
    <View style={[styles.window, { backgroundColor: colors.bg }]}>
      <View style={[styles.column, { maxWidth }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%' },
});
