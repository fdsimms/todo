import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, interaction, radius, spacing, type Colors } from '../theme';
import { NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { TextField } from './TextField';

interface Props {
  /** Minutes on this row; null = none set, and whatever the fallback is applies. */
  value: number | null;
  /** The row's title, for the accessibility label. */
  label: string;
  /** What the number is for, for the accessibility label — "Time estimate", "Timer". */
  what?: string;
  onChange: (minutes: number | null) => void;
  /**
   * Offer a seconds unit: the unit letter becomes a button that flips m and s,
   * and a value in seconds is stored as a fraction of a minute (45s is 0.75).
   * For a subtask's stretch of a countdown; a chain step's estimate stays in
   * whole minutes.
   */
  allowSeconds?: boolean;
}

/**
 * The minutes field on a step row inside an editor: a chain step's own time
 * estimate (task editor, template item editor), and a subtask's stretch of a
 * timed task's countdown (task editor).
 *
 * Minutes only, with no min/hr toggle like the task-level effort field has —
 * these are the small units a task breaks into, and every step of a routine
 * long enough to need hours would still be typed in two digits. Clearing the
 * field restores the fallback (for a chain step, the task's own estimate; for a
 * subtask, no stretch at all), which is why an empty value has to be null
 * rather than 0.
 *
 * Deliberately always visible rather than unfolding on tap, which is how the
 * rest of the editor handles a secondary control: this one sits inside a
 * SortableList row, and a control that expands in place would change the row's
 * height mid-drag — the one thing that list's displacement math can't absorb.
 * The fixed height keeps the row from resizing as the value comes and goes.
 */
export function StepMinutes({ value, label, what = 'Time estimate', onChange, allowSeconds = false }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const fractional = allowSeconds && value != null && !Number.isInteger(value);
  const [unit, setUnit] = useState<'m' | 's'>(fractional ? 's' : 'm');
  // A value that arrives in seconds from outside (an undo, a sync) switches the
  // unit to match; one already in seconds stays, so 60s doesn't flip to 1m.
  useEffect(() => { if (fractional) setUnit('s'); }, [fractional]);
  const inSeconds = allowSeconds && unit === 's';
  const shown = value == null ? '' : String(inSeconds ? Math.round(value * 60) : value);
  const toMinutes = (n: number, u: 'm' | 's') => (u === 's' ? n / 60 : n);
  const flip = () => {
    const next = unit === 's' ? 'm' : 's';
    setUnit(next);
    // The number typed keeps its digits and takes the new unit, as the
    // editor's Duration field does.
    const n = parseInt(shown, 10);
    if (Number.isFinite(n) && n > 0) onChange(toMinutes(n, next));
  };

  return (
    <View style={styles.wrap}>
      <TextField
        style={[styles.input, value != null && styles.inputSet]}
        value={shown}
        onChangeText={text => {
          const digits = text.replace(/[^0-9]/g, '');
          const n = parseInt(digits, 10);
          onChange(Number.isFinite(n) && n > 0 ? toMinutes(n, inSeconds ? 's' : 'm') : null);
        }}
        keyboardType="number-pad"
        placeholder={inSeconds ? 'sec' : 'min'}
        placeholderTextColor={colors.textTertiary}
        maxLength={4}
        returnKeyType="done"
        inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
        accessibilityLabel={`${what} in ${inSeconds ? 'seconds' : 'minutes'} for ${label}`}
      />
      {allowSeconds ? (
        <TouchableOpacity
          onPress={flip}
          activeOpacity={interaction.activeOpacity}
          hitSlop={8}
          style={styles.unitButton}
          accessibilityRole="button"
          accessibilityLabel={`Unit for ${label}, ${inSeconds ? 'seconds' : 'minutes'}. Tap to switch.`}
        >
          <Text style={styles.unit}>{inSeconds ? 's' : 'm'}</Text>
        </TouchableOpacity>
      ) : value != null ? <Text style={styles.unit}>m</Text> : null}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center',
    flexShrink: 0,
  },
  // Unfilled it's just the placeholder — most lists never set a per-row time,
  // and a row of empty wells reads as fields waiting to be completed. The
  // surface appears once the value does, so a step that carries a time looks
  // like it carries one.
  input: {
    minWidth: 34, minHeight: 26,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: 'transparent',
    color: colors.textSecondary,
    fontSize: font.sm,
    textAlign: 'right',
  },
  inputSet: { backgroundColor: colors.bgTertiary, color: colors.text },
  unit: {
    color: colors.textTertiary, fontSize: font.sm,
    marginLeft: 1,
  },
  unitButton: {
    minWidth: 22, minHeight: 22, marginLeft: spacing.xs,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.controlBorder, borderRadius: radius.sm,
  },
});
