import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isSameYear } from 'date-fns/isSameYear';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CountStepper } from './CountStepper';
import { CalendarPicker } from './CalendarPicker';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { InlineAction } from './InlineAction';
import { TextField } from './TextField';
import { ApplyToAllAccessory, APPLY_TO_ALL_ACCESSORY_ID } from './ApplyToAllAccessory';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useTextScale } from '../hooks/useTextScale';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { disclosureValue } from '../theme/textStyles';
import { haptics } from '../utils/haptics';
import { applyTargets, applyToAllLabel } from '../utils/applyToAll';
import { clearApplyOffer, setApplyOffer } from '../utils/applyToAllOffer';
import { confirmDiscard } from '../utils/confirmDiscard';
import { catalogExercise } from '../utils/exerciseCatalog';
import { formatTimeOfDay } from '../utils/dateUtils';
import { workoutHealthWriteOn, workoutSpanWritable } from '../utils/healthWorkoutSync';
import { WORKOUT_NAME_MAX_LENGTH } from '../utils/workoutData';
import { columnLabel, setFieldsFor, type SetField } from '../utils/workoutSession';
import {
  PAST_WORKOUT_DEFAULT_MINUTES, PAST_WORKOUT_MAX_MINUTES, PAST_WORKOUT_MIN_MINUTES,
  buildPastWorkout, nextSetText, pastWorkoutTouched, type PastExerciseDraft, type PastSetText,
} from '../utils/pastWorkout';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** "Tue, Oct 20", with the year once it isn't this one. */
const dayLabel = (date: Date) => format(date, isSameYear(date, new Date()) ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');

/** Five minutes before now, rounded down to five: where a workout logged afterward most likely started. */
function defaultStart(): Date {
  const d = new Date(Date.now() - PAST_WORKOUT_DEFAULT_MINUTES * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 5));
  return d;
}

/** The label above a column, and what to say when a cell is blank. */
const COLUMN_UNIT: Partial<Record<SetField, string>> = { distance: 'm' };

/**
 * Log a workout that was done earlier, without starting one: a name, the day and
 * time, how long it took, and the sets of each exercise. See the mock at
 * docs/arch/workouts-mocks/past-workout.png.
 *
 * - **Staged, then written once.** Nothing is saved until Save, which reads the
 *   typed cells through `buildPastWorkout` and writes `addFinishedSession`. A
 *   swipe down is the Cancel path, so it asks before discarding typed work.
 * - **A blank set is not a set of zeros.** `buildPastWorkout` drops a row nobody
 *   filled in, and refuses a cell that isn't a number by naming it.
 * - **Health.** The workout is left for the next foreground pass to write
 *   (`healthWritePending`), the same route an agent's workout takes, and only
 *   while writing workouts is on and the span is one Health takes.
 * - The exercise picker is rendered inside this sheet's Modal: a sibling sheet
 *   would never appear.
 */
export function LogPastWorkoutSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const textScale = useTextScale();
  const styles = useMemo(() => makeStyles(colors, textScale), [colors, textScale]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });
  const unit = useSettingsStore(s => s.workoutUnit);
  const exerciseRows = useWorkoutStore(s => s.exercises);

  // ==== staged state, reset each time the sheet opens ====
  const [title, setTitle] = useState('');
  const [start, setStart] = useState<Date>(defaultStart);
  const [minutes, setMinutes] = useState(PAST_WORKOUT_DEFAULT_MINUTES);
  const [exercises, setExercises] = useState<PastExerciseDraft[]>([]);
  const [pickingWhen, setPickingWhen] = useState(false);
  const [pickingExercise, setPickingExercise] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setStart(defaultStart());
    setMinutes(PAST_WORKOUT_DEFAULT_MINUTES);
    setExercises([]);
    setPickingWhen(false);
    setPickingExercise(false);
  }, [visible]);

  // ==== editing the list ====
  const addExercise = (exerciseId: string) => {
    const kind = catalogExercise(exerciseRows, exerciseId)?.kind ?? 'weight_reps';
    setExercises(prev => (prev.some(e => e.exerciseId === exerciseId)
      ? prev
      : [...prev, { exerciseId, kind, sets: [{}] }]));
  };
  const removeExercise = (exerciseId: string) => {
    haptics.tap();
    setExercises(prev => prev.filter(e => e.exerciseId !== exerciseId));
  };
  const changeSets = (exerciseId: string, change: (sets: PastSetText[]) => PastSetText[]) => {
    setExercises(prev => prev.map(e => (e.exerciseId === exerciseId ? { ...e, sets: change(e.sets) } : e)));
  };
  const nameOf = (exerciseId: string) => catalogExercise(exerciseRows, exerciseId)?.name ?? 'Unknown exercise';

  // The keyboard bar's "Apply 95 to all sets", offered while a weight or reps
  // cell holds a value its sibling sets don't. `text` is what the cell holds
  // now, which is the new keystroke before state has caught up.
  const offerKey = (exerciseId: string, index: number, f: SetField) => `${exerciseId}:${index}:${f}`;
  const publishOffer = (exerciseId: string, index: number, f: SetField, text: string) => {
    const ex = exercises.find(e => e.exerciseId === exerciseId);
    const key = offerKey(exerciseId, index, f);
    if (!ex) { clearApplyOffer(key); return; }
    const cells = ex.sets.map(s => s[f] ?? '');
    const targets = applyTargets(cells, cells.map((_, i) => i), index, text);
    if (targets.length === 0) { clearApplyOffer(key); return; }
    setApplyOffer({
      key,
      label: applyToAllLabel(text, 'sets'),
      apply: () => {
        haptics.tap();
        changeSets(exerciseId, sets => sets.map((s, i) => (targets.includes(i) ? { ...s, [f]: text.trim() } : s)));
        // Every set now matches, so there is nothing left to offer.
        clearApplyOffer(key);
      },
    });
  };

  // ==== saving, cancelling ====
  const handleCancel = () => {
    if (!pastWorkoutTouched(title, exercises)) { onClose(); return; }
    confirmDiscard(onClose);
  };

  const refuse = (message: string) => {
    haptics.warning();
    Alert.alert('Couldn’t save this workout', message);
  };

  const save = () => {
    const now = new Date();
    const end = new Date(start.getTime() + minutes * 60_000);
    const built = buildPastWorkout({
      title, start, minutes, exercises, unit, now,
      healthWritePending: workoutHealthWriteOn() && workoutSpanWritable({ startedAt: start.toISOString(), endedAt: end.toISOString() }, now),
    });
    if ('problem' in built) {
      if (built.problem === 'empty') refuse('Add an exercise and fill in at least one set.');
      else if (built.problem === 'future') refuse('A workout can’t finish in the future. Pick an earlier start or a shorter length.');
      else refuse(`Set ${built.setNumber} of ${nameOf(built.exerciseId)} has a value that isn’t a number. Fix it or clear it.`);
      return;
    }
    const result = useWorkoutStore.getState().addFinishedSession(built.input);
    if (typeof result === 'string') {
      refuse(result === 'order' ? 'A workout has to finish after it starts.' : 'An exercise in this workout is no longer available.');
      return;
    }
    haptics.success();
    onClose();
  };

  // ==== render ====
  const end = new Date(start.getTime() + minutes * 60_000);

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel} name="LogPastWorkoutSheet">
      <View style={styles.root}>
        <ApplyToAllAccessory />
        <SheetHeader
          title="Log a workout"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} minWidth={64} />}
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          {...keyboardScroll.props}
          ref={keyboardScroll.ref}
        >
          <View style={styles.card}>
            <TextField
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Workout name"
              placeholderTextColor={colors.textTertiary}
              maxLength={WORKOUT_NAME_MAX_LENGTH}
              returnKeyType="done"
              accessibilityLabel="Workout name"
            />
          </View>

          <Text style={styles.groupLabel}>When</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.kv}
              onPress={() => { haptics.tap(); setPickingWhen(true); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Day: ${dayLabel(start)}`}
              accessibilityHint="Changes the day and start time"
            >
              <Text style={styles.kvLabel}>Day</Text>
              <View style={styles.valueRow}>
                <Text style={styles.value}>{dayLabel(start)}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.kv, styles.rowSep]}
              onPress={() => { haptics.tap(); setPickingWhen(true); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Started: ${formatTimeOfDay(start)}`}
              accessibilityHint="Changes the day and start time"
            >
              <Text style={styles.kvLabel}>Started</Text>
              <View style={styles.valueRow}>
                <Text style={styles.value}>{formatTimeOfDay(start)}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
            <View style={[styles.kv, styles.rowSep]}>
              <Text style={styles.kvLabel}>Length</Text>
              <CountStepper
                value={minutes}
                onChange={n => setMinutes(n ?? PAST_WORKOUT_DEFAULT_MINUTES)}
                min={PAST_WORKOUT_MIN_MINUTES}
                max={PAST_WORKOUT_MAX_MINUTES}
                step={5}
                format={n => `${n} min`}
                label="workout length"
              />
            </View>
          </View>
          <Text style={styles.hint}>{`Finished at ${formatTimeOfDay(end)}.`}</Text>

          <Text style={styles.groupLabel}>Exercises</Text>
          {exercises.map(ex => {
            const fields = setFieldsFor(ex.kind);
            return (
              <View key={ex.exerciseId} style={[styles.card, styles.exercise]}>
                <View style={styles.exerciseHead}>
                  <Text style={styles.exerciseName} numberOfLines={2}>{nameOf(ex.exerciseId)}</Text>
                  <TouchableOpacity
                    onPress={() => removeExercise(ex.exerciseId)}
                    hitSlop={8}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${nameOf(ex.exerciseId)}`}
                  >
                    <Ionicons name="close" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.tableHead}>
                  <View style={styles.colSet} />
                  {fields.map(f => (
                    <Text key={f} style={[styles.headCell, styles.colValue]}>
                      {columnLabel(f, ex.kind, unit)}{COLUMN_UNIT[f] ? ` (${COLUMN_UNIT[f]})` : ''}
                    </Text>
                  ))}
                  <View style={styles.colRemove} />
                </View>
                {ex.sets.map((text, index) => (
                  <View key={index} style={styles.setRow}>
                    <View style={styles.colSet}><Text style={styles.setNumber}>{index + 1}</Text></View>
                    {fields.map(f => (
                      <View key={f} style={styles.colValue}>
                        <TextField
                          style={styles.cell}
                          value={text[f] ?? ''}
                          onChangeText={t => {
                            changeSets(ex.exerciseId, sets => sets.map((s, i) => (i === index ? { ...s, [f]: t } : s)));
                            publishOffer(ex.exerciseId, index, f, t);
                          }}
                          onFocus={() => publishOffer(ex.exerciseId, index, f, text[f] ?? '')}
                          onBlur={() => clearApplyOffer(offerKey(ex.exerciseId, index, f))}
                          inputAccessoryViewID={Platform.OS === 'ios' ? APPLY_TO_ALL_ACCESSORY_ID : undefined}
                          placeholder="–"
                          placeholderTextColor={colors.textTertiary}
                          keyboardType={f === 'weight' ? 'decimal-pad' : 'numbers-and-punctuation'}
                          selectTextOnFocus
                          returnKeyType="done"
                          accessibilityLabel={`${nameOf(ex.exerciseId)} set ${index + 1} ${columnLabel(f, ex.kind, unit)}`}
                        />
                      </View>
                    ))}
                    <View style={styles.colRemove}>
                      {ex.sets.length > 1 && (
                        <TouchableOpacity
                          onPress={() => changeSets(ex.exerciseId, sets => sets.filter((_, i) => i !== index))}
                          hitSlop={8}
                          activeOpacity={interaction.activeOpacity}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove set ${index + 1} of ${nameOf(ex.exerciseId)}`}
                        >
                          <Ionicons name="remove-circle-outline" size={20} color={colors.textTertiary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
                <View style={styles.adds}>
                  <InlineAction
                    icon="add"
                    label="Add set"
                    onPress={() => { haptics.tap(); changeSets(ex.exerciseId, sets => [...sets, nextSetText(sets)]); }}
                  />
                </View>
              </View>
            );
          })}
          <View style={styles.addExercise}>
            <InlineAction
              icon="add"
              label="Add exercise"
              variant="neutral"
              surface="page"
              onPress={() => { haptics.tap(); setPickingExercise(true); }}
            />
          </View>
        </ScrollView>

        <CalendarPicker
          visible={visible && pickingWhen}
          mode="datetime"
          title="Started"
          value={start}
          onConfirm={picked => { setStart(picked); setPickingWhen(false); }}
          onCancel={() => setPickingWhen(false)}
        />
        <ExercisePickerSheet
          visible={visible && pickingExercise}
          onClose={() => setPickingExercise(false)}
          onPick={addExercise}
          addedIds={exercises.map(e => e.exerciseId)}
          addedLabel="In workout"
        />
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors, textScale: number) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xl },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  titleInput: { color: colors.text, fontSize: font.md, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 48 },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  kv: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 48,
  },
  kvLabel: { color: colors.text, fontSize: font.md },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  value: { ...disclosureValue(colors), flexShrink: 1, fontVariant: ['tabular-nums'] },
  hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  exercise: { marginBottom: spacing.smd },
  exerciseHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
  },
  exerciseName: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.xsm },
  headCell: {
    color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.semibold, letterSpacing: 0.8,
    textTransform: 'uppercase', textAlign: 'center',
  },
  // Alignment columns, so they grow with the text they hold (see textScale in src/theme/index.ts).
  colSet: { width: 28 * textScale, alignItems: 'center' },
  colValue: { flex: 1 },
  colRemove: { width: 24 * textScale, alignItems: 'center' },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xsm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  setNumber: { color: colors.textSecondary, fontSize: font.md, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  cell: {
    minHeight: 36, paddingHorizontal: spacing.smd, borderRadius: radius.sm, backgroundColor: colors.bgTertiary,
    color: colors.text, fontSize: font.lg, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  adds: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  addExercise: { flexDirection: 'row', marginTop: spacing.xs },
});
