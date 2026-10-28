import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewProps } from 'react-native';
import { spacing } from '../theme';
import { dashboardColumnsFor } from '../utils/columnCap';
import { dealColumns } from '../utils/columnDeal';

/**
 * A dashboard's `ScrollView`: on a window with room for two columns of cards it
 * deals its children into two (`dealColumns` holds the rule and why), and below
 * that it is a plain `ScrollView` whose children are passed through untouched, so
 * a phone and an upright iPad draw exactly what they did.
 *
 * Each child element is one unit: a section is dealt whole, so it has to be one
 * element (a `View` or a Fragment holding its title and its card), never a loose
 * `Text` beside a `View`, or the title would land in one column and its card in
 * the other. A child that is `null` or `false` takes no place, so a section
 * hidden by a condition doesn't leave a hole. A `WideSpan` takes the whole
 * width (Stats' row of three figures), and the sections around it are dealt in
 * separate runs.
 */
export const WideScroll = React.forwardRef<ScrollView, ScrollViewProps>(function WideScroll(
  { children, ...rest },
  ref,
) {
  const { width } = useWindowDimensions();
  const twoColumns = dashboardColumnsFor(width) === 2;
  return (
    <ScrollView ref={ref} {...rest}>
      {twoColumns ? dealt(children) : children}
    </ScrollView>
  );
});

/**
 * Marks a child of `WideScroll` that takes the whole width of the page instead of
 * a column. It draws nothing of its own, so on one column it changes nothing.
 */
export function WideSpan({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function spansWidth(child: React.ReactNode): boolean {
  return React.isValidElement(child) && child.type === WideSpan;
}

function dealt(children: React.ReactNode): React.ReactNode[] {
  return dealColumns(React.Children.toArray(children), spansWidth).map((row, i) =>
    row.kind === 'span' ? (
      row.item
    ) : (
      <View key={`columns-${i}`} style={styles.row}>
        <View style={styles.column}>{row.left}</View>
        <View style={styles.column}>{row.right}</View>
      </View>
    ),
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0 },
});
