import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useFocusedRouteStore } from '../store/useFocusedRouteStore';
import { floatingLayerInsetFor } from '../utils/twoPane';

/**
 * The box the app's floating bars (undo, the ready offer, the cook timer, the
 * focus strip, the toasts) are positioned in. They are children of the app's
 * column, and their own `left`/`right` insets are measured from it.
 *
 * On a two-pane screen the column is the whole window less the sidebar, and
 * those bars stretched across both panes: an undo bar 1,400pt wide, sitting on
 * top of an add button that lives at the list pane's right edge. So while a
 * two-pane screen is on show the layer is the list pane's width, which is where
 * the button is and what the bars were drawn to sit beside. Everywhere else it
 * is the column, as it always was.
 *
 * It takes no touches itself (`box-none`), so the screen under it stays live
 * wherever a bar isn't.
 */
export function FloatingLayer({ children }: { children: React.ReactNode }) {
  const route = useFocusedRouteStore(s => s.route);
  const { width } = useWindowDimensions();
  // A number in every case, never `undefined`: a style prop that goes from a
  // number to unset can leave a native view on its old value (see `AppFrame`).
  const right = floatingLayerInsetFor(width, route);
  return (
    <View pointerEvents="box-none" style={[styles.layer, { right }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0, bottom: 0 },
});
