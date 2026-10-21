import { weightScale } from '../utils/dumbbellLoad';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { format } from 'date-fns/format';
import { EmptyNote } from './EmptyNote';
import { HelpText } from './HelpText';
import { ExerciseProgressChart, type ExerciseChartPoint } from './ExerciseProgressChart';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { catalogExercise } from '../utils/exerciseCatalog';
import { routineProgress, routineSessions, volumeForChart, type RoutineExerciseProgress } from '../utils/routineProgress';
import { formatProgressChange, formatTopSetLine, formatVolume } from '../utils/workoutRecordText';
import type { WorkoutSet } from '../types';

/**
 * A routine's progress: how many workouts it has had, the volume lifted in each,
 * and each exercise's best set from the first workout to the latest. Built to
 * the approved mock, with the exercise's name on a row of its own so a long
 * name is never cut by the figures beside it. Everything is derived on open
 * (`routineProgress`); see docs/arch/workouts.md, "A routine's progress".
 *
 * It lives in the routine editor behind the Edit / Progress control rather than
 * as a screen of its own: it is a view of one routine, and the editor is where
 * the routine is. A row opens the exercise's own page, through `onOpenExercise`,
 * which the host renders inside its sheet.
 */

interface Props {
  routineId: string;
  /** The routine's exercises, in its saved order. */
  exerciseIds: readonly string[];
  onOpenExercise: (exerciseId: string) => void;
  /** Fires true while a finger scrubs the chart, so the host can turn its scroll off. */
  onScrubChange: (scrubbing: boolean) => void;
}

const SPARK_WIDTH = 84;
const SPARK_HEIGHT = 34;
const SPARK_INSET = 5;

const dayLabel = (dayKey: string) => format(new Date(`${dayKey}T12:00:00`), 'MMM d');

function Sparkline({ values, latestIsRecord, colors }: { values: readonly number[]; latestIsRecord: boolean; colors: Colors }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const points = values.map((v, i) => ({
    x: SPARK_INSET + (i * (SPARK_WIDTH - SPARK_INSET * 2)) / (values.length - 1),
    // A flat series sits on the middle line rather than the floor.
    y: span === 0 ? SPARK_HEIGHT / 2 : SPARK_HEIGHT - SPARK_INSET - ((v - lo) / span) * (SPARK_HEIGHT - SPARK_INSET * 2),
  }));
  return (
    <Svg width={SPARK_WIDTH} height={SPARK_HEIGHT} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={colors.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => {
        const last = i === points.length - 1;
        return <Circle key={i} cx={p.x} cy={p.y} r={last ? 4 : 2.5} fill={last && latestIsRecord ? colors.done : colors.accent} />;
      })}
    </Svg>
  );
}

export function RoutineProgressView({ routineId, exerciseIds, onOpenExercise, onScrubChange }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const sessions = useWorkoutStore(s => s.sessions);
  const exercises = useWorkoutStore(s => s.exercises);
  const unit = useSettingsStore(s => s.workoutUnit);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const dumbbellEntry = useSettingsStore(s => s.dumbbellEntry);
  // A pair total reads each stored one-dumbbell weight doubled (`dumbbellLoad.ts`).
  const scaleOf = (id: string) => weightScale(catalogExercise(exercises, id), dumbbellEntry);

  const progress = useMemo(() => {
    const mine = routineSessions(routineId, sessions);
    const store = useWorkoutStore.getState();
    const setsBySession = new Map<string, readonly WorkoutSet[]>(mine.map(s => [s.id, store.loadSets(s.id)]));
    return routineProgress({
      exerciseIds,
      sessions: mine,
      setsBySession,
      kindOf: id => catalogExercise(exercises, id)?.kind ?? 'weight_reps',
      unit,
      dayResetTime,
      scaleOf: id => weightScale(catalogExercise(exercises, id), dumbbellEntry),
    });
  }, [routineId, exerciseIds, sessions, exercises, unit, dayResetTime, dumbbellEntry]);

  if (progress.workouts === 0) {
    return (
      <EmptyNote icon="trending-up-outline">No workouts from this routine yet. Its progress appears here after the first one.</EmptyNote>
    );
  }

  const volume = progress.volume;
  const latestVolume = volume.length > 0 ? volume[volume.length - 1] : null;
  const chartPoints: ExerciseChartPoint[] = volume.map(v => ({
    dayKey: v.dayKey,
    value: volumeForChart(v.volumeKg, unit),
    text: formatVolume(v.volumeKg, 'weight_reps', unit),
  }));
  const percent = progress.volumeChangePercent;
  const tiles: { value: string; label: string }[] = [
    { value: String(progress.workouts), label: progress.workouts === 1 ? 'Workout' : 'Workouts' },
  ];
  if (latestVolume) tiles.push({ value: formatVolume(latestVolume.volumeKg, 'weight_reps', unit), label: 'Last volume' });
  if (percent !== null) tiles.push({ value: `${percent > 0 ? '+' : ''}${percent}%`, label: 'Volume since first' });

  const rowSummary = (e: RoutineExerciseProgress, name: string) => {
    if (!e.first || !e.latest) return `${name}, no workouts yet`;
    return `${name}, ${formatTopSetLine(e.first, e.latest, e.workouts, e.kind, unit, scaleOf(e.exerciseId))}${e.change !== null ? `, ${formatProgressChange(e.change, e.kind, unit)}` : ''}`;
  };

  return (
    <View>
      <Text style={styles.subtitle}>
        {progress.workouts === 1 ? '1 workout' : `${progress.workouts} workouts`}
        {progress.firstDayKey ? ` since ${dayLabel(progress.firstDayKey)}` : ''}
      </Text>

      <View style={styles.tiles}>
        {tiles.map(t => (
          <View key={t.label} style={styles.tile} accessible accessibilityLabel={`${t.label}: ${t.value}`}>
            <Text style={styles.tileValue}>{t.value}</Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      {chartPoints.length >= 2 && (
        <>
          <Text style={styles.groupLabel}>Volume per workout</Text>
          <View style={[styles.card, styles.chart]}>
            <ExerciseProgressChart
              points={chartPoints}
              formatAxis={v => (v >= 1000 ? `${Number((v / 1000).toFixed(1))}k` : String(v))}
              onScrubChange={onScrubChange}
              summary={`Volume per workout, ${chartPoints.length} workouts, latest ${chartPoints[chartPoints.length - 1].text}`}
            />
          </View>
        </>
      )}

      <Text style={styles.groupLabel}>Exercises</Text>
      <View style={styles.card}>
        {progress.exercises.map((e, i) => {
          const name = catalogExercise(exercises, e.exerciseId)?.name ?? 'Exercise';
          return (
            <TouchableOpacity
              key={e.exerciseId}
              style={[styles.exRow, i > 0 && styles.rowSep]}
              onPress={() => onOpenExercise(e.exerciseId)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={rowSummary(e, name)}
              accessibilityHint="Opens the exercise page"
            >
              <Text style={styles.exName}>{name}</Text>
              {e.first && e.latest ? (
                <View style={styles.exFigures}>
                  <Text style={styles.exTop}>{formatTopSetLine(e.first, e.latest, e.workouts, e.kind, unit, scaleOf(e.exerciseId))}</Text>
                  {e.plot.length >= 2 && <Sparkline values={e.plot.map(p => p.value)} latestIsRecord={e.latestIsRecord} colors={colors} />}
                  {e.change !== null && (
                    <View style={styles.exChangeWrap}>
                      <Text style={[styles.exChange, e.change > 0 && styles.exChangeUp]}>{formatProgressChange(e.change, e.kind, unit)}</Text>
                      {e.firstDayKey && <Text style={styles.exSince}>since {dayLabel(e.firstDayKey)}</Text>}
                    </View>
                  )}
                </View>
              ) : (
                <Text style={styles.exTop}>Not done in these workouts yet</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      <HelpText style={styles.foot}>
        Volume is weight times reps over the sets you checked off, warm-ups left out. Gold marks a heavier top set than any earlier workout of this routine. Tap an exercise for its full chart.
      </HelpText>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  subtitle: { color: colors.textSecondary, fontSize: font.sm, textAlign: 'center', marginBottom: spacing.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { flexGrow: 1, flexBasis: '30%', backgroundColor: colors.bgSecondary, borderRadius: radius.md, paddingHorizontal: spacing.smd, paddingVertical: spacing.smd },
  tileValue: { color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  tileLabel: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  chart: { paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.xs },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  exRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  exName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  exFigures: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, marginTop: spacing.xs },
  exTop: { flex: 1, color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs, fontVariant: ['tabular-nums'] },
  exChangeWrap: { minWidth: 68, alignItems: 'flex-end' },
  exChange: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  exChangeUp: { color: colors.greenText },
  exSince: { color: colors.textTertiary, fontSize: font.xxs },
  foot: { color: colors.textTertiary, fontSize: font.xs, marginHorizontal: spacing.xs, marginTop: spacing.smd },
});
