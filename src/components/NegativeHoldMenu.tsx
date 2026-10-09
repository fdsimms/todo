import React, { Fragment, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, border, iconSize, lineHeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import type { NegativeHold } from '../utils/negativeHabits';

interface Props {
  visible: boolean;
  /** Where the box was held, so the card opens from it (above it when the row is low on screen). */
  anchor?: CardAnchor | null;
  /** What `negativeHoldNow` said about today, which decides the rows. */
  hold: NegativeHold;
  /** Adds today to the streak now instead of when the day ends. */
  onCount: () => void;
  /** Takes back a day that was counted early. */
  onReopen: () => void;
  /** Reports that you did the thing today. */
  onSlip: () => void;
  /** Removes the most recent slip logged today. */
  onUndoSlip: () => void;
  onClose: () => void;
}

interface Row {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: 'accent' | 'red';
  label: string;
  detail: string;
  feedback: () => void;
  action: () => void;
}

/**
 * The popover a long press on an avoid-task's box opens, the shape
 * `CompletionOptionsMenu` gives a task you do. Which rows appear depends on the
 * day's state (`negativeHoldFor`): a day not yet counted can be counted now, a
 * day counted early can be taken back, and a slip already logged can be
 * removed. Logging a slip is always there, since the tap on the box is the only
 * other way to reach it. Nothing here asks again afterwards: choosing the row
 * is the deliberate part, and a slip that costs something still goes through
 * `confirmSlip` in `onSlip`.
 */
export function NegativeHoldMenu({ visible, anchor, hold, onCount, onReopen, onSlip, onUndoSlip, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const slipped = hold === 'undo-slip' || hold === 'undo-or-close';
  const rows: Row[] = [];
  if (hold === 'close' || hold === 'undo-or-close') {
    rows.push({
      key: 'count',
      icon: 'checkmark-circle-outline',
      tone: 'accent',
      label: 'Count today now',
      detail: 'Adds today to your streak now instead of when the day ends.',
      feedback: haptics.success,
      action: onCount,
    });
  }
  if (hold === 'reopen') {
    rows.push({
      key: 'reopen',
      icon: 'arrow-undo-outline',
      tone: 'accent',
      label: 'Take back counting today',
      detail: 'Removes today from your streak. It counts again when the day ends if you have not slipped.',
      feedback: haptics.tap,
      action: onReopen,
    });
  }
  rows.push({
    key: 'slip',
    icon: 'close-circle-outline',
    tone: 'red',
    label: slipped ? 'Log another slip' : 'Log a slip',
    detail: 'Records that you did it today.',
    feedback: haptics.warning,
    action: onSlip,
  });
  if (slipped) {
    rows.push({
      key: 'undo-slip',
      icon: 'arrow-undo-outline',
      tone: 'accent',
      label: 'Take back a slip',
      detail: 'Removes the most recent slip logged today.',
      feedback: haptics.tap,
      action: onUndoSlip,
    });
  }

  return (
    <CardSheet
      name="NegativeHoldMenu"
      visible={visible}
      controller={card}
      onClose={onClose}
      onRequestClose={() => card.close()}
      anchor={anchor}
      popoverWidth={300}
      scrimLabel="Close menu"
    >
      {rows.map((row, i) => (
        <Fragment key={row.key}>
          {i > 0 && <View style={styles.sep} />}
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { row.feedback(); card.close(row.action); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}. ${row.detail}`}
          >
            <Ionicons
              name={row.icon}
              size={iconSize.md}
              color={row.tone === 'red' ? colors.redText : colors.accent}
              style={styles.icon}
            />
            <View style={styles.text}>
              <Text style={[styles.label, row.tone === 'red' && styles.redLabel]}>{row.label}</Text>
              <Text style={styles.detail}>{row.detail}</Text>
            </View>
          </TouchableOpacity>
        </Fragment>
      ))}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.smd,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  icon: { marginTop: spacing.xxs },
  text: { flex: 1 },
  label: {
    color: colors.text,
    fontSize: font.lg,
  },
  redLabel: { color: colors.redText },
  detail: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    marginTop: spacing.xxs,
    fontWeight: fontWeight.regular,
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
});
