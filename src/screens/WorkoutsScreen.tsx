import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import { differenceInMinutes } from 'date-fns/differenceInMinutes';
import type { WorkoutRoutine, WorkoutSession } from '../types';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { SearchField } from '../components/SearchField';
import { SegmentedControl } from '../components/SegmentedControl';
import { useFilterField } from '../hooks/useFilterField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { useStartWorkout } from '../hooks/useStartWorkout';
import { InlineAction } from '../components/InlineAction';
import { RoutineEditorSheet } from '../components/RoutineEditorSheet';
import { LazySheet } from '../components/LazySheet';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { catalogExercise, describeExercise, searchExercises, type CatalogExercise } from '../utils/exerciseCatalog';
import { describeRoutine } from '../utils/workoutRoutine';
import { formatTimeOfDay } from '../utils/dateUtils';

/**
 * The Workouts area: the workouts logged so far, the routines to start one
 * from, and the exercise library. See docs/arch/workouts.md; the routine list
 * and the in-progress card are mocked in the phase 2 PR.
 *
 * A workout in progress shows above every view as a card with Resume, since
 * workout mode can be closed without ending it and this is the way back. A
 * routine starts with one tap on its row's Start; tapping the row edits it.
 *
 * The library search matches a name, a muscle or the equipment ("dumbbell
 * chest"). Behind its own switch (`workoutsEnabled`, off by default) and in
 * the Health hub beside the other logs of what a body did.
 */

type View_ = 'history' | 'routines' | 'exercises';

const VIEW_OPTIONS = [
  { value: 'history' as const, label: 'History' },
  { value: 'routines' as const, label: 'Routines' },
  { value: 'exercises' as const, label: 'Exercises' },
];


function sessionLine(session: WorkoutSession, sets: number): string {
  const parts = [format(new Date(session.startedAt), 'EEE, MMM d')];
  if (session.endedAt === null) {
    parts.push('In progress');
  } else {
    const minutes = differenceInMinutes(new Date(session.endedAt), new Date(session.startedAt));
    if (minutes > 0) parts.push(`${minutes} min`);
  }
  parts.push(`${sets} ${sets === 1 ? 'set' : 'sets'}`);
  return parts.join(' · ');
}

export function WorkoutsScreen() {
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const sessions = useWorkoutStore(s => s.sessions);
  const setCounts = useWorkoutStore(s => s.setCounts);
  const exercises = useWorkoutStore(s => s.exercises);
  const routines = useWorkoutStore(s => s.routines);
  const live = useWorkoutStore(s => s.sessions.find(x => x.endedAt === null) ?? null);
  const liveSets = useWorkoutStore(s => (live ? s.setsBySession[live.id] : undefined));
  const startWorkout = useStartWorkout();
  // Which routine the editor is on (null for a new one), kept through the
  // close so the sheet doesn't retitle itself while it slides away.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRoutineId, setEditorRoutineId] = useState<string | null>(null);

  const [view, setView] = useState<View_>('history');
  // Only the library has a field, so only its list listens for the keyboard.
  const keyboardScroll = useKeyboardInsetScroll<FlatList>({
    refreshing: pullSearch.pulling,
    listMounted: view === 'exercises',
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const search = useFilterField();
  const results = useMemo(
    () => searchExercises(exercises, search.query).map(r => r.exercise),
    [exercises, search.query]
  );

  const toggleOpen = useCallback((id: string) => {
    haptics.tap();
    animateLayout();
    setOpenId(prev => (prev === id ? null : id));
  }, []);

  const renderSession = useCallback(({ item }: { item: WorkoutSession }) => (
    <View style={styles.row}>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.detail}>{sessionLine(item, setCounts[item.id] ?? 0)}</Text>
    </View>
  ), [styles, setCounts]);

  const renderExercise = useCallback(({ item }: { item: CatalogExercise }) => {
    const open = openId === item.id;
    const about = item.notes || item.cue;
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={interaction.activeOpacity}
        onPress={() => toggleOpen(item.id)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${item.name}. ${describeExercise(item)}`}
        accessibilityHint={about ? (open ? 'Hides how it is done' : 'Shows how it is done') : undefined}
      >
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.detail}>{describeExercise(item)}</Text>
        {open && about ? <Text style={styles.cue}>{about}</Text> : null}
      </TouchableOpacity>
    );
  }, [styles, openId, toggleOpen]);

  const listBottom = { paddingBottom: tabBarHeight + spacing.xl };

  const openEditor = useCallback((routineId: string | null) => {
    haptics.tap();
    setEditorRoutineId(routineId);
    setEditorOpen(true);
  }, []);

  const renderRoutine = useCallback(({ item }: { item: WorkoutRoutine }) => (
    <TouchableOpacity
      style={[styles.row, styles.routineRow]}
      activeOpacity={interaction.activeOpacity}
      onPress={() => openEditor(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${item.name}`}
    >
      <View style={styles.flex}>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.detail}>
          {describeRoutine(item.items, id => catalogExercise(exercises, id)?.primaryMuscles ?? [])}
        </Text>
      </View>
      <InlineAction
        label="Start"
        onPress={() => startWorkout({ routineId: item.id })}
        accessibilityLabel={`Start a workout from ${item.name}`}
      />
    </TouchableOpacity>
  ), [styles, exercises, openEditor, startWorkout]);

  const liveDone = (liveSets ?? []).filter(x => x.completedAt !== null).length;
  const liveCard = live ? (
    <View style={styles.liveCard}>
      <View style={styles.flex}>
        <Text style={styles.liveTag}>In progress</Text>
        <Text style={styles.title} numberOfLines={1}>{live.title}</Text>
        <Text style={styles.detail}>
          {`Started ${formatTimeOfDay(new Date(live.startedAt))} · ${liveDone} of ${(liveSets ?? []).length} sets`}
        </Text>
      </View>
      <InlineAction
        label="Resume"
        onPress={() => { haptics.tap(); useWorkoutModeStore.getState().show(); }}
        accessibilityLabel={`Resume ${live.title}`}
      />
    </View>
  ) : null;

  const routineActions = (
    <View style={styles.actions}>
      <InlineAction icon="add" label="New routine" surface="page" onPress={() => openEditor(null)} />
      {!live && (
        <InlineAction label="Empty workout" variant="neutral" surface="page" onPress={() => startWorkout()} />
      )}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Workouts"
        subtitle={sessions.length > 0 ? `${sessions.length} ${sessions.length === 1 ? 'workout' : 'workouts'}` : undefined}
      />
      <HubPills hub="health" active="Workouts" />
      <View style={styles.segments}>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
          label="Show"
          surface="page"
        />
      </View>

      {liveCard}

      {view === 'routines' ? (
        routines.length === 0 ? (
          <EmptyState
            icon="list-outline"
            title="No routines yet"
            subtitle="A routine is a list of exercises with the sets you plan for each. Start a workout from it with one tap."
            actionLabel="New routine"
            onAction={() => openEditor(null)}
            bottomOffset={tabBarHeight}
          />
        ) : (
          <FlatList
            data={routines}
            keyExtractor={r => r.id}
            renderItem={renderRoutine}
            refreshControl={pullSearch.refreshControl}
            contentContainerStyle={[styles.list, listBottom]}
            ListFooterComponent={routineActions}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : view === 'history' ? (
        sessions.length === 0 ? (
          <EmptyState
            icon="barbell-outline"
            title="No workouts yet"
            subtitle="Workouts you log show here, newest first. Start one from a routine, or start an empty one and add exercises as you go."
            actionLabel={live ? undefined : 'Start a workout'}
            onAction={live ? undefined : () => startWorkout()}
            bottomOffset={tabBarHeight}
          />
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={s => s.id}
            renderItem={renderSession}
            refreshControl={pullSearch.refreshControl}
            contentContainerStyle={[styles.list, listBottom]}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : (
        <>
          <SearchField
            field={search}
            placeholder="Search exercises"
            style={styles.search}
            accessibilityLabel="Search exercises by name, muscle or equipment"
          />
          {results.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title="Nothing matches"
              subtitle={`No exercise matches “${search.query.trim()}”. Try a muscle or a piece of equipment.`}
              bottomOffset={tabBarHeight}
            />
          ) : (
            <FlatList
              data={results}
              keyExtractor={e => e.id}
              renderItem={renderExercise}
              refreshControl={pullSearch.refreshControl}
              contentContainerStyle={[styles.list, listBottom]}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              {...keyboardScroll.props}
              ref={keyboardScroll.ref}
            />
          )}
        </>
      )}
      {pullSearch.sheet}
      <LazySheet open={editorOpen}>
        <RoutineEditorSheet
          visible={editorOpen}
          routineId={editorRoutineId}
          onClose={() => setEditorOpen(false)}
        />
      </LazySheet>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  segments: { paddingHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
  search: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, gap: spacing.sm },
  flex: { flex: 1 },
  routineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  liveCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd,
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    backgroundColor: colors.bgSecondary, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.accent,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
  },
  liveTag: {
    color: colors.accentText, fontSize: font.xxs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: spacing.xxs,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  row: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
  },
  title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  detail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  cue: { color: colors.text, fontSize: font.sm, marginTop: spacing.sm },
});
