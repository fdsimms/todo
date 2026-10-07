import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { DOSE_UNITS } from '../utils/medicationLog';
import { ChoiceMenuChip, type ChoiceGroup } from './ChoiceMenuChip';
import { TextField } from './TextField';

const NO_UNIT_KEY = 'none';
/** The units that are a measure, as against a form you count. */
const MEASURED_UNITS = new Set(['mg', 'mcg', 'g', 'ml']);

const DOSE_UNIT_GROUPS: ChoiceGroup[] = [
  { heading: 'MEASURED', options: DOSE_UNITS.filter(u => MEASURED_UNITS.has(u.value)).map(u => ({ key: u.value, label: u.value })) },
  { heading: 'COUNTED', options: DOSE_UNITS.filter(u => !MEASURED_UNITS.has(u.value)).map(u => ({ key: u.value, label: u.value })) },
  { options: [{ key: NO_UNIT_KEY, label: 'No unit' }] },
];

interface Props {
  amount: string;
  onChangeAmount: (next: string) => void;
  unit: string | null;
  onChangeUnit: (next: string | null) => void;
  /** For `SheetModal`'s development warnings. */
  name: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A medication's "how much": the number, with its unit as a chip inside the
 * field. Ten units in two rows of segments sat under the field and outweighed
 * it, for a value most people set once per medication. Both places that ask
 * (the task editor and a chain step's sheet) use this, so the unit list, its
 * grouping and the way a unit is cleared can't drift apart.
 */
export function DoseAmountField({ amount, onChangeAmount, unit, onChangeUnit, name, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.row, style]}>
      <TextField
        style={styles.input}
        value={amount}
        onChangeText={onChangeAmount}
        placeholder="e.g. 50"
        placeholderTextColor={colors.textTertiary}
        keyboardType="decimal-pad"
        returnKeyType="done"
        accessibilityLabel="How much, optional"
      />
      <ChoiceMenuChip
        groups={DOSE_UNIT_GROUPS}
        selectedKey={unit}
        onSelect={key => onChangeUnit(key === NO_UNIT_KEY ? null : key)}
        noun="Unit"
        name={name}
      />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingLeft: spacing.smd,
      paddingRight: spacing.xs,
    },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
      // Height rather than lineHeight, see the TextInput note in CLAUDE.md.
      minHeight: 36,
    },
  });
}
