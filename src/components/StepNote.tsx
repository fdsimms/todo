import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ChainItem } from '../types';
import { useColors } from '../theme/ThemeContext';
import { radius, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  step: Pick<ChainItem, 'title' | 'notes'>;
  onPress: () => void;
}

/**
 * The "this step has a note" control on a chain step row, in the task editor
 * and the template item editor. Sibling of `StepLink` and fixed-size for the
 * same reason: the row lives inside a `SortableList`, so nothing here may
 * change its height. Filled only when the step has a note.
 */
export function StepNote({ step, onPress }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const has = !!step.notes?.trim();

  return (
    <TouchableOpacity
      onPress={() => { haptics.tap(); onPress(); }}
      style={[styles.button, has && styles.buttonSet]}
      activeOpacity={interaction.activeOpacity}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={has ? `Note for ${step.title}` : `Add a note for ${step.title}`}
    >
      <Ionicons
        name="document-text-outline"
        size={iconSize.sm}
        color={has ? colors.text : colors.textTertiary}
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
