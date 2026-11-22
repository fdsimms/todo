import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { useTwoPane } from '../hooks/useTwoPane';
import { useSettingsStore } from '../store/useSettingsStore';
import { boardPaneWidthFor, twoPaneListWidthFor } from '../utils/twoPane';
import { MAX_CONTENT_WIDTH } from '../utils/frameWidth';

interface Props {
  /** The screen as it is on a phone: the list, with its header. */
  list: React.ReactNode;
  /** What is open beside it. Drawn only when the window has room. */
  detail: React.ReactNode;
  /**
   * The layout to use in place of the window's. For a screen that holds one while a
   * form is open in it, so a resize can't swap the form's host out from under it.
   */
  twoPane?: boolean;
  /**
   * The list is a board (Today's, `todayWideLayout: 'board'`): it takes the
   * width, and the detail is a fixed pane at the right (`boardPaneWidthFor`)
   * drawn only while `open`. Kept mounted while closed, so the form inside it
   * isn't rebuilt on each open.
   */
  board?: { open: boolean };
}

/**
 * A list with the thing selected in it beside it, on a window wide enough
 * (`twoPaneFor`), and just the list otherwise. The list stays the first child
 * in both, so crossing the breakpoint keeps its scroll position, its search
 * and a selection in progress instead of remounting it.
 */
export function TwoPane({ list, detail, twoPane: held, board }: Props) {
  const colors = useColors();
  const roomForTwoPane = useTwoPane();
  const twoPane = held ?? roomForTwoPane;
  const { width: windowWidth } = useWindowDimensions();
  const sidebarCollapsed = useSettingsStore(s => s.sidebarCollapsed);
  // The page beside the list is a phone-shaped form or screen. In a 1,200pt pane its
  // rows put a label at one end and its value a thousand points away, so it takes
  // the app's column width, centered, like every other screen on a wide window.
  // One shape in every case, the list first, so switching between a list, two
  // panes and a board restyles the list's box rather than remounting it.
  const boardOn = twoPane && !!board;
  return (
    <View style={twoPane ? styles.row : styles.single}>
      <View
        style={!twoPane || boardOn
          ? styles.single
          : [styles.list, { width: twoPaneListWidthFor(windowWidth, sidebarCollapsed), borderRightColor: colors.separator }]}
      >
        {list}
      </View>
      {twoPane && (
        <View
          style={boardOn
            ? [
                styles.boardPane,
                { width: boardPaneWidthFor(windowWidth, sidebarCollapsed), borderLeftColor: colors.separator, backgroundColor: colors.bg },
                !board!.open && styles.hidden,
              ]
            : [styles.detail, { backgroundColor: colors.bg }]}
        >
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
  boardPane: { borderLeftWidth: StyleSheet.hairlineWidth },
  hidden: { display: 'none' },
});
