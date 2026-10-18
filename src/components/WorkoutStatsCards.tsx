import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { format } from 'date-fns/format';
import { AnimatedBarFill } from './AnimatedBarFill';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import type { WeightUnit } from '../utils/weightLog';
import { MUSCLE_LABELS } from '../utils/workoutData';
import type { MuscleRow, WeekBar } from '../utils/workoutRecords';
import { formatRecordValue, recordLabel } from '../utils/workoutRecordText';
import type { WorkoutStatsRecord } from '../hooks/useWorkoutStats';

/**
 * The three cards of Stats' WORKOUTS section (the screen draws each one's
 * heading and cascade, as it does for every other section). Built to
 * docs/arch/workouts-mocks (the Stats mock in the phase 3 work): the bars are
 * the screen's own completions chart, the muscle rows are `ContrastBars`' track
 * and fill, and the records are a plain list.
 *
 * Counts, never a score: nothing here grades how much anybody trained.
 */

const BAR_HEIGHT = 96;
/** Every second week is labeled, counting back from the current one: eight dates would touch. */
const LABEL_EVERY = 2;

/** The workouts started in each of the last weeks, as the screen's bar columns. */
export function WorkoutWeeksCard({ weeks }: { weeks: readonly WeekBar[] }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const max = Math.max(1, ...weeks.map(w => w.count));
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`Workouts per week, ${weeks.map(w => `week of ${format(new Date(`${w.weekKey}T12:00:00`), 'MMMM d')}: ${w.count}`).join(', ')}`}
    >
      <View style={styles.chartInner}>
        {weeks.map((w, i) => {
          const labeled = (weeks.length - 1 - i) % LABEL_EVERY === 0;
          return (
            <View key={w.weekKey} style={styles.chartCol}>
              <Text style={styles.barCount}>{w.count > 0 ? w.count : ' '}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.bar,
                    { height: `${Math.max(3, Math.round((w.count / max) * 100))}%`, backgroundColor: w.current ? colors.accent : colors.bgQuaternary },
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, w.current && { color: colors.accent, fontWeight: fontWeight.semibold }]} numberOfLines={1}>
                {labeled ? format(new Date(`${w.weekKey}T12:00:00`), 'MMM d') : ' '}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Sets credited to each muscle this week, on one scale. Whole numbers and halves, since a helper gets half a set. */
export function WorkoutMusclesCard({ muscles }: { muscles: readonly MuscleRow[] }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const max = Math.max(1, ...muscles.map(m => m.sets));
  return (
    <View style={styles.card}>
      <View style={styles.muscleList}>
        {muscles.map(m => (
          <View
            key={m.muscle}
            style={styles.muscleRow}
            accessible
            accessibilityLabel={`${MUSCLE_LABELS[m.muscle]}, ${Number(m.sets.toFixed(1))} ${m.sets === 1 ? 'set' : 'sets'}`}
          >
            <Text style={styles.muscleName} numberOfLines={1}>{MUSCLE_LABELS[m.muscle]}</Text>
            <View style={styles.track} accessible={false} importantForAccessibility="no">
              <AnimatedBarFill percent={Math.max(4, Math.round((m.sets / max) * 100))} style={styles.fill} />
            </View>
            <Text style={styles.muscleValue}>{Number(m.sets.toFixed(1))}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption}>
        A set counts once for each muscle it mainly trains and half for each it helps. Warm-ups don’t count.
      </Text>
    </View>
  );
}

/** The newest personal records, one row per exercise and workout. */
export function WorkoutRecordsCard({ records, unit }: { records: readonly WorkoutStatsRecord[]; unit: WeightUnit }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.card}>
      {records.map(({ event, name, kind }, i) => {
        const date = format(new Date(`${event.dayKey}T12:00:00`), 'MMM d');
        const value = formatRecordValue(event, kind, unit);
        return (
          <View
            key={`${event.exerciseId}-${event.sessionId}`}
            style={[styles.recordRow, i > 0 && styles.recordSep]}
            accessible
            accessibilityLabel={`${name}, ${recordLabel(event.type, kind, event.reps)} ${value}, ${date}`}
          >
            <View style={styles.recordMain}>
              <Text style={styles.recordName}>{name}</Text>
              <Text style={styles.recordLabel}>{recordLabel(event.type, kind, event.reps)}</Text>
            </View>
            <View style={styles.recordEnd}>
              <Text style={styles.recordValue}>{value}</Text>
              <Text style={styles.recordLabel}>{date}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  chartInner: { flexDirection: 'row', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  chartCol: { flex: 1, alignItems: 'center' },
  barCount: { minHeight: 16, color: colors.textTertiary, fontSize: font.xs, textAlign: 'center' },
  barTrack: { width: 20, height: BAR_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: 20, borderRadius: 4 },
  barLabel: { marginTop: 4, color: colors.textTertiary, fontSize: font.xxs, fontWeight: fontWeight.medium, textAlign: 'center' },
  muscleList: { paddingTop: spacing.smd, paddingBottom: spacing.xs, gap: spacing.sm },
  muscleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  muscleName: { width: 96, color: colors.text, fontSize: font.sm },
  muscleValue: { width: 34, textAlign: 'right', color: colors.textSecondary, fontSize: font.xs, fontVariant: ['tabular-nums'] },
  track: { flex: 1, height: 7, borderRadius: radius.full, backgroundColor: colors.separator, overflow: 'hidden' },
  fill: { height: 7, borderRadius: radius.full, backgroundColor: colors.accent },
  caption: { color: colors.textTertiary, fontSize: font.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.smd },
  recordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  recordSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  recordMain: { flex: 1 },
  recordEnd: { alignItems: 'flex-end', flexShrink: 0 },
  recordName: { color: colors.text, fontSize: font.md },
  recordLabel: { color: colors.textSecondary, fontSize: font.xs },
  recordValue: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
});
