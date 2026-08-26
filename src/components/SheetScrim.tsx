import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  /** Dismisses whatever is on top. */
  onPress: () => void;
  /**
   * Names the scrim for a screen reader, and is what makes it *visible* to one.
   * Pass it only when tapping out is the sheet's only way back — see the note
   * below on why the default is to hide rather than to label.
   */
  label?: string;
  /** The dimming layer itself, where a caller draws one inside the touch target. */
  children?: React.ReactNode;
}

/**
 * The full-screen tap-to-dismiss layer behind a sheet, menu or drawer.
 *
 * It was written out by hand in forty files as
 * `<TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} … />`,
 * and thirty-nine of those said nothing about accessibility — so VoiceOver
 * found a button the size of the screen whose entire announcement was
 * "button". It sits above the sheet's own content in the traversal order,
 * which is the worst place for an unnamed control.
 *
 * **The default is hidden, not labelled, and that's the decision worth not
 * re-deriving.** Nearly every sheet already carries a real Cancel/Close/Done
 * with a name on it, so labelling the scrim adds a second, redundant exit
 * *in front of* the content — a screen-reader user meets "Close" before they
 * meet the thing they opened. Hiding it costs them nothing, because the
 * labelled button is still there; tapping out stays a sighted convenience.
 *
 * **Pass `label` for the handful of sheets where the scrim is the only exit**
 * (`QuickSearchModal`, `QuickAddNameSheet`, `TemplateItemQuickAdd`,
 * `QuickAddProjectModal`, `SideMenuDrawer`). There, hiding it would leave a
 * screen-reader user with no way out but the system back gesture. Name what
 * closes, not the gesture: "Close quick search", not "Dismiss".
 *
 * `activeOpacity={1}` is load-bearing: the scrim must not flash on press, and
 * it's why this can't just be a `Pressable` in some files and a
 * `TouchableOpacity` in others (it had drifted into both).
 */
export function SheetScrim({ onPress, label, children }: Props) {
  return (
    <TouchableOpacity
      style={StyleSheet.absoluteFill}
      activeOpacity={1}
      onPress={onPress}
      // Only a labelled scrim is a control; an unlabelled one is scenery the
      // sheet's own buttons already cover. See the note above.
      accessibilityRole={label ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    >
      {children}
    </TouchableOpacity>
  );
}
