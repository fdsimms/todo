import React, { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, radius, spacing, type Colors } from '../theme';
import { NUTRIENT_KEYS, type NutrientKey } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { NUTRITION_TARGET_RANGES } from '../utils/nutritionTargets';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { CountStepper } from './CountStepper';
import { SheetHeaderButton } from './SheetHeaderButton';

/**
 * A daily figure to aim at, per nutrient.
 *
 * **Nothing is suggested and nothing is on by default.** Every stepper opens
 * empty, and the number it shows when you first press + is where that
 * nutrient's range starts from rather than a recommendation. The app has no
 * business having an opinion on what somebody should eat, so it does not
 * express one here, and `docs/arch/health-data.md` makes the same argument at
 * length about a related case.
 *
 * **Clearing a target is one press at the floor**, which is what `allowNull`
 * is for. "I no longer want a protein target" is a real thing to say, and
 * without it the only way to say it would be a target of zero, which is not
 * none.
 *
 * **Every edit commits immediately**, so there is nothing for a swipe-down to
 * lose and no unsaved-changes guard. That is the other valid answer to the
 * `pageSheet` `onRequestClose` rule, not a workaround.
 *
 * All ten are listed rather than hidden behind an "add one" picker: the set is
 * closed and short, and a picker would make the nine somebody has not set
 * invisible rather than merely empty.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function NutritionTargetsSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const targets = useSettingsStore(useShallow(s => s.nutritionTargets));
  const setNutritionTarget = useSettingsStore(s => s.setNutritionTarget);

  const set = (key: NutrientKey, value: number | null) => setNutritionTarget(key, value);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Daily targets</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Text style={styles.intro}>
            A figure to read the day's total against. Nothing is set to begin with, and
            nothing is suggested: these are yours to choose or to leave alone.
          </Text>

          {NUTRIENT_KEYS.map(key => {
            const range = NUTRITION_TARGET_RANGES[key];
            const unit = NUTRIENT_LABEL[key].unit;
            return (
              <View key={key} style={styles.row}>
                <Text style={styles.rowLabel}>{NUTRIENT_LABEL[key].label}</Text>
                <CountStepper
                  value={targets[key] ?? null}
                  onChange={next => set(key, next)}
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  allowNull
                  emptyLabel="None"
                  format={n => `${n.toLocaleString()}${unit === 'cal' ? '' : unit}`}
                  label={`${NUTRIENT_LABEL[key].label} target`}
                  describeValue={n => `${n} ${unit === 'cal' ? 'calories' : unit}`}
                />
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    headerSpacer: { minWidth: 64 },
    body: { flex: 1 },
    bodyContent: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
    intro: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
    row: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    rowLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  });
}
