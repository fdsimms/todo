import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { NUTRIENT_KEYS, type NutrientKey } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { NUTRITION_TARGET_RANGES, type NutritionTargets } from '../utils/nutritionTargets';
import { NUTRIENT_LABEL } from '../utils/foodNutrition';
import { describeWater, waterInUnit, waterRange, waterToMl } from '../utils/waterLog';
import {
  WATER_EXERCISE_BOOST_ML_RANGE,
  WATER_EXERCISE_BOOST_MINUTES_RANGE,
  type WaterExerciseBoost,
} from '../utils/waterExerciseBoost';
import {
  ACTIVE_ENERGY_BASELINE_RANGE,
  snapToBaselineStep,
  typicalActiveEnergyKcal,
  TYPICAL_ACTIVE_ENERGY_WINDOW_DAYS,
} from '../utils/activeEnergyBoost';
import { useHealthStore } from '../store/useHealthStore';
import { openHealthApp } from '../utils/healthBridge';
import { haptics } from '../utils/haptics';
import { navigateToSettingsEntry } from '../utils/settingsIndex';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';

/** Every nutrient the Food log's own card can show — water has its own card. */
const PINNABLE_NUTRIENTS = NUTRIENT_KEYS.filter(k => k !== 'waterMl');

/**
 * A daily figure to aim at, per nutrient.
 *
 * **Nothing is on by default, and nothing here is the app's opinion.** Every
 * stepper opens empty, and the number it lands on at the first press of + —
 * same figure the "Set to U.S. Daily Value" action above the list fills in
 * for every nutrient still unset — is `NUTRITION_TARGET_RANGES[key].default`,
 * the reference figure US nutrition-label law already prints on the packet.
 * The app is repeating that figure, not assessing the person holding it, the
 * same distinction `NUTRITION_TARGET_RANGES`'s own comment draws and
 * `docs/arch/health-data.md` makes at length about a related case. A target
 * still exists only once somebody presses + or taps that action; the map
 * itself ships and stays empty until then.
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
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const targets = useSettingsStore(useShallow(s => s.nutritionTargets));
  const setNutritionTarget = useSettingsStore(s => s.setNutritionTarget);
  const setNutritionTargets = useSettingsStore(s => s.setNutritionTargets);
  const pinnedNutrients = useSettingsStore(useShallow(s => s.foodLogPinnedNutrients));
  const setFoodLogPinnedNutrients = useSettingsStore(s => s.setFoodLogPinnedNutrients);
  const waterUnit = useSettingsStore(s => s.waterUnit);
  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const waterExerciseBoost = useSettingsStore(useShallow(s => s.waterExerciseBoost));
  const setWaterExerciseBoost = useSettingsStore(s => s.setWaterExerciseBoost);

  const toggleWaterExerciseBoost = () => {
    haptics.tap();
    setWaterExerciseBoost(
      waterExerciseBoost
        ? null
        : { minExerciseMinutes: WATER_EXERCISE_BOOST_MINUTES_RANGE.default, boostMl: WATER_EXERCISE_BOOST_ML_RANGE.default },
    );
  };

  const setBoostField = (field: keyof WaterExerciseBoost, value: number) => {
    if (!waterExerciseBoost) return;
    setWaterExerciseBoost({ ...waterExerciseBoost, [field]: value });
  };

  const activeEnergyBoost = useSettingsStore(useShallow(s => s.activeEnergyBoost));
  const setActiveEnergyBoost = useSettingsStore(s => s.setActiveEnergyBoost);

  const toggleActiveEnergyBoost = () => {
    haptics.tap();
    setActiveEnergyBoost(
      activeEnergyBoost ? null : { baselineKcal: ACTIVE_ENERGY_BASELINE_RANGE.default },
    );
  };

  /**
   * This person's own recent typical day, for the button that offers it —
   * `undefined` while nothing has been looked up, `null` once the window came
   * back without enough days to answer from.
   *
   * Read here rather than from the health store's state because nothing else
   * wants it: it is a fortnight of one metric, fetched when somebody opens the
   * control that needs it and kept nowhere afterwards, the same arrangement
   * `readRecentWeights` has with the generator that asks for it.
   */
  const [typicalKcal, setTypicalKcal] = useState<number | null | undefined>(undefined);
  const boostOn = activeEnergyBoost !== null;

  /**
   * Whether today has an active-energy figure at all.
   *
   * **This is why the notice below can only be phrased as a question.** Adding
   * active energy extended the read-type list, and HealthKit shows its
   * permission sheet once for whatever was asked for at the time: an install
   * that allowed the earlier types is never re-asked on its own, so this one
   * arrives unauthorized and answers null. A refused read, a day nothing has
   * been recorded on yet and a device that records none of this are one
   * answer here by Apple's design (see `docs/arch/health-data.md`), so the row
   * may not say access was denied. What it can honestly do is say the figure
   * is not arriving and offer the one place it could be fixed, which is
   * exactly what stops the toggle above sitting on doing nothing with no
   * explanation.
   */
  const activeEnergyToday = useHealthStore(s => s.today?.activeEnergyKcal ?? null);
  const noActiveEnergy = boostOn && healthReadEnabled && activeEnergyToday === null;
  useEffect(() => {
    if (!visible || !healthReadEnabled || !boostOn) return;
    let live = true;
    void useHealthStore
      .getState()
      .readRecentActiveEnergy(TYPICAL_ACTIVE_ENERGY_WINDOW_DAYS)
      .then(days => {
        // A null window is "there was no way to ask" and must not read as "not
        // enough days": the first would have the button's absence blamed on
        // Health having nothing, when the truth is nobody asked it. Both end
        // up offering no suggestion, but only the second says so on screen.
        if (live) setTypicalKcal(days === null ? undefined : typicalActiveEnergyKcal(days));
      });
    return () => { live = false; };
  }, [visible, healthReadEnabled, boostOn]);

  const set = (key: NutrientKey, value: number | null) => setNutritionTarget(key, value);

  const unsetKeys = NUTRIENT_KEYS.filter(key => targets[key] === undefined);
  const applyDailyValues = () => {
    haptics.tap();
    const values: NutritionTargets = {};
    for (const key of unsetKeys) values[key] = NUTRITION_TARGET_RANGES[key].default;
    setNutritionTargets(values);
  };

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

        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
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
            nothing is suggested: these are yours to choose, to leave alone, or to start
            from the U.S. Daily Value, the reference figure nutrition labels print.
          </Text>
          {unsetKeys.length > 0 && (
            <InlineAction
              label="Set to U.S. Daily Value"
              variant="neutral"
              onPress={applyDailyValues}
              style={styles.dailyValueAction}
            />
          )}

          {NUTRIENT_KEYS.map(key => {
            // Water's target is stored in ml regardless (like every other
            // water figure — see waterLogUnit's note in TaskEditor), but the
            // stepper shows and steps in whichever unit the person picked for
            // water elsewhere in the app (`waterUnit`).
            const isWater = key === 'waterMl';
            const range = isWater ? waterRange(waterUnit) : NUTRITION_TARGET_RANGES[key];
            const unit = NUTRIENT_LABEL[key].unit;
            const value = isWater ? waterInUnit(targets.waterMl ?? null, waterUnit) : (targets[key] ?? null);
            // waterRange's own range has no default of its own to open on —
            // the reference figure is the ml one below, shown in whichever
            // unit the stepper is in, the same conversion `value`/`onChange`
            // already do. The `??` never actually fires (2000ml is always
            // positive), it just keeps waterInUnit's `number | null` result
            // assignable to `start`, which only takes a plain number.
            const start = isWater
              ? waterInUnit(NUTRITION_TARGET_RANGES.waterMl.default, waterUnit) ?? NUTRITION_TARGET_RANGES.waterMl.default
              : NUTRITION_TARGET_RANGES[key].default;
            return (
              <View key={key} style={styles.row}>
                <Text style={styles.rowLabel}>{NUTRIENT_LABEL[key].label}</Text>
                <CountStepper
                  value={value}
                  onChange={next =>
                    set(key, isWater ? (next === null ? null : waterToMl(next, waterUnit)) : next)
                  }
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  start={start}
                  allowNull
                  emptyLabel="None"
                  format={n =>
                    isWater
                      ? (waterUnit === 'flOz' ? `${n.toLocaleString()} fl oz` : `${n.toLocaleString()}ml`)
                      : `${n.toLocaleString()}${unit === 'cal' ? '' : unit}`
                  }
                  label={`${NUTRIENT_LABEL[key].label} target`}
                  describeValue={n =>
                    isWater
                      ? `${n} ${waterUnit === 'flOz' ? 'fluid ounces' : 'ml'}`
                      : `${n} ${unit === 'cal' ? 'calories' : unit}`
                  }
                />
              </View>
            );
          })}

          {targets.waterMl !== undefined && (
            <View>
              <Text style={styles.sectionLabel}>Water on exercise days</Text>
              {!healthReadEnabled ? (
                // The whole card opens the row it names, rather than a button
                // beside it: the sentence is already the thing to tap, and
                // every field here commits as it is made, so closing costs
                // nothing.
                <TouchableOpacity
                  style={styles.boostNotice}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => {
                    haptics.tap();
                    onClose();
                    navigateToSettingsEntry(navigation, 'healthRead');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Turn on Apple Health reading in Settings"
                  accessibilityHint="Opens the Read Apple Health setting"
                >
                  <Ionicons name="heart-outline" size={iconSize.sm} color={colors.textSecondary} />
                  <Text style={styles.boostNoticeText}>
                    Turn on Apple Health reading in Settings to raise today's water target on a day
                    with exercise logged.
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={iconSize.sm}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
              ) : (
                <View style={styles.boostCard}>
                  <TouchableOpacity
                    style={styles.boostToggleRow}
                    activeOpacity={interaction.activeOpacity}
                    onPress={toggleWaterExerciseBoost}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: waterExerciseBoost !== null }}
                    accessibilityLabel="Raise the water target after exercise"
                  >
                    <Ionicons
                      name={waterExerciseBoost ? 'checkmark-circle' : 'ellipse-outline'}
                      size={iconSize.md}
                      color={waterExerciseBoost ? colors.accent : colors.textTertiary}
                    />
                    <Text style={styles.boostToggleLabel}>Raise after exercise</Text>
                  </TouchableOpacity>
                  {waterExerciseBoost && (
                    <View style={styles.boostFields}>
                      <View style={styles.boostFieldRow}>
                        <Text style={styles.boostFieldLabel}>After this much exercise</Text>
                        <CountStepper
                          value={waterExerciseBoost.minExerciseMinutes}
                          onChange={n => setBoostField('minExerciseMinutes', n ?? WATER_EXERCISE_BOOST_MINUTES_RANGE.default)}
                          min={WATER_EXERCISE_BOOST_MINUTES_RANGE.min}
                          max={WATER_EXERCISE_BOOST_MINUTES_RANGE.max}
                          step={WATER_EXERCISE_BOOST_MINUTES_RANGE.step}
                          format={n => `${n} min`}
                          label="Exercise minutes threshold"
                          describeValue={n => `${n} minutes`}
                        />
                      </View>
                      <View style={styles.boostFieldRow}>
                        <Text style={styles.boostFieldLabel}>Raise the target by</Text>
                        <CountStepper
                          value={waterExerciseBoost.boostMl}
                          onChange={n => setBoostField('boostMl', n ?? WATER_EXERCISE_BOOST_ML_RANGE.default)}
                          min={WATER_EXERCISE_BOOST_ML_RANGE.min}
                          max={WATER_EXERCISE_BOOST_ML_RANGE.max}
                          step={WATER_EXERCISE_BOOST_ML_RANGE.step}
                          format={n => describeWater(n, waterUnit)}
                          label="Water target boost amount"
                          describeValue={n => describeWater(n ?? WATER_EXERCISE_BOOST_ML_RANGE.default, waterUnit)}
                        />
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* The sibling of the water section above, and deliberately built to
              the same shape rather than as a second design: same card, same
              notice when the Health read is off, same commit-as-you-go fields.
              Shown only once a calorie target exists, because there is nothing
              to raise until then and offering to raise nothing is a control
              that cannot do anything when tapped. */}
          {targets.calorieKcal !== undefined && (
            <View>
              <Text style={styles.sectionLabel}>Calories on active days</Text>
              {!healthReadEnabled ? (
                <TouchableOpacity
                  style={styles.boostNotice}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => {
                    haptics.tap();
                    onClose();
                    navigateToSettingsEntry(navigation, 'healthRead');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Turn on Apple Health reading in Settings"
                  accessibilityHint="Opens the Read Apple Health setting"
                >
                  <Ionicons name="heart-outline" size={iconSize.sm} color={colors.textSecondary} />
                  <Text style={styles.boostNoticeText}>
                    Turn on Apple Health reading in Settings to raise today's calorie target on a
                    day with more activity than usual.
                  </Text>
                  <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : (
                <View style={styles.boostCard}>
                  <TouchableOpacity
                    style={styles.boostToggleRow}
                    activeOpacity={interaction.activeOpacity}
                    onPress={toggleActiveEnergyBoost}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: activeEnergyBoost !== null }}
                    accessibilityLabel="Add active calories to the calorie target"
                  >
                    <Ionicons
                      name={activeEnergyBoost ? 'checkmark-circle' : 'ellipse-outline'}
                      size={iconSize.md}
                      color={activeEnergyBoost ? colors.accent : colors.textTertiary}
                    />
                    <Text style={styles.boostToggleLabel}>Add active calories</Text>
                  </TouchableOpacity>
                  {activeEnergyBoost && (
                    <View style={styles.boostFields}>
                      <Text style={styles.boostHint}>
                        Today's calorie target goes up by whatever active calories Apple Health
                        records past this figure. A day that stays under it is left alone, and the
                        target you set is never changed.
                      </Text>
                      <View style={styles.boostFieldRow}>
                        <Text style={styles.boostFieldLabel}>Active calories in a typical day</Text>
                        <CountStepper
                          value={activeEnergyBoost.baselineKcal}
                          onChange={n =>
                            setActiveEnergyBoost({
                              baselineKcal: n ?? ACTIVE_ENERGY_BASELINE_RANGE.default,
                            })
                          }
                          min={ACTIVE_ENERGY_BASELINE_RANGE.min}
                          max={ACTIVE_ENERGY_BASELINE_RANGE.max}
                          step={ACTIVE_ENERGY_BASELINE_RANGE.step}
                          format={n => `${n.toLocaleString()} cal`}
                          label="Typical day's active calories"
                          describeValue={n =>
                            `${(n ?? ACTIVE_ENERGY_BASELINE_RANGE.default).toLocaleString()} calories`
                          }
                        />
                      </View>
                      {/* Offered, never applied on its own — the arrangement
                          `WeightGoalSheet` uses for a far bigger number, and
                          the reason a figure worked out from somebody's own
                          data is allowed to be shown here at all. Said even
                          when it matches what's already set, so a resolved
                          figure is never indistinguishable from one still
                          loading or one Health had nothing to answer. */}
                      {typicalKcal !== null && typicalKcal !== undefined && (
                        snapToBaselineStep(typicalKcal) !== activeEnergyBoost.baselineKcal ? (
                          <InlineAction
                            label={`Use your recent average (${typicalKcal.toLocaleString()} cal)`}
                            variant="neutral"
                            onPress={() => {
                              haptics.tap();
                              setActiveEnergyBoost({ baselineKcal: snapToBaselineStep(typicalKcal) });
                            }}
                          />
                        ) : (
                          <Text style={styles.boostHint}>
                            Matches your recent average ({typicalKcal.toLocaleString()} cal).
                          </Text>
                        )
                      )}
                      {typicalKcal === null && !noActiveEnergy && (
                        <Text style={styles.boostHint}>
                          Apple Health hasn't recorded enough days yet to work out your average.
                        </Text>
                      )}
                      {/* The whole row opens the Health app, the same shape the
                          "turn the read on" card above uses. Suppresses the
                          "not enough days" line, since one actionable sentence
                          beats two overlapping ones. */}
                      {noActiveEnergy && (
                        <TouchableOpacity
                          style={[styles.boostNotice, styles.boostNoticeNested]}
                          activeOpacity={interaction.activeOpacity}
                          onPress={() => { haptics.tap(); void openHealthApp(); }}
                          accessibilityRole="button"
                          accessibilityLabel="Open the Health app to allow active energy"
                          accessibilityHint="Opens Apple Health, where you can allow this app to read Active Energy"
                        >
                          <Ionicons name="flame-outline" size={iconSize.sm} color={colors.textSecondary} />
                          <Text style={styles.boostNoticeText}>
                            No active calories recorded yet today. If they never appear, open the
                            Health app and allow this app to read Active Energy.
                          </Text>
                          <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}
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
    dailyValueAction: { alignSelf: 'flex-start' },
    row: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    rowLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
    boostNotice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    boostNoticeText: { flex: 1, color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
    // The same row one level in, where the card around it is already
    // `bgSecondary`: at that colour it would read as part of the card rather
    // than as its own block, so it steps up a surface the way a nested
    // control does.
    boostNoticeNested: { backgroundColor: colors.bgTertiary },
    boostCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
    },
    boostToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
    },
    boostToggleLabel: { color: colors.text, fontSize: font.sm },
    boostFields: {
      borderTopWidth: border.hairline,
      borderTopColor: colors.separator,
      padding: spacing.md,
      gap: spacing.sm,
    },
    boostFieldRow: { gap: spacing.sm },
    boostFieldLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
    boostHint: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
  });
}
