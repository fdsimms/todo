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
// routine-sets.png for the set table and the spacing.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import type { ExerciseKind, ProgressionScheme, WorkoutRoutine, WorkoutRoutineItem } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { weightHeadingSuffix, weightScale } from '../utils/dumbbellLoad';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { confirmDiscard } from '../utils/confirmDiscard';
import { confirmDelete } from '../utils/confirmDelete';
import { generateId } from '../utils/id';
import { catalogExercise } from '../utils/exerciseCatalog';
import { REST_SECONDS_MAX, WORKOUT_NAME_MAX_LENGTH, formatRestSeconds } from '../utils/workoutData';
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
export function RoutineEditorSheet({ visible, routineId, newInGroup = null, onSaved, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const routines = useWorkoutStore(s => s.routines);
  const exercises = useWorkoutStore(s => s.exercises);
  const unit = useSettingsStore(s => s.workoutUnit);
  const defaultRest = useSettingsStore(s => s.defaultRestSeconds);
  const plateInventory = useSettingsStore(s => s.plateInventory);
  const dumbbellEntry = useSettingsStore(s => s.dumbbellEntry);
  const routine = routineId ? routines.find(r => r.id === routineId) ?? null : null;

  // ==== staged state, loaded each time the sheet opens ====
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [picking, setPicking] = useState<'add' | { slotId: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const baseline = useRef('');

  useEffect(() => {
    if (!visible) return;
    const n = routine?.name ?? '';
    const t = routine?.notes ?? '';
    const r = toRows(routine?.items ?? []);
    setName(n);
    setNotes(t);
    setRows(r);
    setOpenRowId(null);
    setPicking(null);
    setRefusal(null);
    baseline.current = snapshotOf(n, t, r);
    // Loaded on open only: a sync landing mid-edit must not overwrite what is
    // being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, routineId]);

  const roles = useMemo(() => supersetRoles(rows.map(r => r.item)), [rows]);
  const kindOf = (exerciseId: string): ExerciseKind => catalogExercise(exercises, exerciseId)?.kind ?? 'weight_reps';
  const nameOf = (exerciseId: string) => catalogExercise(exercises, exerciseId)?.name ?? 'Unknown exercise';
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

  // ==== saving, cancelling, deleting ====
  const dirty = visible && snapshotOf(name, notes, rows) !== baseline.current;

  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose, routine ? {} : {
      title: 'Discard this routine?',
      message: 'It hasn’t been saved yet. If you leave now, it will be lost.',
    });
  };

  const save = () => {
    const store = useWorkoutStore.getState();
    const items = savedItems(rows);
    const result = routine
      ? store.updateRoutine(routine.id, { name, notes, items })
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
      scrollEnabled={!dragging}
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
        <ExercisePickerSheet
          visible={visible && picking !== null}
          onClose={() => setPicking(null)}
          onPick={addExercise}
          addedIds={rows.filter(r => !r.open).map(r => r.item.exerciseId)}
          addedLabel="In routine"
        />
      }
    >
      <View style={styles.nameCard}>
        <TextField
          style={styles.nameInput}
          value={name}
          onChangeText={t => { setName(t); setRefusal(null); }}
          placeholder="Routine name"
          placeholderTextColor={colors.textTertiary}
          maxLength={WORKOUT_NAME_MAX_LENGTH}
          autoFocus={!routine}
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
      {refusal && <Text style={styles.refusal}>{refusal}</Text>}

      <Text style={styles.groupLabel}>Exercises</Text>
      <View>
        {rows.length === 0 ? (
          <View style={[styles.card, styles.emptyWrap]}>
            <EmptyNote icon="barbell-outline">No exercises yet. Add the first one below.</EmptyNote>
          </View>
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
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl * 2 },
  nameCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.xs },
  nameInput: {
    color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md, minHeight: 52,
  },
  cardSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
  notesInput: { color: colors.text, fontSize: font.md, paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.md, minHeight: 48 },
  refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  emptyWrap: { padding: spacing.md },
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
