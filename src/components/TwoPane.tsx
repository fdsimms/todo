import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { useTwoPane } from '../hooks/useTwoPane';
import { TWO_PANE_LIST_WIDTH } from '../utils/twoPane';

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
  return (
    <View style={twoPane ? styles.row : styles.single}>
      <View
        style={twoPane ? [styles.list, { borderRightColor: colors.separator }] : styles.single}
      >
        {list}
      </View>
      {twoPane && <View style={[styles.detail, { backgroundColor: colors.bg }]}>{detail}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  single: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  list: { width: TWO_PANE_LIST_WIDTH, borderRightWidth: StyleSheet.hairlineWidth },
  detail: { flex: 1, minWidth: 0 },
});
