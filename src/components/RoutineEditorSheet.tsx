// The routine editor: a routine's name, notes and exercises, each with its
// planned sets. Built on EditorSheet (fullScreen) because the exercises drag.
// Landmarks:
//
//   ==== <name> ====        the section banners through the logic half
//   ItemControls            one exercise's expanded controls, below the sheet
//   makeStyles              styles, at the bottom
//
// The rules (what an edit to an item changes, supersets) live in
// src/utils/workoutRoutine.ts; this file draws them. Mock:
// docs/arch/workouts-mocks/routine-editor.png.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { EditorSheet } from './EditorSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SortableList } from './SortableList';
import { CountStepper } from './CountStepper';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
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
import {
  REST_SECONDS_MAX, WEIGHT_PLACES, WEIGHT_STEP, WORKOUT_NAME_MAX_LENGTH, formatRestSeconds,
  weightFromDisplay, weightToDisplay,
} from '../utils/workoutData';
import {
  MAX_ROUTINE_SETS, PROGRESSION_HINTS, PROGRESSION_LABELS, describeRoutineItem, itemShape, joinPrevious,
  leaveSuperset, newRoutineItem, normalizeSupersets, supersetRoles, warmupMode, withProgression, withReps,
  withTargetDuration, withTargetWeight, withWarmupMode, withWarmups, withWorkingSets, type SupersetRole, type WarmupMode,
} from '../utils/workoutRoutine';
import { joinAnd, loadContextFor, rampSteps } from '../utils/workoutProgression';
import { formatWeightNumber } from '../utils/workoutData';
import { setFieldsFor } from '../utils/workoutSession';
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

const WARMUP_OPTIONS: SegmentOption<WarmupMode>[] = [
  { value: 'none', label: 'None' },
  { value: 'ramp', label: 'Ramp' },
  { value: 'sets', label: 'Sets' },
];

const PROGRESSION_OPTIONS: SegmentOption<ProgressionScheme | null>[] = (
  ['double', 'linear', 'percent', 'rpe'] as const
).map(value => ({ value, label: PROGRESSION_LABELS[value] }));

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
   * "For 82.5 kg: 32.5, 50 and 65 kg.": the ramp an item's target weight
   * would lay out, worked out the way workout mode will (`rampSteps`), so the
   * hint shows real loads. Null with no target weight to ramp to.
   */
  const rampExample = (item: WorkoutRoutineItem): string | null => {
    const info = catalogExercise(exercises, item.exerciseId);
    const kg = itemShape(item).weightKg;
    if (!info || kg === null) return null;
    const steps = rampSteps(kg, loadContextFor(info, plateInventory, unit, item));
    if (steps.length === 0) return null;
    return `For ${formatWeightNumber(kg, unit)} ${unit}: ${joinAnd(steps.map(st => formatWeightNumber(st.kg, unit)))} ${unit}.`;
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
      <View style={styles.card}>
        {rows.length === 0 ? (
          <View style={styles.emptyWrap}>
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
              return (
                <View style={[styles.itemWrap, index > 0 && styles.itemSep, role !== 'none' && styles.superset]}>
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
                      rampExample={kind === 'weight_reps' ? rampExample(row.item) : null}
                      colors={colors}
                      styles={styles}
                      onChange={change => updateItem(row.id, change)}
                      onJoin={() => joinWithPrevious(index)}
                      onLeave={() => leave(index)}
                      onRemove={() => removeRow(row.id)}
                    />
                  )}
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
  /** The ramp the target weight would lay out, for the Ramp hint. */
  rampExample: string | null;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onChange: (change: (item: WorkoutRoutineItem) => WorkoutRoutineItem) => void;
  onJoin: () => void;
  onLeave: () => void;
  onRemove: () => void;
}

/** One exercise's planned sets, unfolded under its row. */
function ItemControls({
  item, kind, role, unit, defaultRest, canJoin, rampExample, colors, styles, onChange, onJoin, onLeave, onRemove,
}: ItemControlsProps) {
  const shape = itemShape(item);
  const fields = setFieldsFor(kind);
  const scheme = item.progression?.scheme ?? null;
  const warmup = warmupMode(item);
  const rests = role === 'none' || role === 'last';
  const shownWeight = shape.weightKg !== null ? weightToDisplay(shape.weightKg, unit) : null;
  return (
    <View style={styles.controls}>
      <View style={styles.kv}>
        <Text style={styles.cap}>Working sets</Text>
        <CountStepper
          value={shape.workingSets}
          onChange={n => onChange(i => withWorkingSets(i, n ?? 1))}
          min={1}
          max={MAX_ROUTINE_SETS}
          label="Working sets"
        />
      </View>

      {fields.includes('reps') && (
        <View style={styles.kv}>
          <Text style={styles.cap}>Reps</Text>
          <View style={styles.range}>
            <CountStepper
              value={shape.repsMin}
              // Raising the low end past the high end takes the high end with
              // it, and lowering the high end below the low end does the same:
              // the end being stepped is the one that moves as pressed.
              onChange={n => onChange(i => withReps(i, n, Math.max(n ?? 1, shape.repsMax ?? 1)))}
              min={1}
              max={100}
              label="Fewest reps"
            />
            <Text style={styles.to}>to</Text>
            <CountStepper
              value={shape.repsMax}
              onChange={n => onChange(i => withReps(i, Math.min(n ?? 1, shape.repsMin ?? n ?? 1), n))}
              min={1}
              max={100}
              label="Most reps"
            />
          </View>
        </View>
      )}

      {fields.includes('duration') && (
        <View style={styles.kv}>
          <Text style={styles.cap}>Time</Text>
          <CountStepper
            value={shape.durationSeconds}
            onChange={n => onChange(i => withTargetDuration(i, n))}
            min={5}
            max={3600}
            step={5}
            allowNull
            emptyLabel="Any"
            format={formatRestSeconds}
            label="Time per set"
          />
        </View>
      )}

      {fields.includes('weight') && (
        <View>
          <View style={styles.kv}>
            <Text style={styles.cap}>{kind === 'assisted_reps' ? 'Assistance' : 'Weight'}</Text>
            <CountStepper
              value={shownWeight}
              onChange={n => onChange(i => withTargetWeight(i, n === null ? null : weightFromDisplay(n, unit)))}
              min={WEIGHT_STEP[unit]}
              max={unit === 'kg' ? 500 : 1100}
              step={WEIGHT_STEP[unit]}
              places={WEIGHT_PLACES[unit]}
              allowNull
              emptyLabel="Last time"
              format={n => `${n} ${unit}`}
              label={kind === 'assisted_reps' ? 'Assistance' : 'Target weight'}
            />
          </View>
          <HelpText style={styles.hint}>Leave it on Last time to start each workout from the weight you lifted before.</HelpText>
        </View>
      )}

      <View>
        <Text style={[styles.cap, styles.capAbove]}>Progression</Text>
        <SegmentedControl
          options={PROGRESSION_OPTIONS}
          value={scheme}
          onChange={s => onChange(i => withProgression(i, s))}
          onDeselect={() => onChange(i => withProgression(i, null))}
          label="Progression"
        />
        <HelpText style={styles.hint}>
          {scheme
            ? PROGRESSION_HINTS[scheme]
            : 'How this exercise moves on from one workout to the next. With none chosen here, the program’s choice applies. Workout mode shows its suggestion, and you choose whether to use it.'}
        </HelpText>
      </View>

      {fields.includes('weight') && (
        <View>
          <Text style={[styles.cap, styles.capAbove]}>Warm-up</Text>
          <SegmentedControl
            options={kind === 'weight_reps' ? WARMUP_OPTIONS : WARMUP_OPTIONS.filter(o => o.value !== 'ramp')}
            value={warmup}
            onChange={m => onChange(i => withWarmupMode(i, m))}
            label="Warm-up"
          />
          {warmup === 'ramp' && (
            <HelpText style={styles.hint}>
              {`Sets at about 40, 60 and 80% of the working weight, rounded to your plates.${rampExample ? ` ${rampExample}` : ' With no target weight, the ramp is worked out from last time’s.'}`}
            </HelpText>
          )}
          {warmup === 'sets' && (
            <View style={[styles.kv, styles.below]}>
              <Text style={styles.cap}>Warm-up sets</Text>
              <CountStepper
                value={shape.warmups}
                onChange={n => onChange(i => (n === null || n === 0 ? withWarmupMode(i, 'none') : withWarmups(i, n)))}
                min={0}
                max={10}
                label="Warm-up sets"
              />
            </View>
          )}
        </View>
      )}

      {rests ? (
        <View style={styles.kv}>
          <Text style={styles.cap}>{role === 'last' ? 'Rest after the superset' : 'Rest'}</Text>
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

      <View style={styles.itemActions}>
        {role === 'none' && canJoin && (
          <InlineAction label="Superset with the one above" variant="neutral" onPress={onJoin} />
        )}
        {role !== 'none' && <InlineAction label="Leave superset" variant="neutral" onPress={onLeave} />}
        <InlineAction icon="trash-outline" label="Remove" tint={colors.redText} onPress={onRemove} />
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
  itemWrap: { backgroundColor: colors.bgSecondary },
  itemSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  // A superset is a block of neighbours, so its rows share a rail down the
  // left edge, the way the mock draws it. 3pt of the padding goes to the rail.
  superset: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  supersetTag: {
    color: colors.accentText, fontSize: font.xxs, fontWeight: fontWeight.semibold, letterSpacing: 0.8,
    textTransform: 'uppercase', paddingTop: spacing.sm, paddingHorizontal: spacing.md - 3,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 56 },
  itemText: { flex: 1 },
  itemName: { color: colors.text, fontSize: font.md },
  itemSummary: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
    paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.md, gap: spacing.md,
  },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  cap: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  capAbove: { marginBottom: spacing.sm },
  below: { marginTop: spacing.md },
  range: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  to: { color: colors.textSecondary, fontSize: font.sm },
  hint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.xs },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  adds: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  footHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginTop: spacing.lg, paddingVertical: spacing.smd, backgroundColor: colors.bgSecondary, borderRadius: radius.md,
  },
  deleteText: { color: colors.redText, fontSize: font.md, fontWeight: fontWeight.medium },
});
