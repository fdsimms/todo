import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// A single letter is three ambiguous pairs read aloud (two S's, two T's), so
// the circles carry the full name for screen readers.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={DAY_NAMES[day]}
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
  // Matches `interaction.pillHeight`, so a weekday circle and an option pill
  // in the same picker are the same size.
  day: {
    width: interaction.pillHeight,
    height: interaction.pillHeight,
    borderRadius: interaction.pillHeight / 2,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayActive: {
    backgroundColor: colors.accentFill,
  },
  dayText: {
    color: colors.text,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  dayTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.semibold,
  },
});
