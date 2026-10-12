import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf } from '../utils/dateUtils';

interface Props {
  days: Date[];
  /** Whether a day is the filled one. Called with the day's `dayKeyOf` key. */
  isOn: (dayKey: string) => boolean;
  onPress: (dayKey: string) => void;
  accessibilityLabelFor: (day: Date, on: boolean) => string;
  /**
   * Makes a filled day inert. For a row whose filled days are taken off
   * somewhere else, rather than by tapping them again.
   */
  disableOn?: boolean;
}

/**
 * One chip per day in a week-sized row: weekday letter over day number, the
 * filled one in the accent. The Plan a meal sheet's "When" and the planned
 * meal sheet's "Move to" and "Also on" are all this, so the three can't drift.
 * Carries its own 16pt side inset, the way every label above it in those cards
 * is inset.
 */
export function DayChipRow({ days, isOn, onPress, accessibilityLabelFor, disableOn }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      {days.map(day => {
        const key = dayKeyOf(day);
        const on = isOn(key);
        const inert = !!disableOn && on;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.chip, on && styles.chipOn]}
            disabled={inert}
            onPress={() => { haptics.tap(); onPress(key); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityState={inert ? { selected: on, disabled: true } : { selected: on }}
            accessibilityLabel={accessibilityLabelFor(day, on)}
          >
            <Text style={[styles.top, on && styles.textOn]}>{format(day, 'EEEEE')}</Text>
            <Text style={[styles.num, on && styles.textOn]}>{format(day, 'd')}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  chipOn: { backgroundColor: colors.accentFill },
  top: { color: colors.text, fontSize: font.xs, fontWeight: fontWeight.semibold },
  num: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  textOn: { color: colors.onAccent },
});
