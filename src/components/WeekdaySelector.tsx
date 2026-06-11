import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  /** Selected weekdays, 0 = Sunday. */
  value: number[];
  onChange: (days: number[]) => void;
}

/** Sun–Sat toggle row for weekly recurrence days. */
export function WeekdaySelector({ value, onChange }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const toggle = (day: number) => {
    haptics.tap();
    onChange(
      value.includes(day)
        ? value.filter(d => d !== day)
        : [...value, day].sort((a, b) => a - b),
    );
  };

  return (
    <View style={styles.row}>
      {DAY_LABELS.map((label, day) => {
        const active = value.includes(day);
        return (
          <TouchableOpacity
            key={day}
            style={[styles.day, active && styles.dayActive]}
            onPress={() => toggle(day)}
            activeOpacity={interaction.activeOpacity}
          >
            <Text style={[styles.dayText, active && styles.dayTextActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  day: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayActive: {
    backgroundColor: colors.accent,
  },
  dayText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  dayTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.semibold,
  },
});
