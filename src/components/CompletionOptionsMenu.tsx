import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
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
  /** Completes the occurrence with no coins and no streak change. Omitted for a task only its own record can complete. */
  onSomeoneElse?: () => void;
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
  /** Opens a chat about this task: Ask Claude when it is set up, else the Claude app (`discussWithClaude`). */
  onDiscuss?: () => void;
  onClose: () => void;
}

interface MenuRow {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  feedback: () => void;
  onPress: () => void;
  /** Drawn in the miss colour. */
  miss?: boolean;
}

// Row heights as the styles below lay them out at the default text size: padding, the label's
// line, and a detail wrapped to two lines (the longest ones are). Deliberately generous, since
// too small a number brings the scroll back and too large only moves the card a little.
const ROW_PLAIN = spacing.md * 2 + lineHeight.lg;
const ROW_WITH_DETAIL = ROW_PLAIN + spacing.xxs + lineHeight.sm * 2;
const SEP = border.sm;

/**
 * The popover a long press on a task's checkbox opens: the ways to close it
 * without having done it yourself. The expanded panel's Skip and Mark Missed
 * buttons do the first two for a repeating task; this puts them where the
 * thumb already is, next to a third that has no button anywhere else. A task
 * that doesn't repeat has no next date to skip to, so it gets Mark missed
 * (which closes it) and the third.
 */
export function CompletionOptionsMenu({ visible, anchor, onSkip, onMiss, onSomeoneElse, takeOffCount, onTakeOff, onNextStep, onPrevStep, onEndChain, onDuplicate, onDiscuss, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const missDetail = onSkip ? 'Records a miss and moves to the next date.' : 'Records a miss and closes the task.';

  // The two miss rows sit together, so "Mark missed" and "Mark missed and end the chain" read as the pair they are.
  const rows: MenuRow[] = [];
  if (onTakeOff && takeOffCount) {
    rows.push({ key: 'takeOff', icon: 'remove-circle-outline', label: 'Take one off', detail: `Goes from ${takeOffCount} to ${takeOffCount - 1}.`, feedback: haptics.impactMedium, onPress: onTakeOff });
  }
  if (onSkip) {
    rows.push({ key: 'skip', icon: 'play-skip-forward-outline', label: 'Skip this time', detail: 'Moves to the next date. Nothing is recorded.', feedback: haptics.tap, onPress: onSkip });
  }
  if (onMiss) {
    rows.push({ key: 'miss', icon: 'close-circle-outline', label: 'Mark missed', detail: missDetail, feedback: haptics.impactMedium, onPress: onMiss, miss: true });
  }
  if (onEndChain) {
    rows.push({ key: 'endChain', icon: 'stop-circle-outline', label: 'Mark missed and end the chain', detail: 'Skips the rest of its steps for today.', feedback: haptics.impactMedium, onPress: onEndChain, miss: true });
  }
  if (onSomeoneElse) {
    rows.push({ key: 'someoneElse', icon: 'people-outline', label: 'Someone else did it', detail: 'Shows as done in your history, with no coins. Your streak is unchanged.', feedback: haptics.tap, onPress: onSomeoneElse });
  }
  if (onNextStep) {
    rows.push({ key: 'nextStep', icon: 'play-forward-outline', label: 'Skip to the next step', detail: 'This step isn’t completed.', feedback: haptics.tap, onPress: onNextStep });
  }
  if (onPrevStep) {
    rows.push({ key: 'prevStep', icon: 'play-back-outline', label: 'Back a step', feedback: haptics.tap, onPress: onPrevStep });
  }
  if (onDuplicate) {
    rows.push({ key: 'duplicate', icon: 'duplicate-outline', label: 'Duplicate', feedback: haptics.tap, onPress: onDuplicate });
  }
  if (onDiscuss) {
    rows.push({ key: 'discuss', icon: 'chatbubble-ellipses-outline', label: 'Discuss with Claude', feedback: haptics.tap, onPress: onDiscuss });
  }

  // What the rows take with no cap, so a menu too tall for its side of the touch moves to the far
  // edge instead of scrolling. A detail wraps to two lines at the popover's width.
  const expectedHeight = rows.reduce(
    (sum, row) => sum + (row.detail ? ROW_WITH_DETAIL : ROW_PLAIN) + SEP,
    0,
  );

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
      expectedHeight={expectedHeight}
      scrimLabel="Close menu"
    >
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        {rows.map((row, i) => (
          <React.Fragment key={row.key}>
            {i > 0 && <View style={styles.sep} />}
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => choose(row.feedback, row.onPress)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={row.detail ? `${row.label}. ${row.detail}` : row.label}
            >
              <Ionicons name={row.icon} size={iconSize.md} color={row.miss ? colors.redText : colors.accent} style={styles.icon} />
              <View style={styles.text}>
                <Text style={[styles.label, row.miss && styles.missLabel]}>{row.label}</Text>
                {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
              </View>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </ScrollView>
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
    // The card is a translucent blur, so the hairline `separator` all but vanishes on it: a full
    // point in the stronger outline colour keeps rows with two-line details visibly apart.
    height: border.sm,
    backgroundColor: colors.controlBorder,
    marginLeft: spacing.md,
  },
});
