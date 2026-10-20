// The program editor: a program's name, the routines it goes through in
// turn, how its exercises move on, how long a cycle runs and its training
// maxes. Built on EditorSheet (fullScreen) because the rotation drags.
// Landmarks:
//
//   ==== <name> ====        the section banners through the logic half
//   makeStyles              styles, at the bottom
//
// Where the program is (week, next routine) is derived from its sessions in
// src/utils/workoutProgram.ts and only shown here, never edited. Mock:
// the phase 4 PR's program-editor.png.
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
import { PillGroup } from './PillGroup';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { EmptyNote } from './EmptyNote';
import type { ProgressionScheme } from '../types';
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
import { WEIGHT_PLACES, WEIGHT_STEP, WORKOUT_NAME_MAX_LENGTH, formatWeightWithUnit, weightFromDisplay, weightToDisplay } from '../utils/workoutData';
import { PROGRESSION_HINTS, PROGRESSION_LABELS, describeRoutine } from '../utils/workoutRoutine';
import { programProgress, weekLabel } from '../utils/workoutProgram';
import { percentExercises } from '../utils/workoutProgramLibrary';
import { suggestedTrainingMaxKg } from '../utils/workoutProgression';
import { analyzeExercise, recordSessions } from '../utils/workoutRecords';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The program to edit, or null for a new one. */
  programId: string | null;
  onClose: () => void;
}

/** A rotation slot with an id of its own for the list, since a routine can come round twice. */
interface Slot {
  id: string;
  routineId: string;
}

const SCHEME_OPTIONS: SegmentOption<ProgressionScheme>[] = (
  ['double', 'linear', 'percent', 'rpe'] as const
).map(value => ({ value, label: PROGRESSION_LABELS[value] }));

const toSlots = (ids: readonly string[]): Slot[] => ids.map(routineId => ({ id: generateId(), routineId }));
const snapshotOf = (name: string, slots: readonly Slot[], scheme: ProgressionScheme, weeks: number | null, maxes: Record<string, number | null>) =>
  JSON.stringify([name.trim(), slots.map(s => s.routineId), scheme, weeks, Object.entries(maxes).filter(([, kg]) => kg !== null).sort()]);

/**
 * A program's editor. Everything is staged and written on Save, so Cancel
 * asks before throwing edits away (`confirmDiscard`); a full-screen sheet has
 * no swipe to guard, only the button.
 */
export function ProgramEditorSheet({ visible, programId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const programs = useWorkoutStore(s => s.programs);
  const routines = useWorkoutStore(s => s.routines);
  const sessions = useWorkoutStore(s => s.sessions);
  const exercises = useWorkoutStore(s => s.exercises);
  const unit = useSettingsStore(s => s.workoutUnit);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const program = programId ? programs.find(p => p.id === programId) ?? null : null;

  // ==== staged state, loaded each time the sheet opens ====
  const [name, setName] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [scheme, setScheme] = useState<ProgressionScheme>('double');
  const [weeks, setWeeks] = useState<number | null>(null);
  const [maxes, setMaxes] = useState<Record<string, number | null>>({});
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const baseline = useRef('');

  useEffect(() => {
    if (!visible) return;
    const n = program?.name ?? '';
    const s = toSlots(program?.rotation.filter(id => routines.some(r => r.id === id)) ?? []);
    const sc = program?.scheme ?? 'double';
    const w = program?.weeks ?? null;
    const m: Record<string, number | null> = {};
    for (const t of program?.trainingMaxes ?? []) m[t.exerciseId] = t.kg;
    setName(n);
    setSlots(s);
    setScheme(sc);
    setWeeks(w);
    setMaxes(m);
    setAdding(false);
    setRefusal(null);
    baseline.current = snapshotOf(n, s, sc, w, m);
    // Loaded on open only: a sync landing mid-edit must not overwrite what is
    // being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, programId]);

  const routineOf = (id: string) => routines.find(r => r.id === id) ?? null;
  const musclesOf = (id: string) => catalogExercise(exercises, id)?.primaryMuscles ?? [];

  // ==== where the program is, read-only ====
  const progressLine = useMemo(() => {
    if (!program) return null;
    const p = programProgress(program, sessions, routines);
    const next = p.nextRoutineId ? routineOf(p.nextRoutineId)?.name : null;
    const done = `${p.sessionsDone} ${p.sessionsDone === 1 ? 'workout' : 'workouts'} done`;
    return [weekLabel(p), done, next ? `Next: ${next}` : null].filter(Boolean).join(' · ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, sessions, routines]);

  // ==== training maxes: which exercises want one, and a suggestion from history ====
  const tmExercises = useMemo(() => {
    const rotation = slots.map(s => routineOf(s.routineId)).filter((r): r is NonNullable<typeof r> => r !== null);
    const wanted = percentExercises(rotation, scheme, id => catalogExercise(exercises, id)?.kind ?? null);
    for (const id of Object.keys(maxes)) if (maxes[id] !== null && !wanted.includes(id)) wanted.push(id);
    return wanted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, scheme, routines, exercises, maxes]);

  const suggestions = useMemo(() => {
    const out = new Map<string, number>();
    if (!visible || tmExercises.length === 0) return out;
    const rec = recordSessions(sessions, dayResetTime);
    for (const id of tmExercises) {
      const kind = catalogExercise(exercises, id)?.kind ?? 'weight_reps';
      const best = analyzeExercise(id, kind, useWorkoutStore.getState().exerciseHistory(id), rec)
        .records.find(r => r.type === 'e1rm')?.value ?? null;
      const kg = suggestedTrainingMaxKg(best, unit);
      if (kg !== null) out.set(id, kg);
    }
    return out;
  }, [visible, tmExercises, sessions, dayResetTime, exercises, unit]);

  // ==== editing the rotation ====
  const addRoutine = (routineId: string) => {
    haptics.tap();
    animateLayout();
    setSlots(prev => [...prev, { id: generateId(), routineId }]);
  };
  const removeSlot = (id: string) => {
    haptics.tap();
    animateLayout();
    setSlots(prev => prev.filter(s => s.id !== id));
  };

  // ==== saving, cancelling, deleting ====
  const dirty = visible && snapshotOf(name, slots, scheme, weeks, maxes) !== baseline.current;

  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose, program ? {} : {
      title: 'Discard this program?',
      message: 'It hasn’t been saved yet. If you leave now, it will be lost.',
    });
  };

  const save = () => {
    const store = useWorkoutStore.getState();
    const input = {
      name,
      rotation: slots.map(s => s.routineId),
      scheme,
      weeks,
      trainingMaxes: Object.entries(maxes)
        .filter((e): e is [string, number] => e[1] !== null && e[1] > 0)
        .map(([exerciseId, kg]) => ({ exerciseId, kg })),
    };
    const result = program ? store.updateProgram(program.id, input) : store.addProgram(input);
    if (typeof result === 'string') {
      haptics.warning();
      setRefusal(result === 'blank' ? 'Give the program a name.' : 'This program was deleted on another device.');
      return;
    }
    haptics.success();
    onClose();
  };

  const remove = () => {
    if (!program) return;
    confirmDelete({
      title: 'Delete this program?',
      message: 'Its routines stay, as routines on their own, and workouts logged from it stay in your history. Tasks linked to it stop offering it.',
      onConfirm: () => {
        useWorkoutStore.getState().deleteProgram(program.id);
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
          title={program ? 'Program' : 'New program'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} minWidth={64} />}
        />
      }
    >
      <View style={styles.nameCard}>
        <TextField
          style={styles.nameInput}
          value={name}
          onChangeText={t => { setName(t); setRefusal(null); }}
          placeholder="Program name"
          placeholderTextColor={colors.textTertiary}
          maxLength={WORKOUT_NAME_MAX_LENGTH}
          autoFocus={!program}
          accessibilityLabel="Program name"
        />
      </View>
      {refusal && <Text style={styles.refusal}>{refusal}</Text>}
      {!!progressLine && <Text style={styles.progress}>{progressLine}</Text>}

      <Text style={styles.groupLabel}>Rotation</Text>
      <View style={styles.card}>
        {slots.length === 0 ? (
          <View style={styles.pad}>
            <EmptyNote icon="repeat-outline">No routines yet. Add them in the order you do them.</EmptyNote>
          </View>
        ) : (
          <SortableList
            data={slots}
            onDragStateChange={setDragging}
            onReorder={setSlots}
            renderItem={(slot, index, drag) => {
              const routine = routineOf(slot.routineId);
              const label = routine?.name ?? 'A deleted routine';
              return (
                <View style={[styles.slotRow, index > 0 && styles.rowSep]}>
                  <TouchableOpacity
                    onLongPress={drag}
                    delayLongPress={interaction.delayLongPress}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Reorder ${label}`}
                    accessibilityHint="Touch and hold, then drag"
                  >
                    <Ionicons name="reorder-two-outline" size={iconSize.md} color={colors.textTertiary} />
                  </TouchableOpacity>
                  <Text style={styles.slotIndex}>{index + 1}</Text>
                  <TouchableOpacity
                    style={styles.flex}
                    onLongPress={drag}
                    delayLongPress={interaction.delayLongPress}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityLabel={label}
                  >
                    <Text style={styles.slotName}>{label}</Text>
                    {routine && <Text style={styles.slotMeta}>{describeRoutine(routine.items, musclesOf)}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => removeSlot(slot.id)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Take ${label} out of the rotation`}
                  >
                    <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )}
        <View style={[styles.pad, styles.rowSep]}>
          {adding ? (
            routines.length === 0 ? (
              <EmptyNote icon="list-outline">No routines yet. Make one under Routines, then add it here.</EmptyNote>
            ) : (
              <>
                <PillGroup
                  noun="routine"
                  options={routines.map(r => ({ key: r.id, label: r.name, selected: false, onPress: () => addRoutine(r.id) }))}
                />
                <HelpText style={styles.hint}>Tap a routine to add it at the end. A routine can come round more than once.</HelpText>
                <View style={styles.row}>
                  <InlineAction label={BUTTON_LABEL.done} variant="neutral" onPress={() => { haptics.tap(); setAdding(false); }} />
                </View>
              </>
            )
          ) : (
            <View style={styles.row}>
              <InlineAction icon="add" label="Add routine" onPress={() => { haptics.tap(); setAdding(true); }} />
            </View>
          )}
        </View>
      </View>
      <HelpText style={styles.footHint}>
        Touch and hold a routine to move it. A week is one pass through the rotation, so a week off waits for you.
      </HelpText>

      <Text style={styles.groupLabel}>Progression</Text>
      <View style={[styles.card, styles.pad]}>
        <SegmentedControl options={SCHEME_OPTIONS} value={scheme} onChange={setScheme} label="Progression" />
        <HelpText style={styles.hint}>{PROGRESSION_HINTS[scheme]}</HelpText>
        <View style={[styles.kv, styles.kvSep]}>
          <Text style={styles.cap}>Cycle length</Text>
          <CountStepper
            value={weeks}
            onChange={setWeeks}
            min={1}
            max={52}
            start={4}
            allowNull
            emptyLabel="No end"
            label="Cycle length in weeks"
          />
        </View>
        <HelpText style={styles.hint}>
          {scheme === 'percent'
            ? 'Weights rise over the first three weeks. In a cycle of four or more weeks, the last week is lighter.'
            : 'Pick a number of weeks, or leave it on No end to keep repeating the program.'}
        </HelpText>
      </View>

      {tmExercises.length > 0 && (
        <>
          <Text style={styles.groupLabel}>Training maxes</Text>
          <View style={styles.card}>
            {tmExercises.map((id, i) => {
              const info = catalogExercise(exercises, id);
              const value = maxes[id] ?? null;
              const suggestion = value === null ? suggestions.get(id) ?? null : null;
              return (
                <View key={id} style={[styles.tmRow, i > 0 && styles.rowSep]}>
                  <View style={styles.kv}>
                    <Text style={styles.tmName}>{info?.name ?? 'Unknown exercise'}</Text>
                    <CountStepper
                      value={value !== null ? weightToDisplay(value, unit) : null}
                      onChange={n => setMaxes(prev => ({ ...prev, [id]: n === null ? null : weightFromDisplay(n, unit) }))}
                      min={WEIGHT_STEP[unit]}
                      max={unit === 'kg' ? 500 : 1100}
                      step={WEIGHT_STEP[unit]}
                      places={WEIGHT_PLACES[unit]}
                      start={suggestion !== null ? weightToDisplay(suggestion, unit) : WEIGHT_STEP[unit] * 20}
                      allowNull
                      emptyLabel="Not set"
                      format={n => `${n} ${unit}`}
                      label={`Training max for ${info?.name ?? 'this exercise'}`}
                    />
                  </View>
                  {suggestion !== null && (
                    <View style={styles.suggestRow}>
                      <Text style={styles.suggestText}>
                        {`90% of your best estimated 1RM is ${formatWeightWithUnit(suggestion, unit)}.`}
                      </Text>
                      <InlineAction
                        label={`Use ${formatWeightWithUnit(suggestion, unit)}`}
                        variant="neutral"
                        onPress={() => { haptics.tap(); setMaxes(prev => ({ ...prev, [id]: suggestion })); }}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          <HelpText style={styles.footHint}>
            Each percentage set is worked out from this weight. Set it a little under the heaviest single you could lift today.
          </HelpText>
        </>
      )}

      {program && (
        <TouchableOpacity
          style={styles.deleteRow}
          onPress={remove}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
        >
          <Ionicons name="trash-outline" size={iconSize.sm} color={colors.redText} />
          <Text style={styles.deleteText}>Delete program</Text>
        </TouchableOpacity>
      )}
    </EditorSheet>
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
  flex: { flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  nameCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.xs },
  nameInput: {
    color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md, minHeight: 52,
  },
  refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  progress: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  pad: { padding: spacing.md, gap: spacing.sm },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  slotRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 56, backgroundColor: colors.bgSecondary,
  },
  slotIndex: { color: colors.textSecondary, fontSize: font.md, fontWeight: fontWeight.semibold, minWidth: 16, textAlign: 'center', fontVariant: ['tabular-nums'] },
  slotName: { color: colors.text, fontSize: font.md },
  slotMeta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  kvSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, paddingTop: spacing.smd, marginTop: spacing.xs },
  cap: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  hint: { color: colors.textTertiary, fontSize: font.xs },
  footHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  tmRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd, gap: spacing.sm },
  tmName: { flex: 1, color: colors.text, fontSize: font.md },
  suggestRow: { gap: spacing.xs, alignItems: 'flex-start' },
  suggestText: { color: colors.textSecondary, fontSize: font.sm },
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginTop: spacing.lg, paddingVertical: spacing.smd, backgroundColor: colors.bgSecondary, borderRadius: radius.md,
  },
  deleteText: { color: colors.redText, fontSize: font.md, fontWeight: fontWeight.medium },
});
