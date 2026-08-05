import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, border, type Colors } from '../theme';
import { AnimatedCollapsible } from './AnimatedCollapsible';
import { STACK_RAIL_X } from './TaskGroupHeader';

interface Props {
  expanded: boolean;
  /**
   * False when the stack has a header but nothing to show under it — the
   * everything-is-done case on Today, where completed tasks aren't rendered
   * individually but the stack itself stays put until dismissed.
   */
  hasChildren: boolean;
  /** Shown in place of the children when `hasChildren` is false. */
  emptyLabel?: string;
  children: React.ReactNode;
}

// How far above the bottom of the last row the rail stops. Roughly half a
// resting task row, so the line ends around that row's middle and reads as a
// branch reaching its last item rather than as a box drawn around the group.
// A row that's been expanded for its notes is taller than this, so the rail
// finishes nearer its top edge — still a deliberate-looking stop, which is
// why this is one constant instead of a measured per-row layout.
const RAIL_BOTTOM_INSET = 24;

/**
 * The children of a stack: the collapse animation, the rail that ties them to
 * their header, and the all-done stand-in.
 *
 * A stack's header and its children are separate cards in one flat list, so
 * without the rail nothing but indentation says the rows below a header
 * belong to it — and indentation alone is ambiguous the moment a stack is the
 * last thing in a category. The rail hangs from the centre of the header's
 * leading glyph (`STACK_RAIL_X`) so the connection reads as descending from
 * the stack's own mark.
 *
 * It's drawn behind the rows and `pointerEvents="none"`: in the Today list
 * these children sit inside a `SortableList`, and a rail that could take a
 * touch would be a drag that silently doesn't start.
 */
export function TaskGroupBody({ expanded, hasChildren, emptyLabel, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <AnimatedCollapsible expanded={expanded}>
      <View style={styles.content}>
        {hasChildren && <View style={styles.rail} pointerEvents="none" />}
        {hasChildren
          ? children
          : emptyLabel !== undefined && <Text style={styles.empty}>{emptyLabel}</Text>}
      </View>
    </AnimatedCollapsible>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Swallows the first child's own 2pt top margin so the card emerges from
  // under the header rather than floating just below it — closing the header
  // side of that seam alone still leaves the child's half of it. Collapsed
  // this is inert: AnimatedCollapsible clamps the wrapper to zero height and
  // clips, so there's nothing for the offset to pull up.
  content: {
    marginTop: -2,
  },
  rail: {
    position: 'absolute',
    left: STACK_RAIL_X,
    top: 0,
    bottom: RAIL_BOTTOM_INSET,
    width: border.sm,
    backgroundColor: colors.separator,
  },
  empty: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
