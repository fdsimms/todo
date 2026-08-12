import React from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';

interface Props {
  /** Minutes on this row; null = none set, and whatever the fallback is applies. */
  value: number | null;
  /** The row's title, for the accessibility label. */
  label: string;
  /** What the number is for, for the accessibility label — "Time estimate", "Timer". */
  what?: string;
  onChange: (minutes: number | null) => void;
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
export function StepMinutes({ value, label, what = 'Time estimate', onChange }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  return (
    <View style={styles.wrap}>
      <TextInput
        style={[styles.input, value != null && styles.inputSet]}
        value={value != null ? String(value) : ''}
        onChangeText={text => {
          const digits = text.replace(/[^0-9]/g, '');
          const minutes = parseInt(digits, 10);
          onChange(Number.isFinite(minutes) && minutes > 0 ? minutes : null);
        }}
        keyboardType="number-pad"
        placeholder="min"
        placeholderTextColor={colors.textTertiary}
        maxLength={4}
        returnKeyType="done"
        inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
        accessibilityLabel={`${what} in minutes for ${label}`}
      />
      {value != null ? <Text style={styles.unit}>m</Text> : null}
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
    minWidth: 34, height: 26,
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
});
