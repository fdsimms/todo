import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { canStep, stepCount, type StepRange } from '../utils/stepper';
import { formatDose } from '../utils/medicationLog';

/** A counted dose (tablets, sprays) is one whole number: at least 1, and no more than a bottle's worth. */
const DOSE_RANGE: StepRange = { min: 1, max: 99 };

interface Props {
  amount: number;
  unit: string;
  onChange: (amount: number) => void;
  /** Tapping the amount opens the full dose sheet, where the unit can change too. */
  onOpenSheet: () => void;
  medication: string;
}

/**
 * The `− 2 sprays +` pill on a task row that logs a dose of its own medicine.
 * It replaces the "Logs 2 sprays" chip, which hid the amount behind a dropdown
 * and repeated what the title often already says. The unit sits inside the pill,
 * so no "Logs" word is needed.
 *
 * Deliberately smaller than `CountStepper` (44pt keys), which is built for an
 * editor row: this lives in a row's meta line next to 11pt chips, so the keys
 * are 24pt wide and reach 44pt of touch area through `hitSlop` instead.
 * It steps only counted units. A measured dose (mg, ml) has no natural step of
 * 1, so those keep the chip and its sheet (`completionLogChips`' `stepper`).
 */
export function DoseStepper({ amount, unit, onChange, onOpenSheet, medication }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const label = formatDose({ amount, unit, strength: null }) ?? `${amount} ${unit}`;

  const step = (delta: number) => {
    const next = stepCount(amount, delta, DOSE_RANGE);
    if (next === null || next === amount) return;
    haptics.tap();
    onChange(next);
  };

  const key = (delta: number, icon: 'remove' | 'add', verb: string) => {
    const enabled = canStep(amount, delta, DOSE_RANGE);
    return (
      <PressableScale
        style={[styles.key, !enabled && styles.keyDisabled]}
        onPress={() => step(delta)}
        disabled={!enabled}
        hitSlop={{ top: 8, bottom: 8, left: delta < 0 ? 8 : 0, right: delta > 0 ? 8 : 0 }}
        accessibilityLabel={`${verb} ${medication} dose`}
        accessibilityState={{ disabled: !enabled }}
      >
        <Ionicons name={icon} size={iconSize.xs} color={colors.accentText} />
      </PressableScale>
    );
  };

  return (
    <View style={styles.wrap}>
      {key(-1, 'remove', 'Decrease')}
      <TouchableOpacity
        onPress={() => { haptics.tap(); onOpenSheet(); }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`Logs ${label}. Change the unit`}
      >
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
      {key(1, 'add', 'Increase')}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.full,
  },
  key: {
    width: 28,
    paddingVertical: spacing.xsm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDisabled: { opacity: 0.4 },
  label: {
    color: colors.accentText,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
});
