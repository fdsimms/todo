import React, { useMemo } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { DOSE_UNITS } from '../utils/medicationLog';
import { ChoiceMenuChip, type ChoiceGroup } from './ChoiceMenuChip';
import { TextField } from './TextField';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';

const NO_UNIT_KEY = 'none';
/** The units that are a measure, as against a form you count. */
const MEASURED_UNITS = new Set(['mg', 'mcg', 'g', 'ml']);

/** Only the measured units, for a strength: "each capsule contains 125 mcg". */
const MEASURED_UNIT_GROUPS: ChoiceGroup[] = [
  { options: DOSE_UNITS.filter(u => MEASURED_UNITS.has(u.value)).map(u => ({ key: u.value, label: u.value })) },
  { options: [{ key: NO_UNIT_KEY, label: 'No unit' }] },
];

function doseUnitGroups(countedOnly: readonly string[] | undefined): ChoiceGroup[] {
  const counted = DOSE_UNITS
    .filter(u => !MEASURED_UNITS.has(u.value) && (!countedOnly || countedOnly.includes(u.value)))
    .map(u => ({ key: u.value, label: u.value }));
  return [
    { heading: 'MEASURED', options: DOSE_UNITS.filter(u => MEASURED_UNITS.has(u.value)).map(u => ({ key: u.value, label: u.value })) },
    ...(counted.length > 0 ? [{ heading: 'COUNTED', options: counted }] : []),
    { options: [{ key: NO_UNIT_KEY, label: 'No unit' }] },
  ];
}

const DOSE_UNIT_GROUPS = doseUnitGroups(undefined);

interface Props {
  amount: string;
  onChangeAmount: (next: string) => void;
  unit: string | null;
  onChangeUnit: (next: string | null) => void;
  /** For `SheetModal`'s development warnings. */
  name: string;
  style?: StyleProp<ViewStyle>;
  /** Which units the menu offers. Measured only is for a strength, which is never a count. */
  units?: 'all' | 'measured';
  /**
   * Limits the counted units (tablet, spray, ...) to these, for a medication
   * that is only ever taken one way. The unit already chosen is always kept.
   * Measured units are never limited.
   */
  countedUnits?: readonly string[];
  placeholder?: string;
  /** What the chip says until a unit is picked. */
  unitPlaceholder?: string;
}

/**
 * A medication's "how much": the number, with its unit as a chip inside the
 * field. Ten units in two rows of segments sat under the field and outweighed
 * it, for a value most people set once per medication. Both places that ask
 * (the task editor and a chain step's sheet) use this, so the unit list, its
 * grouping and the way a unit is cleared can't drift apart.
 */
export function DoseAmountField({
  amount, onChangeAmount, unit, onChangeUnit, name, style, units = 'all', countedUnits, placeholder = 'e.g. 125', unitPlaceholder = 'Choose unit',
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const countedKey = countedUnits ? [...countedUnits, unit ?? ''].join('|') : '';
  const unitGroups = useMemo(
    () => (units === 'measured' ? MEASURED_UNIT_GROUPS
      : countedUnits ? doseUnitGroups(unit ? [...countedUnits, unit] : countedUnits)
      : DOSE_UNIT_GROUPS),
    [units, countedKey],
  );
  return (
    <>
      <View style={[styles.row, style]}>
        <TextField
          style={styles.input}
          value={amount}
          onChangeText={onChangeAmount}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          keyboardType="decimal-pad"
          inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
          returnKeyType="done"
          accessibilityLabel="How much, optional"
        />
        <ChoiceMenuChip
          groups={unitGroups}
          selectedKey={unit}
          onSelect={key => onChangeUnit(key === NO_UNIT_KEY ? null : key)}
          noun="Unit"
          fallbackLabel={unitPlaceholder}
          name={name}
        />
      </View>
      {/* Mounted here rather than left to the host: this field is used by
          sheets that don't render the Done bar themselves (a chain step's
          medication sheet). Several copies are fine, newest one wins. */}
      <NumberPadAccessory />
    </>
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
