import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, iconSize, type Colors } from '../theme';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  /** One or two sentences: what isn't there yet, and what fills it. */
  children: string;
}

/**
 * A note where a list would be, for a section that is empty while the rest of
 * the sheet still has content above and below it — "No stores yet. Name one
 * when you finish a trip…".
 *
 * Deliberately **not** `EmptyState`, which is the same idea given the whole
 * screen: an 88pt icon circle, a title, and `flex: 1` centering itself in the
 * space. That treatment needs a viewport to sit in, and both callers here are
 * one section of a scrolling sheet, so it would tower over the two lines it is
 * explaining and fight the content around it. This is the inline sibling: an
 * icon, a line of text, one card.
 *
 * The text is `textSecondary` rather than the `textTertiary` both copies used,
 * for the reason `EmptyState`'s own subtitle was raised off it — this says
 * what's missing and how to fix it, which is information, and 13pt tertiary
 * measures about 3:1 against this card.
 */
export function EmptyNote({ icon, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.note}>
      <Ionicons name={icon} size={iconSize.md} color={colors.textSecondary} />
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  text: { flex: 1, fontSize: font.sm, color: colors.textSecondary },
});
