import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InlineAction } from './InlineAction';
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
  /**
   * Takes you to where the run landed. Omitted where you are already there
   * (a run applied from the project's own page), and the toast stays a plain
   * confirmation.
   */
  goTo?: { label: string; onPress: () => void };
}

/**
 * Toast shown after applying a template, in place of opening the task
 * editor on whatever it created — see CLAUDE.md's note on this. Names how
 * many tasks landed and auto-dismisses; there's nothing to undo here
 * that shake-to-undo doesn't already cover. With `goTo`, it also offers a
 * way to the place they landed, since an apply from the template list
 * otherwise leaves you somewhere the tasks aren't.
 */
export function TemplateAppliedToast({ count, bottom, onDismiss, noun = 'task', goTo }: Props) {
  const { colors, shadows } = useTheme();
  const styles = makeStyles(colors);

  useEffect(() => {
    const timeout = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const message = count === 1 ? `Created 1 ${noun}` : `Created ${count} ${noun}s`;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents={goTo ? 'box-none' : 'none'}>
      <View style={[styles.bar, shadows.fab]}>
        <Text style={styles.label} numberOfLines={2}>
          {message}
        </Text>
        {goTo && (
          <InlineAction
            label={goTo.label}
            onPress={() => { onDismiss(); goTo.onPress(); }}
            accessibilityLabel={goTo.label}
          />
        )}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  label: {
    flexShrink: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
});
