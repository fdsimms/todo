import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { OVERLAY_CARD_MAX_WIDTH } from '../utils/frameWidth';

/**
 * The strip an `InputAccessoryView` carries above the keyboard (title tokens, a
 * number pad's Done, "apply to all"). The system gives the view the whole width
 * of the window, and on a Mac window that is 1,500pt with its buttons at one
 * end and its confirm at the other, nowhere near the field they act on. The
 * strip keeps its full-width fill and hairline, so it still reads as one bar,
 * and its content sits in a column the width of the card above it (a quick add
 * card is capped at the same `OVERLAY_CARD_MAX_WIDTH`).
 *
 * `style` is the content row's own layout (direction, spacing, padding).
 */
export function AccessoryBar({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <View style={[styles.strip, { backgroundColor: colors.bgSecondary, borderTopColor: colors.separator }]}>
      <View style={[styles.column, style]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { borderTopWidth: StyleSheet.hairlineWidth },
  column: { width: '100%', maxWidth: OVERLAY_CARD_MAX_WIDTH, alignSelf: 'center' },
});
