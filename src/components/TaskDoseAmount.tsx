import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { useMedicationStore } from '../store/useMedicationStore';
import { defaultUsualDose, prefsFor } from '../utils/medicationSettings';
import { formatDose, isCountedUnit } from '../utils/medicationLog';
import { describeTaskDose } from '../utils/taskDose';
import { haptics } from '../utils/haptics';
import { DoseAmountField } from './DoseAmountField';
import { InlineAction } from './InlineAction';
import { PillGroup } from './PillGroup';

interface Props {
  /** The medication the task logs a dose of. */
  medication: string;
  amount: string;
  onChangeAmount: (next: string) => void;
  unit: string | null;
  onChangeUnit: (next: string | null) => void;
  /** For `SheetModal`'s development warnings. */
  menuName: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * "How much" for a task that logs a dose, and what completing it will record.
 *
 * **Left empty, the amount is the medication's default usual amount**, so a
 * task for a medication whose page already says "1 capsule" records that
 * without being told twice (`DoseInput.useUsualDose`). The card says so in
 * words and offers Change, which opens the number and unit for a one-off
 * override; "Use usual amount" puts it back. A medication with no usual amount
 * gets the fields straight away and a note saying where to set one.
 *
 * What is stored is only the override: an empty amount and no unit mean "the
 * usual one", read when the task is completed, so changing the usual amount
 * later changes the task with it. The preview line is `describeTaskDose`, the
 * same inputs the store reads.
 */
export function TaskDoseAmount({
  medication, amount, onChangeAmount, unit, onChangeUnit, menuName, style,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settings = useMedicationStore(s => s.settings);
  const prefs = useMemo(() => prefsFor(settings, medication), [settings, medication]);
  const usual = defaultUsualDose(prefs);
  const strength = prefs.strength ?? null;
  const usualDoses = prefs.usualDoses ?? [];

  // Open by tapping Change, or because an override is already set. Derived from
  // the fields rather than stored, so loading a task that carries its own
  // amount opens straight onto it.
  const [changing, setChanging] = useState(false);
  const hasOverride = amount.trim() !== '' || unit !== null;
  const showFields = !usual || changing || hasOverride;

  const preview = describeTaskDose({ name: medication, amount, unit, usual, strength });
  const usualText = usual
    ? formatDose({ ...usual, strength: isCountedUnit(usual.unit) ? strength : null })
    : null;

  const useUsual = () => {
    haptics.tap();
    onChangeAmount('');
    onChangeUnit(null);
    setChanging(false);
  };

  return (
    <View style={style}>
      <Text style={styles.label}>AMOUNT PER DOSE</Text>
      {!showFields && usual ? (
        <View style={styles.usualRow}>
          <View style={styles.usualText}>
            <Text style={styles.usualValue}>{usualText}</Text>
            <Text style={styles.usualCaption}>{`Your usual amount of ${medication}`}</Text>
          </View>
          <InlineAction label="Change" variant="neutral" onPress={() => { haptics.tap(); setChanging(true); }} />
        </View>
      ) : (
        <>
          {usualDoses.length > 1 && (
            <PillGroup
              noun="amount"
              surface="card"
              options={usualDoses.map(d => ({
                key: `${d.amount}-${d.unit}`,
                label: formatDose({ ...d, strength: isCountedUnit(d.unit) ? strength : null }) ?? '',
                selected: Number(amount.trim()) === d.amount && unit === d.unit,
                onPress: () => { haptics.tap(); onChangeAmount(String(d.amount)); onChangeUnit(d.unit); },
              }))}
            />
          )}
          <DoseAmountField
            name={menuName}
            style={usualDoses.length > 1 ? styles.fieldAfterPicks : undefined}
            amount={amount}
            onChangeAmount={onChangeAmount}
            unit={unit}
            onChangeUnit={onChangeUnit}
          />
          {usual ? (
            <View style={styles.useUsual}>
              <InlineAction label={`Use usual amount (${usualText})`} variant="neutral" onPress={useUsual} />
            </View>
          ) : (
            <Text style={styles.note}>
              {`No usual amount is saved for ${medication}. Add one on its medication page to use it here, or enter an amount.`}
            </Text>
          )}
        </>
      )}
      {preview.needsUnit && (
        <Text style={styles.warn}>Choose a unit, or the amount you typed is not recorded.</Text>
      )}
      <View style={styles.preview}>
        <Text style={styles.previewText}>{preview.text}</Text>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    label: {
      color: colors.textSecondary, fontSize: font.xxs, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.8,
      marginTop: spacing.md, marginBottom: spacing.xsm, marginLeft: spacing.xxs,
    },
    usualRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
      paddingVertical: spacing.sm, paddingLeft: spacing.smd, paddingRight: spacing.xs,
    },
    usualText: { flex: 1 },
    usualValue: { color: colors.text, fontSize: font.md, fontWeight: '600' },
    usualCaption: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
    fieldAfterPicks: { marginTop: spacing.sm },
    useUsual: { flexDirection: 'row', marginTop: spacing.sm },
    note: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm, marginLeft: spacing.xxs },
    warn: { color: colors.warningText, fontSize: font.sm, marginTop: spacing.sm, marginLeft: spacing.xxs },
    preview: {
      backgroundColor: colors.accentSubtle, borderRadius: radius.sm,
      paddingVertical: spacing.sm, paddingHorizontal: spacing.smd, marginTop: spacing.smd,
    },
    previewText: { color: colors.text, fontSize: font.md },
  });
}
