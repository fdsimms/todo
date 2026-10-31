import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { kgToUnit, type WeightUnit } from '../utils/weightLog';
import { withThousands } from '../utils/workoutRecordText';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';

interface Props {
  /** Whole minutes, `sessionMinutes`. */
  minutes: number;
  exercises: number;
  sets: number;
  /** Kilograms lifted, `liftVolumeKg`; null or 0 reads as 0. */
  volumeKg: number | null;
  unit: WeightUnit;
  /** One row of exercises, sets and volume, for a caller that already says the time elsewhere. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A workout's four figures in a two-by-two grid of tiles (four across leaves a six-digit volume no room): how long, how many exercises,
 * how many sets, and the volume lifted (0 when nothing weighted was done). Workout mode's finish summary and the workout page both draw
 * it, so the figures read the same on both; each caller says what it counts.
 */
export function WorkoutStatTiles({ minutes, exercises, sets, volumeKg, unit, compact = false, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tiles = [
    ...(compact ? [] : [{ value: `${minutes} min`, label: 'Time' }]),
    { value: String(exercises), label: exercises === 1 ? 'Exercise' : 'Exercises' },
    { value: String(sets), label: sets === 1 ? 'Set' : 'Sets' },
    { value: withThousands(kgToUnit(volumeKg ?? 0, unit)), label: `Volume (${unit})` },
  ];
  return (
    <View style={[styles.row, compact && styles.rowCompact, style]}>
      {tiles.map(t => (
        <View key={t.label} style={[styles.tile, compact && styles.tileCompact]} accessible accessibilityLabel={`${t.label}: ${t.value}`}>
          <Text style={styles.value}>{t.value}</Text>
          <Text style={styles.label}>{t.label}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowCompact: { flexWrap: 'nowrap' },
  tileCompact: { flexBasis: 0, minWidth: 0 },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.bgSecondary, borderRadius: radius.md, paddingHorizontal: spacing.smd, paddingVertical: spacing.smd },
  value: { color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  label: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
});
