import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ChainItem } from '../types';
import { deliverableMeta } from '../utils/deliverables';
import { useColors } from '../theme/ThemeContext';
import { radius, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  /** The step this button belongs to. */
  step: ChainItem;
  /** Whether the step's answer is set to date the step after it. */
  datesNextStep: boolean;
  onPress: () => void;
}

/**
 * The "what does finishing this step ask for" button on a chain step row, in
 * the task editor and the template item editor.
 *
 * Sibling of `StepMinutes`, and fixed-size for the same reason: the row lives
 * inside a `SortableList`, so nothing here may change the row's height. The
 * kind's own glyph when one is set (the same icons the picker shows, off
 * `DELIVERABLE_META`, so the row and the picker can't disagree), a hollow
 * question mark when it isn't — the unset state stays a placeholder rather
 * than a filled well, again like `StepMinutes`, because most steps never ask
 * anything and a row of filled buttons reads as settings already made.
 *
 * A date that schedules the next step gets a small arrow badge: it's the one
 * setting here that changes another row, and it would otherwise look identical
 * to a date that's merely recorded.
 */
export function StepQuestion({ step, datesNextStep, onPress }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const kind = step.deliverableKind ?? null;
  const label = kind
    ? `Question for ${step.title}, ${deliverableMeta(kind).label}${datesNextStep ? ', schedules the next step' : ''}`
    : `Ask something when ${step.title} is completed`;

  return (
    <TouchableOpacity
      onPress={() => { haptics.tap(); onPress(); }}
      style={[styles.button, kind && styles.buttonSet]}
      activeOpacity={interaction.activeOpacity}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name={(kind ? deliverableMeta(kind).icon : 'help-circle-outline') as never}
        size={iconSize.sm}
        color={kind ? colors.text : colors.textTertiary}
      />
      {datesNextStep && (
        <View style={styles.badge}>
          <Ionicons name="arrow-forward" size={9} color={colors.onAccent} />
        </View>
      )}
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
  badge: {
    position: 'absolute',
    right: 0, bottom: 0,
    width: 12, height: 12, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accent,
  },
});
