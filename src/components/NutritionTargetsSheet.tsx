import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { NUTRIENT_KEYS, type NutrientKey } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { NUTRITION_TARGET_RANGES } from '../utils/nutritionTargets';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { haptics } from '../utils/haptics';
import { CountStepper } from './CountStepper';
import { SheetHeaderButton } from './SheetHeaderButton';

/** Every nutrient the Food log's own card can show — water has its own card. */
const PINNABLE_NUTRIENTS = NUTRIENT_KEYS.filter(k => k !== 'waterMl');

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
  const pinnedNutrients = useSettingsStore(useShallow(s => s.foodLogPinnedNutrients));
  const setFoodLogPinnedNutrients = useSettingsStore(s => s.setFoodLogPinnedNutrients);

  const set = (key: NutrientKey, value: number | null) => setNutritionTarget(key, value);

  const togglePinned = (key: NutrientKey) => {
    haptics.tap();
    const next = pinnedNutrients.includes(key)
      ? pinnedNutrients.filter(k => k !== key)
      : [...pinnedNutrients, key];
    setFoodLogPinnedNutrients(next);
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Nutrition</Text>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={64} />
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <View>
            <Text style={styles.sectionLabel}>Shown on Food log</Text>
            <Text style={styles.intro}>
              Which of these the totals card shows before "Show every nutrient" is tapped.
            </Text>
            <View style={styles.pinnedCard}>
              {PINNABLE_NUTRIENTS.map((key, i) => {
                const pinned = pinnedNutrients.includes(key);
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.pinnedRow, i === PINNABLE_NUTRIENTS.length - 1 && styles.pinnedRowLast]}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => togglePinned(key)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: pinned }}
                    accessibilityLabel={`Show ${NUTRIENT_LABEL[key].label} on the Food log`}
                  >
                    <Ionicons
                      name={pinned ? 'checkmark-circle' : 'ellipse-outline'}
                      size={iconSize.md}
                      color={pinned ? colors.accent : colors.textTertiary}
                    />
                    <Text style={styles.pinnedRowLabel}>{NUTRIENT_LABEL[key].label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <Text style={styles.sectionLabel}>Daily targets</Text>
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
    </SheetModal>
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
    intro: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, marginBottom: spacing.sm },
    sectionLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: spacing.xs,
    },
    pinnedCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
    },
    pinnedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    pinnedRowLast: { borderBottomWidth: 0 },
    pinnedRowLabel: { color: colors.text, fontSize: font.sm },
    row: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    rowLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  });
}
