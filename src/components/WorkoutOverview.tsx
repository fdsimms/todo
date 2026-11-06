import React, { useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, type RefreshControlProps } from 'react-native';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import Ionicons from '@expo/vector-icons/Ionicons';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWorkoutStats } from '../hooks/useWorkoutStats';
import { startWorkout } from '../utils/startWorkout';
import { InlineAction } from './InlineAction';
import { WorkoutMusclesCard, WorkoutRecordsCard, WorkoutWeeksCard } from './WorkoutStatsCards';
import { WorkoutStatTiles } from './WorkoutStatTiles';
import { catalogExercise } from '../utils/exerciseCatalog';
import { dayKeyOf, getLogicalDayKey } from '../utils/dateUtils';
import { currentProgram, isRunnableProgram, programProgress, weekLabel } from '../utils/workoutProgram';
import { describeRoutine } from '../utils/workoutRoutine';
import { sessionDayKey, trainingDays, weekKeyOf } from '../utils/workoutRecords';
import { haptics } from '../utils/haptics';

interface Props {
  /** The History rows of the newest workouts, drawn by the screen so they read and open as they do there. */
  recent: ReactNode;
  /** Whether a workout is in progress: the screen's own card already says so above every view, so no start card here. */
  live: boolean;
  onSeeAll: () => void;
  /** Opens a routine's page; the Up next card's name and exercises are the button. */
  onOpenRoutine: (routineId: string) => void;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  bottomPadding: number;
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The Workouts area's first view: what to do next, how this week is going, and
 * the same weekly bars, muscles and records Stats draws (`useWorkoutStats`), so
 * the figures agree between the two. Everything here is derived from the log,
 * and nothing is a goal or a score: counts only, as docs/arch/workouts.md says.
 * Finished workouts only, like Stats; the live one has its own card.
 */
export function WorkoutOverview({ recent, live, onSeeAll, onOpenRoutine, refreshControl, bottomPadding }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const sessions = useWorkoutStore(s => s.sessions);
  const setCounts = useWorkoutStore(s => s.setCounts);
  const volumeKgBySession = useWorkoutStore(s => s.volumeKgBySession);
  const routines = useWorkoutStore(s => s.routines);
  const programs = useWorkoutStore(s => s.programs);
  const exercises = useWorkoutStore(s => s.exercises);
  const currentProgramId = useSettingsStore(s => s.currentProgramId);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const unit = useSettingsStore(s => s.workoutUnit);

  const todayKey = getLogicalDayKey(new Date(), dayResetTime);
  const stats = useWorkoutStats(true, todayKey);
  const finished = useMemo(() => sessions.filter(s => s.endedAt !== null), [sessions]);

  // ==== up next ====
  // The current program's next routine; with no program, the routine of the newest workout, to do again.
  const next = useMemo(() => {
    const program = currentProgram(programs, currentProgramId);
    if (program && isRunnableProgram(program)) {
      const progress = programProgress(program, sessions, routines);
      const routine = routines.find(r => r.id === progress.nextRoutineId);
      if (routine) return { routine, tag: `Up next · ${weekLabel(progress)}`, programId: program.id };
    }
    const last = finished.find(s => s.routineId !== null && routines.some(r => r.id === s.routineId && !r.archived));
    const routine = last ? routines.find(r => r.id === last.routineId) : undefined;
    return routine ? { routine, tag: 'Up next', programId: null } : null;
  }, [programs, currentProgramId, sessions, routines, finished]);

  // ==== this week ====
  const week = useMemo(() => {
    const weekKey = weekKeyOf(todayKey, weekStartsOn);
    const start = new Date(`${weekKey}T12:00:00`);
    const trained = trainingDays(finished, dayResetTime);
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      const key = dayKeyOf(date);
      return { key, letter: WEEKDAY_LETTERS[date.getDay()], done: trained.has(key), today: key === todayKey };
    });
    const inWeek = finished.filter(s => weekKeyOf(sessionDayKey(s.startedAt, dayResetTime), weekStartsOn) === weekKey);
    return {
      days,
      workouts: inWeek.length,
      sets: inWeek.reduce((n, s) => n + (setCounts[s.id] ?? 0), 0),
      volumeKg: inWeek.reduce((n, s) => n + (volumeKgBySession[s.id] ?? 0), 0),
    };
  }, [finished, todayKey, weekStartsOn, dayResetTime, setCounts, volumeKgBySession]);

  const heading = (text: string, action?: ReactNode) => (
    <View style={styles.headingRow}>
      <Text style={styles.heading} accessibilityRole="header">{text}</Text>
      {action}
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
    >
      {!live && (
        <View style={styles.card}>
          <TouchableOpacity
            disabled={!next}
            onPress={() => next && onOpenRoutine(next.routine.id)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={next ? `Open routine ${next.routine.name}` : undefined}
          >
            <Text style={styles.tag}>{next ? next.tag : 'Ready when you are'}</Text>
            <View style={styles.titleRow}>
              <Text style={styles.heroTitle}>{next ? next.routine.name : 'Empty workout'}</Text>
              {next && <Ionicons name="chevron-forward" size={iconSize.md} color={colors.textSecondary} style={styles.chevron} />}
            </View>
            <Text style={styles.detail}>
              {next
                ? describeRoutine(next.routine.items, id => catalogExercise(exercises, id)?.primaryMuscles ?? [])
                : 'Add exercises as you go.'}
            </Text>
          </TouchableOpacity>
          <InlineAction
            icon="play"
            label="Start workout"
            style={styles.start}
            onPress={() => {
              haptics.tap();
              if (next?.programId) startWorkout({ programId: next.programId });
              else startWorkout({ routineId: next?.routine.id ?? null });
            }}
            accessibilityLabel={next ? `Start ${next.routine.name}` : 'Start an empty workout'}
          />
        </View>
      )}

      {heading('This week')}
      <View style={styles.card}>
        <View style={styles.weekRow} accessible accessibilityLabel={`Trained on ${week.days.filter(d => d.done).length} of 7 days this week`}>
          {week.days.map(d => (
            <View key={d.key} style={styles.day}>
              <Text style={[styles.dayLetter, d.today && styles.dayToday]}>{d.letter}</Text>
              <View style={[styles.dot, d.done && styles.dotDone]} />
            </View>
          ))}
        </View>
        <WorkoutStatTiles
          compact
          minutes={0}
          exercises={week.workouts}
          sets={week.sets}
          volumeKg={week.volumeKg}
          unit={unit}
          style={styles.tiles}
          countLabel={week.workouts === 1 ? 'Workout' : 'Workouts'}
        />
      </View>

      {stats && (
        <>
          {heading('Workouts per week')}
          <WorkoutWeeksCard weeks={stats.weeks} />
          {stats.muscles.length > 0 && (
            <>
              {heading('Sets by muscle this week')}
              <WorkoutMusclesCard muscles={stats.muscles} />
            </>
          )}
          {stats.records.length > 0 && (
            <>
              {heading('New records')}
              <WorkoutRecordsCard records={stats.records} unit={unit} />
            </>
          )}
        </>
      )}

      {finished.length > 0 && (
        <>
          {heading('Recent', (
            <TouchableOpacity
              onPress={() => { haptics.tap(); onSeeAll(); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="See all workouts in History"
              hitSlop={8}
            >
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.recent}>{recent}</View>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, padding: spacing.md },
  tag: {
    color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  heroTitle: { flex: 1, color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold },
  chevron: { marginLeft: spacing.xs },
  detail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  start: { alignSelf: 'flex-start', marginTop: spacing.smd },
  headingRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.xs,
  },
  heading: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  seeAll: { color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { alignItems: 'center', gap: spacing.xs, flex: 1 },
  dayLetter: { color: colors.textSecondary, fontSize: font.xs },
  dayToday: { color: colors.accentText, fontWeight: fontWeight.semibold },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.controlBorder },
  dotDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  tiles: { marginTop: spacing.md },
  recent: { gap: spacing.sm },
});
