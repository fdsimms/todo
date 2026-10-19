import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { MAX_CONTENT_WIDTH } from '../utils/frameWidth';

/**
 * Draws its children in one centered column no wider than `MAX_CONTENT_WIDTH`,
 * on the page background. On a phone the column is the whole window, so this
 * is a pair of Views that change nothing. On an iPad or a resized Mac window
 * it is what keeps a row from stretching across the display.
 *
 * Touches inside it report `pageX` from the window's left edge, so anything
 * that turns one into a position in here subtracts `useFrameWidth().left`.
 * Whatever is positioned from window coordinates (a popover opened from a
 * long press) is drawn outside the frame instead.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.window, { backgroundColor: colors.bg }]}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH },
});
