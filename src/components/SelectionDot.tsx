import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { border, interaction, radius, spacing, type Colors } from '../theme';

export const SELECTION_DOT_SIZE = 22;

interface Props {
  selected: boolean;
  onPress: () => void;
}

/**
 * The selection circle on the trailing edge of a row that can be picked while
 * bulk editing — empty ring when the row isn't selected, filled with a tick
 * when it is.
 *
 * It exists because bulk selection used to be shown by filling in the row's own
 * completion checkbox, which meant a selected task looked exactly like a task
 * that had just been ticked off, and a screen full of unselected rows looked
 * exactly like a screen that wasn't in selection mode at all. The empty rings
 * are the more important half: they appear on every eligible row the moment
 * selection starts, so the mode is visible before anything has been picked.
 *
 * A circle, deliberately — completion checkboxes here are rounded squares (see
 * `checkboxRadius`), so the two controls can't be mistaken for one another even
 * at a glance. And on the trailing edge for the same reason: the leading edge
 * belongs to the checkbox, and a second circle beside it would be two circles
 * a few points apart saying different things.
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
      // beside it would announce the same thing twice on every row. Both flags
      // are needed — `accessible={false}` alone leaves the tick glyph inside as
      // an element of its own on iOS, since an Ionicon is a Text node.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.dot, selected && styles.dotSelected]}>
        {selected && <Ionicons name="checkmark" size={14} color={colors.onAccent} />}
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
  dotSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
});
