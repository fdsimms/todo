// Workout mode: the live session, one exercise at a time, with the rest in
// a strip under the header, then a summary to save it from. One component of ~1,000 lines, so
// grep a landmark rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   SuggestionCard          the progression's proposal on the exercise's card
//   SessionClock            the header's running time, its own tick
//   RestStrip               the rest countdown and its three buttons
//   ScreenAwake             the keep-awake helper
//   makeStyles              styles, at the bottom
//
// The rules (what's next, what a tick does, what finishing writes) live in
// src/utils/workoutSession.ts, the suggested next load in
// src/utils/workoutProgression.ts; the design in docs/arch/workouts.md, the mocks
// in docs/arch/workouts-mocks/workout-mode.png.
import { format } from 'date-fns/format';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { useKeepAwake } from 'expo-keep-awake';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeaderButton } from './SheetHeaderButton';
import { ActionMenu } from './ActionMenu';
import type { CardAnchor } from './CardSheet';
import { CountStepper } from './CountStepper';
import { CheckPop } from './CheckPop';
import { InlineAction } from './InlineAction';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { ProgressBar } from './ProgressBar';
import { EmptyNote } from './EmptyNote';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { DescribeWorkoutSheet } from './DescribeWorkoutSheet';
import { ExerciseDetailSheet } from './ExerciseDetailSheet';
import { ExercisePhotos } from './ExercisePhotos';
import { PlateLine } from './PlateLine';
import { SelectionDot } from './SelectionDot';
import { SortableList } from './SortableList';
import { WorkoutRecordsCard } from './WorkoutRecordsCard';
import { WorkoutStatTiles } from './WorkoutStatTiles';
import type { ExerciseKind, WorkoutSet, WorkoutSetKind } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDemoStore } from '../store/useDemoStore';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { useTaskStore } from '../store/useTaskStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { useRestTimer } from '../hooks/useRestTimer';
import { ExerciseRestSheet } from './ExerciseRestSheet';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatTimeOfDay, getCurrentDayStart } from '../utils/dateUtils';
import { formatStopwatch } from '../utils/effort';
import { linkedTaskLine, rotationPickFor, workoutTaskEffect } from '../utils/workoutTask';
import { displayTitleFor } from '../utils/visibilityUtils';
import { catalogExercise } from '../utils/exerciseCatalog';
import { withCreatedExercises } from '../utils/describedExercises';
import type { RoutineDraft } from '../utils/workoutDraft';
import { swapCandidates, swappableSets } from '../utils/exerciseSwap';
import { GymLine, GymNoteBox, GymUnavailableBanner } from './GymWorkoutParts';
import { GymsSheet } from './GymsSheet';
import { useGymStore } from '../store/useGymStore';
import {
  describeLastLoad, exerciseIdsDoneAt, gymIncrementKg, gymSettingFor, gymSwapCandidates, unavailableExerciseIds, withGymBar,
} from '../utils/gyms';
import { lastTimeNotes } from '../utils/lastTimeNotes';
import { parseSetCell, typedTickValues } from '../utils/workoutCell';
import { weightHeadingSuffix, weightScale } from '../utils/dumbbellLoad';
import { exerciseDayNote, exerciseDayNotePatches } from '../utils/exerciseDayNote';
import { applyRoutineChanges, describeRoutineChange, routineChanges } from '../utils/routineUpdate';
import { currentRoutineVersion, finishVersionText, routineVersionsOf, sessionPlan, versionNumber } from '../utils/routineVersions';
import { barKgFor, effectivePlateInventory, isPlateLoaded, plateLoad } from '../utils/plateMath';
import { liftVolumeKg, liveSetRecords, sessionRecordSummary } from '../utils/workoutRecords';
import { formatRecordChange, recordLabel, recordShortLabel } from '../utils/workoutRecordText';
import { proposalActionLabel, proposalApplied, proposalHeadline, workingSetLogged, type Proposal } from '../utils/workoutProgression';
import { exerciseProposal, type ExerciseProposal } from '../utils/workoutProposal';
import { applyProposal, liveProposal } from '../utils/workoutProposalApply';
import {
  MUSCLE_LABELS, WEIGHT_PLACES, WEIGHT_STEP, WORKOUT_EFFORT, formatRestSeconds, formatWeightNumber, weightFromDisplay,
  weightToDisplay,
} from '../utils/workoutData';
import {
  REST_NUDGE_BACK_SECONDS, REST_NUDGE_FORWARD_SECONDS, isStepTimerReady, stepTimerOverSeconds, stepTimerProgress,
  stepTimerRemaining,
} from '../utils/stepTimers';
import {
  finishPlan, formatDistance, formatSetLine, exerciseBlocks, matchPreviousByPosition, movedExerciseOrder, nextSet, previousBadge,
  columnLabel, fieldLabel, sessionExercises, sessionSummary, setBadge, setFieldsFor, setLabels, setName, valuesFromLastDone,
  type SetField,
  restSecondsFor, supersetGroup,
} from '../utils/workoutSession';
import { tickSet, type TickValues } from '../utils/workoutTick';
import type { SessionExercise } from '../utils/workoutSession';

// The four kinds of set, in the order the tray offers them. `amrap` is "Failure"
// to match the F badge and `setName`'s "To failure".
const SET_KIND_OPTIONS: SegmentOption<WorkoutSetKind>[] = [
  { value: 'working', label: 'Working' },
  { value: 'warmup', label: 'Warm-up' },
  { value: 'drop', label: 'Drop' },
  { value: 'amrap', label: 'Failure' },
];
import type { WeightUnit } from '../utils/weightLog';
import { workoutSpanWritable } from '../utils/healthWorkoutSync';
import { BUTTON_LABEL } from '../copy/shared';

/** "today" is this workout's note on the exercise, "always" the exercise's own. */
type NoteKind = 'today' | 'always';

const NOTE_HELP: Record<NoteKind, string> = {
  today: 'Only this workout. Shows as "Last time" next session.',
  always: 'Saved on the exercise and shown every time.',
};
const NOTE_PLACEHOLDER: Record<NoteKind, string> = {
  today: 'e.g. Left shoulder felt tight',
  always: 'e.g. Use the dumbbell press if the bench is taken',
};

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
  const routineVersions = useWorkoutStore(s => s.routineVersions);
  const programs = useWorkoutStore(s => s.programs);
  const exerciseRows = useWorkoutStore(s => s.exercises);
  const sessionsList = useWorkoutStore(s => s.sessions);
  const gyms = useGymStore(s => s.gyms);
  const gymSettings = useGymStore(s => s.settings);
  const unit = useSettingsStore(s => s.workoutUnit);
  const defaultRestSeconds = useSettingsStore(s => s.defaultRestSeconds);
  const dumbbellEntry = useSettingsStore(s => s.dumbbellEntry);
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
  // The version the workout was started on, which its rests and suggestions are read from (`sessionPlan`).
  const startedPlan = useMemo(() => (session ? sessionPlan(session, routines, routineVersions) : null), [session, routines, routineVersions]);
  // Which version of the routine this workout is on, and the current one's
  // number. A workout started from an older version (History's "Start a
  // workout from it") is measured against that version, and its summary
  // offers to make it current again.
  const versionInfo = useMemo(() => {
    if (!session || !routine) return null;
    const list = routineVersionsOf(routine, routineVersions);
    const current = currentRoutineVersion(routine, list);
    const own = session.routineVersionId ? list.find(v => v.id === session.routineVersionId) : undefined;
    return {
      currentNumber: versionNumber(list, current.id),
      old: own && own.id !== current.id ? { version: own, number: versionNumber(list, own.id) } : null,
    };
  }, [session, routine, routineVersions]);
  const oldVersion = versionInfo?.old ?? null;
  const exercises = useMemo(() => sessionExercises(sets), [sets]);
  // Numbered within each exercise: its working sets read 1, 2, 3.
  const labels = useMemo(
    () => new Map(exercises.flatMap(e => [...setLabels(e.sets).entries()])),
    [exercises],
  );

  useEffect(() => {
    if (visible && session && !cachedSets) useWorkoutStore.getState().loadSets(session.id);
  }, [visible, session, cachedSets]);

  // ==== the gym: which one, and what it can't do ====
  const gym = session?.gymId ? gyms.find(g => g.id === session.gymId) ?? null : null;
  // Exercises the gym can't do and that still have sets to do: one with every
  // set ticked is a record, and a swap would have nothing to move.
  const unavailableIds = useMemo(
    () => unavailableExerciseIds(gym, exerciseRows, exercises.filter(e => swappableSets(e.sets, e.exerciseId).length > 0).map(e => e.exerciseId)),
    [gym, exerciseRows, exercises],
  );
  const doneHere = useMemo(
    () => (gym && unavailableIds.length > 0
      ? exerciseIdsDoneAt(gym.id, sessionsList, useWorkoutStore.getState().allSets())
      : new Set<string>()),
    [gym, unavailableIds.length, sessionsList],
  );
  const candidatesFor = (exerciseId: string, taken: readonly string[] = exercises.map(e => e.exerciseId)) =>
    gymSwapCandidates(exerciseRows, exerciseId, gym, taken, doneHere);

  // ==== screen state: which exercise is shown, which set is open ====
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [effort, setEffort] = useState<number | null>(null);
  const [sessionNotes, setSessionNotes] = useState('');
  // What the exercise picker is for: adding one, or swapping the shown one out.
  const [picking, setPicking] = useState<'add' | 'swap' | null>(null);
  // Exercises described in words (`DescribeWorkoutSheet` with `into`). Claude only, so no key or a switched-off feature means no button.
  const [describing, setDescribing] = useState(false);
  const canDescribe = useAiRoute('workoutDraft') !== 'unavailable';
  // The notes editor, open on one exercise at a time across all cards, with both
  // fields at once (see `exerciseDayNote` for "today"; "always" is
  // `Exercise.notes`). `focus` is the field that takes the keyboard, and the two
  // drafts are what is typed in them.
  const [noteEdit, setNoteEdit] = useState<{ exerciseId: string; focus: NoteKind } | null>(null);
  const [todayDraft, setTodayDraft] = useState('');
  // The gym's own notice and note. "Keep" dismisses a notice for this workout
  // only and is not stored. The gym note is edited on one exercise at a time.
  const [gymPickerOpen, setGymPickerOpen] = useState(false);
  const [keptIds, setKeptIds] = useState<ReadonlySet<string>>(new Set());
  const [gymNoteEdit, setGymNoteEdit] = useState<string | null>(null);
  const [gymNoteDraft, setGymNoteDraft] = useState('');
  const [alwaysDraft, setAlwaysDraft] = useState('');
  // The compact list the exercises are dragged in, instead of their cards, and
  // whether a row of it is in the air (which switches the page's scroll off).
  const [reordering, setReordering] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The routine changes ticked on the summary. Nothing starts ticked.
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [detailOpen, setDetailOpen] = useState(false);
  // Exercises whose form photos are open. Session-only and per exercise: every
  // exercise is a card on the page, so one flag for all of them opened the photos
  // on the cards above too and pushed the tapped card off screen.
  const [photosOpenIds, setPhotosOpenIds] = useState<ReadonlySet<string>>(new Set());
  // The exercise the detail sheet is on, kept through its close so it doesn't retitle while it slides away.
  const [detailId, setDetailId] = useState<string | null>(null);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  useEffect(() => {
    if (!visible) return;
    setViewedId(nextSet(sets)?.exerciseId ?? exercises[0]?.exerciseId ?? null);
    setOpenSetId(null);
    setFinishing(false);
    setEffort(session?.effort ?? null);
    setSessionNotes(session?.notes ?? '');
    setPicking(null);
    setDescribing(false);
    setReordering(false);
    setNoteEdit(null);
    setGymNoteEdit(null);
    setGymPickerOpen(false);
    setKeptIds(new Set());
    setAccepted(new Set());
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
  }, [viewRequest]);

  const viewIndex = Math.max(0, exercises.findIndex(e => e.exerciseId === viewedId));
  const viewed = exercises[viewIndex] ?? null;
  const program = session?.programId ? programs.find(p => p.id === session.programId) ?? null : null;

  // ==== writing a set ====
  const edit = useCallback((setId: string, patch: Partial<WorkoutSet>) => {
    if (!session) return;
    useWorkoutStore.getState().editSet(session.id, setId, patch);
  }, [session]);

  // What each set's cells hold while they are being typed in, so a tick
  // tapped before the field loses focus writes the typed number rather than
  // the dimmed one (`typedTickValues`). Cleared when a cell commits or its
  // set is ticked.
  const typedRef = useRef(new Map<string, Partial<Record<SetField, string>>>());
  const noteTyping = useCallback((setId: string, field: SetField, text: string | null) => {
    const row = { ...typedRef.current.get(setId) };
    if (text === null) delete row[field];
    else row[field] = text;
    if (Object.keys(row).length === 0) typedRef.current.delete(setId);
    else typedRef.current.set(setId, row);
  }, []);

  // The summary's effort and notes are written as they change, the way the
  // workout page writes them, so Close (which keeps the workout running), the
  // back gesture or the app being closed doesn't lose them before Save.
  const saveEffort = (n: number | null) => {
    setEffort(n);
    if (session) useWorkoutStore.getState().updateSession(session.id, { effort: n });
  };
  const saveNotes = () => {
    if (session && sessionNotes.trim() !== session.notes) useWorkoutStore.getState().updateSession(session.id, { notes: sessionNotes });
  };

  const toggleSet = (set: WorkoutSet, exercise: SessionExercise) => {
    if (!session) return;
    if (set.completedAt !== null) {
      haptics.tap();
      edit(set.id, { completedAt: null });
      return;
    }
    haptics.impactMedium();
    // The write, the rest it starts and where the card goes are `tickSet`'s,
    // shared with the Lock Screen's "Done set".
    // A field left empty is done at the dimmed number the row showed in it,
    // and one still being typed in at what was typed.
    const scale = weightScale(catalogExercise(exerciseRows, exercise.exerciseId), dumbbellEntry);
    const values = typedTickValues(ghostFill(set, exercise), typedRef.current.get(set.id) ?? {}, unit, scale);
    typedRef.current.delete(set.id);
    const next = tickSet(session.id, set.id, new Date(), values);
    if (!next) return;
    // A tick that sets a record is worth a different buzz than an ordinary one.
    const records = liveSetRecords(
      session.id,
      exercise.exerciseId,
      catalogExercise(exerciseRows, exercise.exerciseId)?.kind ?? 'weight_reps',
      useWorkoutStore.getState().exerciseHistory(exercise.exerciseId),
      sessionsList,
      dayResetTime,
    );
    if (records.has(set.id)) haptics.success();
    if (next.showExerciseId !== viewedId) animateLayout();
    setViewedId(next.showExerciseId);
    setOpenSetId(null);
  };

  const openRow = (set: WorkoutSet, open: WorkoutSet | null) => {
    haptics.tap();
    animateLayout();
    setOpenSetId(set.id === open?.id ? null : set.id);
  };

  const addSet = (exercise: SessionExercise) => {
    if (!session) return;
    haptics.tap();
    animateLayout();
    useWorkoutStore.getState().addPlannedSet(session.id, exercise.exerciseId);
  };

  const removeSet = (set: WorkoutSet, exercise: SessionExercise) => {
    if (!session) return;
    haptics.tap();
    animateLayout();
    // The exercise's note rides on its first set, so removing that set hands it to the next.
    const keep = exerciseDayNote(exercise.sets);
    useWorkoutStore.getState().deleteSet(session.id, set.id);
    if (keep) for (const p of exerciseDayNotePatches(exercise.sets.filter(x => x.id !== set.id), keep)) edit(p.setId, { note: p.note });
    setOpenSetId(null);
  };

  // Last time's numbers written into a set: the Previous column, tapped.
  const fillFromPrevious = (set: WorkoutSet, prev: WorkoutSet | null | undefined) => {
    if (!prev) return;
    haptics.tap();
    edit(set.id, { weightKg: prev.weightKg, reps: prev.reps, durationSeconds: prev.durationSeconds, distanceM: prev.distanceM });
  };

  const changeKind = (set: WorkoutSet, next: WorkoutSetKind) => {
    if (next === set.kind) return;
    haptics.tap();
    animateLayout();
    edit(set.id, { kind: next });
  };

  // "Use 82.5 kg": the proposal written onto the planned working sets, and a
  // ramp's planned warm-ups worked out again from the new weight
  // (`applyProposal`, which the watch's Use goes through too). Each is an
  // ordinary edit, as if typed, and every one stays editable.
  const useProposal = (exerciseId: string, shown: ExerciseProposal | null) => {
    if (!session || !shown) return;
    haptics.success();
    applyProposal(session.id, exerciseId, { proposal: shown });
  };

  const toggleReordering = () => {
    haptics.tap();
    animateLayout();
    setOpenSetId(null);
    setNoteEdit(null);
    setReordering(v => !v);
  };

  // One draggable row per block (a superset is one), so a drop never splits a pair.
  const reorderRows = useMemo(
    () => exerciseBlocks(sets).map(block => ({ id: block[0].exerciseId, block })),
    [sets],
  );
  const dropReorder = (next: typeof reorderRows) => {
    if (!session) return;
    useWorkoutStore.getState().reorderExercises(session.id, next.flatMap(r => r.block.map(e => e.exerciseId)));
  };

  const addExercise = (exerciseId: string) => {
    if (!session) return;
    const added = useWorkoutStore.getState().addSessionExercise(session.id, exerciseId);
    if (typeof added === 'string') return;
    setViewedId(exerciseId);
    setOpenSetId(null);
  };

  // Described exercises are added after what is there, and the view goes to
  // the first new one. A `new:` exercise is made here, on confirm.
  const addDescribed = (draft: RoutineDraft) => {
    if (!session) return;
    const items = withCreatedExercises(draft.items, draft.newExercises);
    const result = items ? useWorkoutStore.getState().addRoutineItems(session.id, items) : 'notFound';
    if (typeof result === 'string') {
      haptics.warning();
      Alert.alert('Couldn’t add the exercises', 'Something went wrong while adding them. Nothing was changed, so you can try again.');
      return;
    }
    haptics.success();
    animateLayout();
    setDescribing(false);
    if (result.added.length > 0) { setViewedId(result.added[0]); setOpenSetId(null); }
    if (result.skipped.length > 0) {
      const names = result.skipped.map(id => catalogExercise(useWorkoutStore.getState().exercises, id)?.name ?? 'An exercise');
      Alert.alert(
        result.added.length > 0 ? 'Some exercises were left out' : 'Nothing was added',
        `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} already in this workout.`,
      );
    }
  };

  // ==== the exercise's "•••" menu: supersets ====
  // The exercise whose rest the Rest chip's card is open on.
  const [restFor, setRestFor] = useState<string | null>(null);
  const [exerciseMenu, setExerciseMenu] = useState<{ exerciseId: string; anchor: CardAnchor } | null>(null);
  const joinSuperset = (exerciseId: string, partnerId: string) => {
    if (!session) return;
    if (!useWorkoutStore.getState().joinSessionSuperset(session.id, exerciseId, partnerId)) return;
    haptics.success();
    animateLayout();
  };
  // The view stays on the exercise that moved: `viewIndex` follows its id.
  const moveExercise = (exerciseId: string, direction: 'up' | 'down') => {
    if (!session) return;
    if (!useWorkoutStore.getState().moveSessionExercise(session.id, exerciseId, direction)) return;
    haptics.tap();
    animateLayout();
  };
  const leaveSuperset = (exerciseId: string) => {
    if (!session) return;
    if (!useWorkoutStore.getState().leaveSessionSuperset(session.id, exerciseId)) return;
    haptics.tap();
    animateLayout();
  };

  const swapExercise = (toExerciseId: string, fromExerciseId: string | undefined = viewed?.exerciseId) => {
    if (!session || !fromExerciseId) return;
    const moved = useWorkoutStore.getState().swapSessionExercise(session.id, fromExerciseId, toExerciseId);
    if (typeof moved === 'string') return;
    haptics.success();
    animateLayout();
    setViewedId(toExerciseId);
    setOpenSetId(null);
    setNoteEdit(null);
  };

  const removeExercise = (exercise: SessionExercise, name: string) => {
    if (!session) return;
    const run = () => {
      const index = exercises.findIndex(e => e.exerciseId === exercise.exerciseId);
      const neighbor = exercises[index + 1] ?? exercises[index - 1];
      if (useWorkoutStore.getState().removeSessionExercise(session.id, exercise.exerciseId) !== true) return;
      haptics.success();
      animateLayout();
      setViewedId(neighbor?.exerciseId ?? null);
      setOpenSetId(null);
      setNoteEdit(null);
    };
    // Nothing logged on it, nothing lost: a planned exercise goes without asking.
    if (!exercise.sets.some(s => s.completedAt !== null)) { run(); return; }
    haptics.tap();
    Alert.alert(
      `Remove ${name}?`,
      'The sets you logged on it will be deleted from this workout.',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: run },
      ],
    );
  };

  // ==== the exercise's two notes ====
  const savedNote = (exercise: SessionExercise, k: NoteKind) => (
    k === 'always' ? catalogExercise(exerciseRows, exercise.exerciseId)?.notes ?? '' : exerciseDayNote(exercise.sets)
  );
  const openNote = (exercise: SessionExercise, focus: NoteKind) => {
    haptics.tap();
    animateLayout();
    setTodayDraft(savedNote(exercise, 'today'));
    setAlwaysDraft(savedNote(exercise, 'always'));
    setNoteEdit({ exerciseId: exercise.exerciseId, focus });
  };
  // Each field saves on its own blur, so one never waits on the other.
  const commitNote = (exercise: SessionExercise, k: NoteKind) => {
    if (!session) return;
    const draft = k === 'always' ? alwaysDraft : todayDraft;
    if (savedNote(exercise, k).trim() === draft.trim()) return;
    if (k === 'always') {
      useWorkoutStore.getState().updateExercise(exercise.exerciseId, { notes: draft });
      return;
    }
    for (const p of exerciseDayNotePatches(exercise.sets, draft)) edit(p.setId, { note: p.note });
  };
  const closeNote = (exercise: SessionExercise) => {
    commitNote(exercise, 'today');
    commitNote(exercise, 'always');
    animateLayout();
    setNoteEdit(null);
  };

  // ==== the gym's note, and swapping what it lacks ====
  const openGymNote = (exerciseId: string, current: string) => {
    haptics.tap();
    animateLayout();
    setGymNoteDraft(current);
    setGymNoteEdit(exerciseId);
  };
  const commitGymNote = (exerciseId: string, current: string) => {
    if (gym && current.trim() !== gymNoteDraft.trim()) {
      useGymStore.getState().setGymExercise(gym.id, exerciseId, { notes: gymNoteDraft });
    }
  };
  // Swap every flagged exercise for the gym's best match for it, one at a time
  // so two never take the same replacement. Each is the same swap as the one
  // on its card, and one with no match is left for the person.
  const swapAllUnavailable = () => {
    if (!session) return;
    haptics.success();
    animateLayout();
    const taken = exercises.map(e => e.exerciseId);
    for (const id of unavailableIds) {
      const best = candidatesFor(id, taken)[0];
      if (!best) continue;
      const moved = useWorkoutStore.getState().swapSessionExercise(session.id, id, best);
      if (typeof moved !== 'string') taken.push(best);
    }
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
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const pickMember = rotationPickFor(linkedTask, session ?? {}, getCurrentDayStart(), weekStartsOn);
  const taskEffect = workoutTaskEffect(linkedTask, pickMember);
  const askFirst = taskEffect === 'ask';
  const summary = useMemo(
    () => (finishing && session ? sessionSummary(session, sets) : null),
    [finishing, session, sets],
  );

  // What this workout changed from its routine, offered on the summary one
  // change at a time. Read off the routine and the done sets while it is open.
  const routineDiff = useMemo(
    () => {
      if (!finishing || !session || !routine) return [];
      return routineChanges({
        items: oldVersion?.version.items ?? routine.items,
        sets,
        kindOf: id => catalogExercise(exerciseRows, id)?.kind ?? 'weight_reps',
        // A load taken from the suggestion is the plan working, not a change to it.
        suggestedKg: id => liveProposal(session.id, id)?.proposal.sets.find(x => x.kind !== 'warmup')?.weightKg ?? null,
        restOverrides: session.restOverrides,
        defaultRestSeconds,
      });
    },
    [finishing, session, routine, sets, exerciseRows, oldVersion, defaultRestSeconds],
  );
  const exerciseName = (id: string) => catalogExercise(exerciseRows, id)?.name ?? 'Unknown exercise';
  // On a workout from an old version a change is to that version, so taking
  // one takes the restore with it, and letting the restore go lets them go.
  const toggleChange = (id: string) => {
    haptics.tap();
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.delete(id)) {
        if (id === RESTORE_CHANGE) return new Set();
      } else {
        next.add(id);
        if (oldVersion) next.add(RESTORE_CHANGE);
      }
      return next;
    });
  };
  const acceptedCount = routineDiff.filter(c => accepted.has(c.id)).length;
  const restoring = oldVersion !== null && accepted.has(RESTORE_CHANGE);
  const changeTotal = routineDiff.length + (oldVersion ? 1 : 0);
  const selectedTotal = acceptedCount + (restoring ? 1 : 0);

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
    // The ticked changes go into the routine as it is now, as a new version:
    // this workout was done on the current one, which stays as it was. On a
    // workout from an old version they go onto that version, restored as the
    // newest. A routine that has since been deleted or refuses the edit
    // leaves the saved workout alone.
    const picked = routineDiff.filter(c => accepted.has(c.id));
    const store = useWorkoutStore.getState();
    const current = routine ? store.routines.find(r => r.id === routine.id) : undefined;
    if (current && oldVersion && restoring) {
      store.updateRoutine(
        current.id,
        { items: applyRoutineChanges(oldVersion.version.items, picked), notes: oldVersion.version.notes },
        { version: 'new', source: 'restore' },
      );
    } else if (current && !oldVersion && picked.length > 0) {
      store.updateRoutine(current.id, { items: applyRoutineChanges(current.items, picked) }, { version: 'new', source: 'workout' });
    }
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

        {/* Under the header, not in a footer: the keyboard is up while sets are
            typed, and anything at the bottom of the sheet is behind it. */}
        {session && !finishing && <RestStrip sessionId={visible ? session.id : undefined} styles={styles} />}

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
              volumeKg={liftVolumeKg(sets, id => catalogExercise(exerciseRows, id)?.kind ?? 'weight_reps')}
              unit={unit}
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
                    const heaviest = e.heaviest && info ? heaviestLine(e.heaviest, info.kind, unit, weightScale(info, dumbbellEntry)) : null;
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
                      onChange={saveEffort}
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
                  <Text style={styles.notesLabel}>Notes</Text>
                  <TextField
                    style={styles.notesInput}
                    value={sessionNotes}
                    onChangeText={setSessionNotes}
                    onBlur={saveNotes}
                    placeholder="e.g. Shoulder felt fine on the last set"
                    placeholderTextColor={colors.textTertiary}
                    multiline
                    accessibilityLabel="Notes on this workout"
                  />
                </View>
              </>
            )}
            {routine && versionInfo && (routineDiff.length > 0 || oldVersion) && (
              <>
                <Text style={styles.groupLabel}>{`Update ${routine.name}?`}</Text>
                <View style={styles.card}>
                  {oldVersion && (
                    <TouchableOpacity
                      style={styles.changeRow}
                      onPress={() => toggleChange(RESTORE_CHANGE)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: restoring }}
                      accessibilityLabel={`Make version ${oldVersion.number} current again`}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.changeTitle}>{`Make version ${oldVersion.number} current again`}</Text>
                        <Text style={styles.changeDetail}>
                          {`This workout was done on it. Version ${versionInfo.currentNumber} stays in History.`}
                        </Text>
                      </View>
                      <SelectionDot selected={restoring} onPress={() => toggleChange(RESTORE_CHANGE)} />
                    </TouchableOpacity>
                  )}
                  {routineDiff.map((c, i) => {
                    const text = describeRoutineChange(c, exerciseName, unit);
                    const on = accepted.has(c.id);
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.changeRow, (i > 0 || oldVersion !== null) && styles.rowSep]}
                        onPress={() => toggleChange(c.id)}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${text.title}. ${text.detail}`}
                      >
                        <View style={styles.flex}>
                          <Text style={styles.changeTitle}>{text.title}</Text>
                          <Text style={styles.changeDetail}>{text.detail}</Text>
                        </View>
                        <SelectionDot selected={on} onPress={() => toggleChange(c.id)} />
                      </TouchableOpacity>
                    );
                  })}
                  <View style={[styles.changeFooter, styles.rowSep]}>
                    <InlineAction
                      label={selectedTotal === changeTotal ? 'Clear all' : 'Select all'}
                      variant="neutral"
                      surface="tray"
                      onPress={() => {
                        haptics.tap();
                        setAccepted(selectedTotal === changeTotal
                          ? new Set()
                          : new Set([...routineDiff.map(c => c.id), ...(oldVersion ? [RESTORE_CHANGE] : [])]));
                      }}
                    />
                    <Text style={styles.changeCount}>{`${selectedTotal} of ${changeTotal} selected`}</Text>
                  </View>
                </View>
                <Text style={styles.consequence}>
                  {finishVersionText({
                    current: versionInfo.currentNumber,
                    old: oldVersion?.number ?? null,
                    restoring,
                    changes: acceptedCount,
                    inProgram: routine.programId !== null,
                  })}
                </Text>
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
                  ? linkedTaskLine(taskEffect, displayTitleFor(linkedTask), pickMember?.title)
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
            scrollEnabled={!dragging}
            {...keyboardScroll.props}
            ref={keyboardScroll.ref}
          >
            {(gym || gyms.length > 0) && (
              <GymLine
                name={gym?.name ?? null}
                unavailableCount={unavailableIds.length}
                onChoose={() => setGymPickerOpen(true)}
                onSwapAll={swapAllUnavailable}
              />
            )}
            {exercises.length > 0 && (
              <View style={styles.position}>
                <Text style={styles.positionText}>{`${exercises.length} exercises`}</Text>
                <View style={styles.flex} />
                {exercises.length > 1 && (
                  <InlineAction
                    icon={reordering ? undefined : 'reorder-three-outline'}
                    label="Reorder"
                    variant={reordering ? 'accent' : 'neutral'}
                    onPress={toggleReordering}
                    accessibilityLabel={reordering ? 'Done reordering exercises' : 'Reorder exercises'}
                  />
                )}
              </View>
            )}

            {/* One card per shown exercise: the one the sheet is on, or every one in All. The param keeps the name `viewed`, so the card body reads as it always has. */}
            {reordering && (
              <>
                <Text style={styles.reorderHint}>Touch and hold, then drag to reorder</Text>
                <View style={styles.reorderCard}>
                  <SortableList
                    data={reorderRows}
                    onDragStateChange={setDragging}
                    onReorder={dropReorder}
                    renderItem={(row, index, drag, isActive) => {
                      const names = row.block.map(e => catalogExercise(exerciseRows, e.exerciseId)?.name ?? 'Unknown exercise');
                      const all = row.block.flatMap(e => e.sets);
                      const done = all.filter(s => s.completedAt !== null).length;
                      const detail = `${row.block.length > 1 ? 'Superset · ' : ''}${all.length} ${all.length === 1 ? 'set' : 'sets'} · ${done} done`;
                      return (
                        <TouchableOpacity
                          style={[styles.reorderRow, index > 0 && styles.reorderRowSep, row.block.length > 1 && styles.reorderSuperset, isActive && styles.reorderActive]}
                          onLongPress={drag}
                          delayLongPress={interaction.delayLongPress}
                          activeOpacity={interaction.activeOpacity}
                          accessibilityRole="button"
                          accessibilityLabel={`Reorder ${names.join(' and ')}`}
                          accessibilityHint="Touch and hold, then drag"
                        >
                          <Ionicons name="reorder-two-outline" size={iconSize.md} color={colors.textTertiary} />
                          <View style={styles.flex}>
                            <Text style={styles.reorderName}>{names.join(' + ')}</Text>
                            <Text style={styles.reorderDetail}>{detail}</Text>
                          </View>
                          <View style={[styles.reorderDot, done === all.length && styles.reorderDotDone]} />
                        </TouchableOpacity>
                      );
                    }}
                  />
                </View>
              </>
            )}
            {(reordering ? [] : exercises).map((viewed, cardIndex) => {
              const viewedInfo = catalogExercise(exerciseRows, viewed.exerciseId);
              const kind: ExerciseKind = viewedInfo?.kind ?? 'weight_reps';
              const fields = setFieldsFor(kind);
              // The set whose tray is open: only one tapped by hand, none by default.
              const openSet = viewed.sets.find(s => s.id === openSetId) ?? null;
              const gymSetting = gymSettingFor(gymSettings, gym?.id, viewed.exerciseId);
              // A pair total reads each stored dumbbell weight doubled (`dumbbellLoad.ts`).
              const scale = weightScale(viewedInfo, dumbbellEntry);
              const noteFocus = noteEdit?.exerciseId === viewed.exerciseId ? noteEdit.focus : null;
              const todayNote = exerciseDayNote(viewed.sets);

              // The plates for the open set's weight, for a barbell, EZ bar or trap bar: a
              // dumbbell or a machine has nothing to load. A pound lifter who never set an
              // inventory gets the pound default (`effectivePlateInventory`).
              const inventory = effectivePlateInventory(plateInventory, unit);
              const plate = openSet && viewedInfo && isPlateLoaded(viewedInfo.equipment) && kind === 'weight_reps' && openSet.weightKg
                ? plateLoad(openSet.weightKg, barKgFor(withGymBar(viewedInfo, gymSetting).barKg, inventory, viewedInfo.equipment, unit), inventory, unit)
                : null;

              // Last time, for this exercise: one read per exercise shown, not per row.
              const previous = session ? useWorkoutStore.getState().lastTimeFor(viewed.exerciseId, session.id) : [];
              const previousBySet = matchPreviousByPosition(viewed.sets, previous);
              // What was written on this exercise's sets last time, read before the first set.
              const lastNotes = lastTimeNotes(previous);
              // The records this workout has set on the exercise so far, by the set holding each.
              const liveRecords = session && viewed.sets.some(s => s.completedAt !== null)
                ? liveSetRecords(
                  session.id,
                  viewed.exerciseId,
                  kind,
                  useWorkoutStore.getState().exerciseHistory(viewed.exerciseId),
                  sessionsList,
                  dayResetTime,
                )
                : null;
              // The rest comes after the round, so a superset's earlier exercises have none of their own.
              const viewedGroup = supersetGroup(exercises, viewed.exerciseId);
              const restChip = session && viewedGroup[viewedGroup.length - 1]?.exerciseId === viewed.exerciseId
                ? {
                    seconds: restSecondsFor(startedPlan, viewed.exerciseId, defaultRestSeconds, session.restOverrides),
                    overridden: session.restOverrides?.[viewed.exerciseId] !== undefined,
                  }
                : null;

              // ==== the suggestion: the next load, proposed and never applied unasked ====
              // The routine the workout follows and the program it belongs to decide
              // which scheme moves this exercise on (`exerciseProposal`, shared with
              // the Apple Watch's suggestion).
              const shownProposal: ExerciseProposal | null = session ? exerciseProposal({
                exerciseId: viewed.exerciseId,
                exercises: exerciseRows,
                routine: startedPlan,
                program,
                sessions: sessionsList,
                routines,
                history: useWorkoutStore.getState().exerciseHistory(viewed.exerciseId),
                exceptSessionId: session.id,
                plateInventory,
                unit,
                gymBarKg: gymSetting?.barKg ?? null,
                gymIncrementKg: gymIncrementKg(gymSetting),
                dumbbellEntry,
              }) : null;
              const proposal = shownProposal?.proposal ?? null;

              return (
              <View key={viewed.exerciseId} style={[styles.card, cardIndex > 0 && styles.cardStacked]}>
                <View style={styles.exHead}>
                  <View style={styles.exTitleRow}>
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
                  <TouchableOpacity
                    style={styles.exMenuButton}
                    hitSlop={8}
                    onPress={e => {
                      haptics.tap();
                      setExerciseMenu({ exerciseId: viewed.exerciseId, anchor: { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY } });
                    }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`More options for ${viewedInfo?.name ?? 'this exercise'}`}
                  >
                    <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={colors.textSecondary} />
                  </TouchableOpacity>
                  </View>
                  {!!viewedInfo && viewedInfo.primaryMuscles.length > 0 && (
                    <Text style={styles.exMuscles}>
                      {viewedInfo.primaryMuscles.map(m => MUSCLE_LABELS[m]).join(', ')}
                    </Text>
                  )}
                  {gym && unavailableIds.includes(viewed.exerciseId) && !keptIds.has(viewed.exerciseId) && (() => {
                    const best = candidatesFor(viewed.exerciseId)[0] ?? null;
                    return (
                      <GymUnavailableBanner
                        gymName={gym.name}
                        candidateName={best ? catalogExercise(exerciseRows, best)?.name ?? null : null}
                        candidateDetail={best && session ? describeLastLoad(useWorkoutStore.getState().lastTimeFor(best, session.id), unit) : null}
                        onSwap={() => { if (best) swapExercise(best, viewed.exerciseId); }}
                        onOther={() => { haptics.tap(); setViewedId(viewed.exerciseId); setPicking('swap'); }}
                        onKeep={() => { haptics.tap(); setKeptIds(prev => new Set(prev).add(viewed.exerciseId)); }}
                      />
                    );
                  })()}
                  <ExercisePhotos
                    exerciseId={viewed.exerciseId}
                    name={viewedInfo?.name ?? 'this exercise'}
                    open={photosOpenIds.has(viewed.exerciseId)}
                    onToggle={() => setPhotosOpenIds(prev => {
                      const next = new Set(prev);
                      if (!next.delete(viewed.exerciseId)) next.add(viewed.exerciseId);
                      return next;
                    })}
                  />
                  <View style={styles.exActions}>
                    {restChip && (
                      <InlineAction
                        icon="timer-outline"
                        label={`Rest ${restChip.seconds === 0 ? 'none' : formatRestSeconds(restChip.seconds)}`}
                        variant={restChip.overridden ? undefined : 'neutral'}
                        onPress={() => { haptics.tap(); setRestFor(viewed.exerciseId); }}
                        accessibilityLabel={`Rest between sets of ${viewedInfo?.name ?? 'this exercise'}, ${restChip.seconds === 0 ? 'none' : formatRestSeconds(restChip.seconds)}`}
                      />
                    )}
                    {!noteFocus && (!viewedInfo?.notes || !todayNote) && (
                      <InlineAction
                        icon="create-outline"
                        label="Add note"
                        variant="neutral"
                        onPress={() => openNote(viewed, !todayNote ? 'today' : 'always')}
                        accessibilityLabel={`Add a note on ${viewedInfo?.name ?? 'this exercise'}`}
                      />
                    )}
                    {gym && gymNoteEdit !== viewed.exerciseId && (
                      <InlineAction
                        icon="location-outline"
                        label={gymSetting?.notes ? 'Edit gym note' : 'Add gym note'}
                        variant="neutral"
                        onPress={() => openGymNote(viewed.exerciseId, gymSetting?.notes ?? '')}
                        accessibilityLabel={`${gymSetting?.notes ? 'Edit' : 'Add'} the note on ${viewedInfo?.name ?? 'this exercise'} at ${gym.name}`}
                      />
                    )}
                  </View>
                  {gym && (
                    <GymNoteBox
                      gymName={gym.name}
                      note={gymSetting?.notes ?? ''}
                      editing={gymNoteEdit === viewed.exerciseId}
                      draft={gymNoteDraft}
                      onChangeDraft={setGymNoteDraft}
                      onCommit={() => { commitGymNote(viewed.exerciseId, gymSetting?.notes ?? ''); setGymNoteEdit(null); }}
                    />
                  )}
                  {(!!noteFocus || !!viewedInfo?.notes || !!todayNote || !!lastNotes) && (
                    <View style={styles.noteCard}>
                      {noteFocus ? (
                        <View style={styles.noteEditor}>
                          {(['today', 'always'] as const).map(k => (
                            <View key={k} style={styles.noteField}>
                              <Text style={styles.noteLabel}>{k === 'today' ? 'Today' : 'Every time'}</Text>
                              <HelpText style={styles.noteHelp}>{NOTE_HELP[k]}</HelpText>
                              <TextField
                                style={styles.noteInput}
                                value={k === 'today' ? todayDraft : alwaysDraft}
                                onChangeText={k === 'today' ? setTodayDraft : setAlwaysDraft}
                                onBlur={() => commitNote(viewed, k)}
                                placeholder={NOTE_PLACEHOLDER[k]}
                                placeholderTextColor={colors.textTertiary}
                                multiline
                                autoFocus={noteFocus === k}
                                accessibilityLabel={`${k === 'today' ? 'Note for today on' : 'Note every time on'} ${viewedInfo?.name ?? 'this exercise'}`}
                              />
                            </View>
                          ))}
                          <View style={styles.noteEditorActions}>
                            <InlineAction label={BUTTON_LABEL.done} onPress={() => closeNote(viewed)} />
                          </View>
                        </View>
                      ) : (
                        <>
                          {!!viewedInfo?.notes && (
                            <TouchableOpacity
                              style={styles.noteRow}
                              onPress={() => openNote(viewed, 'always')}
                              activeOpacity={interaction.activeOpacity}
                              accessibilityRole="button"
                              accessibilityLabel={`Edit the every time note: ${viewedInfo.notes}`}
                            >
                              <Text style={styles.noteLabel}>Every time</Text>
                              <Text style={styles.noteText}>{viewedInfo.notes}</Text>
                            </TouchableOpacity>
                          )}
                          {!!todayNote && (
                            <TouchableOpacity
                              style={styles.noteRow}
                              onPress={() => openNote(viewed, 'today')}
                              activeOpacity={interaction.activeOpacity}
                              accessibilityRole="button"
                              accessibilityLabel={`Edit today’s note: ${todayNote}`}
                            >
                              <Text style={styles.noteLabel}>Today</Text>
                              <Text style={styles.noteText}>{todayNote}</Text>
                            </TouchableOpacity>
                          )}
                        </>
                      )}
                      {lastNotes && (
                        <View style={styles.noteRow}>
                          <Text style={[styles.noteLabel, styles.noteLabelLast]}>{`Last time · ${format(new Date(lastNotes.at), 'MMM d')}`}</Text>
                          {lastNotes.notes.map((n, i) => (
                            <Text key={i} style={styles.noteText}>{lastNotes.notes.length > 1 ? `${n.where}: ${n.text}` : n.text}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                  {proposal && (
                    <SuggestionCard
                      proposal={proposal}
                      unit={unit}
                      scale={scale}
                      // Offered until a working set is logged or the plan
                      // already asks for it; after that it is shown plainly,
                      // as the target being worked to.
                      offer={!workingSetLogged(viewed.sets) && !proposalApplied(viewed.sets, proposal, unit)}
                      onUse={() => useProposal(viewed.exerciseId, shownProposal)}
                      styles={styles}
                    />
                  )}
                </View>

                <View style={styles.setHead} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Text style={[styles.headCell, styles.colSet]}>Set</Text>
                  <Text style={[styles.headCell, styles.colPrev]}>Previous</Text>
                  {fields.map(f => (
                    <Text key={f} style={[styles.headCell, styles.colValue]}>{f === 'distance' ? 'Dist (m)' : columnLabel(f, kind, unit, weightHeadingSuffix(viewedInfo, dumbbellEntry))}</Text>
                  ))}
                  <View style={styles.colCheck} />
                </View>

                {viewed.sets.map(set => {
                  const isTray = openSet?.id === set.id;
                  const done = set.completedAt !== null;
                  const prev = previousBySet.get(set.id);
                  const prevLine = prev ? formatSetLine(prev, kind, unit, false, scale) : null;
                  const prevMark = prev ? previousBadge(prev) : null;
                  const label = labels.get(set.id) ?? '';
                  const record = done ? liveRecords?.get(set.id)?.[0] ?? null : null;
                  const recordShort = record ? recordShortLabel(record.type, kind, record.reps) : '';
                  const recordChange = record ? formatRecordChange(record, kind, unit) : null;
                  const recordText = record && recordChange
                    ? `${recordLabel(record.type, kind, record.reps)}, was ${recordChange.before}`
                    : null;
                  return (
                    <DeletableSet
                      key={set.id}
                      label={setName(set.kind, labels.get(set.id) ?? '')}
                      onDelete={() => removeSet(set, viewed)}
                      styles={styles}
                    >
                      <View style={styles.setRow}>
                        <TouchableOpacity
                          style={styles.colSet}
                          onPress={() => openRow(set, openSet)}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: isTray }}
                          accessibilityLabel={`${setName(set.kind, label)}, more options`}
                        >
                          <Text style={[setBadge(set.kind) ? styles.setBadge : styles.setNumber, styles.setLabel]}>{label}</Text>
                        </TouchableOpacity>
                        {prev ? (
                          <TouchableOpacity
                            style={styles.colPrev}
                            onPress={() => fillFromPrevious(set, prev)}
                            hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Use last time’s ${prevLine}${prevMark ? ` (${setName(prev!.kind, '')})` : ''} for ${setName(set.kind, label)}`}
                          >
                            <Text style={styles.prevText} numberOfLines={1}>
                              {prevLine}
                              {prevMark ? <Text style={styles.prevMark}>{`  ${prevMark}`}</Text> : null}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <Text style={[styles.colPrev, styles.prevText]} numberOfLines={1}>–</Text>
                        )}
                        {!!recordText && (
                          <View
                            style={styles.recordPill}
                            accessible
                            accessibilityLabel={`Personal record. ${recordText}`}
                          >
                            <Ionicons name="trophy" size={iconSize.xs} color={colors.accentText} />
                            <Text style={styles.recordPillText}>{recordShort}</Text>
                          </View>
                        )}
                        {fields.map(f => (
                          <SetInput
                            key={f}
                            set={set}
                            field={f}
                            unit={unit}
                            scale={scale}
                            done={done}
                            ghost={ghostText(set, viewed, f, unit, scale)}
                            onEdit={patch => edit(set.id, patch)}
                            onTyping={text => noteTyping(set.id, f, text)}
                            styles={styles}
                            placeholderColor={colors.textTertiary}
                            accessibilityLabel={`${setName(set.kind, label)} ${fieldLabel(f, kind)}`}
                          />
                        ))}
                        <TouchableOpacity
                          style={styles.colCheck}
                          onPress={() => toggleSet(set, viewed)}
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
                      {isTray && (
                        <View style={styles.tray}>
                          <SegmentedControl
                            label="Set type"
                            options={SET_KIND_OPTIONS}
                            value={set.kind}
                            onChange={next => changeKind(set, next)}
                          />
                          {!!plate && <PlateLine load={plate} unit={unit} />}
                        </View>
                      )}
                    </DeletableSet>
                  );
                })}

                <View style={styles.adds}>
                  <InlineAction icon="add" label="Add set" onPress={() => addSet(viewed)} />
                </View>
              </View>
              );
            })}
            {exercises.length === 0 && (
              <View style={styles.emptyWrap}>
                <EmptyNote icon="barbell-outline">No exercises yet. Add the first one to start logging sets.</EmptyNote>
              </View>
            )}

            <View style={styles.addExercise}>
              <InlineAction icon="add" label="Add exercise" variant="neutral" surface="page" onPress={() => { haptics.tap(); setPicking('add'); }} />
              {canDescribe && (
                <InlineAction icon="sparkles-outline" label="Describe" surface="page" onPress={() => { haptics.tap(); setDescribing(true); }} />
              )}
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
        ) : null}
      </View>
      {/* Inside this Modal, not beside it: a second sheet presented from the
          same view controller as this one never appears. */}
      {(() => {
        const menuId = exerciseMenu?.exerciseId ?? null;
        const menuExercise = menuId ? exercises.find(e => e.exerciseId === menuId) ?? null : null;
        const group = menuId ? supersetGroup(exercises, menuId) : [];
        const partners = exercises.filter(e => !group.some(g => g.exerciseId === e.exerciseId));
        const nameOf = (id: string) => catalogExercise(exerciseRows, id)?.name ?? 'Unknown exercise';
        return (
          <ActionMenu
            visible={exerciseMenu !== null}
            title={menuId ? nameOf(menuId) : ''}
            anchor={exerciseMenu?.anchor ?? null}
            onClose={() => setExerciseMenu(null)}
            actions={menuId && menuExercise ? [
              ...(['up', 'down'] as const)
                .filter(direction => movedExerciseOrder(sets, menuId, direction) !== null)
                .map(direction => ({
                  key: `move-${direction}`,
                  label: direction === 'up' ? 'Move up' : 'Move down',
                  icon: (direction === 'up' ? 'arrow-up-outline' : 'arrow-down-outline') as 'arrow-up-outline',
                  onPress: () => moveExercise(menuId, direction),
                })),
              ...(partners.length > 0 ? [{
                key: 'superset',
                label: 'Superset with…',
                icon: 'link-outline' as const,
                choices: partners.map(p => ({ key: p.exerciseId, label: nameOf(p.exerciseId), onPress: () => joinSuperset(menuId, p.exerciseId) })),
              }] : []),
              ...(menuExercise.supersetKey && group.length > 1 ? [{
                key: 'leave',
                label: 'Leave superset',
                icon: 'unlink-outline' as const,
                onPress: () => leaveSuperset(menuId),
              }] : []),
              ...(swappableSets(menuExercise.sets, menuId).length > 0 ? [{
                key: 'swap',
                label: 'Swap',
                icon: 'swap-horizontal' as const,
                onPress: () => { setViewedId(menuId); setPicking('swap'); },
              }] : []),
              {
                key: 'remove',
                label: 'Remove from workout',
                icon: 'trash-outline' as const,
                destructive: true,
                onPress: () => removeExercise(menuExercise, nameOf(menuId)),
              },
            ] : []}
          />
        );
      })()}
      <ExerciseRestSheet
        visible={visible && restFor !== null && session !== null}
        exerciseName={restFor ? catalogExercise(exerciseRows, restFor)?.name ?? 'This exercise' : ''}
        seconds={session && restFor ? restSecondsFor(startedPlan, restFor, defaultRestSeconds, session.restOverrides) : 0}
        fallbackSeconds={restFor ? restSecondsFor(startedPlan, restFor, defaultRestSeconds) : 0}
        overridden={!!session && !!restFor && session.restOverrides?.[restFor] !== undefined}
        onChange={seconds => { if (session && restFor) useWorkoutStore.getState().setSessionRest(session.id, restFor, seconds); }}
        onClose={() => setRestFor(null)}
      />
      <ExercisePickerSheet
        visible={visible && picking !== null}
        onClose={() => setPicking(null)}
        onPick={picking === 'swap' ? swapExercise : addExercise}
        addedIds={exercises.map(e => e.exerciseId)}
        addedLabel="In workout"
        suggestedIds={picking === 'swap' && viewed ? (gym ? candidatesFor(viewed.exerciseId) : swapCandidates(exerciseRows, viewed.exerciseId, exercises.map(e => e.exerciseId))) : undefined}
      />
      <DescribeWorkoutSheet
        visible={visible && describing}
        onClose={() => setDescribing(false)}
        mode="routine"
        into={{ target: 'workout', onAdd: addDescribed }}
      />
      <GymsSheet
        visible={visible && gymPickerOpen}
        onClose={() => setGymPickerOpen(false)}
        currentId={gym?.id ?? null}
        onPick={gymId => { if (session) useWorkoutStore.getState().updateSession(session.id, { gymId }); }}
      />
      <ExerciseDetailSheet visible={visible && detailOpen} exerciseId={detailId} onClose={() => setDetailOpen(false)} />
    </SheetModal>
  );
}

// ==== the cells and their steppers ====

/** The finish summary's row that makes an old version current again; not a `RoutineChange`, so it has its own id. */
const RESTORE_CHANGE = 'restore-version';

function valueText(set: WorkoutSet, field: SetField, unit: WeightUnit, scale = 1): string | null {
  if (field === 'weight') return set.weightKg !== null ? formatWeightNumber(set.weightKg * scale, unit) : null;
  if (field === 'reps') return set.reps !== null ? String(set.reps) : null;
  if (field === 'duration') return set.durationSeconds !== null ? formatRestSeconds(set.durationSeconds) : null;
  return set.distanceM !== null ? formatDistance(set.distanceM) : null;
}

/**
 * What an empty cell of a not-yet-done set shows dimmed: the number from the
 * done set nearest above (`valuesFromLastDone`). Null for a done set, a cell
 * that has its own value, or when nothing above is done.
 */
function ghostText(set: WorkoutSet, exercise: SessionExercise, field: SetField, unit: WeightUnit, scale = 1): string | null {
  if (set.completedAt !== null) return null;
  const values = valuesFromLastDone(exercise.sets, set.id);
  return values ? valueText({ ...set, ...values }, field, unit, scale) : null;
}

/** The numbers ticking `set` writes for its empty cells: the ones `ghostText` showed. */
function ghostFill(set: WorkoutSet, exercise: SessionExercise): TickValues {
  const values = valuesFromLastDone(exercise.sets, set.id);
  if (!values) return {};
  const out: TickValues = {};
  if (set.weightKg === null && values.weightKg !== null) out.weightKg = values.weightKg;
  if (set.reps === null && values.reps !== null) out.reps = values.reps;
  if (set.durationSeconds === null && values.durationSeconds !== null) out.durationSeconds = values.durationSeconds;
  if (set.distanceM === null && values.distanceM !== null) out.distanceM = values.distanceM;
  return out;
}

/** "82.5 kg × 8": the heaviest set, with its unit, for the summary. */
function heaviestLine(set: WorkoutSet, kind: ExerciseKind, unit: WeightUnit, scale = 1): string | null {
  if (set.weightKg === null) return null;
  const w = `${formatWeightNumber(set.weightKg * scale, unit)} ${unit}`;
  if (kind === 'weight_distance' && set.distanceM !== null) return `${w} × ${formatDistance(set.distanceM)}`;
  return set.reps !== null ? `${w} × ${set.reps}` : w;
}

/**
 * One value cell of a set row, typed in place. The text is a draft held here
 * until the field loses focus, because `TextField` takes a `value` only when it
 * differs from what the field last reported, so writing each keystroke through
 * the store would turn "10." into "10" under the person's finger. A planned
 * value reads dim and a done one reads full, as the cells did before they
 * became fields.
 */
function SetInput({ set, field, unit, scale, done, ghost, onEdit, onTyping, styles, placeholderColor, accessibilityLabel }: {
  set: WorkoutSet;
  field: SetField;
  unit: WeightUnit;
  scale: number;
  done: boolean;
  /** The last done set's number, shown dimmed in an empty cell. */
  ghost: string | null;
  onEdit: (patch: Partial<WorkoutSet>) => void;
  /** The text while it is being typed, and null once it is written or dropped. */
  onTyping: (text: string | null) => void;
  styles: ReturnType<typeof makeStyles>;
  placeholderColor: string;
  accessibilityLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Only text typed since focus is written: focusing an empty cell and then
  // ticking the set wrote the dimmed number, and the blur after it wrote the
  // untouched empty draft over it.
  const typed = useRef(false);
  const shown = valueText(set, field, unit, scale) ?? '';
  // Distance is typed in meters; the row's own read-back says "1.2 km".
  const stored = field === 'distance' && set.distanceM !== null ? String(Math.round(set.distanceM)) : shown;
  // A tick takes what the cell held (`typedTickValues`), so the draft is spent.
  useEffect(() => {
    typed.current = false;
    setDraft(null);
  }, [set.completedAt]);
  const commit = () => {
    if (draft === null) return;
    const wasTyped = typed.current;
    typed.current = false;
    setDraft(null);
    onTyping(null);
    if (!wasTyped) return;
    const patch = parseSetCell(field, draft, unit, scale);
    if (patch) onEdit(patch);
  };
  return (
    <View style={styles.colValue}>
      <TextField
        style={[styles.cellInput, !done && styles.valuePlanned]}
        value={draft ?? stored}
        onChangeText={t => { typed.current = true; setDraft(t); onTyping(t); }}
        onBlur={commit}
        onSubmitEditing={commit}
        onFocus={() => { typed.current = false; setDraft(stored); }}
        placeholder={ghost ?? '–'}
        placeholderTextColor={placeholderColor}
        keyboardType={field === 'weight' || field === 'distance' ? 'decimal-pad' : field === 'duration' ? 'numbers-and-punctuation' : 'number-pad'}
        selectTextOnFocus
        returnKeyType="done"
        textAlign="center"
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

/**
 * The proposal for the shown exercise, as the mock draws it: "Today 3 × 6–8 at
 * 82.5 kg." in bold, then the reason, and a "Use 82.5 kg" button while it is
 * on offer. A proposal with nothing to propose yet (a percentage set with no
 * training max) shows only what is missing.
 */
/**
 * A set row that swipes left to reveal Delete. The swipe only opens the panel:
 * the set goes when Delete is tapped, so a stray drag can't take a logged set
 * away. It is the one destructive swipe in the app, and it stays inside this
 * sheet because a full-swipe commit is too easy to trigger for something the
 * app can't take back.
 */
function DeletableSet({ label, onDelete, children, styles }: {
  label: string;
  onDelete: () => void;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  const ref = useRef<Swipeable>(null);
  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootRight={false}
      renderRightActions={() => (
        <TouchableOpacity
          style={styles.deletePanel}
          onPress={() => { ref.current?.close(); onDelete(); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${label}`}
        >
          <Ionicons name="trash-outline" size={iconSize.sm} color={styles.deleteText.color} />
          <Text style={styles.deleteText}>{BUTTON_LABEL.delete}</Text>
        </TouchableOpacity>
      )}
    >
      {children}
    </Swipeable>
  );
}

function SuggestionCard({ proposal, unit, scale, offer, onUse, styles }: {
  proposal: Proposal;
  unit: WeightUnit;
  scale: number;
  offer: boolean;
  onUse: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const headline = proposalHeadline(proposal, unit, scale);
  return (
    <View style={styles.suggest}>
      <Text style={styles.suggestText}>
        {headline && <Text style={styles.suggestHead}>{`${headline} `}</Text>}
        {proposal.reason}
      </Text>
      {offer && headline && (
        <View style={styles.suggestActions}>
          <InlineAction
            label={proposalActionLabel(proposal, unit, scale)}
            onPress={onUse}
            accessibilityLabel={`${proposalActionLabel(proposal, unit, scale)} on the sets not done yet`}
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
 * The rest after the last set: how long is left, how long it was, and −15,
 * +30 and Skip, in one strip under the header so the keyboard can't cover it.
 * Once it runs out it says so and counts up, and stays until it is dismissed
 * or the next set starts another: nothing moves on by itself. Absent while
 * there is no rest. Its own component, for the per-second tick.
 */
function RestStrip({ sessionId, styles }: {
  sessionId: string | undefined;
  styles: ReturnType<typeof makeStyles>;
}) {
  const colors = useColors();
  const { rest, now } = useRestTimer(sessionId);
  if (rest === null) return null;
  const store = useStepTimerStore.getState();
  const over = isStepTimerReady(rest, now);
  const label = rest.label ? `Rest ${rest.label.charAt(0).toLowerCase()}${rest.label.slice(1)}` : 'Rest';
  const overText = over ? `+${formatStopwatch(stepTimerOverSeconds(rest, now))}` : '';
  return (
    <View style={[styles.restStrip, over && styles.restStripOver]}>
      <View style={styles.restBody}>
        <View style={styles.restText}>
          {over ? (
            <>
              <Text style={[styles.restTime, styles.restOnDone]} accessibilityLabel={`Rest over ${stepTimerOverSeconds(rest, now)} seconds ago`}>
                Rest over
              </Text>
              <Text style={[styles.restLabel, styles.restOnDone]} numberOfLines={1}>
                {rest.label ? `${overText} · ${rest.label}` : overText}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.restTime} accessibilityLabel={`${Math.ceil(stepTimerRemaining(rest, now))} seconds of rest left`}>
                {formatStopwatch(Math.ceil(stepTimerRemaining(rest, now)))}
              </Text>
              <Text style={styles.restLabel} numberOfLines={1}>
                {`${label} · of ${formatRestSeconds(rest.durationSeconds)}`}
              </Text>
            </>
          )}
        </View>
        <View style={styles.restButtons}>
          {!over && (
            <InlineAction
              label={`−${REST_NUDGE_BACK_SECONDS}`}
              variant="neutral"
              style={styles.restButton}
              accessibilityLabel={`${REST_NUDGE_BACK_SECONDS} seconds less rest`}
              onPress={() => { haptics.impactLight(); store.addTime(rest.id, -REST_NUDGE_BACK_SECONDS); }}
            />
          )}
          <InlineAction
            label={`+${REST_NUDGE_FORWARD_SECONDS}`}
            variant={over ? 'accent' : 'neutral'}
            tint={over ? colors.onDone : undefined}
            style={styles.restButton}
            accessibilityLabel={`${REST_NUDGE_FORWARD_SECONDS} seconds more rest`}
            onPress={() => { haptics.impactLight(); store.addTime(rest.id, REST_NUDGE_FORWARD_SECONDS); }}
          />
          <InlineAction
            label={over ? 'Dismiss' : 'Skip'}
            tint={over ? colors.onDone : undefined}
            style={styles.restButton}
            accessibilityLabel={over ? 'Dismiss rest' : 'Skip rest'}
            onPress={() => { haptics.tap(); store.remove(rest.id); }}
          />
        </View>
      </View>
      {!over && <ProgressBar progress={stepTimerProgress(rest, now)} height={3} decorative style={styles.restBar} />}
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
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  cardStacked: { marginTop: spacing.md },
  reorderHint: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginHorizontal: spacing.xs, marginBottom: spacing.sm,
  },
  reorderCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  reorderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, backgroundColor: colors.bgSecondary },
  reorderRowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  reorderSuperset: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  reorderActive: { backgroundColor: colors.bgTertiary },
  reorderName: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  reorderDetail: { color: colors.textSecondary, fontSize: font.sm },
  reorderDot: { width: 14, height: 14, borderRadius: 4, borderWidth: 2, borderColor: colors.controlBorder },
  reorderDotDone: { backgroundColor: colors.done, borderColor: colors.done },
  exHead: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  exTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  exNameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  exMenuButton: { padding: spacing.xs },
  exName: { flexShrink: 1, color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold },
  exActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.smd },
  noteCard: { marginTop: spacing.smd, borderRadius: radius.sm, backgroundColor: colors.bgTertiary, overflow: 'hidden' },
  noteRow: { padding: spacing.smd, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  noteLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: spacing.xxs,
  },
  noteLabelLast: { color: colors.warningText },
  noteText: { color: colors.text, fontSize: font.sm },
  noteEditor: { padding: spacing.smd, gap: spacing.smd },
  noteField: { gap: spacing.xs },
  noteHelp: { color: colors.textSecondary, fontSize: font.xs },
  noteInput: {
    color: colors.text, fontSize: font.md, minHeight: 40,
    paddingHorizontal: spacing.smd, paddingVertical: spacing.sm, backgroundColor: colors.bgSecondary, borderRadius: radius.sm,
  },
  noteEditorActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  changeTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  changeDetail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  changeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  changeCount: { color: colors.textSecondary, fontSize: font.sm },
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
  setLabel: { textAlign: 'center' },
  cellInput: {
    color: colors.text, fontSize: font.md, fontVariant: ['tabular-nums'], textAlign: 'center',
    paddingVertical: spacing.xsm, paddingHorizontal: spacing.xs, backgroundColor: colors.bgTertiary, borderRadius: radius.sm, minHeight: 36,
  },
  colCheck: { width: 28, alignItems: 'center' },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46,
    paddingHorizontal: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  setNumber: { color: colors.textSecondary, fontSize: font.md, fontWeight: fontWeight.semibold },
  setBadge: { color: colors.orangeText, fontSize: font.md, fontWeight: fontWeight.bold },
  recordPill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minHeight: 22, paddingHorizontal: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.accentSubtle,
  },
  recordPillText: { color: colors.accentText, fontSize: font.xxs, fontWeight: fontWeight.bold, letterSpacing: 0.4 },
  prevMark: { color: colors.orangeText, fontSize: font.sm, fontWeight: fontWeight.bold },
  prevText: { color: colors.textTertiary, fontSize: font.md, fontVariant: ['tabular-nums'] },
  valuePlanned: { color: colors.textTertiary },
  check: {
    width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: colors.controlBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.done, borderColor: colors.done },
  tray: { paddingHorizontal: spacing.md, paddingBottom: spacing.smd, gap: spacing.smd },
  deletePanel: { width: 88, alignSelf: 'stretch', backgroundColor: colors.redFill, alignItems: 'center', justifyContent: 'center', gap: spacing.xxs },
  deleteText: { color: colors.onFill, fontSize: font.sm, fontWeight: fontWeight.semibold },
  adds: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  addExercise: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  footer: {
    backgroundColor: colors.bgSecondary, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
    paddingHorizontal: spacing.md, paddingTop: spacing.smd,
  },
  restStrip: { marginHorizontal: spacing.md, marginBottom: spacing.smd, backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  restBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, paddingLeft: spacing.md, paddingRight: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.smd },
  restText: { flex: 1, minWidth: 0 },
  restLabel: { color: colors.textSecondary, fontSize: font.xs },
  // A hero number, read from a bench at arm's length: a literal size, which
  // the scale isn't for (see the font scale note in CLAUDE.md).
  restTime: { color: colors.text, fontSize: 28, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  // Once the rest ends the whole strip fills with the finished gold, so it
  // reads as a different state from across a bench, not a recolored number.
  restStripOver: { backgroundColor: colors.done },
  restOnDone: { color: colors.onDone },
  restBar: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  restButtons: { flexDirection: 'row', gap: spacing.xsm },
  restButton: { minWidth: 48, justifyContent: 'center', minHeight: 44 },
  summaryTitle: { color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold, marginTop: spacing.xs, marginHorizontal: spacing.xs },
  stats: { marginTop: spacing.smd },
  summaryRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  summaryName: { color: colors.text, fontSize: font.md },
  summaryMeta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  kvLabel: { color: colors.text, fontSize: font.md },
  notesLabel: { color: colors.text, fontSize: font.md, paddingHorizontal: spacing.md, paddingTop: spacing.smd },
  notesInput: { color: colors.text, fontSize: font.md, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.md, minHeight: 120, textAlignVertical: 'top' },
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
