import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { LOG_MEAL_SLOTS, LOG_MEAL_SLOT_LABELS, type LogMealSlot, type RuleTaskLog } from '../types';
import { useMedicationStore } from '../store/useMedicationStore';
import { useSavedMealsStore } from '../store/useSavedMealsStore';
import { medicationKey, medicationVocabulary } from '../utils/medicationLog';
import { slotForHour } from '../utils/mealLog';
import { RULE_MEDICATION_NAME_MAX_LENGTH, parseRuleLog } from '../utils/ruleLog';
import { haptics } from '../utils/haptics';
import { PillGroup } from './PillGroup';
import { SegmentedControl } from './SegmentedControl';
import { TaskDoseAmount } from './TaskDoseAmount';
import { TextField } from './TextField';
import { HelpText } from './HelpText';

interface Props {
  rule: RuleTaskLog;
  /** Every change commits through here as it is made, like the rest of the rule sheet. */
  onChange: (patch: Partial<RuleTaskLog>) => void;
  /** For `SheetModal`'s development warnings. */
  menuName: string;
}

/**
 * "When completed" on a rule: what completing the task it writes records, a dose
 * in the medication log, a food log entry, or both. The task editor's "Log a
 * dose" and "Log to food log" rows, shaped for a rule's expanded row (see
 * `src/utils/ruleLog.ts`).
 *
 * Two on/off pills rather than a three-way track, because the two are
 * independent on a task and a rule that carries both (written back from a task)
 * has to be able to show both. Turning one off clears its fields, so "off" and
 * "on with nothing filled in" can't both be stored. Whether each is on is local
 * state seeded from the rule, since a dose with its name still empty has nothing
 * to store yet; the parent keys this by rule id so a different rule starts fresh.
 */
export function RuleLogFields({ rule, onChange, menuName }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const stored = useMemo(() => parseRuleLog(rule), [rule]);

  const [doseOn, setDoseOn] = useState(!!stored.medicationName);
  const [foodOn, setFoodOn] = useState(!!stored.logMealSlot);
  const [name, setName] = useState(stored.medicationName ?? '');
  const [amount, setAmount] = useState(stored.medicationAmount != null ? String(stored.medicationAmount) : '');
  const [unit, setUnit] = useState<string | null>(stored.medicationUnit ?? null);

  const medicationLogs = useMedicationStore(useShallow(s => s.logs));
  const archivedMedications = useMedicationStore(useShallow(s => s.archived));
  const registeredMedications = useMedicationStore(useShallow(s => s.registered));
  const medicationSuggestions = useMemo(
    () => medicationVocabulary(medicationLogs, archivedMedications, registeredMedications),
    [medicationLogs, archivedMedications, registeredMedications],
  );
  const savedMeals = useSavedMealsStore(s => s.meals);

  /** Commits a dose. An amount with no unit, or the reverse, is stored as no amount (the usual one is used). */
  const commitDose = (nextName: string, nextAmount: string, nextUnit: string | null) => {
    const trimmed = nextName.trim();
    const parsed = Number(nextAmount.trim());
    const usable = nextAmount.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && !!nextUnit;
    onChange({
      medicationName: trimmed || null,
      medicationAmount: trimmed && usable ? parsed : null,
      medicationUnit: trimmed && usable ? nextUnit : null,
    });
  };

  const toggleDose = () => {
    haptics.tap();
    if (doseOn) {
      setDoseOn(false);
      setName(''); setAmount(''); setUnit(null);
      onChange({ medicationName: null, medicationAmount: null, medicationUnit: null });
    } else {
      setDoseOn(true);
    }
  };

  const toggleFood = () => {
    haptics.tap();
    if (foodOn) {
      setFoodOn(false);
      onChange({ logMealSlot: null, logSavedMealId: null, logMealSlotByTime: false });
    } else {
      setFoodOn(true);
      onChange({ logMealSlot: slotForHour(new Date().getHours()) });
    }
  };

  const slot: LogMealSlot = stored.logMealSlot ?? 'breakfast';
  const chosenMeal = stored.logSavedMealId ? savedMeals.find(m => m.id === stored.logSavedMealId) ?? null : null;

  return (
    <View style={styles.root}>
      <PillGroup
        noun="log"
        surface="card"
        options={[
          { key: 'dose', label: 'Log a dose', selected: doseOn, onPress: toggleDose },
          { key: 'food', label: 'Log to food log', selected: foodOn, onPress: toggleFood },
        ]}
      />

      {doseOn && (
        <View style={styles.section}>
          <Text style={styles.label}>Medication</Text>
          <TextField
            style={styles.fieldBox}
            value={name}
            onChangeText={text => { setName(text); commitDose(text, amount, unit); }}
            placeholder="e.g. Sertraline"
            placeholderTextColor={colors.textTertiary}
            maxLength={RULE_MEDICATION_NAME_MAX_LENGTH}
            returnKeyType="done"
            accessibilityLabel="What completing this rule’s task records a dose of"
          />
          {/* Picking one is what makes it the same medication as an earlier
              dose: medicationKey does no fuzzy matching, so retyping a name
              would split one medicine's history in two. */}
          {medicationSuggestions.length > 0 && (
            <PillGroup
              noun="medication"
              surface="card"
              options={medicationSuggestions.map(n => ({
                key: medicationKey(n),
                label: n,
                selected: !!name.trim() && medicationKey(n) === medicationKey(name),
                onPress: () => {
                  haptics.tap();
                  // An amount typed for one medicine is not another's.
                  const same = medicationKey(n) === medicationKey(name);
                  const nextAmount = same ? amount : '';
                  const nextUnit = same ? unit : null;
                  setName(n); setAmount(nextAmount); setUnit(nextUnit);
                  commitDose(n, nextAmount, nextUnit);
                },
              }))}
            />
          )}
          {name.trim().length > 0 && (
            <TaskDoseAmount
              menuName={menuName}
              medication={name.trim()}
              amount={amount}
              onChangeAmount={next => { setAmount(next); commitDose(name, next, unit); }}
              unit={unit}
              onChangeUnit={next => { setUnit(next); commitDose(name, amount, next); }}
            />
          )}
          {name.trim().length === 0 && (
            <HelpText style={styles.hint}>
              Completing the task adds a dose to your medication log. Unchecking it removes the dose.
            </HelpText>
          )}
        </View>
      )}

      {foodOn && (
        <View style={styles.section}>
          <Text style={styles.label}>Meal</Text>
          <SegmentedControl<LogMealSlot>
            options={LOG_MEAL_SLOTS.map(s => ({ value: s, label: LOG_MEAL_SLOT_LABELS[s] }))}
            value={slot}
            onChange={next => { haptics.tap(); onChange({ logMealSlot: next, logMealSlotByTime: false }); }}
            columns={2}
            label="Meal"
            surface="card"
          />
          <PillGroup
            noun="time of day"
            surface="card"
            options={[{
              key: 'byTime',
              label: 'Choose the meal from the time of day',
              selected: stored.logMealSlotByTime === true,
              onPress: () => { haptics.tap(); onChange({ logMealSlotByTime: stored.logMealSlotByTime !== true }); },
            }]}
          />
          <Text style={styles.label}>Food</Text>
          {savedMeals.length === 0 ? (
            <Text style={styles.hint}>
              No saved meals yet. In the food log, select entries and choose Save as meal. Until then completing the task asks what you ate.
            </Text>
          ) : (
            <PillGroup
              noun="saved meal"
              surface="card"
              filterPlaceholder="Find a saved meal…"
              options={[
                {
                  key: '',
                  label: 'Ask each time',
                  selected: !chosenMeal,
                  pinned: true,
                  onPress: () => { haptics.tap(); onChange({ logSavedMealId: null }); },
                },
                ...savedMeals.map(meal => ({
                  key: meal.id,
                  label: meal.name,
                  selected: meal.id === chosenMeal?.id,
                  onPress: () => { haptics.tap(); onChange({ logSavedMealId: meal.id }); },
                })),
              ]}
            />
          )}
          <HelpText style={styles.hint}>
            Completing the task adds a food log entry. Unchecking it removes what it logged.
          </HelpText>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { gap: spacing.sm },
    section: { gap: spacing.sm },
    label: {
      color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
      textTransform: 'uppercase', letterSpacing: 0.8,
    },
    fieldBox: {
      color: colors.text, fontSize: font.md,
      backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
      paddingHorizontal: spacing.smd,
      minHeight: 36,
    },
    hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
  });
}
