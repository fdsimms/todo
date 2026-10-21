import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { PillGroup } from './PillGroup';
import { CountStepper } from './CountStepper';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { KIND_OPTIONS } from './ExercisePickerSheet';
import type { ExerciseEquipment, ExerciseKind, MuscleGroup } from '../types';
import { useWorkoutStore, type ExercisePatch } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import { catalogExercise, describeExercise } from '../utils/exerciseCatalog';
import { libraryExercise } from '../utils/exerciseLibrary';
import { DUMBBELL_ENTRY_LABELS, dumbbellsUsed } from '../utils/dumbbellLoad';
import { barKgFor, effectivePlateInventory, isPlateLoaded } from '../utils/plateMath';
import {
  EQUIPMENT_LABELS, EXERCISE_EQUIPMENT, MUSCLE_GROUPS, MUSCLE_LABELS, WEIGHT_PLACES, WORKOUT_NAME_MAX_LENGTH,
  cleanOtherNames, formatOtherNames, parseOtherNames, formatWeightWithUnit, weightFromDisplay, weightToDisplay,
} from '../utils/workoutData';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** Kept by the host through the close, so the sheet doesn't empty while it slides away. */
  exerciseId: string | null;
  onClose: () => void;
}

const REFUSED: Record<string, string> = {
  blank: 'Give the exercise a name.',
  taken: 'That name is taken.',
  otherNameTaken: 'Another exercise already goes by one of those names.',
  notFound: 'This exercise is no longer in the library.',
  hasHistory: 'Kind can’t change once sets are logged with this exercise.',
};

/** The bar weight steps by half a kilogram, or a pound: bars come in odd weights. */
const BAR_STEP = { kg: 0.5, lb: 1 } as const;

const snapshotOf = (v: Staged) => JSON.stringify([v.name.trim(), cleanOtherNames(parseOtherNames(v.otherNames), v.name), v.kind, v.equipment, v.primary, v.secondary, v.barKg, v.dumbbells, v.loadEntry, v.notes.trim()]);

interface Staged {
  name: string;
  /** The other names as typed, comma separated. */
  otherNames: string;
  kind: ExerciseKind;
  equipment: ExerciseEquipment;
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
  barKg: number | null;
  /** The count in use: the library's answer or the person's, resolved. */
  dumbbells: 1 | 2;
  loadEntry: 'each' | 'pair' | null;
  notes: string;
}

/**
 * Edit an exercise: for one the person made, everything about it; for a
 * built-in, only its name, other names, notes and bar weight, the override the catalog
 * takes from a row (what the movement is stays the library's, so a later
 * correction still reaches it). Writes through `updateExercise`, which
 * enforces the same split and refuses a name another exercise has.
 *
 * A page sheet with staged state, so Cancel and the swipe-down both go
 * through `handleCancel` (`confirmDiscard` once anything changed). Opened from
 * the exercise page, and rendered inside that sheet's own Modal, since two
 * sheets presented side by side never both appear.
 */
export function ExerciseEditorSheet({ visible, exerciseId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const exercises = useWorkoutStore(s => s.exercises);
  const unit = useSettingsStore(s => s.workoutUnit);
  const plateInventory = useSettingsStore(s => s.plateInventory);
  const info = exerciseId ? catalogExercise(exercises, exerciseId) : null;
  const builtIn = !!exerciseId && !!libraryExercise(exerciseId);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const [v, setV] = useState<Staged>({
    name: '', otherNames: '', kind: 'weight_reps', equipment: 'barbell', primary: [], secondary: [], barKg: null, dumbbells: 2, loadEntry: null, notes: '',
  });
  const [refusal, setRefusal] = useState<string | null>(null);
  // Whether a set is logged on this device with the exercise: what a set
  // records is then fixed (`updateExercise` refuses it too).
  const [kindLocked, setKindLocked] = useState(false);
  const baseline = useRef('');

  useEffect(() => {
    if (!visible || !info) return;
    const next: Staged = {
      name: info.name,
      otherNames: formatOtherNames(info.otherNames),
      kind: info.kind,
      equipment: info.equipment,
      primary: [...info.primaryMuscles],
      secondary: [...info.secondaryMuscles],
      barKg: info.barKg,
      dumbbells: dumbbellsUsed(info) ?? 2,
      loadEntry: info.loadEntry,
      notes: info.notes,
    };
    setV(next);
    setRefusal(null);
    setKindLocked(!!exerciseId && useWorkoutStore.getState().exerciseHistory(exerciseId).length > 0);
    baseline.current = snapshotOf(next);
    // On open only: a sync landing mid-edit must not overwrite what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, exerciseId]);

  const patch = (change: Partial<Staged>) => { setV(prev => ({ ...prev, ...change })); setRefusal(null); };
  const toggle = (list: MuscleGroup[], m: MuscleGroup) => (list.includes(m) ? list.filter(x => x !== m) : [...list, m]);

  const dirty = visible && snapshotOf(v) !== baseline.current;
  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose);
  };

  const save = () => {
    if (!exerciseId) return;
    // The library's own count is stored as nothing, so a correction to it in a later build still reaches this exercise.
    const defaultCount = dumbbellsUsed({ id: exerciseId, equipment: 'dumbbell', dumbbells: null });
    const dumbbellChange: ExercisePatch = isDumbbell
      ? { dumbbells: v.dumbbells === defaultCount ? null : v.dumbbells, loadEntry: v.dumbbells === 2 ? v.loadEntry : null }
      : {};
    const otherNames = parseOtherNames(v.otherNames);
    const change: ExercisePatch = builtIn
      ? { name: v.name, otherNames, notes: v.notes, barKg: v.barKg, ...dumbbellChange }
      : {
        ...dumbbellChange,
        name: v.name, otherNames, notes: v.notes, barKg: isPlateLoaded(v.equipment) ? v.barKg : null,
        kind: v.kind, equipment: v.equipment, primaryMuscles: v.primary, secondaryMuscles: v.secondary.filter(m => !v.primary.includes(m)),
      };
    const result = useWorkoutStore.getState().updateExercise(exerciseId, change);
    if (typeof result === 'string') {
      haptics.warning();
      setRefusal(REFUSED[result] ?? 'This exercise could not be saved.');
      return;
    }
    haptics.success();
    onClose();
  };

  const isDumbbell = (builtIn ? info?.equipment : v.equipment) === 'dumbbell';
  const dumbbellEntry = useSettingsStore(st => st.dumbbellEntry);
  const plateLoaded = isPlateLoaded(builtIn ? info?.equipment ?? 'other' : v.equipment);
  const inventory = effectivePlateInventory(plateInventory, unit);
  const defaultBar = barKgFor(null, inventory, builtIn ? info?.equipment ?? 'barbell' : v.equipment, unit);
  const lib = exerciseId ? libraryExercise(exerciseId) : null;

  const musclePills = (selected: MuscleGroup[], onPress: (m: MuscleGroup) => void, noun: string) => (
    <PillGroup
      noun={noun}
      surface="page"
      options={MUSCLE_GROUPS.map(m => ({
        key: m,
        label: MUSCLE_LABELS[m],
        selected: selected.includes(m),
        onPress: () => { haptics.tap(); onPress(m); },
      }))}
    />
  );

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel} name="ExerciseEditorSheet">
      <View style={styles.root}>
        <SheetHeader
          title="Edit exercise"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} minWidth={64} />}
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
          ref={keyboardScroll.ref}
        >
          <TextField
            style={styles.nameInput}
            value={v.name}
            onChangeText={t => patch({ name: t })}
            placeholder="Exercise name"
            placeholderTextColor={colors.textTertiary}
            maxLength={WORKOUT_NAME_MAX_LENGTH}
            returnKeyType="done"
            accessibilityLabel="Exercise name"
          />
          {refusal && <Text style={styles.refusal}>{refusal}</Text>}
          {lib && lib.name !== v.name.trim() && <Text style={styles.note}>{`Built in as ${lib.name}.`}</Text>}

          <Text style={styles.label}>Also called</Text>
          <TextField
            style={styles.otherNamesInput}
            value={v.otherNames}
            onChangeText={t => patch({ otherNames: t })}
            placeholder="e.g. Two arm dumbbell row, DB row"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            autoCapitalize="sentences"
            accessibilityLabel="Other names for this exercise, separated by commas"
          />
          <HelpText style={styles.hint}>Search and imports find the exercise by these names. Separate them with commas.</HelpText>

          {!builtIn && (
            <>
              <Text style={styles.label}>What a set records</Text>
              <SegmentedControl
                options={kindLocked ? KIND_OPTIONS.map(o => ({ ...o, disabled: o.value !== v.kind })) : KIND_OPTIONS}
                value={v.kind}
                onChange={k => patch({ kind: k })}
                columns={3}
                label="What a set records"
                surface="page"
              />
              <HelpText style={styles.hint}>
                {kindLocked ? 'Kind can’t change once sets are logged with this exercise.' : 'This can’t be changed once a set is logged with the exercise.'}
              </HelpText>
              <Text style={styles.label}>Equipment</Text>
              <PillGroup
                noun="piece of equipment"
                pluralNoun="pieces of equipment"
                surface="page"
                filterPlaceholder="Find equipment…"
                options={EXERCISE_EQUIPMENT.map(q => ({
                  key: q,
                  label: EQUIPMENT_LABELS[q],
                  selected: q === v.equipment,
                  onPress: () => { haptics.tap(); patch({ equipment: q }); },
                }))}
              />
              <Text style={styles.label}>Main muscles</Text>
              {musclePills(v.primary, m => setV(prev => ({ ...prev, primary: toggle(prev.primary, m) })), 'muscle')}
              <Text style={styles.label}>Helping muscles</Text>
              {musclePills(v.secondary, m => setV(prev => ({ ...prev, secondary: toggle(prev.secondary, m) })), 'muscle')}
              <HelpText style={styles.hint}>A main muscle counts a whole set toward its weekly sets on Stats, a helping one half.</HelpText>
            </>
          )}

          {plateLoaded && (
            <>
              <Text style={styles.label}>Bar</Text>
              <View style={styles.card}>
                <View style={styles.kv}>
                  <Text style={styles.kvLabel}>Bar weight</Text>
                  <CountStepper
                    value={v.barKg !== null ? weightToDisplay(v.barKg, unit) : null}
                    onChange={n => patch({ barKg: n === null ? null : weightFromDisplay(n, unit) })}
                    min={BAR_STEP[unit]}
                    max={unit === 'kg' ? 50 : 110}
                    step={BAR_STEP[unit]}
                    places={WEIGHT_PLACES[unit]}
                    start={weightToDisplay(defaultBar, unit)}
                    allowNull
                    emptyLabel={`${formatWeightWithUnit(defaultBar, unit)} bar`}
                    format={n => `${n} ${unit}`}
                    label="Bar weight"
                    describeValue={n => (n === null ? `the usual ${formatWeightWithUnit(defaultBar, unit)} bar` : `${n} ${unit}`)}
                  />
                </View>
              </View>
              <HelpText style={styles.hint}>The plates are worked out on this bar. Leave it for your gym’s usual bar.</HelpText>
            </>
          )}

          {isDumbbell && (
            <>
              <Text style={styles.label}>Dumbbells used</Text>
              <SegmentedControl
                options={[{ value: 1 as const, label: '1' }, { value: 2 as const, label: '2' }]}
                value={v.dumbbells}
                onChange={n => patch({ dumbbells: n })}
                label="Dumbbells used"
                surface="page"
              />
              {v.dumbbells === 2 && (
                <>
                  <Text style={styles.label}>Log weight as</Text>
                  <SegmentedControl
                    options={[
                      { value: 'default' as const, label: 'Default' },
                      { value: 'each' as const, label: 'Each' },
                      { value: 'pair' as const, label: 'Pair total' },
                    ]}
                    value={v.loadEntry ?? 'default'}
                    onChange={o => patch({ loadEntry: o === 'default' ? null : o })}
                    label="Log weight as"
                    surface="page"
                  />
                  <HelpText style={styles.hint}>
                    {`Default follows Settings, which is ${DUMBBELL_ENTRY_LABELS[dumbbellEntry].toLowerCase()}. The app keeps the weight of one dumbbell either way.`}
                  </HelpText>
                </>
              )}
            </>
          )}

          <Text style={styles.label}>Notes</Text>
          <TextField
            style={styles.notesInput}
            value={v.notes}
            onChangeText={t => patch({ notes: t })}
            placeholder="e.g. Pause each rep at the bottom"
            placeholderTextColor={colors.textTertiary}
            multiline
            accessibilityLabel="Notes on this exercise"
          />

          {builtIn && info && (
            <View style={[styles.card, styles.libraryCard]}>
              <Text style={styles.libraryText}>
                {`${describeExercise(info)}. What it is and the muscles it works come with the app.`}
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  form: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl * 2 },
  nameInput: {
    color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold, backgroundColor: colors.bgSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 52, marginTop: spacing.xs,
  },
  refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  note: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  hint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  kvLabel: { color: colors.text, fontSize: font.md },
  otherNamesInput: {
    color: colors.text, fontSize: font.md, backgroundColor: colors.bgSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, minHeight: 44,
  },
  notesInput: {
    color: colors.text, fontSize: font.md, backgroundColor: colors.bgSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 64,
  },
  libraryCard: { marginTop: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  libraryText: { color: colors.textSecondary, fontSize: font.sm },
});
