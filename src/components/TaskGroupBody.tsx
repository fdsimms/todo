import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, type Colors } from '../theme';
import { AnimatedCollapsible } from './AnimatedCollapsible';

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

/**
 * The children of a stack: the collapse animation and the all-done stand-in.
 *
 * **There is no rail.** A hairline used to hang from the centre of the
 * header's glyph and run down the left of these rows, because back when the
 * header was itself a card, nothing but indentation said the rows below it
 * belonged to it — and indentation alone is ambiguous when a stack is the
 * last thing in a category. That line paid for itself then and doesn't now:
 * the header is a caption band on the page background rather than a card
 * (see TaskGroupHeader), so "the indented cards under the band" is already an
 * unambiguous read, and the rail was left tracing the edge of a card that no
 * longer exists. The grouping is carried by three things instead — the band
 * itself, children inset to start exactly at its title (`STACK_CHILD_INSET`),
 * and the closing gap below.
 */
export function TaskGroupBody({ expanded, hasChildren, emptyLabel, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <AnimatedCollapsible expanded={expanded}>
      <View style={styles.content}>
        {hasChildren
          ? children
          : emptyLabel !== undefined && <Text style={styles.empty}>{emptyLabel}</Text>}
      </View>
    </AnimatedCollapsible>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Closes the block. Children sit 2pt apart, so without this the first row
  // after a stack is exactly as far from the last child as the children are
  // from each other, and the stack has no visible end. Collapsed this is
  // inert — AnimatedCollapsible clamps the wrapper to zero height and clips.
  content: {
    paddingBottom: spacing.sm,
  },
  empty: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
