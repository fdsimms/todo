import React from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing } from '../theme';
import { AnimatedCollapsible } from './AnimatedCollapsible';

interface Props {
  expanded: boolean;
  /** False when the stack has a header but nothing to show under it. */
  hasChildren: boolean;
  children: React.ReactNode;
}

/**
 * The children of a stack, and the collapse animation over them.
 *
 * **There is no rail.** A hairline used to hang from the centre of the
 * header's glyph and run down the left of these rows, because back when the
 * header was itself a card, nothing but indentation said the rows below it
 * belonged to it — and indentation alone is ambiguous when a stack is the last
 * thing in a category. `TaskGroupTray` answers that question outright now: the
 * rows and their header are inside one region with a visible edge, so a line
 * pointing at the relationship is redundant, and it was drawn against the side
 * of a card the header no longer has.
 */
export function TaskGroupBody({ expanded, hasChildren, children }: Props) {
  return (
    <AnimatedCollapsible expanded={expanded}>
      <View style={styles.content}>{hasChildren && children}</View>
    </AnimatedCollapsible>
  );
}

const styles = StyleSheet.create({
  // The tray's vertical padding, kept on this side of the collapse so it
  // folds away with the children — a collapsed stack should be a tray the
  // height of its header, not one with an empty band under it. The top gap is
  // the smaller of the two: the header is a caption for these rows, so it
  // wants to sit nearer them than the tray's floor does.
  content: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
});
