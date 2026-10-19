// Workout mode: the live session, one exercise at a time, with the rest in
// the footer, then a summary to save it from. One component of ~1,000 lines, so
// grep a landmark rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   SuggestionCard          the progression's proposal on the exercise's card
//   SessionClock            the header's running time, its own tick
//   RestFooter              the rest countdown and its three buttons
//   ScreenAwake             the keep-awake helper
//   makeStyles              styles, at the bottom
//
// The rules (what's next, what a tick does, what finishing writes) live in
// src/utils/workoutSession.ts, the suggested next load in
// src/utils/workoutProgression.ts; the design in docs/arch/workouts.md, the mocks
// in docs/arch/workouts-mocks/workout-mode.png.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CountStepper } from './CountStepper';
import { CheckPop } from './CheckPop';
import { InlineAction } from './InlineAction';
import { ProgressBar } from './ProgressBar';
import { EmptyNote } from './EmptyNote';
import { TextField } from './TextField';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { ExerciseDetailSheet } from './ExerciseDetailSheet';
import { PlateLine } from './PlateLine';
import { WorkoutRecordsCard } from './WorkoutRecordsCard';
import { WorkoutStatTiles } from './WorkoutStatTiles';
import type { ExerciseKind, WorkoutSet } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDemoStore } from '../store/useDemoStore';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { useTaskStore } from '../store/useTaskStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { useRestTimer } from '../hooks/useRestTimer';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatTimeOfDay } from '../utils/dateUtils';
import { formatStopwatch } from '../utils/effort';
import { linkedTaskLine, workoutTaskEffect } from '../utils/workoutTask';
import { displayTitleFor } from '../utils/visibilityUtils';
import { catalogExercise } from '../utils/exerciseCatalog';
import { barKgFor, effectivePlateInventory, isPlateLoaded, plateLoad } from '../utils/plateMath';
import { sessionRecordSummary } from '../utils/workoutRecords';
import { proposalActionLabel, proposalApplied, proposalHeadline, workingSetLogged, type Proposal } from '../utils/workoutProgression';
import { exerciseProposal, type ExerciseProposal } from '../utils/workoutProposal';
import { applyProposal } from '../utils/workoutProposalApply';
import {
  MUSCLE_LABELS, WEIGHT_PLACES, WEIGHT_STEP, WORKOUT_EFFORT, formatRestSeconds, formatWeightNumber, weightFromDisplay,
  weightToDisplay,
} from '../utils/workoutData';
import {
  REST_NUDGE_BACK_SECONDS, REST_NUDGE_FORWARD_SECONDS, isStepTimerReady, stepTimerOverSeconds, stepTimerProgress,
  stepTimerRemaining,
} from '../utils/stepTimers';
import {
  currentSetOf, finishPlan, formatDistance, formatSetLine, matchPrevious, nextSet,
  columnLabel, fieldLabel, sessionExercises, sessionSummary, setBadge, setFieldsFor, setLabels, setName, valuesFromLastDone,
  type SetField,
} from '../utils/workoutSession';
import { tickSet } from '../utils/workoutTick';
import type { WeightUnit } from '../utils/weightLog';
import { workoutSpanWritable } from '../utils/healthWorkoutSync';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** Closes the sheet. The session stays live unless it was finished or thrown away. */
  onClose: () => void;
  /**
   * After a save, the task occurrence whose question workout mode left for
   * its host to ask (the answer-first rule), so the host can queue it once
   * this sheet is down. Null when there is nothing to ask.
   */
  onSaved: (askTaskId: string | null) => void;
}

/**
 * Workout mode, modelled on cook mode: the screen kept awake, one exercise at
 * a time, the controls that matter in reach without aiming.
 *
 * - **A tick is the only thing that moves the session.** Checking a set logs
 *   it, may turn the card to a superset partner, and starts the rest
 *   (`tickSet`, which the Lock Screen's "Done set" calls too). The rest running
 *   out chimes and counts up; it never moves anything on.
 * - **Rows are the sets.** Planned sets are rows with no `completedAt`; the
 *   expanded row (the first open one, unless another is tapped) takes the
 *   steppers, and every change is written as it is made, so closing the sheet
 *   mid-set loses nothing.
 * - **Leaving is not ending.** "End" asks: close and keep it running, or
 *   discard it. Finish opens the summary, and Save there ends the session,
 *   drops the planned sets never checked and completes the linked task
 *   through `completeTask`.
 * - **Weights are stored in kg** and stepped in `workoutUnit`, converted at
 *   the steppers and nowhere else.
 */
export function WorkoutModeSheet({ visible, onClose, onSaved }: Props) {
  // ==== store bindings and derived data ====
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const session = useWorkoutStore(s => s.sessions.find(x => x.endedAt === null) ?? null);
  const cachedSets = useWorkoutStore(s => (session ? s.setsBySession[session.id] : undefined));
  const routines = useWorkoutStore(s => s.routines);
  const programs = useWorkoutStore(s => s.programs);
  const exerciseRows = useWorkoutStore(s => s.exercises);
  const sessionsList = useWorkoutStore(s => s.sessions);
  const unit = useSettingsStore(s => s.workoutUnit);
  const plateInventory = useSettingsStore(s => s.plateInventory);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  // Whether Save also writes the workout to Health (`workoutHealthWriteOn`,
  // read reactively here so the summary says so). Demo mode never writes.
  const healthWriteOn = useSettingsStore(s => s.healthWriteEnabled && s.workoutHealthWrite && s.workoutsEnabled);
  const demoActive = useDemoStore(s => s.active);
  const writesToHealth = healthWriteOn && !demoActive;
  const linkedTask = useTaskStore(s => (session?.taskId ? s.tasks.find(t => t.id === session.taskId) ?? null : null));
  const sets = useMemo(() => cachedSets ?? [], [cachedSets]);
  const routine = session?.routineId ? routines.find(r => r.id === session.routineId) ?? null : null;
  const exercises = useMemo(() => sessionExercises(sets), [sets]);
  // Numbered within each exercise: its working sets read 1, 2, 3.
  const labels = useMemo(
    () => new Map(exercises.flatMap(e => [...setLabels(e.sets).entries()])),
    [exercises],
  );

  useEffect(() => {
    if (visible && session && !cachedSets) useWorkoutStore.getState().loadSets(session.id);
  }, [visible, session, cachedSets]);

  // ==== screen state: which exercise is shown, which set is open ====
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [effort, setEffort] = useState<number | null>(null);
  const [sessionNotes, setSessionNotes] = useState('');
  const [picking, setPicking] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  // The exercise the detail sheet is on, kept through its close so it doesn't retitle while it slides away.
  const [detailId, setDetailId] = useState<string | null>(null);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  useEffect(() => {
    if (!visible) return;
    setViewedId(nextSet(sets)?.exerciseId ?? exercises[0]?.exerciseId ?? null);
    setOpenSetId(null);
    setNotesOpen(false);
    setFinishing(false);
    setEffort(session?.effort ?? null);
    setSessionNotes(session?.notes ?? '');
    setPicking(false);
    setDetailOpen(false);
    // On open only: a tick re-derives the view through its own handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session?.id]);

  // A tick made outside the sheet (the Lock Screen's "Done set") turns the card
  // the way a tick here does. After the open effect above, so on a cold open it
  // is the one that decides.
  const viewRequest = useWorkoutModeStore(s => s.viewRequest);
  useEffect(() => {
    if (!viewRequest) return;
    setViewedId(viewRequest.exerciseId);
    setOpenSetId(null);
    setNotesOpen(false);
  }, [viewRequest]);

  const viewIndex = Math.max(0, exercises.findIndex(e => e.exerciseId === viewedId));
  const viewed = exercises[viewIndex] ?? null;
  const viewedInfo = viewed ? catalogExercise(exerciseRows, viewed.exerciseId) : null;
  const kind: ExerciseKind = viewedInfo?.kind ?? 'weight_reps';
  const fields = setFieldsFor(kind);
  const current = viewed ? currentSetOf(viewed) : null;
  const openSet = viewed?.sets.find(s => s.id === (openSetId ?? current?.id)) ?? null;

  // The plates for the open set's weight, for a barbell, EZ bar or trap bar: a
  // dumbbell or a machine has nothing to load. A pound lifter who never set an
  // inventory gets the pound default (`effectivePlateInventory`).
  const plate = useMemo(() => {
    if (!openSet || !viewedInfo || !isPlateLoaded(viewedInfo.equipment) || kind !== 'weight_reps' || !openSet.weightKg) return null;
    const inventory = effectivePlateInventory(plateInventory, unit);
    return plateLoad(openSet.weightKg, barKgFor(viewedInfo.barKg, inventory, viewedInfo.equipment, unit), inventory, unit);
  }, [openSet, viewedInfo, kind, plateInventory, unit]);

  // Last time, for the shown exercise: one read per exercise shown, not per row.
  const previous = useMemo(
    () => (viewed && session ? useWorkoutStore.getState().lastTimeFor(viewed.exerciseId, session.id) : []),
    // sessionsList: a session finished elsewhere changes which one was last.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewed?.exerciseId, session?.id, sessionsList],
  );
  const previousBySet = useMemo(() => matchPrevious(viewed?.sets ?? [], previous), [viewed, previous]);

  // ==== the suggestion: the next load, proposed and never applied unasked ====
  // The routine the workout follows and the program it belongs to decide
  // which scheme moves the shown exercise on (`exerciseProposal`, shared with
  // the Apple Watch's suggestion).
  const program = session?.programId ? programs.find(p => p.id === session.programId) ?? null : null;
  const shownProposal = useMemo<ExerciseProposal | null>(() => {
    if (!viewed || !session) return null;
    return exerciseProposal({
      exerciseId: viewed.exerciseId,
      exercises: exerciseRows,
      routine,
      program,
      sessions: sessionsList,
      routines,
      history: useWorkoutStore.getState().exerciseHistory(viewed.exerciseId),
      exceptSessionId: session.id,
      plateInventory,
      unit,
    });
    // Keyed on the exercise and what decides its history, not on its sets: a
    // set edited this session doesn't change what was lifted before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed?.exerciseId, session?.id, exerciseRows, routine, program, sessionsList, routines, plateInventory, unit]);
  const proposal = shownProposal?.proposal ?? null;

  /**
   * "Use 82.5 kg": the proposal written onto the planned working sets, and a
   * ramp's planned warm-ups worked out again from the new weight
   * (`applyProposal`, which the watch's Use goes through too). Each is an
   * ordinary edit, as if typed, and every one stays editable.
   */
  const useProposal = () => {
    if (!session || !viewed || !shownProposal) return;
    haptics.success();
    applyProposal(session.id, viewed.exerciseId, { proposal: shownProposal });
  };
  const upNext = exercises[viewIndex + 1] ?? null;
  const upNextInfo = upNext ? catalogExercise(exerciseRows, upNext.exerciseId) : null;

  // ==== writing a set ====
  const edit = useCallback((setId: string, patch: Partial<WorkoutSet>) => {
    if (!session) return;
    useWorkoutStore.getState().editSet(session.id, setId, patch);
  }, [session]);

  const toggleSet = (set: WorkoutSet) => {
    if (!session) return;
    if (set.completedAt !== null) {
      haptics.tap();
      edit(set.id, { completedAt: null });
      return;
    }
    haptics.impactMedium();
    // The write, the rest it starts and where the card goes are `tickSet`'s,
    // shared with the Lock Screen's "Done set".
    const next = tickSet(session.id, set.id);
    if (!next) return;
    if (next.showExerciseId !== viewedId) animateLayout();
    setViewedId(next.showExerciseId);
    setOpenSetId(null);
    setNotesOpen(false);
  };

  const openRow = (set: WorkoutSet) => {
    haptics.tap();
    animateLayout();
    setOpenSetId(set.id === openSet?.id ? null : set.id);
    setNotesOpen(false);
  };

  const addSet = () => {
    if (!session || !viewed) return;
    haptics.tap();
    animateLayout();
    const added = useWorkoutStore.getState().addPlannedSet(session.id, viewed.exerciseId);
    if (typeof added !== 'string') setOpenSetId(added.id);
  };

  const removeSet = (set: WorkoutSet) => {
    if (!session) return;
    haptics.tap();
    animateLayout();
    useWorkoutStore.getState().deleteSet(session.id, set.id);
    setOpenSetId(null);
  };

  const sameAsLast = (set: WorkoutSet) => {
    if (!viewed) return;
    const values = valuesFromLastDone(viewed.sets, set.id);
    if (!values) return;
    haptics.tap();
    edit(set.id, values);
  };

  const toggleNotes = () => {
    haptics.tap();
    setNoteDraft(openSet?.note ?? '');
    setNotesOpen(v => !v);
  };
  const commitNote = () => {
    if (openSet && (openSet.note ?? '') !== noteDraft.trim()) edit(openSet.id, { note: noteDraft });
  };

  const goTo = (index: number) => {
    const target = exercises[index];
    if (!target) return;
    haptics.tap();
    animateLayout();
    setViewedId(target.exerciseId);
    setOpenSetId(null);
    setNotesOpen(false);
  };

  const addExercise = (exerciseId: string) => {
    if (!session) return;
    const added = useWorkoutStore.getState().addSessionExercise(session.id, exerciseId);
    if (typeof added === 'string') return;
    setViewedId(exerciseId);
    setOpenSetId(null);
  };

  // ==== leaving, finishing ====
  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  const end = () => {
    haptics.tap();
    Alert.alert(
      'End this workout?',
      'Close keeps it running, and Workouts has it under In progress. Discard deletes it and every set logged in it.',
      [
        { text: 'Close', onPress: close },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            useWorkoutStore.getState().discardSession();
            haptics.success();
            close();
          },
        },
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
      ],
    );
  };

  const plan = useMemo(() => finishPlan(sets), [sets]);
  // What saving does to the task the workout was started from: what its own
  // checkbox would do (`workoutTaskEffect`). A question is asked by the host
  // once this sheet is down, so the store is told to leave that task alone.
  const taskEffect = workoutTaskEffect(linkedTask);
  const askFirst = taskEffect === 'ask';
  const summary = useMemo(
    () => (finishing && session ? sessionSummary(session, sets) : null),
    [finishing, session, sets],
  );

  // What this workout beat, against everything before it. Read from each
  // exercise's own history (the live session's sets are in the database as
  // they are edited), and only while the summary is up. The workout page
  // reads the same helper, so the two say the same about one workout.
  const sessionRecords = useMemo(() => {
    if (!finishing || !session) return [];
    return sessionRecordSummary(
      session.id,
      exercises.map(e => e.exerciseId),
      id => catalogExercise(exerciseRows, id)?.kind ?? 'weight_reps',
      id => useWorkoutStore.getState().exerciseHistory(id),
      sessionsList,
      dayResetTime,
    );
    // `sets`: an edit made before finishing changes what the records are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishing, session, sets, exercises, exerciseRows, sessionsList, dayResetTime]);

  const save = () => {
    if (!session) return;
    const finished = useWorkoutStore.getState().finishSession(session.id, {
      effort,
      notes: sessionNotes,
      completeLinkedTask: !askFirst,
    });
    if (typeof finished === 'string') return;
    haptics.chainFinish();
    close();
    onSaved(askFirst && linkedTask ? linkedTask.id : null);
  };

  const discardEmpty = () => {
    haptics.tap();
    useWorkoutStore.getState().discardSession();
    close();
  };

  // ==== render. Everything below is JSX ====
  const headerTitle = session?.title ?? 'Workout';
  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close} name="WorkoutModeSheet">
      <ScreenAwake />
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <SheetHeaderButton
            label="End"
            role="cancel"
            minWidth={64}
            onPress={end}
            accessibilityLabel="End or close the workout"
          />
          <View style={styles.headerTitle}>
            <Text style={styles.title} numberOfLines={1}>{headerTitle}</Text>
            {session && <SessionClock startedAt={session.startedAt} style={styles.subtitle} />}
          </View>
          {!finishing && session ? (
            <SheetHeaderButton label="Finish" minWidth={64} onPress={() => { haptics.tap(); Keyboard.dismiss(); setFinishing(true); }} />
          ) : <View style={styles.headerSpacer} />}
        </View>

        {!session ? (
          <View style={styles.emptyWrap}>
            <EmptyNote icon="barbell-outline">No workout is in progress. Start one from a routine on the Workouts screen, or from a task.</EmptyNote>
          </View>
        ) : finishing && summary ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.scroll, { paddingBottom: spacing.xl }]}
            keyboardShouldPersistTaps="handled"
            {...keyboardScroll.props}
            ref={keyboardScroll.ref}
          >
            <Text style={styles.summaryTitle}>Workout summary</Text>
            <WorkoutStatTiles
              minutes={summary.minutes}
              exercises={summary.exercises.length}
              sets={summary.setsDone}
              style={styles.stats}
            />
            {summary.exercises.length > 0 && (
              <>
                {sessionRecords.length > 0 && (
                  <>
                    <Text style={styles.groupLabel}>Personal records</Text>
                    <WorkoutRecordsCard records={sessionRecords} exercises={exerciseRows} unit={unit} />
                  </>
                )}
                <Text style={styles.groupLabel}>Exercises</Text>
                <View style={styles.card}>
                  {summary.exercises.map((e, i) => {
                    const info = catalogExercise(exerciseRows, e.exerciseId);
                    const heaviest = e.heaviest && info ? heaviestLine(e.heaviest, info.kind, unit) : null;
                    return (
                      <View key={e.exerciseId} style={[styles.summaryRow, i > 0 && styles.rowSep]}>
                        <Text style={styles.summaryName}>{info?.name ?? 'Unknown exercise'}</Text>
                        <Text style={styles.summaryMeta}>
                          {`${e.sets} ${e.sets === 1 ? 'set' : 'sets'}${heaviest ? ` · heaviest ${heaviest}` : ''}`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={styles.groupLabel}>How it went</Text>
                <View style={styles.card}>
                  <View style={styles.kv}>
                    <Text style={styles.kvLabel}>Effort</Text>
                    <CountStepper
                      value={effort}
                      onChange={setEffort}
                      min={WORKOUT_EFFORT.min}
                      max={WORKOUT_EFFORT.max}
                      start={WORKOUT_EFFORT.start}
                      allowNull
                      emptyLabel="Not set"
                      label="Effort"
                      describeValue={n => (n === null ? 'not set' : `${n} out of ${WORKOUT_EFFORT.max}`)}
                    />
                  </View>
                  <View style={styles.rowSep} />
                  <TextField
                    style={styles.notesInput}
                    value={sessionNotes}
                    onChangeText={setSessionNotes}
                    placeholder="e.g. Shoulder felt fine on the last set"
                    placeholderTextColor={colors.textTertiary}
                    multiline
                    accessibilityLabel="Notes on this workout"
                  />
                </View>
              </>
            )}
            <Text style={styles.consequence}>
              {[
                plan.loggedCount === 0
                  ? 'No sets are checked yet, so there is nothing to save.'
                  : plan.dropSetIds.length > 0
                    ? `${plan.dropSetIds.length} planned ${plan.dropSetIds.length === 1 ? 'set wasn’t' : 'sets weren’t'} checked and won’t be saved.`
                    : null,
                plan.loggedCount > 0 && linkedTask && !linkedTask.completed && !linkedTask.archived
                  ? linkedTaskLine(taskEffect, displayTitleFor(linkedTask))
                  : null,
                // Only for a span the write would accept: Save ends the
                // session now, so a workout left running past a day is saved
                // here and refused by Health's write, and the line would
                // promise something that doesn't happen.
                plan.loggedCount > 0 && writesToHealth && session
                  && workoutSpanWritable({ startedAt: session.startedAt, endedAt: new Date().toISOString() })
                  ? 'Saving also writes it to Apple Health as a strength workout.'
                  : null,
              ].filter(Boolean).join(' ')}
            </Text>
          </ScrollView>
        ) : (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            {...keyboardScroll.props}
            ref={keyboardScroll.ref}
          >
            {exercises.length > 0 && (
              <View style={styles.position}>
                <TouchableOpacity
                  onPress={() => goTo(viewIndex - 1)}
                  disabled={viewIndex === 0}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Previous exercise"
                >
                  <Ionicons name="chevron-back" size={iconSize.sm} color={viewIndex === 0 ? colors.textTertiary : colors.accent} />
                </TouchableOpacity>
                <Text style={styles.positionText}>{`Exercise ${viewIndex + 1} of ${exercises.length}`}</Text>
                <TouchableOpacity
                  onPress={() => goTo(viewIndex + 1)}
                  disabled={viewIndex >= exercises.length - 1}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Next exercise"
                >
                  <Ionicons name="chevron-forward" size={iconSize.sm} color={viewIndex >= exercises.length - 1 ? colors.textTertiary : colors.accent} />
                </TouchableOpacity>
                <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {exercises.map((e, i) => {
                    const allDone = e.sets.every(s => s.completedAt !== null);
                    return (
                      <View
                        key={e.exerciseId}
                        style={[styles.dot, allDone && styles.dotDone, i === viewIndex && styles.dotOn]}
                      />
                    );
                  })}
                </View>
              </View>
            )}

            {viewed ? (
              <View style={styles.card}>
                <View style={styles.exHead}>
                  <TouchableOpacity
                    style={styles.exNameRow}
                    onPress={() => { haptics.tap(); setDetailId(viewed.exerciseId); setDetailOpen(true); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${viewedInfo?.name ?? 'Unknown exercise'}, open its history and records`}
                  >
                    <Text style={styles.exName}>{viewedInfo?.name ?? 'Unknown exercise'}</Text>
                    <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                  </TouchableOpacity>
                  {!!viewedInfo && viewedInfo.primaryMuscles.length > 0 && (
                    <Text style={styles.exMuscles}>
                      {viewedInfo.primaryMuscles.map(m => MUSCLE_LABELS[m]).join(', ')}
                    </Text>
                  )}
                  {proposal && (
                    <SuggestionCard
                      proposal={proposal}
                      unit={unit}
                      // Offered until a working set is logged or the plan
                      // already asks for it; after that it is shown plainly,
                      // as the target being worked to.
                      offer={!workingSetLogged(viewed.sets) && !proposalApplied(viewed.sets, proposal, unit)}
                      onUse={useProposal}
                      styles={styles}
                    />
                  )}
                </View>

                <View style={styles.setHead} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Text style={[styles.headCell, styles.colSet]}>Set</Text>
                  <Text style={[styles.headCell, styles.colPrev]}>Previous</Text>
                  {fields.map(f => (
                    <Text key={f} style={[styles.headCell, styles.colValue]}>{columnLabel(f, kind, unit)}</Text>
                  ))}
                  <View style={styles.colCheck} />
                </View>

                {viewed.sets.map(set => {
                  const isOpen = openSet?.id === set.id;
                  const done = set.completedAt !== null;
                  const prev = previousBySet.get(set.id);
                  const prevLine = prev ? formatSetLine(prev, kind, unit) : null;
                  const label = labels.get(set.id) ?? '';
                  return (
                    <View key={set.id}>
                      {isOpen ? (
                        <View style={styles.open}>
                          {/* Its own captions, since the table's header is lined up with the closed rows' columns, which an open row's steppers don't match. */}
                          <View style={styles.openCaps} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            <View style={styles.colSet} />
                            {fields.map(f => (
                              <Text key={f} style={[styles.headCell, styles.openCell, fields.length === 1 && styles.openCellSingle]} numberOfLines={1}>
                                {inlineCaption(f, kind, unit)}
                              </Text>
                            ))}
                            {fields.length === 1 && <View style={styles.openSpacer} />}
                            <View style={styles.colCheck} />
                          </View>
                          <View style={styles.openRow}>
                            <TouchableOpacity
                              style={styles.colSet}
                              onPress={() => openRow(set)}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
                              accessibilityRole="button"
                              accessibilityState={{ expanded: true }}
                              accessibilityLabel={`${setName(set.kind, label)}, close`}
                            >
                              <Text style={[setBadge(set.kind) ? styles.setBadge : styles.setNumber, styles.openSetLabel]}>{label}</Text>
                            </TouchableOpacity>
                            {fields.map(f => (
                              <View key={f} style={[styles.openCell, fields.length === 1 && styles.openCellSingle]}>
                                <FieldStepper set={set} field={f} unit={unit} onEdit={patch => edit(set.id, patch)} stepperStyle={styles.editStepper} inline />
                              </View>
                            ))}
                            {fields.length === 1 && <View style={styles.openSpacer} />}
                            <TouchableOpacity
                              style={styles.colCheck}
                              onPress={() => toggleSet(set)}
                              hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: done }}
                              accessibilityLabel={`${setName(set.kind, label)} done`}
                            >
                              <CheckPop checked={done} style={styles.check} checkedStyle={styles.checkDone}>
                                <Ionicons name="checkmark" size={14} color={colors.onDone} />
                              </CheckPop>
                            </TouchableOpacity>
                          </View>
                          <View style={styles.edit}>
                            {!!prevLine && <Text style={styles.lastTime}>Last time: {prevLine}</Text>}
                            {!!plate && <PlateLine load={plate} unit={unit} />}
                            <View style={styles.editActions}>
                              {!!valuesFromLastDone(viewed.sets, set.id) && (
                                <InlineAction label="Same as last set" variant="neutral" surface="tray" onPress={() => sameAsLast(set)} />
                              )}
                              <InlineAction icon="trash-outline" label="Remove set" tint={colors.redText} onPress={() => removeSet(set)} />
                            </View>
                          </View>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.setRow}
                          onPress={() => openRow(set)}
                          activeOpacity={interaction.activeOpacity}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: false }}
                          accessibilityLabel={`${setName(set.kind, label)}${prevLine ? `, last time ${prevLine}` : ''}, ${fields.map(f => valueText(set, f, unit) ?? 'not entered').join(', ')}`}
                        >
                          <Text style={[styles.colSet, setBadge(set.kind) ? styles.setBadge : styles.setNumber]}>{label}</Text>
                          <Text style={[styles.colPrev, styles.prevText]} numberOfLines={1}>{prevLine ?? '–'}</Text>
                          {fields.map(f => (
                            <Text
                              key={f}
                              style={[styles.colValue, styles.valueText, !done && styles.valuePlanned]}
                              numberOfLines={1}
                            >
                              {valueText(set, f, unit) ?? '–'}
                            </Text>
                          ))}
                          <TouchableOpacity
                            style={styles.colCheck}
                            onPress={() => toggleSet(set)}
                            hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: done }}
                            accessibilityLabel={`${setName(set.kind, label)} done`}
                          >
                            <CheckPop checked={done} style={styles.check} checkedStyle={styles.checkDone}>
                              <Ionicons name="checkmark" size={14} color={colors.onDone} />
                            </CheckPop>
                          </TouchableOpacity>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}

                <View style={styles.adds}>
                  <InlineAction icon="add" label="Add set" onPress={addSet} />
                  {openSet && (
                    <InlineAction
                      label={openSet.note ? 'Note' : 'Notes'}
                      icon={openSet.note ? 'document-text-outline' : undefined}
                      variant="neutral"
                      onPress={toggleNotes}
                      accessibilityLabel={`Note on set ${labels.get(openSet.id) ?? ''}`}
                    />
                  )}
                </View>
                {notesOpen && openSet && (
                  <TextField
                    style={styles.noteInput}
                    value={noteDraft}
                    onChangeText={setNoteDraft}
                    onBlur={commitNote}
                    onSubmitEditing={commitNote}
                    placeholder="e.g. Paused at the bottom"
                    placeholderTextColor={colors.textTertiary}
                    autoFocus
                    returnKeyType="done"
                    accessibilityLabel={`Note on set ${labels.get(openSet.id) ?? ''}`}
                  />
                )}
              </View>
            ) : (
              <View style={styles.emptyWrap}>
                <EmptyNote icon="barbell-outline">No exercises yet. Add the first one to start logging sets.</EmptyNote>
              </View>
            )}

            {upNext && (
              <>
                <Text style={styles.groupLabel}>Up next</Text>
                <TouchableOpacity
                  style={[styles.card, styles.nextRow]}
                  onPress={() => goTo(viewIndex + 1)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to ${upNextInfo?.name ?? 'the next exercise'}`}
                >
                  <View style={styles.flex}>
                    <Text style={styles.nextName}>{upNextInfo?.name ?? 'Unknown exercise'}</Text>
                    <Text style={styles.nextMeta}>
                      {`${upNext.sets.length} ${upNext.sets.length === 1 ? 'set' : 'sets'}`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>
              </>
            )}
            <View style={styles.addExercise}>
              <InlineAction icon="add" label="Add exercise" variant="neutral" surface="page" onPress={() => { haptics.tap(); setPicking(true); }} />
            </View>
          </ScrollView>
        )}

        {session && finishing ? (
          <View style={[styles.footer, styles.footRow, { paddingBottom: insets.bottom + spacing.smd }]}>
            <TouchableOpacity
              style={[styles.footButton, styles.footSecondary]}
              onPress={() => { haptics.tap(); setFinishing(false); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Back to the workout"
            >
              <Ionicons name="chevron-back" size={iconSize.sm} color={colors.accentText} />
              <Text style={styles.footSecondaryText}>Back</Text>
            </TouchableOpacity>
            {plan.loggedCount === 0 ? (
              <TouchableOpacity style={[styles.footButton, styles.footDanger]} onPress={discardEmpty} activeOpacity={interaction.activeOpacity} accessibilityRole="button">
                <Text style={styles.footDangerText}>Discard workout</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.footButton, styles.footPrimary]} onPress={save} activeOpacity={interaction.activeOpacity} accessibilityRole="button">
                <Text style={styles.footPrimaryText}>Save workout</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : session ? (
          <RestFooter sessionId={visible ? session.id : undefined} bottomInset={insets.bottom} styles={styles} />
        ) : null}
      </View>
      {/* Inside this Modal, not beside it: a second sheet presented from the
          same view controller as this one never appears. */}
      <ExercisePickerSheet
        visible={visible && picking}
        onClose={() => setPicking(false)}
        onPick={addExercise}
        addedIds={exercises.map(e => e.exerciseId)}
        addedLabel="In workout"
      />
      <ExerciseDetailSheet visible={visible && detailOpen} exerciseId={detailId} onClose={() => setDetailOpen(false)} />
    </SheetModal>
  );
}

// ==== the cells and their steppers ====

function valueText(set: WorkoutSet, field: SetField, unit: WeightUnit): string | null {
  if (field === 'weight') return set.weightKg !== null ? formatWeightNumber(set.weightKg, unit) : null;
  if (field === 'reps') return set.reps !== null ? String(set.reps) : null;
  if (field === 'duration') return set.durationSeconds !== null ? formatRestSeconds(set.durationSeconds) : null;
  return set.distanceM !== null ? formatDistance(set.distanceM) : null;
}

/** "82.5 kg × 8": the heaviest set, with its unit, for the summary. */
function heaviestLine(set: WorkoutSet, kind: ExerciseKind, unit: WeightUnit): string | null {
  if (set.weightKg === null) return null;
  const w = `${formatWeightNumber(set.weightKg, unit)} ${unit}`;
  if (kind === 'weight_distance' && set.distanceM !== null) return `${w} × ${formatDistance(set.distanceM)}`;
  return set.reps !== null ? `${w} × ${set.reps}` : w;
}

/** What heads an open set's stepper: the field's name, with the unit it counts in. */
function inlineCaption(field: SetField, kind: ExerciseKind, unit: WeightUnit): string {
  const name = fieldLabel(field, kind);
  if (field === 'weight') return `${name} (${unit})`;
  if (field === 'distance') return `${name} (m)`;
  return name;
}

function FieldStepper({ set, field, unit, onEdit, stepperStyle, inline }: {
  set: WorkoutSet;
  field: SetField;
  unit: WeightUnit;
  onEdit: (patch: Partial<WorkoutSet>) => void;
  stepperStyle: object;
  /** Sat in the open row's own cell: narrower keys, and no unit in the value, since the caption above it carries that. */
  inline?: boolean;
}) {
  if (field === 'weight') {
    return (
      <CountStepper
        value={set.weightKg !== null ? weightToDisplay(set.weightKg, unit) : null}
        onChange={n => onEdit({ weightKg: n === null ? null : weightFromDisplay(n, unit) })}
        min={0}
        max={unit === 'kg' ? 500 : 1100}
        step={WEIGHT_STEP[unit]}
        places={WEIGHT_PLACES[unit]}
        allowNull
        start={WEIGHT_STEP[unit] * 8}
        emptyLabel="–"
        format={inline ? undefined : n => `${n} ${unit}`}
        label="Weight"
        style={stepperStyle}
        inline={inline}
      />
    );
  }
  if (field === 'reps') {
    return (
      <CountStepper
        value={set.reps}
        onChange={n => onEdit({ reps: n })}
        min={0}
        max={200}
        allowNull
        start={8}
        emptyLabel="–"
        label="Reps"
        style={stepperStyle}
        inline={inline}
      />
    );
  }
  if (field === 'duration') {
    return (
      <CountStepper
        value={set.durationSeconds}
        onChange={n => onEdit({ durationSeconds: n })}
        min={0}
        max={3600}
        step={5}
        allowNull
        start={30}
        emptyLabel="–"
        format={formatRestSeconds}
        label="Time"
        style={stepperStyle}
        inline={inline}
      />
    );
  }
  return (
    <CountStepper
      value={set.distanceM}
      onChange={n => onEdit({ distanceM: n })}
      min={0}
      max={100000}
      step={10}
      allowNull
      start={100}
      emptyLabel="–"
      format={inline ? undefined : n => `${n} m`}
      label="Distance in meters"
      style={stepperStyle}
      inline={inline}
    />
  );
}

/**
 * The proposal for the shown exercise, as the mock draws it: "Today 3 × 6–8 at
 * 82.5 kg." in bold, then the reason, and a "Use 82.5 kg" button while it is
 * on offer. A proposal with nothing to propose yet (a percentage set with no
 * training max) shows only what is missing.
 */
function SuggestionCard({ proposal, unit, offer, onUse, styles }: {
  proposal: Proposal;
  unit: WeightUnit;
  offer: boolean;
  onUse: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const headline = proposalHeadline(proposal, unit);
  return (
    <View style={styles.suggest}>
      <Text style={styles.suggestText}>
        {headline && <Text style={styles.suggestHead}>{`${headline} `}</Text>}
        {proposal.reason}
      </Text>
      {offer && headline && (
        <View style={styles.suggestActions}>
          <InlineAction
            label={proposalActionLabel(proposal, unit)}
            onPress={onUse}
            accessibilityLabel={`${proposalActionLabel(proposal, unit)} on the sets not done yet`}
          />
        </View>
      )}
    </View>
  );
}

/**
 * "Started 6:12 PM · 32:14", moving once a second. Its own component so the
 * tick re-renders this line and not the whole sheet.
 */
function SessionClock({ startedAt, style }: { startedAt: string; style: object }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const start = new Date(startedAt);
  return (
    <Text style={style} numberOfLines={1}>
      {`Started ${formatTimeOfDay(start)} · ${formatStopwatch((now - start.getTime()) / 1000)}`}
    </Text>
  );
}

/**
 * The rest after the last set: how long is left, how long it was, and −15 s,
 * +30 s and Skip. Once it runs out it says so and counts up, and stays until
 * it is dismissed or the next set starts another: nothing moves on by itself.
 * Absent while there is no rest. Its own component, for the per-second tick.
 */
function RestFooter({ sessionId, bottomInset, styles }: {
  sessionId: string | undefined;
  bottomInset: number;
  styles: ReturnType<typeof makeStyles>;
}) {
  const colors = useColors();
  const { rest, now } = useRestTimer(sessionId);
  if (rest === null) return null;
  const store = useStepTimerStore.getState();
  const over = isStepTimerReady(rest, now);
  const label = rest.label ? `Rest ${rest.label.charAt(0).toLowerCase()}${rest.label.slice(1)}` : 'Rest';
  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + spacing.smd }]}>
      <View style={styles.restTop}>
        <Text style={styles.restLabel} numberOfLines={1}>{over ? 'Rest is over' : label}</Text>
        <Text style={styles.restOf}>{`of ${formatRestSeconds(rest.durationSeconds)}`}</Text>
      </View>
      <Text
        style={[styles.restTime, over && styles.restTimeOver]}
        accessibilityLabel={over ? `Rest over ${stepTimerOverSeconds(rest, now)} seconds ago` : `${Math.ceil(stepTimerRemaining(rest, now))} seconds of rest left`}
      >
        {over ? `+${formatStopwatch(stepTimerOverSeconds(rest, now))}` : formatStopwatch(Math.ceil(stepTimerRemaining(rest, now)))}
      </Text>
      <ProgressBar progress={stepTimerProgress(rest, now)} height={4} decorative style={styles.restBar} color={over ? colors.done : undefined} />
      <View style={styles.restButtons}>
        <InlineAction
          label={`−${REST_NUDGE_BACK_SECONDS} s`}
          variant="neutral"
          disabled={over}
          style={styles.restButton}
          accessibilityLabel={`${REST_NUDGE_BACK_SECONDS} seconds less rest`}
          onPress={() => { haptics.impactLight(); store.addTime(rest.id, -REST_NUDGE_BACK_SECONDS); }}
        />
        <InlineAction
          label={`+${REST_NUDGE_FORWARD_SECONDS} s`}
          variant="neutral"
          style={styles.restButton}
          accessibilityLabel={`${REST_NUDGE_FORWARD_SECONDS} seconds more rest`}
          onPress={() => { haptics.impactLight(); store.addTime(rest.id, REST_NUDGE_FORWARD_SECONDS); }}
        />
        <InlineAction
          label={over ? 'Dismiss' : 'Skip rest'}
          style={styles.restButton}
          onPress={() => { haptics.tap(); store.remove(rest.id); }}
        />
      </View>
    </View>
  );
}

/**
 * Holds the screen awake for exactly as long as it's mounted: inside the
 * Modal's content, so a sheet mounted hidden doesn't hold it (CookModeSheet's
 * reason).
 */
function ScreenAwake() {
  useKeepAwake();
  return null;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.smd, gap: spacing.sm },
  headerTitle: { flex: 1, alignItems: 'center' },
  headerSpacer: { minWidth: 64 },
  title: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  subtitle: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs, fontVariant: ['tabular-nums'] },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  emptyWrap: { padding: spacing.md },
  position: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xs, marginBottom: spacing.smd },
  positionText: { color: colors.textSecondary, fontSize: font.md },
  dots: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xsm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.bgQuaternary },
  dotDone: { backgroundColor: colors.done },
  dotOn: { width: 18, backgroundColor: colors.accent },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  exHead: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  exNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  exName: { flexShrink: 1, color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold },
  exMuscles: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs },
  suggest: { backgroundColor: colors.bgTertiary, borderRadius: radius.md, padding: spacing.smd, marginTop: spacing.smd, gap: spacing.sm },
  suggestText: { color: colors.text, fontSize: font.sm },
  suggestHead: { fontWeight: fontWeight.semibold },
  suggestActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  setHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.xsm },
  headCell: {
    color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.semibold, letterSpacing: 0.8, textTransform: 'uppercase',
  },
  colSet: { width: 34, textAlign: 'center' },
  colPrev: { flex: 1 },
  colValue: { width: 64 },
  colCheck: { width: 28, alignItems: 'center' },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46,
    paddingHorizontal: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  open: { backgroundColor: colors.accentSubtle, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  openCaps: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md },
  openCell: { flex: 1, textAlign: 'center' },
  // One value has no neighbour to share the row with, so it keeps a stepper's own width.
  openCellSingle: { flex: 0, width: 140 },
  openSpacer: { flex: 1 },
  openSetLabel: { textAlign: 'center' },
  lastTime: { color: colors.textSecondary, fontSize: font.sm },
  setNumber: { color: colors.textSecondary, fontSize: font.md, fontWeight: fontWeight.semibold },
  setBadge: { color: colors.orangeText, fontSize: font.md, fontWeight: fontWeight.bold },
  prevText: { color: colors.textTertiary, fontSize: font.md, fontVariant: ['tabular-nums'] },
  valueText: { color: colors.text, fontSize: font.md, fontVariant: ['tabular-nums'] },
  valuePlanned: { color: colors.textTertiary },
  check: {
    width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: colors.controlBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.done, borderColor: colors.done },
  edit: { paddingHorizontal: spacing.md, paddingBottom: spacing.smd, gap: spacing.smd },
  editStepper: { backgroundColor: colors.bgSecondary },
  editActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  adds: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  noteInput: {
    color: colors.text, fontSize: font.md, marginHorizontal: spacing.md, marginBottom: spacing.md,
    paddingHorizontal: spacing.smd, paddingVertical: spacing.sm, backgroundColor: colors.bgTertiary, borderRadius: radius.sm, minHeight: 40,
  },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  nextName: { color: colors.text, fontSize: font.md },
  nextMeta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  addExercise: { flexDirection: 'row', marginTop: spacing.md },
  footer: {
    backgroundColor: colors.bgSecondary, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
    paddingHorizontal: spacing.md, paddingTop: spacing.smd,
  },
  restTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  restLabel: { flex: 1, color: colors.textSecondary, fontSize: font.md },
  restOf: { color: colors.textTertiary, fontSize: font.md, fontVariant: ['tabular-nums'] },
  // A hero number, read from a bench at arm's length: a literal size, which
  // the scale isn't for (see the font scale note in CLAUDE.md).
  restTime: { color: colors.text, fontSize: 34, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'], marginTop: spacing.xxs },
  restTimeOver: { color: colors.accentText },
  restBar: { marginTop: spacing.sm, marginBottom: spacing.smd },
  restButtons: { flexDirection: 'row', gap: spacing.sm },
  restButton: { flex: 1, justifyContent: 'center', minHeight: 44 },
  summaryTitle: { color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold, marginTop: spacing.xs, marginHorizontal: spacing.xs },
  stats: { marginTop: spacing.smd },
  summaryRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  summaryName: { color: colors.text, fontSize: font.md },
  summaryMeta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  kvLabel: { color: colors.text, fontSize: font.md },
  notesInput: { color: colors.text, fontSize: font.md, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 64 },
  consequence: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.smd, marginHorizontal: spacing.xs },
  footRow: { flexDirection: 'row', gap: spacing.sm },
  footButton: { flex: 1, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: radius.md },
  footSecondary: { backgroundColor: colors.bgTertiary },
  footSecondaryText: { color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold },
  footPrimary: { backgroundColor: colors.accentFill },
  footPrimaryText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  footDanger: { backgroundColor: colors.bgTertiary },
  footDangerText: { color: colors.redText, fontSize: font.md, fontWeight: fontWeight.semibold },
});
