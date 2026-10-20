import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CountStepper } from './CountStepper';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { useGymStore } from '../store/useGymStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { catalogExercise } from '../utils/exerciseCatalog';
import { barKgFor, effectivePlateInventory, isPlateLoaded } from '../utils/plateMath';
import { gymExerciseId } from '../utils/gyms';
import {
  WEIGHT_PLACES, WEIGHT_STEP, formatWeightWithUnit, weightFromDisplay, weightToDisplay,
} from '../utils/workoutData';
import { BUTTON_LABEL } from '../copy/shared';

export interface GymExerciseSubject {
  gymId: string;
  exerciseId: string;
}

interface Props {
  visible: boolean;
  /** Kept through the close, so the card doesn't empty while it fades. */
  subject: GymExerciseSubject | null;
  onClose: () => void;
}

/** A bar or a stack's step moves by half a kilogram, or a pound: they come in odd sizes. */
const STEP = { kg: 0.5, lb: 1 } as const;

/**
 * One exercise at one gym: the note kept for it there, the bar if it isn't the
 * usual one, and how much one step of the load adds (a stack's pin, a pair of
 * plates). Opened from the exercise's page. A card, not a bottom sheet: it is
 * three fields. An empty note with both numbers left on their defaults deletes
 * the row (`setGymExercise`), so clearing everything is how it is removed.
 */
export function GymExerciseSheet({ visible, subject: liveSubject, onClose }: Props) {
  const subject = useSheetSubject(liveSubject);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const unit = useSettingsStore(s => s.workoutUnit);
  const plateInventory = useSettingsStore(s => s.plateInventory);
  const exercises = useWorkoutStore(s => s.exercises);
  const gyms = useGymStore(s => s.gyms);
  const settings = useGymStore(s => s.settings);
  const finish = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const [notes, setNotes] = useState('');
  const [barKg, setBarKg] = useState<number | null>(null);
  const [incrementKg, setIncrementKg] = useState<number | null>(null);

  const key = subject ? gymExerciseId(subject.gymId, subject.exerciseId) : null;
  useEffect(() => {
    if (!visible || !key) return;
    const existing = settings.find(s => s.id === key);
    setNotes(existing?.notes ?? '');
    setBarKg(existing?.barKg ?? null);
    setIncrementKg(existing?.incrementKg ?? null);
    // On open only: a sync landing mid-edit must not overwrite what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);

  if (!subject) return null;
  const gym = gyms.find(g => g.id === subject.gymId);
  const info = catalogExercise(exercises, subject.exerciseId);
  const plateLoaded = !!info && isPlateLoaded(info.equipment);
  const defaultBar = barKgFor(null, effectivePlateInventory(plateInventory, unit), info?.equipment ?? 'barbell', unit);
  const defaultStep = WEIGHT_STEP[unit];

  const save = () => {
    haptics.success();
    finish(() => {
      useGymStore.getState().setGymExercise(subject.gymId, subject.exerciseId, {
        notes, barKg: plateLoaded ? barKg : null, incrementKg,
      });
    });
  };

  return (
    <CardSheet name="GymExerciseSheet" visible={visible} controller={card} onRequestClose={() => finish()}>
      <View style={styles.header}>
        <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => finish()} />
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{info?.name ?? 'Exercise'}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{gym ? `At ${gym.name}` : 'At this gym'}</Text>
        </View>
        <SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} />
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>Note</Text>
        <TextField
          style={styles.input}
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. Seat 4, handle on the second hole"
          placeholderTextColor={colors.textTertiary}
          multiline
          accessibilityLabel={`Note on ${info?.name ?? 'this exercise'} at ${gym?.name ?? 'this gym'}`}
        />
        {plateLoaded && (
          <>
            <Text style={[styles.label, styles.spaced]}>Bar</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Bar weight</Text>
              <CountStepper
                value={barKg !== null ? weightToDisplay(barKg, unit) : null}
                onChange={n => setBarKg(n === null ? null : weightFromDisplay(n, unit))}
                min={STEP[unit]}
                max={unit === 'kg' ? 50 : 110}
                step={STEP[unit]}
                places={WEIGHT_PLACES[unit]}
                start={weightToDisplay(defaultBar, unit)}
                allowNull
                emptyLabel={`${formatWeightWithUnit(defaultBar, unit)} bar`}
                format={n => `${n} ${unit}`}
                label="Bar weight at this gym"
                describeValue={n => (n === null ? `the usual ${formatWeightWithUnit(defaultBar, unit)} bar` : `${n} ${unit}`)}
              />
            </View>
          </>
        )}
        <Text style={[styles.label, styles.spaced]}>Load step</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Step</Text>
          <CountStepper
            value={incrementKg !== null ? weightToDisplay(incrementKg, unit) : null}
            onChange={n => setIncrementKg(n === null ? null : weightFromDisplay(n, unit))}
            min={STEP[unit]}
            max={unit === 'kg' ? 25 : 55}
            step={STEP[unit]}
            places={WEIGHT_PLACES[unit]}
            start={defaultStep}
            allowNull
            emptyLabel={`${formatWeightWithUnit(weightFromDisplay(defaultStep, unit), unit)} usual`}
            format={n => `${n} ${unit}`}
            label="Load step at this gym"
            describeValue={n => (n === null ? 'the usual step' : `${n} ${unit}`)}
          />
        </View>
        <HelpText style={styles.hint}>
          How much one step adds on the machines here. Weight buttons and suggested loads use it at this gym.
        </HelpText>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.smd,
  },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  subtitle: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  body: { padding: spacing.md },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  spaced: { marginTop: spacing.lg },
  input: {
    color: colors.text, fontSize: font.md, backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 56,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 48 },
  rowLabel: { color: colors.text, fontSize: font.md },
  hint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm },
});
