// The routine editor: a routine's name, notes and exercises, each with its
// planned sets. Built on EditorSheet (fullScreen) because the exercises drag.
// Landmarks:
//
//   ==== <name> ====        the section banners through the logic half
//   ItemControls            one exercise's expanded controls, below the sheet
//   makeStyles              styles, at the bottom
//
// Each exercise is a card of its own (a superset's cards join into one block),
// and its sets are a table drawn by RoutineSetTable. The rules (what an edit
// to an item changes, supersets) live in src/utils/workoutRoutine.ts; this
// file draws them. Mocks: docs/arch/workouts-mocks/routine-editor.png, and
// routine-sets.png for the set table and the spacing. The Progress and History
// tabs are their own components; History's version page and merge picker
// render in this sheet's footer, inside its Modal.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { EditorSheet } from './EditorSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SortableList } from './SortableList';
import { CountStepper } from './CountStepper';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { RoutineSetTable } from './RoutineSetTable';
import { Toggle } from './Toggle';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { RotatingChevron } from './RotatingChevron';
import { EmptyNote } from './EmptyNote';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { ExerciseDetailSheet } from './ExerciseDetailSheet';
import { DescribeWorkoutSheet } from './DescribeWorkoutSheet';
import { withCreatedExercises } from '../utils/describedExercises';
import { RoutineProgressView } from './RoutineProgressView';
import { RoutineHistoryView } from './RoutineHistoryView';
import { RoutineVersionSheet } from './RoutineVersionSheet';
import { MergeRoutineSheet } from './MergeRoutineSheet';
import type { ExerciseKind, ProgressionScheme, WorkoutRoutine, WorkoutRoutineItem, WorkoutRoutineVersion } from '../types';
import { useWorkoutStore, type ExerciseInput, type VersionMode } from '../store/useWorkoutStore';
import { startWorkout } from '../utils/startWorkout';
import {
  currentRoutineVersion, routineContentChanged, routineSessionsByVersion, routineVersionsOf, versionNumber, workoutCountText,
} from '../utils/routineVersions';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import { weightHeadingSuffix, weightScale } from '../utils/dumbbellLoad';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { confirmDiscard } from '../utils/confirmDiscard';
import { confirmDelete } from '../utils/confirmDelete';
import { generateId } from '../utils/id';
import { buildCatalog, catalogExercise } from '../utils/exerciseCatalog';
import { REST_SECONDS_MAX, WORKOUT_NAME_MAX_LENGTH, exerciseNameKey, formatRestSeconds, readRoutineItems } from '../utils/workoutData';
import { NEW_EXERCISE_PREFIX } from '../utils/workoutCsv';
import type { RoutineDraft } from '../utils/workoutDraft';
import {
  PROGRESSION_HINTS, PROGRESSION_LABELS, describeRoutineItem, itemShape, joinPrevious,
  droppedIntoSuperset, leaveSuperset, newRoutineItem, normalizeSupersets, settleOpenSlots, supersetRoles,
  withProgression, withWarmupMode,
  type SupersetRole, type SupersetRowView,
} from '../utils/workoutRoutine';
import { joinAnd, loadContextFor, rampSteps } from '../utils/workoutProgression';
import { formatWeightNumber } from '../utils/workoutData';
import type { WeightUnit } from '../utils/weightLog';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The routine to edit, or null for a new one. */
  routineId: string | null;
  /** The group a new routine is filed under when saved (an empty group's "Add new routine"). Ignored when editing. */
  newInGroup?: string | null;
  /** The routine as saved, before `onClose`: for a caller that links a new one to what it was made for. */
  onSaved?: (routine: WorkoutRoutine) => void;
  onClose: () => void;
  /**
   * Whether History offers to start a workout from an old version. Off where
   * this editor sits inside another sheet (a program's), since workout mode
   * can't appear until every sheet under it has gone.
   */
  canStartWorkout?: boolean;
}

/**
 * A routine item with a key of its own for the list, which items don't carry.
 * An `open` row is not an exercise: it is the empty slot of a superset the
 * person is filling, held at the end of the superset. It never reaches Save.
 */
interface Row {
  id: string;
  item: WorkoutRoutineItem;
  open?: boolean;
}

const PROGRESSION_OPTIONS: SegmentOption<ProgressionScheme | null>[] = (
  ['double', 'linear', 'percent', 'rpe'] as const
).map(value => ({ value, label: PROGRESSION_LABELS[value] }));

const PROGRESSION_INTRO =
  'How this exercise moves on from one workout to the next. With none chosen here, the program’s choice applies. Workout mode shows its suggestion, and you choose whether to use it.';

// Behind the "?" beside the label: the four names mean nothing to most people.
const PROGRESSION_GLOSSARY = [
  ['Rep range', 'You aim for a range, like 8 to 12 reps. Once every set reaches the top, add weight and start at the bottom again.'],
  ['Linear', 'Add a little weight each workout where you finish all your reps. Common for beginners.'],
  ['% of max', 'Each set’s weight is a percentage of your heaviest lift, which you set in the program.'],
  ['RPE', 'After a set, rate how hard it felt from 1 (very easy) to 10 (couldn’t do another rep), and the suggested weight follows.'],
] as const;

type EditorTab = 'edit' | 'progress' | 'history';
const TAB_OPTIONS: SegmentOption<EditorTab>[] = [
  { value: 'edit', label: 'Edit' },
  { value: 'progress', label: 'Progress' },
  { value: 'history', label: 'History' },
];

const NAME_REFUSED: Record<string, string> = {
  blank: 'Give the routine a name.',
  notFound: 'This routine was deleted on another device.',
};

const toRows = (items: readonly WorkoutRoutineItem[]): Row[] => items.map(item => ({ id: generateId(), item }));
/** What Save writes: the exercises, with any superset left holding fewer than two let go. */
const savedItems = (rows: readonly Row[]): WorkoutRoutineItem[] =>
  normalizeSupersets(rows.filter(r => !r.open).map(r => r.item));
const snapshotOf = (name: string, notes: string, rows: readonly Row[]) =>
  JSON.stringify([name.trim(), notes.trim(), savedItems(rows)]);
const viewsOf = (rows: readonly Row[]): SupersetRowView[] =>
  rows.map(r => ({ id: r.id, key: r.item.supersetKey ?? null, open: r.open === true }));

/**
 * A routine's editor. Everything is staged and written on Save, so Cancel
 * asks before throwing edits away (`confirmDiscard`); a full-screen sheet has
 * no swipe to guard, only the button.
 */
export function RoutineEditorSheet({ visible, routineId, newInGroup = null, onSaved, onClose, canStartWorkout = true }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const routines = useWorkoutStore(s => s.routines);
  const exercises = useWorkoutStore(s => s.exercises);
  const unit = useSettingsStore(s => s.workoutUnit);
  const defaultRest = useSettingsStore(s => s.defaultRestSeconds);
  const plateInventory = useSettingsStore(s => s.plateInventory);
  const dumbbellEntry = useSettingsStore(s => s.dumbbellEntry);
  const routine = routineId ? routines.find(r => r.id === routineId) ?? null : null;
  // A routine described from inside this editor (`routineFromDraft`). Nothing in it is saved until Save:
  // its `new:` exercises are made then, so backing out leaves the library as it was.
  const [described, setDescribed] = useState<RoutineDraft | null>(null);
  const [describing, setDescribing] = useState(false);
  // `new:` exercises named by what was described into a routine that already had content. Made on Save, with a draft's own.
  const [describedNew, setDescribedNew] = useState<Record<string, ExerciseInput>>({});
  // A draft only seeds a routine that doesn't exist yet.
  const seed = routine ? null : described;
  // Claude only (`workoutDraft` has no on-device engine), so no key or a switched-off feature means no row.
  const canDescribe = useAiRoute('workoutDraft') !== 'unavailable';

  // ==== staged state, loaded each time the sheet opens ====
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [picking, setPicking] = useState<'add' | { slotId: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  // The Progress tab reads the routine as saved. Only a saved routine has one: a new routine has no workouts.
  const [tab, setTab] = useState<EditorTab>('edit');
  const [scrubbing, setScrubbing] = useState(false);
  // The exercise page opened from a progress row. The id is kept through the close, so the sheet doesn't retitle while it slides away.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The version page opened from History, and the merge picker. The id is
  // kept through the close, as the exercise page's is.
  const [versionId, setVersionId] = useState<string | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  // The version whose plan was restored into the editor, so a new version
  // saved from it says so in History.
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  const baseline = useRef('');

  useEffect(() => {
    if (!visible) return;
    const n = routine?.name ?? seed?.name ?? '';
    const t = routine?.notes ?? seed?.notes ?? '';
    const r = toRows(routine?.items ?? seed?.items ?? []);
    setName(n);
    setNotes(t);
    setRows(r);
    setOpenRowId(null);
    setPicking(null);
    setDescribed(null);
    setDescribedNew({});
    setDescribing(false);
    setTab('edit');
    setScrubbing(false);
    setDetailOpen(false);
    setRefusal(null);
    setVersionOpen(false);
    setMergeOpen(false);
    setRestoredFrom(null);
    // A draft is measured against an empty routine: nothing of it is saved
    // yet, so leaving it untouched still has something to lose.
    baseline.current = seed ? snapshotOf('', '', []) : snapshotOf(n, t, r);
    // Loaded on open only: a sync landing mid-edit must not overwrite what is
    // being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, routineId]);

  const roles = useMemo(() => supersetRoles(rows.map(r => r.item)), [rows]);
  // An exercise the draft will create is named by its `new:` id until Save.
  const pending = (exerciseId: string) =>
    exerciseId.startsWith(NEW_EXERCISE_PREFIX)
      ? { ...seed?.newExercises, ...describedNew }[exerciseId.slice(NEW_EXERCISE_PREFIX.length)] ?? null
      : null;
  const kindOf = (exerciseId: string): ExerciseKind =>
    pending(exerciseId)?.kind ?? catalogExercise(exercises, exerciseId)?.kind ?? 'weight_reps';
  const nameOf = (exerciseId: string) =>
    pending(exerciseId)?.name ?? catalogExercise(exercises, exerciseId)?.name ?? 'Unknown exercise';
  /**
   * "32.5, 50 and 65 kg": the ramp an item's target weight would lay out,
   * worked out the way workout mode will (`rampSteps`), so the table's ramp
   * row shows real loads. Null with no target weight to ramp to.
   */
  const rampLoads = (item: WorkoutRoutineItem): string | null => {
    const info = catalogExercise(exercises, item.exerciseId);
    const kg = itemShape(item).weightKg;
    if (!info || kg === null) return null;
    const scale = weightScale(info, dumbbellEntry);
    const steps = rampSteps(kg, loadContextFor(info, plateInventory, unit, item, scale));
    if (steps.length === 0) return null;
    return `${joinAnd(steps.map(st => formatWeightNumber(st.kg * scale, unit)))} ${unit}`;
  };

  // ==== editing the list ====
  const updateItem = (rowId: string, change: (item: WorkoutRoutineItem) => WorkoutRoutineItem) =>
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, item: change(r.item) } : r)));

  const asItems = (list: Row[]) => list.map(r => r.item);
  const withItems = (list: Row[], items: WorkoutRoutineItem[]) => list.map((r, i) => ({ ...r, item: items[i] }));
  /**
   * The list after an edit, with its supersets put right: a superset that holds
   * fewer than two exercises lets go, except while its empty slot is still
   * there to fill, and each slot stays at the end of its superset.
   */
  const settled = (list: Row[]): Row[] => {
    const keyed = list.map(r => (r.open && !r.item.supersetKey ? { ...r, item: { ...r.item, supersetKey: generateId() } } : r));
    const normal = withItems(keyed, normalizeSupersets(asItems(keyed), i => keyed[i].open === true));
    const order = settleOpenSlots(viewsOf(normal));
    return order.map(id => normal.find(r => r.id === id)!);
  };

  const addExercise = (exerciseId: string) => {
    const row: Row = { id: generateId(), item: newRoutineItem(exerciseId, kindOf(exerciseId)) };
    animateLayout();
    setRows(prev => {
      if (picking === null || picking === 'add') return [...prev, row];
      // Into a superset: the row takes the slot's key and sits just above it.
      const at = prev.findIndex(r => r.id === picking.slotId);
      if (at < 0) return [...prev, row];
      const joined = { ...row, item: { ...row.item, supersetKey: prev[at].item.supersetKey } };
      return settled([...prev.slice(0, at), joined, ...prev.slice(at)]);
    });
    setOpenRowId(row.id);
  };

  const addEmptySuperset = () => {
    haptics.tap();
    animateLayout();
    const slot: Row = { id: generateId(), open: true, item: newRoutineItem('', 'weight_reps') };
    setRows(prev => settled([...prev, { ...slot, item: { ...slot.item, supersetKey: generateId() } }]));
  };

  const removeRow = (rowId: string) => {
    haptics.tap();
    animateLayout();
    setRows(prev => settled(prev.filter(r => r.id !== rowId)));
  };

  const joinWithPrevious = (index: number) => {
    haptics.tap();
    setRows(prev => settled(withItems(prev, joinPrevious(asItems(prev), index, generateId()))));
  };

  const leave = (index: number) => {
    haptics.tap();
    setRows(prev => settled(withItems(prev, leaveSuperset(asItems(prev), index))));
  };

  const reorder = (next: Row[]) => {
    const hit = droppedIntoSuperset(viewsOf(rows), viewsOf(next));
    const joined = hit
      ? next.map(r => (r.id === hit.id ? { ...r, item: { ...r.item, supersetKey: hit.key } } : r))
      : next;
    setRows(settled(joined));
  };

  const toggleOpen = (rowId: string) => {
    haptics.tap();
    animateLayout();
    setOpenRowId(prev => (prev === rowId ? null : rowId));
  };

  // ==== describing ====
  /**
   * A described routine fills the form in place. It is offered only while the
   * form is still empty, so applying it never replaces anything typed, and the
   * baseline stays the empty routine: nothing of it is saved until Save.
   */
  const applyDescribed = (d: RoutineDraft) => {
    setDescribed(d);
    setName(d.name);
    setNotes(d.notes);
    setRows(toRows(d.items));
    setOpenRowId(null);
    setRefusal(null);
    setDescribing(false);
  };
  /**
   * Described exercises go on the end of a routine that already has content. One
   * already in the routine is left out and named, the way the picker marks it
   * "In routine".
   */
  const appendDescribed = (d: RoutineDraft) => {
    const have = new Set(rows.filter(r => !r.open).map(r => r.item.exerciseId));
    const fresh = d.items.filter(i => !have.has(i.exerciseId));
    const left = d.items.filter(i => have.has(i.exerciseId));
    if (fresh.length > 0) {
      animateLayout();
      setDescribedNew(prev => ({ ...prev, ...d.newExercises }));
      setRows(prev => settled([...prev, ...fresh.map(item => ({ id: generateId(), item }))]));
    }
    haptics.success();
    setDescribing(false);
    if (left.length > 0) {
      const names = left.map(i => nameOf(i.exerciseId));
      Alert.alert(
        fresh.length > 0 ? 'Some exercises were left out' : 'Nothing was added',
        `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} already in this routine.`,
      );
    }
  };
  const canOfferDescribe = canDescribe && !routine && !seed && rows.length === 0 && !name.trim() && !notes.trim();

  // ==== saving, cancelling, deleting ====
  const dirty = visible && snapshotOf(name, notes, rows) !== baseline.current;

  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose, routine ? {} : {
      title: 'Discard this routine?',
      message: 'It hasn’t been saved yet. If you leave now, it will be lost.',
    });
  };

  /**
   * Saving a changed plan once a workout has been done on the current version
   * asks which it is: a new version, keeping the one those workouts were done
   * on, or a change to it. Before any workout there is nothing to keep, and a
   * rename or a change that isn't to the plan doesn't ask. It asks before a
   * described exercise is made, so Cancel leaves the library as it was.
   */
  const save = () => {
    const store = useWorkoutStore.getState();
    // Before anything is created: a refusal for the name shouldn't leave exercises behind.
    if (!routine && !name.trim()) { haptics.warning(); setRefusal(NAME_REFUSED.blank); return; }
    // Compared the way the store will read them, or a field the editor leaves
    // undefined (a superset key) would read as a change and ask on a rename.
    // An exercise still to be made has a `new:` id, which is a change anyway.
    const planned = savedItems(rows);
    if (routine && routineContentChanged(routine, { notes, items: readRoutineItems(planned) }) && store.routineVersionTrained(routine.id)) {
      const list = routineVersionsOf(routine, store.routineVersions);
      const current = currentRoutineVersion(routine, list);
      const n = versionNumber(list, current.id);
      const done = routineSessionsByVersion(routine, list, store.sessions).get(current.id)?.length ?? 0;
      Alert.alert(
        `Save as version ${n + 1}?`,
        `You’ve done ${workoutCountText(done).toLowerCase()} on version ${n}. A new version keeps version ${n} as it was. Updating it changes the plan those workouts were done on.`,
        [
          { text: 'New version', onPress: () => commit(planned, 'new') },
          { text: `Update version ${n}`, onPress: () => commit(planned, 'amend') },
          { text: BUTTON_LABEL.cancel, style: 'cancel' },
        ],
      );
      return;
    }
    commit(planned, 'auto');
  };

  const commit = (planned: WorkoutRoutineItem[], version: VersionMode) => {
    const store = useWorkoutStore.getState();
    const items = withCreatedExercises(planned, { ...seed?.newExercises, ...describedNew });
    if (!items) { haptics.warning(); setRefusal('This routine could not be saved.'); return; }
    const result = routine
      ? store.updateRoutine(routine.id, { name, notes, items }, { version, source: restoredFrom ? 'restore' : 'edit' })
      : (() => {
        const made = store.addRoutine(name, items);
        if (typeof made === 'string') return made;
        return notes.trim() || newInGroup
          ? store.updateRoutine(made.id, { notes, groupName: newInGroup })
          : made;
      })();
    if (typeof result === 'string') {
      haptics.warning();
      setRefusal(NAME_REFUSED[result] ?? 'This routine could not be saved.');
      return;
    }
    haptics.success();
    onSaved?.(result);
    onClose();
  };

  // ==== history ====
  /**
   * An old version's plan goes into the editor as unsaved changes, so it can
   * be looked over (or changed) before Save, which keeps it as the newest
   * version. Changes not yet saved are asked about first.
   */
  const restore = (version: WorkoutRoutineVersion) => {
    const apply = () => {
      animateLayout();
      setNotes(version.notes);
      setRows(toRows(version.items));
      setOpenRowId(null);
      setRefusal(null);
      setRestoredFrom(version.id);
      setVersionOpen(false);
      setTab('edit');
    };
    if (dirty) {
      confirmDiscard(apply, { message: 'Restoring puts the old plan in place of the changes you haven’t saved.' });
    } else apply();
  };

  const startFromVersion = (id: string) => {
    if (!routine) return;
    const go = () => {
      setVersionOpen(false);
      onClose();
      startWorkout({ routineId: routine.id, routineVersionId: id });
    };
    if (dirty) {
      confirmDiscard(go, { message: 'Starting a workout closes the routine, and the changes you haven’t saved will be lost.' });
    } else go();
  };

  const remove = () => {
    if (!routine) return;
    confirmDelete({
      title: 'Delete this routine?',
      message: 'Workouts already logged from it stay in your history. Tasks linked to it stop offering it.',
      onConfirm: () => {
        useWorkoutStore.getState().deleteRoutine(routine.id);
        haptics.success();
        onClose();
      },
    });
  };

  // ==== render ====
  return (
    <EditorSheet
      visible={visible}
      onRequestClose={handleCancel}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      scrollEnabled={!dragging && !scrubbing}
      header={
        <SheetHeader
          bare
          title={routine ? 'Routine' : 'New routine'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} minWidth={64} />}
        />
      }
      footer={
        // Inside this sheet's own Modal, not beside it: a sheet presented as a
        // sibling of an open one never appears (see "Two sibling Modals").
        <>
          <ExercisePickerSheet
            visible={visible && picking !== null}
            onClose={() => setPicking(null)}
            onPick={addExercise}
            addedIds={rows.filter(r => !r.open).map(r => r.item.exerciseId)}
            addedLabel="In routine"
          />
          <ExerciseDetailSheet visible={visible && detailOpen} exerciseId={detailId} onClose={() => setDetailOpen(false)} />
          <RoutineVersionSheet
            visible={visible && versionOpen}
            routineId={routine?.id ?? null}
            versionId={versionId}
            onClose={() => setVersionOpen(false)}
            onRestore={restore}
            onStart={canStartWorkout ? startFromVersion : undefined}
          />
          <MergeRoutineSheet visible={visible && mergeOpen} intoId={routine?.id ?? null} onClose={() => setMergeOpen(false)} />
          <DescribeWorkoutSheet
            visible={visible && describing}
            mode="routine"
            onClose={() => setDescribing(false)}
            {...(canOfferDescribe
              ? { onRoutine: applyDescribed }
              : { into: { target: 'routine' as const, onAdd: appendDescribed } })}
          />
        </>
      }
    >
      {routine && (
        <View style={styles.tabs}>
          <SegmentedControl options={TAB_OPTIONS} value={tab} onChange={setTab} surface="page" label="Routine view" />
        </View>
      )}
      {routine && tab === 'history' ? (
        <RoutineHistoryView
          routineId={routine.id}
          onOpenVersion={id => { haptics.tap(); setVersionId(id); setVersionOpen(true); }}
          onMerge={() => { haptics.tap(); setMergeOpen(true); }}
        />
      ) : routine && tab === 'progress' ? (
        <RoutineProgressView
          routineId={routine.id}
          exerciseIds={routine.items.map(i => i.exerciseId)}
          onScrubChange={setScrubbing}
          onOpenExercise={id => { haptics.tap(); setDetailId(id); setDetailOpen(true); }}
        />
      ) : (
      <>
      {seed ? (
        <View style={styles.banner}>
          <Ionicons name="sparkles-outline" size={iconSize.sm} color={colors.accentText} />
          <Text style={styles.bannerText}>
            <Text style={styles.bannerLead}>Drafted from your description. </Text>
            {`Check the sets, then save.${seed.notes.trim() ? ' What wasn’t a lift went into Notes.' : ''} Weights and rest you didn’t mention are left empty.`}
          </Text>
        </View>
      ) : null}
      <View style={styles.nameCard}>
        <TextField
          style={styles.nameInput}
          value={name}
          onChangeText={t => { setName(t); setRefusal(null); }}
          placeholder="Routine name"
          placeholderTextColor={colors.textTertiary}
          maxLength={WORKOUT_NAME_MAX_LENGTH}
          autoFocus={!routine && !seed?.name}
          accessibilityLabel="Routine name"
        />
        <View style={styles.cardSep} />
        <TextField
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes"
          placeholderTextColor={colors.textTertiary}
          multiline
          accessibilityLabel="Routine notes"
        />
      </View>
      {canOfferDescribe && (
        <View style={styles.describeRow}>
          <InlineAction
            icon="sparkles-outline"
            label="Describe it instead"
            variant="neutral"
            surface="page"
            onPress={() => { haptics.tap(); setDescribing(true); }}
            accessibilityLabel="Describe this routine in words"
          />
        </View>
      )}
      {refusal && <Text style={styles.refusal}>{refusal}</Text>}

      <Text style={styles.groupLabel}>Exercises</Text>
      <View>
        {rows.length === 0 ? (
          <EmptyNote icon="barbell-outline">No exercises yet. Add the first one below.</EmptyNote>
        ) : (
          <SortableList
            data={rows}
            onDragStateChange={setDragging}
            onReorder={reorder}
            renderItem={(row, index, drag) => {
              const role = roles[index];
              if (row.open) {
                return (
                  <OpenSlot
                    role={role}
                    colors={colors}
                    styles={styles}
                    onAdd={() => { haptics.tap(); setPicking({ slotId: row.id }); }}
                    onRemove={() => removeRow(row.id)}
                  />
                );
              }
              // The empty slot isn't an exercise, so the last exercise above it is the end of the run.
              const next = rows[index + 1];
              const tail = next?.open === true && next.item.supersetKey === row.item.supersetKey;
              const itemRole: SupersetRole = tail && (role === 'first' || role === 'middle') ? 'last' : role;
              const open = openRowId === row.id;
              const kind = kindOf(row.item.exerciseId);
              const exName = nameOf(row.item.exerciseId);
              // The gap is padding inside the row rather than a margin between
              // rows, so SortableList measures it as part of the row and the
              // drag maths still line up. A superset's cards close it up and
              // square their inner corners, so the run reads as one block.
              const joinsNext = role === 'first' || role === 'middle';
              return (
                <View style={!joinsNext && styles.itemGap}>
                  <View
                    style={[
                      styles.itemCard,
                      role !== 'none' && styles.superset,
                      (role === 'middle' || role === 'last') && styles.itemSep,
                      joinsNext && styles.squareBottom,
                      (role === 'middle' || role === 'last') && styles.squareTop,
                    ]}
                  >
                    {role === 'first' && <Text style={styles.supersetTag}>Superset</Text>}
                    <View style={styles.itemRow}>
                      <TouchableOpacity
                        onLongPress={drag}
                        delayLongPress={interaction.delayLongPress}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Reorder ${exName}`}
                        accessibilityHint="Touch and hold, then drag"
                      >
                        <Ionicons name="reorder-two-outline" size={iconSize.md} color={colors.textTertiary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.itemText}
                        onPress={() => toggleOpen(row.id)}
                        onLongPress={drag}
                        delayLongPress={interaction.delayLongPress}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        accessibilityLabel={exName}
                      >
                        <Text style={styles.itemName}>{exName}</Text>
                        <Text style={styles.itemSummary}>
                          {describeRoutineItem(row.item, { kind, unit, defaultRestSeconds: defaultRest, role: itemRole })}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => toggleOpen(row.id)} hitSlop={8} accessibilityElementsHidden importantForAccessibility="no">
                        <RotatingChevron open={open} size={iconSize.sm} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                    {open && (
                      <ItemControls
                        item={row.item}
                        kind={kind}
                        role={itemRole}
                        unit={unit}
                        scale={weightScale(catalogExercise(exercises, row.item.exerciseId), dumbbellEntry)}
                        weightSuffix={weightHeadingSuffix(catalogExercise(exercises, row.item.exerciseId), dumbbellEntry)}
                        defaultRest={defaultRest}
                        canJoin={index > 0}
                        rampLoads={kind === 'weight_reps' ? rampLoads(row.item) : null}
                        colors={colors}
                        styles={styles}
                        onChange={change => updateItem(row.id, change)}
                        onJoin={() => joinWithPrevious(index)}
                        onLeave={() => leave(index)}
                        onRemove={() => removeRow(row.id)}
                      />
                    )}
                  </View>
                </View>
              );
            }}
          />
        )}
        <View style={styles.adds}>
          <InlineAction icon="add" label="Add exercise" onPress={() => { haptics.tap(); setPicking('add'); }} />
          {canDescribe && !canOfferDescribe && (
            <InlineAction icon="sparkles-outline" label="Describe" variant="neutral" onPress={() => { haptics.tap(); setDescribing(true); }} />
          )}
          <InlineAction
            label="Superset"
            variant="neutral"
            onPress={addEmptySuperset}
            accessibilityLabel="Add an empty superset"
          />
        </View>
      </View>
      <HelpText style={styles.footHint}>
        Touch and hold an exercise to move it, including into a superset. A superset is done set by set, back to back, with the rest after the last one.
      </HelpText>

      {routine && (
        <TouchableOpacity
          style={styles.deleteRow}
          onPress={remove}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
        >
          <Ionicons name="trash-outline" size={iconSize.sm} color={colors.redText} />
          <Text style={styles.deleteText}>Delete routine</Text>
        </TouchableOpacity>
      )}
      </>
      )}
    </EditorSheet>
  );
}

interface OpenSlotProps {
  /** 'last' when exercises sit above it in the superset, 'none' when it is empty. */
  role: SupersetRole;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onAdd: () => void;
  onRemove: () => void;
}

/** The end of a superset still being filled: a way to add an exercise to it. Exercises are dropped on it like on any row. */
function OpenSlot({ role, colors, styles, onAdd, onRemove }: OpenSlotProps) {
  const empty = role === 'none';
  return (
    <View style={empty && styles.itemGap}>
      <View style={[styles.itemCard, styles.superset, !empty && styles.itemSep, !empty && styles.squareTop]}>
        {empty && <Text style={styles.supersetTag}>Superset</Text>}
        <View style={styles.slotBody}>
          <View style={styles.itemActions}>
            <InlineAction icon="add" label="Add exercise" onPress={onAdd} />
            <InlineAction label={empty ? 'Remove superset' : BUTTON_LABEL.done} variant="neutral" onPress={onRemove} />
          </View>
        </View>
      </View>
    </View>
  );
}

interface ItemControlsProps {
  item: WorkoutRoutineItem;
  kind: ExerciseKind;
  role: SupersetRole;
  unit: WeightUnit;
  /** Reads a stored one-dumbbell weight as a pair total where it is 2 (`dumbbellLoad.ts`). */
  scale: number;
  /** " each" or " pair" after the unit in the weight heading, or nothing. */
  weightSuffix: string;
  defaultRest: number;
  canJoin: boolean;
  /** What the ramp lays out from the target weight, for the table's ramp row. */
  rampLoads: string | null;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onChange: (change: (item: WorkoutRoutineItem) => WorkoutRoutineItem) => void;
  onJoin: () => void;
  onLeave: () => void;
  onRemove: () => void;
}

/**
 * One exercise unfolded under its row: its sets as a table, then the rest of
 * what it asks (a ramp, the rest, the progression) in sections of their own,
 * each label beside or above its one control so no row has to hold two.
 */
function ItemControls({
  item, kind, role, unit, scale, weightSuffix, defaultRest, canJoin, rampLoads, colors, styles, onChange, onJoin, onLeave, onRemove,
}: ItemControlsProps) {
  const scheme = item.progression?.scheme ?? null;
  const [explainOpen, setExplainOpen] = useState(false);
  const rests = role === 'none' || role === 'last';
  const ramp = item.warmupRamp === true;
  return (
    <View style={styles.controls}>
      <RoutineSetTable item={item} kind={kind} unit={unit} scale={scale} weightSuffix={weightSuffix} rampLoads={rampLoads} onChange={onChange} />

      <View style={styles.section}>
        {kind === 'weight_reps' && (
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => { haptics.tap(); animateLayout(); onChange(i => withWarmupMode(i, ramp ? 'none' : 'ramp')); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityState={{ checked: ramp }}
            accessibilityLabel="Ramp warm-ups"
          >
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Ramp warm-ups</Text>
              <HelpText style={styles.rowHint}>
                About 40, 60 and 80% of the first working weight, rounded to your plates. In place of warm-up sets of its own.
              </HelpText>
            </View>
            <Toggle value={ramp} />
          </TouchableOpacity>
        )}
        {rests ? (
          <View style={styles.kv}>
            <Text style={styles.rowLabel}>{role === 'last' ? 'Rest after the superset' : 'Rest'}</Text>
            <CountStepper
              value={item.restSeconds ?? defaultRest}
              onChange={n => onChange(i => ({ ...i, restSeconds: n ?? 0 }))}
              min={0}
              max={REST_SECONDS_MAX}
              step={15}
              format={n => (n === 0 ? 'None' : formatRestSeconds(n))}
              label="Rest"
            />
          </View>
        ) : (
          <HelpText style={styles.hint}>No rest of its own: the rest comes after the last exercise of the superset.</HelpText>
        )}
      </View>

      <View style={styles.section}>
        <View>
          <View style={styles.capRow}>
            <Text style={styles.cap}>Progression</Text>
            <TouchableOpacity
              onPress={() => { haptics.tap(); animateLayout(); setExplainOpen(o => !o); }}
              activeOpacity={interaction.activeOpacity}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="What the progression options mean"
              accessibilityState={{ expanded: explainOpen }}
            >
              <Ionicons
                name={explainOpen ? 'help-circle' : 'help-circle-outline'}
                size={iconSize.md}
                color={explainOpen ? colors.accent : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
          <SegmentedControl
            options={PROGRESSION_OPTIONS}
            value={scheme}
            onChange={s => onChange(i => withProgression(i, s))}
            onDeselect={() => onChange(i => withProgression(i, null))}
            label="Progression"
          />
          <HelpText style={[styles.hint, styles.hintBelow]}>
            {scheme
              ? PROGRESSION_HINTS[scheme]
              : PROGRESSION_INTRO}
          </HelpText>
          {explainOpen && (
            <View style={styles.glossary}>
              {PROGRESSION_GLOSSARY.map(([name, text]) => (
                <Text key={name} style={styles.hint}>
                  <Text style={styles.glossaryName}>{name}</Text>
                  {`: ${text}`}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>

      <View style={[styles.section, styles.itemActions]}>
        {role === 'none' && canJoin && (
          <InlineAction label="Superset with the one above" variant="neutral" onPress={onJoin} />
        )}
        {role !== 'none' && <InlineAction label="Leave superset" variant="neutral" onPress={onLeave} />}
        <InlineAction icon="trash-outline" label="Remove exercise" tint={colors.redText} onPress={onRemove} />
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
  },
  tabs: { marginBottom: spacing.md },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl * 2 },
  banner: {
    flexDirection: 'row', gap: spacing.smd, alignItems: 'flex-start',
    backgroundColor: colors.accentSubtle, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, marginTop: spacing.xs, marginBottom: spacing.smd,
  },
  bannerText: { flex: 1, color: colors.text, fontSize: font.sm },
  bannerLead: { color: colors.accentText, fontWeight: fontWeight.semibold },
  nameCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.xs },
  nameInput: {
    color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md, minHeight: 52,
  },
  cardSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
  notesInput: { color: colors.text, fontSize: font.md, paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.md, minHeight: 120, textAlignVertical: 'top' },
  describeRow: { flexDirection: 'row', marginTop: spacing.smd },
  refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  itemGap: { paddingBottom: spacing.smd },
  itemCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  itemSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  squareTop: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  squareBottom: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  // A superset is a block of neighbours, so its rows share a rail down the
  // left edge, the way the mock draws it. 3pt of the padding goes to the rail.
  superset: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  supersetTag: {
    color: colors.accentText, fontSize: font.xxs, fontWeight: fontWeight.semibold, letterSpacing: 0.8,
    textTransform: 'uppercase', paddingTop: spacing.sm, paddingHorizontal: spacing.md - 3,
  },
  slotBody: { padding: spacing.md - 3, paddingRight: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 60 },
  itemText: { flex: 1 },
  itemName: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  itemSummary: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs, lineHeight: 18 },
  // The table runs edge to edge inside the card (its rows carry their own
  // padding); the sections below it are padded, and each opens with a rule.
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
    paddingTop: spacing.smd, paddingBottom: spacing.md,
  },
  section: {
    marginTop: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.md, gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap', minHeight: 44 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  rowText: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: font.md },
  rowHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs, lineHeight: 16 },
  cap: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  capRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  glossary: { marginTop: spacing.smd, gap: spacing.sm },
  glossaryName: { color: colors.text, fontWeight: fontWeight.semibold },
  hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
  hintBelow: { marginTop: spacing.sm },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  adds: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  footHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginTop: spacing.lg, paddingVertical: spacing.smd, backgroundColor: colors.bgSecondary, borderRadius: radius.md,
  },
  deleteText: { color: colors.redText, fontSize: font.md, fontWeight: fontWeight.medium },
});
