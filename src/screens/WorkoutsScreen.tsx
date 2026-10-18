import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import { differenceInMinutes } from 'date-fns/differenceInMinutes';
import type { WorkoutSession } from '../types';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { SearchField } from '../components/SearchField';
import { SegmentedControl } from '../components/SegmentedControl';
import { useFilterField } from '../hooks/useFilterField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { describeExercise, searchExercises, type CatalogExercise } from '../utils/exerciseCatalog';

/**
 * The Workouts area, as far as phase 1 of docs/arch/workouts.md goes: the
 * workouts logged so far, newest first, and the exercise library to browse.
 *
 * Logging is phase 2, so this is a reader. The library search matches a name,
 * a muscle or the equipment ("dumbbell chest"), which is the whole of its
 * filtering for now: the catalog's muscle and equipment filters wait for the
 * picker that needs them.
 *
 * Behind its own switch (`workoutsEnabled`, off by default) and in the Health
 * hub beside the other logs of what a body did.
 */

type View_ = 'history' | 'exercises';

const VIEW_OPTIONS = [
  { value: 'history' as const, label: 'History' },
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

      {view === 'history' ? (
        sessions.length === 0 ? (
          <EmptyState
            icon="barbell-outline"
            title="No workouts yet"
            subtitle="Workouts you log show here, newest first."
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
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  segments: { paddingHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
  search: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, gap: spacing.sm },
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
