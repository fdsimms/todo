import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { useTwoPane } from '../hooks/useTwoPane';
import { twoPaneListWidthFor } from '../utils/twoPane';
import { MAX_CONTENT_WIDTH } from '../utils/frameWidth';

interface Props {
  /** The screen as it is on a phone: the list, with its header. */
  list: React.ReactNode;
  /** What is open beside it. Drawn only when the window has room. */
  detail: React.ReactNode;
}

/**
 * A list with the thing selected in it beside it, on a window wide enough
 * (`twoPaneFor`), and just the list otherwise. The list stays the first child
 * in both, so crossing the breakpoint keeps its scroll position, its search
 * and a selection in progress instead of remounting it.
 */
export function TwoPane({ list, detail }: Props) {
  const colors = useColors();
  const twoPane = useTwoPane();
  const { width: windowWidth } = useWindowDimensions();
  // The page beside the list is a phone-shaped form or screen. In a 1,200pt pane its
  // rows put a label at one end and its value a thousand points away, so it takes
  // the app's column width, centered, like every other screen on a wide window.
  return (
    <View style={twoPane ? styles.row : styles.single}>
      <View
        style={twoPane
          ? [styles.list, { width: twoPaneListWidthFor(windowWidth), borderRightColor: colors.separator }]
          : styles.single}
      >
        {list}
      </View>
      {twoPane && (
        <View style={[styles.detail, { backgroundColor: colors.bg }]}>
          <View style={styles.detailColumn}>{detail}</View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  single: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  list: { borderRightWidth: StyleSheet.hairlineWidth },
  detail: { flex: 1, minWidth: 0, alignItems: 'center' },
  detailColumn: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH },
});
