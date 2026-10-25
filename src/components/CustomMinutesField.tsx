import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { customMinutesProblem, type MinutesRange } from '../utils/customMinutes';
import { NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { TextField } from './TextField';

interface Props {
  /** What the person has typed. The caller owns it, so it can seed and read it back. */
  text: string;
  onChangeText: (text: string) => void;
  range: MinutesRange;
  /** Names the field for the screen reader: "Reminder length". */
  label: string;
  autoFocus?: boolean;
  /** The word after the number. Defaults to "minutes". */
  unit?: string;
}

/**
 * A whole number of minutes, typed where a row's presets don't have the one
 * wanted. Shows why a number can't be used instead of silently clamping it, so
 * the row never saves a value other than the one on screen. Parsing and the
 * range rule are `customMinutes.ts`; this is the field and its message.
 */
export function CustomMinutesField({ text, onChangeText, range, label, autoFocus, unit = 'minutes' }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const problem = customMinutesProblem(text, range);

  return (
    <View>
      <View style={styles.row}>
        <TextField
          style={[styles.input, problem !== null && styles.inputProblem]}
          value={text}
          onChangeText={t => onChangeText(t.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          placeholder="e.g. 45"
          placeholderTextColor={colors.textTertiary}
          maxLength={5}
          autoFocus={autoFocus}
          returnKeyType="done"
          inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
          accessibilityLabel={`${label} in ${unit}`}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
      {problem !== null && <Text style={styles.problem}>{problem}</Text>}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    minWidth: 72,
    minHeight: 40,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    backgroundColor: colors.bgTertiary,
    color: colors.text,
    fontSize: font.md,
  },
  inputProblem: { borderColor: colors.redText },
  unit: { color: colors.textSecondary, fontSize: font.md },
  problem: { color: colors.redText, fontSize: font.sm, marginTop: spacing.xs },
});
