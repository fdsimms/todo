import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';

interface Props {
  /** Whole minutes, `sessionMinutes`. */
  minutes: number;
  exercises: number;
  sets: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A workout's three figures in a row of tiles: how long, how many exercises,
 * how many sets. Workout mode's finish summary and the workout page both draw
 * it, so the figures read the same on both; each caller says what it counts.
 */
export function WorkoutStatTiles({ minutes, exercises, sets, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tiles = [
    { value: `${minutes} min`, label: 'Time' },
    { value: String(exercises), label: exercises === 1 ? 'Exercise' : 'Exercises' },
    { value: String(sets), label: sets === 1 ? 'Set' : 'Sets' },
  ];
  return (
    <View style={[styles.row, style]}>
      {tiles.map(t => (
        <View key={t.label} style={styles.tile} accessible accessibilityLabel={`${t.label}: ${t.value}`}>
          <Text style={styles.value}>{t.value}</Text>
          <Text style={styles.label}>{t.label}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, backgroundColor: colors.bgSecondary, borderRadius: radius.md, paddingHorizontal: spacing.smd, paddingVertical: spacing.smd },
  value: { color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  label: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
});
