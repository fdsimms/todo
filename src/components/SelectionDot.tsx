import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { border, interaction, radius, spacing, type Colors } from '../theme';

export const SELECTION_DOT_SIZE = 22;
// Leaves a visible ring of empty space between the inner fill and the outer
// circle — the gap is what reads as "radio button" rather than "solid dot".
const INNER_DOT_SIZE = 12;

interface Props {
  selected: boolean;
  onPress: () => void;
}

/**
 * The selection circle on the trailing edge of a row that can be picked while
 * bulk editing — a plain radio button: an empty ring when the row isn't
 * selected, an accent-filled inner circle inside that ring when it is.
 *
 * It exists because bulk selection used to be shown by filling in the row's own
 * completion checkbox, which meant a selected task looked exactly like a task
 * that had just been ticked off, and a screen full of unselected rows looked
 * exactly like a screen that wasn't in selection mode at all. The empty rings
 * are the more important half: they appear on every eligible row the moment
 * selection starts, so the mode is visible before anything has been picked.
 *
 * Deliberately not a checkmark-in-a-filled-circle — that's what the completion
 * checkbox already does (see `circleCompleting` in `TaskItem`), and a second
 * control a few points away using the same fill-plus-tick language would read
 * as another way to finish the task rather than as a different kind of pick.
 * A radio button has no other meaning in this app, so it can only mean one
 * thing here. It's a circle, full stop, where completion checkboxes are
 * rounded squares (see `checkboxRadius`) — round vs. square is the first cue,
 * the trailing edge vs. the leading one is the second.
 */
export function SelectionDot({ selected, onPress }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      // Out to the card's trailing edge on the right, and generously vertical:
      // the dot is 22pt in a row that's ~48, and this is the control the eye
      // goes to once selection is on.
      hitSlop={{ top: 12, bottom: 12, left: 12, right: spacing.md }}
      // Not its own accessibility element. The row already exposes a checkbox
      // with this exact state and a "Select …"/"Deselect …" label; a second one
      // beside it would announce the same thing twice on every row.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.dot, selected && styles.dotSelected]}>
        {selected && <View style={styles.dotInner} />}
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  dot: {
    width: SELECTION_DOT_SIZE,
    height: SELECTION_DOT_SIZE,
    borderRadius: radius.full,
    borderWidth: border.md,
    // A step brighter than the checkbox's own ring (bgQuaternary). This one has
    // to be legible at rest across a whole list — that's what says "you are
    // still selecting" — where the checkbox only has to be findable next to the
    // text it belongs to.
    borderColor: colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The ring itself tints accent too, matching the checkbox's own
  // border-follows-fill convention (see circleCompleting) — only the inner
  // dot's presence is what actually carries the state.
  dotSelected: {
    borderColor: colors.accent,
  },
  dotInner: {
    width: INNER_DOT_SIZE,
    height: INNER_DOT_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});
