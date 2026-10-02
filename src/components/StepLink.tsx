import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { LinkableItem } from './ChainStepLinkSheet';
import { useColors } from '../theme/ThemeContext';
import { radius, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  /** The step or rotation member this button belongs to. */
  step: LinkableItem;
  /**
   * What the task itself opens, for the accessibility label only. A step
   * with none of its own falls back to this (see `linkFor`), so "opens
   * nothing" and "opens the task's" are different states and the label has
   * to be able to say which.
   */
  taskLinkUrl: string | null;
  onPress: () => void;
}

/**
 * The "what does this step's link button open" control on a chain step row,
 * in the task editor and the template item editor.
 *
 * Sibling of `StepMinutes`, `StepQuestion` and `StepMedication`, and
 * fixed-size for the same reason: the row lives inside a `SortableList`, so
 * nothing here may change the row's height. Filled only when the step
 * carries its own link — a step merely inheriting the task's is left as a
 * placeholder, because a row of filled buttons would read as settings made
 * that weren't.
 */
export function StepLink({ step, taskLinkUrl, onPress }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const own = step.linkUrl?.trim() || null;
  const label = own
    ? `Link for ${step.title}, ${own}`
    : taskLinkUrl
      ? `Link for ${step.title}, currently the task's link`
      : `Set a link for ${step.title}`;

  return (
    <TouchableOpacity
      onPress={() => { haptics.tap(); onPress(); }}
      style={[styles.button, own && styles.buttonSet]}
      activeOpacity={interaction.activeOpacity}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name="link-outline"
        size={iconSize.sm}
        color={own ? colors.text : colors.textTertiary}
      />
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  button: {
    width: 30, height: 26,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm,
    flexShrink: 0,
  },
  buttonSet: { backgroundColor: colors.bgTertiary },
});
