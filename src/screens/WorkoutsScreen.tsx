import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View, type GestureResponderEvent } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { WorkoutProgram, WorkoutRoutine, WorkoutSession } from '../types';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { SearchField } from '../components/SearchField';
import { SegmentedControl } from '../components/SegmentedControl';
import { useFilterField } from '../hooks/useFilterField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { useStartWorkout } from '../hooks/useStartWorkout';
import { InlineAction } from '../components/InlineAction';
import { RoutineEditorSheet } from '../components/RoutineEditorSheet';
import { ProgramEditorSheet } from '../components/ProgramEditorSheet';
import { ProgramLibrarySheet } from '../components/ProgramLibrarySheet';
import { EmptyNote } from '../components/EmptyNote';
import { HelpText } from '../components/HelpText';
import { ExerciseDetailSheet } from '../components/ExerciseDetailSheet';
import { WorkoutDetailSheet } from '../components/WorkoutDetailSheet';
import { LazySheet } from '../components/LazySheet';
import { ActionMenu } from '../components/ActionMenu';
import type { CardAnchor } from '../components/CardSheet';
import { CsvExportSheet } from '../components/CsvExportSheet';
import { WorkoutImportSheet } from '../components/WorkoutImportSheet';
import { GymsSheet } from '../components/GymsSheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { pickBackupFile } from '../utils/backupFile';
import { afterSheetsDismissed } from '../utils/sheetModal';
import {
  parseWorkoutCsv,
  workoutExportCsv,
  workoutExportFileName,
  workoutExportSummary,
  type ExportedWorkout,
} from '../utils/workoutCsv';
import { dayKeyOf } from '../utils/dateUtils';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { catalogExercise, describeExercise, searchExercises, type CatalogExercise } from '../utils/exerciseCatalog';
import { describeRoutine } from '../utils/workoutRoutine';
import { useGymStore } from '../store/useGymStore';
import { describeRoutineFit, lastUsedGymId, routineFit } from '../utils/gyms';
import { describeProgress, programProgress } from '../utils/workoutProgram';
import { trainingMaxRaises } from '../utils/workoutProgression';
import { formatWeightNumber } from '../utils/workoutData';
import { formatTimeOfDay } from '../utils/dateUtils';
import { sessionMinutes } from '../utils/workoutSession';
import { useHealthWorkoutHistory } from '../hooks/useHealthWorkoutHistory';
import {
  healthWorkoutLine,
  healthWorkoutSource,
  healthWorkoutTitle,
  interleaveHistory,
  type WorkoutHistoryRow,
} from '../utils/workoutHistory';

/**
 * The Workouts area: the workouts logged so far, the routines to start one
 * from, and the exercise library. See docs/arch/workouts.md; the routine list
 * and the in-progress card are mocked in the phase 2 PR.
 *
 * A workout in progress shows above every view as a card with Resume, since
 * workout mode can be closed without ending it and this is the way back. A
 * routine starts with one tap on its row's Start; tapping the row edits it.
 * A program's card starts its next routine (derived from its sessions,
 * `programProgress`) and, when a percentage program has just finished a
 * cycle, offers the raised training maxes for the next one: a proposal shown
 * in full, written only on the tap.
 *
 * The library search matches a name, a muscle or the equipment ("dumbbell
 * chest"). Tapping an exercise opens its page (`ExerciseDetailSheet`): the
 * chart, the personal records and every session that did it. Behind its own switch (`workoutsEnabled`, off by default), with
 * a menu row of its own after Groceries & meals (it was a Health hub pill until it outgrew the logs there).
 *
 * Tapping a finished workout in History opens its page (`WorkoutDetailSheet`):
 * its times, records, sets, effort and notes, and the way to delete it. The
 * one still in progress opens workout mode instead, as Resume does.
 *
 * The History view also lists workouts other apps recorded in Health, between
 * the sessions by date and marked "From Health" with the app that recorded
 * them (`useHealthWorkoutHistory`, `workoutHistory.ts`). They are read for the
 * window the list shows and never stored or counted: the header's count is
 * the app's own workouts, and records, Stats and the mood contrast never see
 * them. An empty read adds nothing, not a prompt to connect Health, since a
 * refused read and no workouts look the same.
 */

type View_ = 'history' | 'routines' | 'programs' | 'exercises';

const VIEW_OPTIONS = [
  { value: 'history' as const, label: 'History' },
  { value: 'routines' as const, label: 'Routines' },
  { value: 'programs' as const, label: 'Programs' },
  { value: 'exercises' as const, label: 'Exercises' },
];


/**
 * "Tue, Oct 14 · 52 min · 17 sets". The set count is every set row the
 * session has (`setCounts`), and the minutes are `sessionMinutes`: the
 * workout page's tiles read the same two, so the row and the page agree.
 */
function sessionLine(session: WorkoutSession, sets: number): string {
  const parts = [format(new Date(session.startedAt), 'EEE, MMM d')];
  if (session.endedAt === null) {
    parts.push('In progress');
  } else {
    const minutes = sessionMinutes(session);
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
  const programs = useWorkoutStore(s => s.programs);
  const live = useWorkoutStore(s => s.sessions.find(x => x.endedAt === null) ?? null);
  const liveSets = useWorkoutStore(s => (live ? s.setsBySession[live.id] : undefined));
  const startWorkout = useStartWorkout();
  // The gym a workout would start at, so a routine that needs what it lacks says so before Start.
  const gyms = useGymStore(s => s.gyms);
  const fitGym = useMemo(() => {
    const id = lastUsedGymId(gyms, sessions);
    return gyms.find(g => g.id === id) ?? null;
  }, [gyms, sessions]);
  // Which routine the editor is on (null for a new one), kept through the
  // close so the sheet doesn't retitle itself while it slides away.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRoutineId, setEditorRoutineId] = useState<string | null>(null);
  // The same for the program editor, and the library it can be opened from.
  const [programEditorOpen, setProgramEditorOpen] = useState(false);
  const [editorProgramId, setEditorProgramId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  // The menu off the header's "…", the file picked to import (kept through the
  // sheet's close so it doesn't empty while it slides away) and the export sheet.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<CardAnchor | null>(null);
  const [importText, setImportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [gymsOpen, setGymsOpen] = useState(false);
  const workoutUnit = useSettingsStore(s => s.workoutUnit);
  const loadSets = useWorkoutStore(s => s.loadSets);

  const [view, setView] = useState<View_>('history');
  // Only the library has a field, so only its list listens for the keyboard.
  const keyboardScroll = useKeyboardInsetScroll<FlatList>({
    refreshing: pullSearch.pulling,
    listMounted: view === 'exercises',
  });
  // The exercise whose page is open, kept through the close so the sheet
  // doesn't retitle itself while it slides away.
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const search = useFilterField();
  const results = useMemo(
    () => searchExercises(exercises, search.query).map(r => r.exercise),
    [exercises, search.query]
  );

  const openExercise = useCallback((id: string) => {
    haptics.tap();
    setDetailId(id);
    setDetailOpen(true);
  }, []);

  // The workout whose page is open. Its sets are read before the page opens,
  // so it never draws a frame without them.
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const shownSessionId = useSheetSubject(openSessionId);
  const openSession = useCallback((session: WorkoutSession) => {
    haptics.tap();
    if (session.endedAt === null) {
      useWorkoutModeStore.getState().show();
      return;
    }
    useWorkoutStore.getState().loadSets(session.id);
    setOpenSessionId(session.id);
  }, []);

  const health = useHealthWorkoutHistory(sessions, view === 'history');
  const historyRows = useMemo(
    () => interleaveHistory(sessions, health.workouts, health.windowStart),
    [sessions, health.workouts, health.windowStart],
  );

  const renderHistoryRow = useCallback(({ item }: { item: WorkoutHistoryRow }) => {
    if (item.kind === 'session') {
      const line = sessionLine(item.session, setCounts[item.session.id] ?? 0);
      return (
        <TouchableOpacity
          style={[styles.row, styles.exerciseRow]}
          activeOpacity={interaction.activeOpacity}
          onPress={() => openSession(item.session)}
          accessibilityRole="button"
          accessibilityLabel={`${item.session.title}, ${line}`}
          accessibilityHint={item.session.endedAt === null ? 'Opens the workout in progress' : 'Opens its times, records and sets'}
        >
          <View style={styles.flex}>
            <Text style={styles.title}>{item.session.title}</Text>
            <Text style={styles.detail}>{line}</Text>
          </View>
          <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
        </TouchableOpacity>
      );
    }
    // A reading, not an entry: it names the app that recorded it and what kind
    // of workout it says it was, and offers nothing to tap.
    const source = healthWorkoutSource(item.workout);
    const title = healthWorkoutTitle(item.workout);
    const line = healthWorkoutLine(item.workout);
    return (
      <View style={styles.row} accessible accessibilityLabel={`${title}, ${line}. ${source}`}>
        <View style={styles.healthTagRow}>
          <Ionicons name="heart" size={iconSize.xs} color={colors.textSecondary} />
          <Text style={styles.healthTag} numberOfLines={1}>{source}</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail}>{line}</Text>
      </View>
    );
  }, [styles, setCounts, colors, openSession]);

  const renderExercise = useCallback(({ item }: { item: CatalogExercise }) => (
    <TouchableOpacity
      style={[styles.row, styles.exerciseRow]}
      activeOpacity={interaction.activeOpacity}
      onPress={() => openExercise(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}. ${describeExercise(item)}`}
      accessibilityHint="Opens its history and records"
    >
      <View style={styles.flex}>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.detail}>{describeExercise(item)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  ), [styles, colors, openExercise]);

  const listBottom = { paddingBottom: tabBarHeight + spacing.xl };

  const openEditor = useCallback((routineId: string | null) => {
    haptics.tap();
    setEditorRoutineId(routineId);
    setEditorOpen(true);
  }, []);

  const fitLine = useCallback(
    (routine: WorkoutRoutine) => (fitGym ? describeRoutineFit(routineFit(fitGym, routine, exercises), fitGym.name) : null),
    [fitGym, exercises],
  );

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
        {!!fitLine(item) && <Text style={styles.fitDetail}>{fitLine(item)}</Text>}
      </View>
      <InlineAction
        label="Start"
        onPress={() => startWorkout({ routineId: item.id })}
        accessibilityLabel={`Start a workout from ${item.name}`}
      />
    </TouchableOpacity>
  ), [styles, exercises, openEditor, startWorkout, fitLine]);

  const openProgram = useCallback((programId: string | null) => {
    haptics.tap();
    setEditorProgramId(programId);
    setProgramEditorOpen(true);
  }, []);

  const routineName = useCallback((id: string) => routines.find(r => r.id === id)?.name ?? null, [routines]);
  const livePrograms = useMemo(() => programs.filter(p => !p.archived), [programs]);

  const renderProgram = useCallback(({ item }: { item: WorkoutProgram }) => {
    const progress = programProgress(item, sessions, routines);
    const next = progress.nextRoutineId ? routineName(progress.nextRoutineId) : null;
    // The raised maxes for the next cycle of a percentage program, offered at
    // the moment one ends; starting the next cycle writes them and counts the
    // weeks again from now.
    const raises = progress.cycleDone && item.scheme === 'percent'
      ? trainingMaxRaises(item, id => catalogExercise(exercises, id)?.primaryMuscles ?? [], workoutUnit)
      : [];
    const startNextCycle = () => {
      useWorkoutStore.getState().updateProgram(item.id, {
        trainingMaxes: raises.map(r => ({ exerciseId: r.exerciseId, kg: r.toKg })),
        startedAt: new Date().toISOString(),
      });
      haptics.success();
    };
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={interaction.activeOpacity}
        onPress={() => openProgram(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${item.name}`}
      >
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.detail}>{describeProgress(item, progress, routineName)}</Text>
        {raises.length > 0 && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>Raise the training maxes for the next cycle:</Text>
            {raises.map(r => (
              <View key={r.exerciseId} style={styles.noticeLine}>
                <Text style={styles.noticeName}>{catalogExercise(exercises, r.exerciseId)?.name ?? 'Unknown exercise'}</Text>
                <Text style={styles.noticeValue}>
                  {`${formatWeightNumber(r.fromKg, workoutUnit)} → ${formatWeightNumber(r.toKg, workoutUnit)} ${workoutUnit}`}
                </Text>
              </View>
            ))}
          </View>
        )}
        {(next || raises.length > 0) && (
          <View style={styles.actions}>
            {raises.length > 0 && <InlineAction label="Start again" onPress={startNextCycle} />}
            {next && (
              <InlineAction
                icon="play"
                label={`Start ${next}`}
                variant={raises.length > 0 ? 'neutral' : undefined}
                onPress={() => startWorkout({ programId: item.id })}
                accessibilityLabel={`Start ${next}, the next workout of ${item.name}`}
              />
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  }, [styles, sessions, routines, routineName, exercises, workoutUnit, openProgram, startWorkout]);

  const programActions = (
    <View>
      <View style={styles.actions}>
        <InlineAction icon="add" label="New program" surface="page" onPress={() => openProgram(null)} />
        <InlineAction label="From the library" variant="neutral" surface="page" onPress={() => { haptics.tap(); setLibraryOpen(true); }} />
      </View>
      <HelpText style={styles.footHint}>
        A program is routines done in turn. A week is one pass through them, so a week off waits for you.
      </HelpText>
    </View>
  );

  // Reads the file before opening the review sheet, so a file that isn't a
  // Strong or Hevy export is told so here, with what to do, rather than as an
  // empty sheet. In demo mode the import writes to the demo database like any
  // other change there, and is thrown away with it.
  const startImport = useCallback(async () => {
    let text: string | null;
    try {
      // Raised from the "…" menu, which is still leaving: iOS refuses to
      // present the picker over it.
      await afterSheetsDismissed();
      text = await pickBackupFile();
    } catch {
      Alert.alert('Couldn’t read the file', 'The file couldn’t be opened. Pick it again, or export it again from the app.');
      return;
    }
    if (text === null) return;
    const result = parseWorkoutCsv(text);
    if (!result.ok) {
      if (result.reason === 'unknown') {
        Alert.alert('Not a Strong or Hevy export', 'In Strong or Hevy, export your workouts as a CSV file, then pick that file here.');
      } else if (result.reason === 'empty') {
        Alert.alert('That file is empty', 'Export your workouts again and pick the new file.');
      } else {
        Alert.alert('No workouts found', 'The file has the right columns but no workouts with sets in them.');
      }
      return;
    }
    setImportText(text);
    setImportOpen(true);
  }, []);

  const selectForExport = useCallback((from: string | null): ExportedWorkout[] =>
    sessions
      .filter(s => s.endedAt !== null && (from === null || dayKeyOf(new Date(s.startedAt)) >= from))
      .map(session => ({ session, sets: loadSets(session.id) })),
  [sessions, loadSets]);

  const liveDone = (liveSets ?? []).filter(x => x.completedAt !== null).length;
  const liveCard = live ? (
    <View style={styles.liveCard}>
      <View>
        <Text style={styles.liveTag}>In progress</Text>
        <Text style={styles.title} numberOfLines={2}>{live.title}</Text>
        <Text style={styles.detail}>
          {`Started ${formatTimeOfDay(new Date(live.startedAt))} · ${liveDone} of ${(liveSets ?? []).length} sets`}
        </Text>
      </View>
      <View style={styles.actions}>
        <InlineAction
          label="Resume"
          onPress={() => { haptics.tap(); useWorkoutModeStore.getState().show(); }}
          accessibilityLabel={`Resume ${live.title}`}
        />
      </View>
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
        actions={[{
          icon: 'ellipsis-horizontal' as const,
          onPress: (e: GestureResponderEvent) => {
            haptics.tap();
            setMenuAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
            setMenuOpen(true);
          },
          accessibilityLabel: 'More workout options',
        }]}
      />
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

      {view === 'programs' ? (
        <FlatList
          data={livePrograms}
          keyExtractor={p => p.id}
          renderItem={renderProgram}
          refreshControl={pullSearch.refreshControl}
          contentContainerStyle={[styles.list, listBottom]}
          ListHeaderComponent={livePrograms.length === 0 ? (
            <View style={styles.row}>
              <EmptyNote icon="calendar-outline">
                No programs yet. Add one from the library, or make your own from your routines.
              </EmptyNote>
            </View>
          ) : null}
          ListFooterComponent={programActions}
          showsVerticalScrollIndicator={false}
        />
      ) : view === 'routines' ? (
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
            data={historyRows}
            keyExtractor={r => r.key}
            renderItem={renderHistoryRow}
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
      <LazySheet open={menuOpen}>
        <ActionMenu
          visible={menuOpen}
          title="Workouts"
          anchor={menuAnchor}
          onClose={() => setMenuOpen(false)}
          actions={[
            { key: 'gyms', label: 'Gyms', icon: 'location-outline', onPress: () => setGymsOpen(true) },
            { key: 'import', label: 'Import from Strong or Hevy', icon: 'download-outline', onPress: () => { void startImport(); } },
            ...(sessions.some(s => s.endedAt !== null)
              ? [{ key: 'export', label: 'Export as CSV', icon: 'share-outline' as const, onPress: () => setExportOpen(true) }]
              : []),
          ]}
        />
      </LazySheet>
      <LazySheet open={gymsOpen}>
        <GymsSheet visible={gymsOpen} onClose={() => setGymsOpen(false)} />
      </LazySheet>
      <LazySheet open={importOpen}>
        <WorkoutImportSheet visible={importOpen} onClose={() => setImportOpen(false)} fileText={importText} />
      </LazySheet>
      <LazySheet open={exportOpen}>
        <CsvExportSheet
          visible={exportOpen}
          onClose={() => setExportOpen(false)}
          hint={`A spreadsheet of your finished workouts, one row per set: date, workout, exercise, weight in ${workoutUnit}, reps, distance, time and notes.`}
          dialogTitle="Share your workouts"
          select={selectForExport}
          toCsv={rows => workoutExportCsv(rows, exercises, workoutUnit)}
          fileName={workoutExportFileName}
          summary={workoutExportSummary}
        />
      </LazySheet>
      <LazySheet open={detailOpen}>
        <ExerciseDetailSheet visible={detailOpen} exerciseId={detailId} onClose={() => setDetailOpen(false)} />
      </LazySheet>
      {shownSessionId && (
        <WorkoutDetailSheet
          visible={openSessionId !== null}
          sessionId={shownSessionId}
          onClose={() => setOpenSessionId(null)}
        />
      )}
      <LazySheet open={libraryOpen}>
        <ProgramLibrarySheet
          visible={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          onAdded={id => {
            // One sheet down and the next up in the same commit: SheetModal
            // holds the open until the close has landed.
            setLibraryOpen(false);
            setEditorProgramId(id);
            setProgramEditorOpen(true);
          }}
        />
      </LazySheet>
      <LazySheet open={programEditorOpen}>
        <ProgramEditorSheet
          visible={programEditorOpen}
          programId={editorProgramId}
          onClose={() => setProgramEditorOpen(false)}
        />
      </LazySheet>
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
  exerciseRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  liveCard: {
    gap: spacing.smd,
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
  notice: { backgroundColor: colors.bgTertiary, borderRadius: radius.md, paddingHorizontal: spacing.smd, paddingVertical: spacing.sm, marginTop: spacing.smd, gap: spacing.xs },
  noticeText: { color: colors.text, fontSize: font.sm },
  noticeLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  noticeName: { flex: 1, color: colors.textSecondary, fontSize: font.sm },
  noticeValue: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  footHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  detail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  fitDetail: { color: colors.orangeText, fontSize: font.sm, marginTop: spacing.xxs },
  healthTagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxs },
  healthTag: {
    flexShrink: 1, color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
});
