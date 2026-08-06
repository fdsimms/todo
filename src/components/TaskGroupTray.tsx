import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, type Colors } from '../theme';

/** Inner padding of the tray, and so the inset of everything inside it. */
export const TRAY_PAD = spacing.sm;

interface Props {
  children: React.ReactNode;
}

/**
 * The recessed region a stack's header and its task cards share.
 *
 * This is the thing that says the cards belong to the header, and it replaced
 * two earlier answers to that question. The first was making the header a card
 * itself, one shade brighter than the rows and flush against them — which read
 * as a *selected* row, because a brighter version of the card surface is what
 * this app uses for pressed and dragged. The second dropped the card, made the
 * header a caption band on the page, and leaned on alignment plus a hairline
 * rail to do the grouping; the header stopped looking selected and started
 * looking unrelated to the tasks beneath it.
 *
 * Enclosure is the cue that actually holds, and it costs nothing that the
 * other two spent: a common region groups the header with the cards without
 * the header having to resemble them at all. So the header stays a caption —
 * transparent, no card, 17pt — and the tray does the work. It also gives the
 * stack a visible bottom edge, which is what the rail was for.
 *
 * Children sit at `TRAY_PAD` from its inner edges; `TaskItem`'s `indented`
 * rows drop their own horizontal margins so this padding is the only inset
 * they get (which incidentally hands them back the width the old 56pt
 * text-alignment indent was eating).
 */
export function TaskGroupTray({ children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return <View style={styles.tray}>{children}</View>;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  tray: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: TRAY_PAD,
    // No vertical padding: the gaps above and below the children live inside
    // TaskGroupBody, where AnimatedCollapsible takes them away with the rest
    // of the body. Put them here and a collapsed stack keeps a band of empty
    // tray under its header.
    borderRadius: radius.lg,
    backgroundColor: colors.bgSunken,
  },
});
