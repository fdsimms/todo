import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Exercise } from '../types';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { catalogExercise } from '../utils/exerciseCatalog';
import type { ExerciseRecordsSummary } from '../utils/workoutRecords';
import { formatRecordChange, recordLabel } from '../utils/workoutRecordText';
import type { WeightUnit } from '../utils/weightLog';

interface Props {
  /** What the workout beat, from `sessionRecordSummary`. */
  records: readonly ExerciseRecordsSummary[];
  /** The exercise rows, to name each exercise and read what kind it is. */
  exercises: readonly Exercise[];
  unit: WeightUnit;
  style?: StyleProp<ViewStyle>;
}

/**
 * The records one workout set, one block per exercise: its name, then each
 * record as "Estimated 1RM   102 kg → 104.5 kg". Workout mode's finish summary
 * and the workout page both draw it, so a record reads the same on both; the
 * caller draws the section label above it and hides the section when there
 * are none.
 */
export function WorkoutRecordsCard({ records, exercises, unit, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.card, style]}>
      {records.map((r, i) => {
        const info = catalogExercise(exercises, r.exerciseId);
        const kind = info?.kind ?? 'weight_reps';
        const name = info?.name ?? 'Unknown exercise';
        return (
          <View
            key={r.exerciseId}
            style={[styles.row, i > 0 && styles.rowSep]}
            accessible
            accessibilityLabel={`${name}. ${r.records.map(e => {
              const change = formatRecordChange(e, kind, unit);
              return `${recordLabel(e.type, kind, e.reps)}, up from ${change.before} to ${change.after}`;
            }).join('. ')}`}
          >
            <Text style={styles.name}>{name}</Text>
            {r.records.map(e => {
              const change = formatRecordChange(e, kind, unit);
              return (
                <View key={`${e.type}-${e.reps ?? 0}`} style={styles.line}>
                  <Text style={styles.label}>{recordLabel(e.type, kind, e.reps)}</Text>
                  <Text style={styles.value}>
                    <Text style={styles.before}>{`${change.before} → `}</Text>
                    {change.after}
                  </Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  name: { color: colors.text, fontSize: font.md },
  line: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.smd, marginTop: spacing.xs },
  label: { flex: 1, color: colors.textSecondary, fontSize: font.sm },
  value: { flexShrink: 0, color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'], textAlign: 'right' },
  before: { color: colors.textSecondary, fontWeight: fontWeight.regular },
});
