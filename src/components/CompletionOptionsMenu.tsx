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
  /** Records a miss. Moves to the next date when `onSkip` is also given (the task repeats), otherwise closes the task. */
  onMiss?: () => void;
  /** Completes the occurrence with no coins and no streak change. */
  onSomeoneElse: () => void;
  /** A target's current count, when it has one to take a unit off of. Omit it (or pass 0) and the row is hidden. */
  takeOffCount?: number;
  /** Takes the last logged unit off a target. */
  onTakeOff?: () => void;
  /** Moves a chained task on one step without completing this one. Omitted on the last step. */
  onNextStep?: () => void;
  /** Moves a chained task back one step. Omitted on the first step. */
  onPrevStep?: () => void;
  /** Records a miss and ends the rest of the chain, rather than moving into its next step. */
  onEndChain?: () => void;
  onDuplicate?: () => void;
  onClose: () => void;
}

/**
 * The popover a long press on a task's checkbox opens: the ways to close it
 * without having done it yourself. The expanded panel's Skip and Mark Missed
 * buttons do the first two for a repeating task; this puts them where the
 * thumb already is, next to a third that has no button anywhere else. A task
 * that doesn't repeat has no next date to skip to, so it gets Mark missed
 * (which closes it) and the third.
 */
export function CompletionOptionsMenu({ visible, anchor, onSkip, onMiss, onSomeoneElse, takeOffCount, onTakeOff, onNextStep, onPrevStep, onEndChain, onDuplicate, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const missDetail = onSkip ? 'Records a miss and moves to the next date.' : 'Records a miss and closes the task.';

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
      {onTakeOff && takeOffCount ? (
        <>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose(haptics.impactMedium, onTakeOff)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Take one off. Goes from ${takeOffCount} to ${takeOffCount - 1}.`}
          >
            <Ionicons name="remove-circle-outline" size={iconSize.md} color={colors.accent} style={styles.icon} />
            <View style={styles.text}>
              <Text style={styles.label}>Take one off</Text>
              <Text style={styles.detail}>{`Goes from ${takeOffCount} to ${takeOffCount - 1}.`}</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.sep} />
        </>
      ) : null}
      {onSkip && (
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
        </>
      )}
      {onMiss && (
        <>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose(haptics.impactMedium, onMiss)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Mark missed. ${missDetail}`}
          >
            <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.redText} style={styles.icon} />
            <View style={styles.text}>
              <Text style={[styles.label, styles.missLabel]}>Mark missed</Text>
              <Text style={styles.detail}>{missDetail}</Text>
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
      {onNextStep && (
        <>
          <View style={styles.sep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose(haptics.tap, onNextStep)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Skip to the next step. This step isn’t completed."
          >
            <Ionicons name="play-forward-outline" size={iconSize.md} color={colors.accent} style={styles.icon} />
            <View style={styles.text}>
              <Text style={styles.label}>Skip to the next step</Text>
              <Text style={styles.detail}>This step isn’t completed.</Text>
            </View>
          </TouchableOpacity>
        </>
      )}
      {onPrevStep && (
        <>
          <View style={styles.sep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose(haptics.tap, onPrevStep)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Back a step"
          >
            <Ionicons name="play-back-outline" size={iconSize.md} color={colors.accent} style={styles.icon} />
            <View style={styles.text}>
              <Text style={styles.label}>Back a step</Text>
            </View>
          </TouchableOpacity>
        </>
      )}
      {onEndChain && (
        <>
          <View style={styles.sep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose(haptics.impactMedium, onEndChain)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Mark missed and end the chain. Skips the rest of its steps for today."
          >
            <Ionicons name="stop-circle-outline" size={iconSize.md} color={colors.redText} style={styles.icon} />
            <View style={styles.text}>
              <Text style={[styles.label, styles.missLabel]}>Mark missed and end the chain</Text>
              <Text style={styles.detail}>Skips the rest of its steps for today.</Text>
            </View>
          </TouchableOpacity>
        </>
      )}
      {onDuplicate && (
        <>
          <View style={styles.sep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => choose(haptics.tap, onDuplicate)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Duplicate"
          >
            <Ionicons name="duplicate-outline" size={iconSize.md} color={colors.accent} style={styles.icon} />
            <View style={styles.text}>
              <Text style={styles.label}>Duplicate</Text>
            </View>
          </TouchableOpacity>
        </>
      )}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.smd,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // The label's line box is 24pt and the icon 20pt, so this offset centres the icon on the title
  // whatever the detail line below it does (centering it on the whole block parks it between
  // the two lines instead).
  icon: { marginTop: (lineHeight.lg - iconSize.md) / 2 },
  // flexShrink + minWidth let the detail wrap inside the row rather than clip at its edge.
  text: { flex: 1, flexShrink: 1, minWidth: 0 },
  label: {
    color: colors.text,
    fontSize: font.lg,
    lineHeight: lineHeight.lg,
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
