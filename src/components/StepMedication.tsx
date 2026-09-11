import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ChainItem } from '../types';
import { useColors } from '../theme/ThemeContext';
import { radius, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  /** The step this button belongs to. */
  step: ChainItem;
  /**
   * What the task itself records, for the accessibility label only. A step
   * with nothing of its own falls back to this (see `medicationFor`), so
   * "records nothing" and "records the task's" are different states and the
   * label has to be able to say which.
   */
  taskMedicationName: string | null;
  onPress: () => void;
}

/**
 * The "what does finishing this step record" button on a chain step row, in
 * the task editor and the template item editor.
 *
 * Sibling of `StepMinutes` and `StepQuestion`, and fixed-size for the same
 * reason: the row lives inside a `SortableList`, so nothing here may change
 * the row's height. Filled only when the step carries its own medication —
 * a step merely inheriting the task's is left as a placeholder, because a row
 * of filled buttons would read as five settings made when only one was.
 */
export function StepMedication({ step, taskMedicationName, onPress }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const own = step.medicationName?.trim() || null;
  const label = own
    ? `Dose for ${step.title}, ${own}`
    : taskMedicationName
      ? `Dose for ${step.title}, currently the task's ${taskMedicationName}`
      : `Record a dose when ${step.title} is completed`;

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
        name="medkit-outline"
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
