import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, type Colors } from '../theme';

const VISIBLE_MS = 4000;

interface Props {
  /** Number of tasks the apply created. */
  count: number;
  bottom: number;
  onDismiss: () => void;
  /** What to call them: "item" on a list, "task" everywhere else. */
  noun?: 'task' | 'item';
}

/**
 * Toast shown after applying a template, in place of opening the task
 * editor on whatever it created — see CLAUDE.md's note on this. Names how
 * many tasks landed and auto-dismisses; there's nothing to undo here
 * that shake-to-undo doesn't already cover.
 */
export function TemplateAppliedToast({ count, bottom, onDismiss, noun = 'task' }: Props) {
  const { colors, shadows } = useTheme();
  const styles = makeStyles(colors);

  useEffect(() => {
    const timeout = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const message = count === 1 ? `Created 1 ${noun}` : `Created ${count} ${noun}s`;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="none">
      <View style={[styles.bar, shadows.fab]}>
        <Text style={styles.label} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  bar: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  label: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
});
