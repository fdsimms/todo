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
import type { ExerciseKind, ProgressionScheme, WorkoutRoutineItem } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
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
  leaveSuperset, newRoutineItem, normalizeSupersets, supersetRoles, withProgression, withWarmupMode,
  type SupersetRole,
} from '../utils/workoutRoutine';
import { joinAnd, loadContextFor, rampSteps } from '../utils/workoutProgression';
import { formatWeightNumber } from '../utils/workoutData';
import type { WeightUnit } from '../utils/weightLog';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The routine to edit, or null for a new one. */
  routineId: string | null;
  onClose: () => void;
}

/** A routine item with a key of its own for the list, which items don't carry. */
interface Row {
  id: string;
  item: WorkoutRoutineItem;
}

const PROGRESSION_OPTIONS: SegmentOption<ProgressionScheme | null>[] = (
  ['double', 'linear', 'percent', 'rpe'] as const
).map(value => ({ value, label: PROGRESSION_LABELS[value] }));

// With no scheme chosen the four names mean nothing to most people, so the
// hint spells each one out. Once one is picked, PROGRESSION_HINTS takes over.
const PROGRESSION_INTRO = [
  'How this exercise moves on from one workout to the next. With none chosen here, the program’s choice applies. Workout mode shows its suggestion, and you choose whether to use it.',
  'Rep range: you aim for a range, like 8 to 12 reps. Once every set reaches the top, add weight and start at the bottom again.',
  'Linear: add a little weight each workout where you finish all your reps. Common for beginners.',
  '% of max: each set’s weight is a percentage of your heaviest lift, which you set in the program.',
  'RPE: after a set, rate how hard it felt from 1 (very easy) to 10 (couldn’t do another rep), and the suggested weight follows.',
].join('\n\n');

const NAME_REFUSED: Record<string, string> = {
  blank: 'Give the routine a name.',
  notFound: 'This routine was deleted on another device.',
};

const toRows = (items: readonly WorkoutRoutineItem[]): Row[] => items.map(item => ({ id: generateId(), item }));
const snapshotOf = (name: string, notes: string, rows: readonly Row[]) =>
  JSON.stringify([name.trim(), notes.trim(), rows.map(r => r.item)]);

/**
 * A routine's editor. Everything is staged and written on Save, so Cancel
 * asks before throwing edits away (`confirmDiscard`); a full-screen sheet has
 * no swipe to guard, only the button.
 */
export function RoutineEditorSheet({ visible, routineId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const routines = useWorkoutStore(s => s.routines);
  const exercises = useWorkoutStore(s => s.exercises);
  const unit = useSettingsStore(s => s.workoutUnit);
  const defaultRest = useSettingsStore(s => s.defaultRestSeconds);
  const plateInventory = useSettingsStore(s => s.plateInventory);
  const routine = routineId ? routines.find(r => r.id === routineId) ?? null : null;

  // ==== staged state, loaded each time the sheet opens ====
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [picking, setPicking] = useState<'add' | 'superset' | null>(null);
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
    const steps = rampSteps(kg, loadContextFor(info, plateInventory, unit, item));
    if (steps.length === 0) return null;
    return `${joinAnd(steps.map(st => formatWeightNumber(st.kg, unit)))} ${unit}`;
  };

  // ==== editing the list ====
  const setItems = (next: Row[]) => setRows(next);
  const updateItem = (rowId: string, change: (item: WorkoutRoutineItem) => WorkoutRoutineItem) =>
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, item: change(r.item) } : r)));

  const asItems = (list: Row[]) => list.map(r => r.item);
  const withItems = (list: Row[], items: WorkoutRoutineItem[]) => list.map((r, i) => ({ ...r, item: items[i] }));

  const addExercise = (exerciseId: string) => {
    const row: Row = { id: generateId(), item: newRoutineItem(exerciseId, kindOf(exerciseId)) };
    animateLayout();
    setRows(prev => {
      const next = [...prev, row];
      if (picking !== 'superset' || prev.length === 0) return next;
      return withItems(next, joinPrevious(asItems(next), next.length - 1, generateId()));
    });
    setOpenRowId(row.id);
  };

  const removeRow = (rowId: string) => {
    haptics.tap();
    animateLayout();
    setRows(prev => {
      const next = prev.filter(r => r.id !== rowId);
      return withItems(next, normalizeSupersets(asItems(next)));
    });
  };

  const joinWithPrevious = (index: number) => {
    haptics.tap();
    setRows(prev => withItems(prev, joinPrevious(asItems(prev), index, generateId())));
  };

  const leave = (index: number) => {
    haptics.tap();
    setRows(prev => withItems(prev, leaveSuperset(asItems(prev), index)));
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
    const items = asItems(rows);
    const result = routine
      ? store.updateRoutine(routine.id, { name, notes, items })
      : (() => {
        const made = store.addRoutine(name, items);
        if (typeof made === 'string') return made;
        return notes.trim() ? store.updateRoutine(made.id, { notes }) : made;
      })();
    if (typeof result === 'string') {
      haptics.warning();
      setRefusal(NAME_REFUSED[result] ?? 'This routine could not be saved.');
      return;
    }
    haptics.success();
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
          addedIds={rows.map(r => r.item.exerciseId)}
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
            onReorder={next => setItems(withItems(next, normalizeSupersets(asItems(next))))}
            renderItem={(row, index, drag) => {
              const role = roles[index];
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
                          {describeRoutineItem(row.item, { kind, unit, defaultRestSeconds: defaultRest, role })}
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
                        role={role}
                        unit={unit}
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
          {rows.length > 0 && (
            <InlineAction
              label="Superset"
              variant="neutral"
              onPress={() => { haptics.tap(); setPicking('superset'); }}
              accessibilityLabel="Add an exercise as a superset with the last one"
            />
          )}
        </View>
      </View>
      <HelpText style={styles.footHint}>
        Touch and hold an exercise to move it. A superset is done set by set, back to back, with the rest after the last one.
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

interface ItemControlsProps {
  item: WorkoutRoutineItem;
  kind: ExerciseKind;
  role: SupersetRole;
  unit: WeightUnit;
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
  item, kind, role, unit, defaultRest, canJoin, rampLoads, colors, styles, onChange, onJoin, onLeave, onRemove,
}: ItemControlsProps) {
  const scheme = item.progression?.scheme ?? null;
  const rests = role === 'none' || role === 'last';
  const ramp = item.warmupRamp === true;
  return (
    <View style={styles.controls}>
      <RoutineSetTable item={item} kind={kind} unit={unit} rampLoads={rampLoads} onChange={onChange} />

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
          <Text style={[styles.cap, styles.capAbove]}>Progression</Text>
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
  notesInput: { color: colors.text, fontSize: font.md, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 48 },
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
  capAbove: { marginBottom: spacing.sm },
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
