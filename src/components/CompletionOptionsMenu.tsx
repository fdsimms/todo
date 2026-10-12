import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, border, iconSize, lineHeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  /** Where the checkbox was held, so the card opens from it (above it when the row is low on screen). */
  anchor?: CardAnchor | null;
  /** Moves to the next date with no record and no streak change. Omitted for a task that doesn't repeat, which has no next date. */
  onSkip?: () => void;
  /** Records a miss and moves to the next date. Omitted with `onSkip`. */
  onMiss?: () => void;
  /** Completes the occurrence with no coins and no streak change. */
  onSomeoneElse: () => void;
  onClose: () => void;
}

/**
 * The popover a long press on a task's checkbox opens: the ways to close it
 * without having done it yourself. The expanded panel's Skip and Mark Missed
 * buttons do the first two for a repeating task; this puts them where the
 * thumb already is, next to a third that has no button anywhere else. A task
 * that doesn't repeat has nothing to skip or miss, so it gets only the third.
 */
export function CompletionOptionsMenu({ visible, anchor, onSkip, onMiss, onSomeoneElse, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const choose = (feedback: () => void, action: () => void) => {
    feedback();
    card.close(action);
  };

  return (
    <CardSheet
      name="CompletionOptionsMenu"
      visible={visible}
      controller={card}
      onClose={onClose}
      onRequestClose={() => card.close()}
      anchor={anchor}
      popoverWidth={300}
      scrimLabel="Close menu"
    >
      {onSkip && onMiss && (
        <>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose(haptics.tap, onSkip)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Skip this time. Moves to the next date. Nothing is recorded."
          >
            <Ionicons name="play-skip-forward-outline" size={iconSize.md} color={colors.accent} style={styles.icon} />
            <View style={styles.text}>
              <Text style={styles.label}>Skip this time</Text>
              <Text style={styles.detail}>Moves to the next date. Nothing is recorded.</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.sep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose(haptics.impactMedium, onMiss)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Mark missed. Records a miss and moves to the next date."
          >
            <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.redText} style={styles.icon} />
            <View style={styles.text}>
              <Text style={[styles.label, styles.missLabel]}>Mark missed</Text>
              <Text style={styles.detail}>Records a miss and moves to the next date.</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.sep} />
        </>
      )}
      <TouchableOpacity
        style={styles.optionRow}
        onPress={() => choose(haptics.tap, onSomeoneElse)}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel="Someone else did it. Shows as done in your history, with no coins. Your streak is unchanged."
      >
        <Ionicons name="people-outline" size={iconSize.md} color={colors.accent} style={styles.icon} />
        <View style={styles.text}>
          <Text style={styles.label}>Someone else did it</Text>
          <Text style={styles.detail}>Shows as done in your history, with no coins. Your streak is unchanged.</Text>
        </View>
      </TouchableOpacity>
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
  missLabel: { color: colors.redText },
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
