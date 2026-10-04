import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import type { ChainItem } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { DOSE_UNITS, medicationVocabulary, medicationKey } from '../utils/medicationLog';
import { useMedicationStore } from '../store/useMedicationStore';
import { useShallow } from 'zustand/react/shallow';
import { PillGroup } from './PillGroup';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';

const NAME_MAX_LENGTH = 60;

interface Props {
  visible: boolean;
  /** The step being edited; its title is the sheet's subject. */
  step: ChainItem | null;
  /**
   * What the task itself records, named in the hint so the empty state can say
   * what leaving it empty actually does — which is different depending on
   * whether the task carries one.
   */
  taskMedicationName: string | null;
  /** Applies the step's new settings. `onClose` follows it — the host hides the sheet. */
  onSave: (patch: Pick<ChainItem, 'medicationName' | 'medicationAmount' | 'medicationUnit'>) => void;
  onClose: () => void;
}

/**
 * What one chain step records in the medication log — the per-step half of
 * "Log a dose" (see `ChainItem.medicationName`).
 *
 * A sheet rather than controls unfolding on the step row, for the reason
 * `ChainStepQuestionSheet` beside it gives: the row lives inside a
 * `SortableList`, and a control that expands in place changes the row's height
 * mid-drag, which is the one thing that list's displacement math can't absorb.
 *
 * Shared by the task editor and the template item editor, like that sheet is.
 *
 * `KeyboardAvoidingView` here, against the general rule: this is a small
 * bottom-anchored card rather than a full scrollable sheet, which is exactly
 * the carve-out `LogMealPrompt` already holds. `useKeyboardInsetScroll` is for
 * a `ScrollView` that has somewhere to scroll, and this has none.
 */
export function ChainStepMedicationSheet({
  visible, step, taskMedicationName, onSave, onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const card = useCardSheet();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<string | null>(null);

  // Every medication ever logged, for the name field's own suggestions below
  // — see medicationVocabulary for why this is derived rather than a registry.
  const medicationLogs = useMedicationStore(useShallow(s => s.logs));
  const archivedMedications = useMedicationStore(useShallow(s => s.archived));
  const medicationSuggestions = useMemo(
    () => medicationVocabulary(medicationLogs, archivedMedications),
    [medicationLogs, archivedMedications]
  );

  useEffect(() => {
    if (!visible) return;
    setName(step?.medicationName ?? '');
    setAmount(step?.medicationAmount != null ? String(step.medicationAmount) : '');
    setUnit(step?.medicationUnit ?? null);
  }, [visible, step?.id]);

  const dismiss = (after: () => void) => {
    Keyboard.dismiss();
    card.close(() => {
      after();
    });
  };

  const save = () => {
    haptics.success();
    const trimmed = name.trim();
    const parsed = Number(amount.trim());
    // The whole triple is cleared with the name, rather than an orphan dose
    // being left on a step that records nothing: `medicationFor` resolves a
    // step as a set, so a stored amount with no name beside it could never be
    // read back and would come back the next time a name was typed.
    const usable = amount.trim() !== '' && Number.isFinite(parsed) && !!unit;
    const patch = {
      medicationName: trimmed || null,
      medicationAmount: trimmed && usable ? parsed : null,
      medicationUnit: trimmed && usable ? unit : null,
    };
    dismiss(() => { onSave(patch); onClose(); });
  };

  return (
    <CardSheet
      name="ChainStepMedicationSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss(onClose)}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss(onClose)} minWidth={56} />
          <Text style={styles.heading} numberOfLines={2}>{step?.title ?? 'Step'}</Text>
          <SheetHeaderButton label="Done" onPress={save} minWidth={56} style={styles.headerRight} />
        </View>

        <Text style={styles.label}>Log a dose</Text>
        <View style={styles.body}>
          <TextField
            style={styles.fieldBox}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Sertraline"
            placeholderTextColor={colors.textTertiary}
            maxLength={NAME_MAX_LENGTH}
            returnKeyType="done"
            accessibilityLabel="What this step records a dose of"
          />
          <Text style={styles.hint}>
            {taskMedicationName
              ? `Leave it empty and this step records the task's ${taskMedicationName}.`
              : 'Leave it empty and this step records nothing.'}
          </Text>

          {/* Picking one of these is what makes it the *same* medication
              as an earlier dose — medicationKey does no fuzzy matching
              (see docs/arch/mood-log.md), so retyping "Sertraline" as
              "sertraline" would otherwise split one medicine's history
              into two untallied entries. */}
          {medicationSuggestions.length > 0 && (
            <PillGroup
              noun="medication"
              surface="card"
              options={medicationSuggestions.map(n => ({
                key: medicationKey(n),
                label: n,
                selected: !!name.trim() && medicationKey(n) === medicationKey(name),
                onPress: () => { haptics.tap(); setName(n); },
              }))}
            />
          )}

          {name.trim().length > 0 && (
            <>
              <TextField
                style={styles.fieldBox}
                value={amount}
                onChangeText={setAmount}
                placeholder="e.g. 50"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                returnKeyType="done"
                accessibilityLabel="How much, optional"
              />
              <SegmentedControl
                options={DOSE_UNITS.map(u => ({ value: u.value, label: u.value }))}
                value={unit ?? ''}
                columns={5}
                label="Unit"
                surface="card"
                onChange={next => { haptics.tap(); setUnit(next === unit ? null : next); }}
              />
            </>
          )}
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  body: { paddingHorizontal: spacing.md, gap: spacing.sm },
  fieldBox: {
    color: colors.text, fontSize: font.md,
    backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
    paddingHorizontal: spacing.smd,
    // Height rather than lineHeight — see the TextInput note in CLAUDE.md.
    minHeight: 36,
  },
  hint: { color: colors.textSecondary, fontSize: font.sm },
});
