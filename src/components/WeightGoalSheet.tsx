import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart, getLogicalToday } from '../utils/dateUtils';
import {
  formatWeight,
  kgToUnit,
  parseWeightInput,
  unitToKg,
  type WeightUnit,
} from '../utils/weightLog';
import {
  RATE_RANGE,
  goalDirection,
  type WeightGoal,
  type WeightGoalDirection,
} from '../utils/weightGoal';
import {
  ACTIVITY_LABEL,
  ACTIVITY_LEVELS,
  EMPTY_BODY_PROFILE,
  MACRO_PRESETS,
  MAX_HEIGHT_CM,
  MIN_BIRTH_YEAR,
  MIN_HEIGHT_CM,
  budgetFromMaintenance,
  calorieBudget,
  cmToFeetInches,
  feetInchesToCm,
  isProfileComplete,
  macroGrams,
  DIGESTION_SHARE,
  measuredMaintenanceKcal,
  type ActivityLevel,
  type BodyProfile,
  type BodySex,
} from '../utils/energyBudget';
import {
  typicalActiveEnergyKcal,
  TYPICAL_ACTIVE_ENERGY_WINDOW_DAYS,
} from '../utils/activeEnergyBoost';
import { useHealthStore } from '../store/useHealthStore';
import { EditorSheet } from './EditorSheet';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';

// The feet stepper's bounds, derived from the same cm bounds the kg stepper
// uses — so the two units can't drift into disagreeing about the range.
const MIN_HEIGHT_FEET = cmToFeetInches(MIN_HEIGHT_CM).feet;
const MAX_HEIGHT_FEET = cmToFeetInches(MAX_HEIGHT_CM).feet;

// Where + lands the first time a stepper is turned on from empty, for the
// two fields whose `min` is an absurdity floor rather than a plausible
// value — 50cm and 1900 are there to catch nonsense, not to be landed on.
// The midpoint of the field's own valid range is a starting point that
// doesn't presume anything about who's using it, just splits the bound the
// app already draws. Height's cm and feet starts are the same point in two
// units, so switching `weightUnit` can't make the field seem to jump.
const HEIGHT_START_CM = Math.round((MIN_HEIGHT_CM + MAX_HEIGHT_CM) / 2);
const HEIGHT_START_FEET = cmToFeetInches(HEIGHT_START_CM).feet;

/**
 * Setting a weight goal, and the calorie figure it implies.
 *
 * **The goal itself is entirely typed in** — no suggested target, no
 * recommended rate, nothing filled in from a body. The calorie figure is
 * arithmetic over the fields above it, printed with its own working shown.
 * `energyBudget.ts` gives the long version of why that matters.
 *
 * **The plain calorie figure is the one asked-for exception to "stays a
 * suggestion until applied."** Saving this sheet writes it straight to
 * `nutritionTargets.calorieKcal`, and `useSettingsStore.syncWeightGoalCalorieTarget`
 * keeps it in step afterward too, on a body-profile edit or a fresh weigh-in,
 * so the food log target doesn't quietly go stale the moment the goal isn't
 * being looked at. See `autoCalorieTargetKcal` in `weightGoal.ts` for the
 * reasoning and the scope of the exception — it stops at the plain figure:
 * macros stay opt-in via the button below, same as before.
 *

 * **An `EditorSheet` (full screen) rather than a page sheet**, so the staged
 * form has no swipe-down to lose it — the same answer `LogWeightSheet` takes,
 * and the reason there is no `handleCancel` confirm here.
 *
 * **The starting weight is captured once, when the goal is saved.** Progress is
 * measured from it, so re-reading it later would move the line somebody is
 * measuring against and quietly rewrite their history. Editing an existing goal
 * keeps the original start rather than restamping it, which is why `start` is
 * seeded from the stored goal where there is one.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The most recent weigh-in, for seeding the starting weight of a new goal. */
  currentKg: number | null;
  /**
   * Opens the weigh-in sheet, for the dead end below. Omit where there's
   * nowhere else to send someone (there isn't one on every screen that opens
   * this sheet) and the plain explanation is all there is to show.
   */
  onLogWeight?: () => void;
}

export function WeightGoalSheet({ visible, onClose, currentKg, onLogWeight }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const unit = useSettingsStore(s => s.weightUnit);
  const storedGoal = useSettingsStore(useShallow(s => s.weightGoal));
  const storedProfile = useSettingsStore(useShallow(s => s.bodyProfile));
  const storedTargets = useSettingsStore(useShallow(s => s.nutritionTargets));
  const setWeightGoal = useSettingsStore(s => s.setWeightGoal);
  const setBodyProfile = useSettingsStore(s => s.setBodyProfile);
  const setNutritionTarget = useSettingsStore(s => s.setNutritionTarget);

  const currentYear = getLogicalToday().getFullYear();
  // Same reasoning as HEIGHT_START_CM above: the midpoint of the stepper's
  // own range, not a guess about how old anyone actually is. Computed here
  // rather than as a module constant because it moves with the day.
  const birthYearStart = Math.round((MIN_BIRTH_YEAR + currentYear) / 2);

  const [direction, setDirection] = useState<WeightGoalDirection>('lose');
  const [targetText, setTargetText] = useState('');
  // In the *display* unit. Converted on save, so switching kg/lb while the
  // sheet is shut can't leave a half-converted number in the field.
  const [rate, setRate] = useState<number | null>(RATE_RANGE[unit].default);
  // Canonical when weighing in kg; the ft/in pair when weighing in lb. Only
  // one of the two is live at a time (`unit`), the other stays at its seed.
  const [heightCmVal, setHeightCmVal] = useState<number | null>(null);
  const [heightFeet, setHeightFeet] = useState<number | null>(null);
  const [heightInches, setHeightInches] = useState(0);
  const [birthYear, setBirthYear] = useState<number | null>(null);
  const [sex, setSex] = useState<BodySex | null>(null);
  const [activity, setActivity] = useState<ActivityLevel>('sedentary');
  /**
   * Which way the maintenance figure is worked out: the multiplier over the
   * activity level above, or Apple Health's own measurement of a recent
   * typical day.
   *
   * **Defaults to the multiplier even when a measurement exists**, and stays
   * unpersisted, for the same reason `macroPresetId` preselects nothing: the
   * app is offering two ways to arrive at a number rather than ranking them,
   * and `measuredMaintenanceKcal` says at length why neither is the one that
   * is simply right. Opening on the measured figure would be the app deciding
   * that somebody's watch knows them better than they do.
   */
  const [measuredBasis, setMeasuredBasis] = useState(false);
  /**
   * A typical recent day's active energy, or null once looked up and not
   * answerable. Read while the sheet is open and kept nowhere, exactly as
   * `NutritionTargetsSheet` reads the same figure for the same reason.
   */
  const [typicalActiveKcal, setTypicalActiveKcal] = useState<number | null>(null);
  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  // Nothing preselected, and not persisted: a split is a one-off choice made
  // when applying targets, not a setting. See MACRO_PRESETS on why the app has
  // no opinion about which one.
  const [macroPresetId, setMacroPresetId] = useState<string | null>(null);

  // What a recent typical day of this person's actually recorded, fetched while
  // the sheet is open and stored nowhere. Cleared rather than kept when the
  // read cannot be made, so a revoked Health permission takes the measured
  // option away with it instead of leaving the last figure on screen.
  useEffect(() => {
    if (!visible || !healthReadEnabled) {
      setTypicalActiveKcal(null);
      return;
    }
    let live = true;
    void useHealthStore
      .getState()
      .readRecentActiveEnergy(TYPICAL_ACTIVE_ENERGY_WINDOW_DAYS)
      .then(days => {
        if (live) setTypicalActiveKcal(days === null ? null : typicalActiveEnergyKcal(days));
      });
    return () => { live = false; };
  }, [visible, healthReadEnabled]);

  // Seeded on each open rather than on mount: the sheet stays mounted across
  // visibility toggles, and a form still holding last time's numbers would
  // silently save them over a goal edited elsewhere.
  useEffect(() => {
    if (!visible) return;
    const profile = storedProfile ?? EMPTY_BODY_PROFILE;
    if (profile.heightCm === null) {
      setHeightCmVal(null);
      setHeightFeet(null);
      setHeightInches(0);
    } else if (unit === 'kg') {
      setHeightCmVal(Math.round(profile.heightCm));
    } else {
      const { feet, inches } = cmToFeetInches(profile.heightCm);
      setHeightFeet(feet);
      setHeightInches(inches);
    }
    setBirthYear(profile.birthYear);
    setSex(profile.sex);
    setActivity(profile.activity);
    setMacroPresetId(null);
    // Reset with the rest of the form: the basis is a choice about this
    // sitting, not a setting, so a sheet reopened later opens on the
    // multiplier again rather than on whatever was picked last time.
    setMeasuredBasis(false);

    if (storedGoal) {
      setDirection(goalDirection(storedGoal));
      setTargetText(kgToUnit(storedGoal.targetKg, unit).toFixed(1));
      setRate(round(kgToUnit(storedGoal.rateKgPerWeek, unit), RATE_RANGE[unit].step));
    } else {
      setDirection('lose');
      setTargetText('');
      setRate(RATE_RANGE[unit].default);
    }
    // Deliberately keyed on `visible` alone: this is a seed, and re-running it
    // when the stored values change under an open sheet would throw away what
    // is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const maintaining = direction === 'maintain';

  /**
   * The weight progress is measured from.
   *
   * An existing goal keeps the weight it was set at, so editing the rate does
   * not rewrite the history somebody is being measured against. **Maintain is
   * the exception and has to be**: a maintain goal is "hold where I am now",
   * and the direction is derived from the target against the start
   * (`goalDirection`), so anchoring it to a start from eight weeks and four
   * kilograms ago would both aim at the wrong number and read back as a losing
   * goal. Switching to Maintain therefore begins a new phase from today's
   * weight, which is also the only reading of the word that means anything.
   */
  const startKg = maintaining
    ? (currentKg ?? storedGoal?.startKg ?? null)
    : (storedGoal?.startKg ?? currentKg);
  const targetKg = maintaining ? startKg : parseWeightInput(targetText, unit);
  const rateKg = rate === null ? null : unitToKg(rate, unit);
  // A start that isn't the stored one is a new phase, so the pace line restarts
  // from today rather than from whenever the previous goal began.
  const restarting = storedGoal === null || startKg !== storedGoal.startKg;

  const profile: BodyProfile = {
    heightCm:
      unit === 'kg' ? heightCmVal : heightFeet === null ? null : feetInchesToCm(heightFeet, heightInches),
    birthYear,
    sex,
    activity,
  };

  const canSave =
    startKg !== null &&
    targetKg !== null &&
    (maintaining || (rateKg !== null && rateKg > 0)) &&
    // A target on the wrong side of the start is a direction that disagrees
    // with itself. Refusing to save says so before the goal exists, which
    // beats saving one whose own `goalDirection` contradicts what was picked.
    (maintaining || (direction === 'lose' ? targetKg < startKg : targetKg > startKg));

  // The budget is worked out against the weight *now* rather than the goal's
  // start: what to eat today depends on today's body, and a figure anchored to
  // a weight from eight weeks ago gets steadily wronger as the goal succeeds.
  const budgetWeightKg = currentKg ?? startKg;
  const signedRateKg =
    maintaining || rateKg === null ? 0 : direction === 'lose' ? -rateKg : rateKg;
  const multiplierBudget =
    budgetWeightKg === null
      ? null
      : calorieBudget(profile, budgetWeightKg, signedRateKg, getLogicalToday());
  const measuredBudget =
    budgetWeightKg === null
      ? null
      : budgetFromMaintenance(
        measuredMaintenanceKcal(profile, budgetWeightKg, getLogicalToday(), typicalActiveKcal),
        sex,
        signedRateKg,
      );
  // Offered only when there is a real measurement behind it. A control with one
  // working option is a control that lies about having a choice, so the picker
  // below renders only while this holds.
  const canUseMeasured = measuredBudget !== null;
  const budget = measuredBasis && measuredBudget !== null ? measuredBudget : multiplierBudget;

  const save = () => {
    if (!canSave || startKg === null || targetKg === null) return;
    haptics.success();
    setBodyProfile(profile);
    setWeightGoal({
      startKg,
      // An existing goal keeps the day it was set on, so editing the rate
      // doesn't restart the pace line somebody is already measured against.
      // A goal re-anchored to a new starting weight is a new phase and does.
      startDayKey: restarting || !storedGoal
        ? dayKeyOf(getCurrentDayStart())
        : storedGoal.startDayKey,
      targetKg,
      rateKgPerWeek: maintaining ? 0 : (rateKg ?? 0),
    });
    // Keeps the food log's calorie target in step with the goal automatically
    // — see autoCalorieTargetKcal's doc comment. Whichever basis (multiplier
    // or measured) is on screen right now is the one that gets written; a
    // later weigh-in or profile edit re-syncs on the multiplier basis, via
    // useSettingsStore.syncWeightGoalCalorieTarget.
    if (budget !== null) setNutritionTarget('calorieKcal', budget.proposedKcal);
    onClose();
  };

  const clear = () => {
    Alert.alert('Remove this goal?', 'Your weigh-ins stay in Apple Health either way.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          haptics.warning();
          setWeightGoal(null);
          onClose();
        },
      },
    ]);
  };

  const applyCalorieTarget = () => {
    if (!budget) return;
    haptics.success();
    setBodyProfile(profile);
    setNutritionTarget('calorieKcal', budget.proposedKcal);
  };

  const macroPreset = MACRO_PRESETS.find(p => p.id === macroPresetId) ?? null;
  const macros = budget === null || macroPreset === null
    ? null
    : macroGrams(budget.proposedKcal, macroPreset.split);

  // Writes the calorie target alongside the three macros, because a macro
  // target that doesn't add up to the calorie figure it was split out of is
  // three numbers with nothing holding them together.
  const applyMacroTargets = () => {
    if (!budget || !macros) return;
    haptics.success();
    setBodyProfile(profile);
    setNutritionTarget('calorieKcal', budget.proposedKcal);
    setNutritionTarget('proteinG', macros.proteinG);
    setNutritionTarget('carbsG', macros.carbsG);
    setNutritionTarget('fatG', macros.fatG);
  };

  const existingCalorieTarget = storedTargets.calorieKcal;
  const alreadyApplied = budget !== null && existingCalorieTarget === budget.proposedKcal;
  const rateRange = RATE_RANGE[unit];

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title="Weight goal"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />}
          right={<SheetHeaderButton label="Save" onPress={save} disabled={!canSave} minWidth={64} />}
        />
      }
    >
      {startKg === null ? (
        <>
          <Text style={styles.footnote}>
            Record a weight first. A goal is measured from where you started, so
            there is nothing to set one against yet.
          </Text>
          {onLogWeight && (
            <InlineAction
              icon="add-circle-outline"
              label="Record a weight"
              onPress={() => { haptics.tap(); onClose(); onLogWeight(); }}
            />
          )}
        </>
      ) : (
        <>
          <Text style={styles.sectionTitle}>THE GOAL</Text>
          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Aim to</Text>
              <SegmentedControl
                options={[
                  { value: 'lose' as WeightGoalDirection, label: 'Lose' },
                  { value: 'maintain' as WeightGoalDirection, label: 'Maintain' },
                  { value: 'gain' as WeightGoalDirection, label: 'Gain' },
                ]}
                value={direction}
                onChange={next => { haptics.tap(); setDirection(next); }}
                label="Aim to"
              />
            </View>

            {!maintaining && (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Target weight</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      value={targetText}
                      onChangeText={setTargetText}
                      keyboardType="decimal-pad"
                      placeholder={`e.g. ${suggestPlaceholder(startKg, direction, unit)}`}
                      placeholderTextColor={colors.textTertiary}
                      accessibilityLabel={`Target weight in ${unit === 'kg' ? 'kilograms' : 'pounds'}`}
                    />
                    <Text style={styles.unit}>{unit}</Text>
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Rate</Text>
                  <View style={styles.stepperRow}>
                    <Text style={styles.stepperCaption}>{unit} per week</Text>
                    <CountStepper
                      value={rate}
                      onChange={setRate}
                      min={rateRange.min}
                      max={rateRange.max}
                      step={rateRange.step}
                      format={n => n.toFixed(unit === 'kg' ? 1 : 2)}
                      label="Rate"
                      describeValue={n =>
                        n === null ? 'not set' : `${n} ${unit} per week`}
                    />
                  </View>
                </View>
              </>
            )}

            <Text style={styles.help}>
              {maintaining
                ? `Holding ${formatWeight(startKg, unit)}, your latest weigh-in.`
                : `Measured from ${formatWeight(startKg, unit)}${restarting ? ', your latest weigh-in.' : ', where this goal started.'}`}
            </Text>
          </View>

          {!canSave && !maintaining && targetKg !== null && (
            <Text style={styles.warning}>
              A target to {direction} has to be {direction === 'lose' ? 'below' : 'above'}{' '}
              {formatWeight(startKg, unit)}.
            </Text>
          )}

          <Text style={styles.sectionTitle}>FOR THE CALORIE ESTIMATE</Text>
          <View style={styles.card}>
            <Text style={styles.help}>
              Used only to calculate the figure below. Nothing else in the app reads
              these, and they are never sent anywhere or written to Apple Health.
            </Text>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Height</Text>
              {unit === 'kg' ? (
                <CountStepper
                  value={heightCmVal}
                  onChange={setHeightCmVal}
                  min={MIN_HEIGHT_CM}
                  max={MAX_HEIGHT_CM}
                  allowNull
                  start={HEIGHT_START_CM}
                  format={n => `${n} cm`}
                  label="Height"
                />
              ) : (
                <View style={styles.inputRow}>
                  <CountStepper
                    value={heightFeet}
                    onChange={next => {
                      setHeightFeet(next);
                      if (next === null) setHeightInches(0);
                    }}
                    min={MIN_HEIGHT_FEET}
                    max={MAX_HEIGHT_FEET}
                    allowNull
                    start={HEIGHT_START_FEET}
                    format={n => `${n}′`}
                    label="Height, feet"
                  />
                  <CountStepper
                    value={heightInches}
                    onChange={next => setHeightInches(next ?? 0)}
                    min={0}
                    max={11}
                    format={n => `${n}″`}
                    label="Height, inches"
                  />
                </View>
              )}
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Year of birth</Text>
              <CountStepper
                value={birthYear}
                onChange={setBirthYear}
                min={MIN_BIRTH_YEAR}
                max={currentYear}
                allowNull
                start={birthYearStart}
                label="Year of birth"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Sex</Text>
              {/* The value is deliberately nullable and starts null, so neither
                  segment is raised until one is picked. Defaulting the control
                  to Female would show a choice nobody made — and would then
                  disagree with the estimate below, which correctly reports the
                  field as missing. Nothing here fills a field in. */}
              <SegmentedControl
                options={[
                  { value: 'female' as BodySex | null, label: 'Female' },
                  { value: 'male' as BodySex | null, label: 'Male' },
                ]}
                value={sex}
                onChange={next => { haptics.tap(); setSex(next); }}
                label="Sex"
              />
              <Text style={styles.help}>
                The calorie equation has two forms, and this picks which one is
                used. It is not stored for any other purpose.
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Activity</Text>
              <SegmentedControl
                options={ACTIVITY_LEVELS.map(level => ({
                  value: level,
                  label: ACTIVITY_LABEL[level].label,
                }))}
                value={activity}
                onChange={next => { haptics.tap(); setActivity(next); }}
                columns={2}
                label="Activity"
              />
              <Text style={styles.help}>{ACTIVITY_LABEL[activity].hint}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>DAILY CALORIES</Text>
          <View style={styles.card}>
            {budget === null ? (
              <Text style={styles.help}>
                {isProfileComplete(profile)
                  ? 'Record a weight to work this out.'
                  : 'Fill in height, year of birth and sex above to see a figure here.'}
              </Text>
            ) : (
              <>
                <Text style={styles.budgetValue}>
                  {budget.proposedKcal.toLocaleString()} cal a day
                </Text>
                {/* Only once there is a real measurement to offer. The two
                    are presented as two ways of arriving at the same figure,
                    in the order that puts the one somebody typed first, and
                    `measuredMaintenanceKcal` explains why neither is ranked
                    above the other. */}
                {canUseMeasured && (
                  <View style={styles.field}>
                    <SegmentedControl
                      options={[
                        { value: false, label: 'Activity level' },
                        { value: true, label: 'Apple Health' },
                      ]}
                      value={measuredBasis}
                      onChange={next => { haptics.tap(); setMeasuredBasis(next); }}
                      label="How activity is counted"
                    />
                    <Text style={styles.help}>
                      {measuredBasis
                        ? `Your resting rate plus ${(typicalActiveKcal ?? 0).toLocaleString()} cal, the active calories in a typical recent day of yours, plus about ${Math.round(budget.maintenanceKcal * DIGESTION_SHARE).toLocaleString()} cal for digesting food (about a tenth of what you eat). To also add a day when you move more than usual, turn on Add active calories under Daily targets.`
                        : `The activity level you picked above, as a multiplier on your resting rate.`}
                    </Text>
                  </View>
                )}
                <View style={styles.workingRow}>
                  <Text style={styles.workingLabel}>To hold your weight</Text>
                  <Text style={styles.workingValue}>
                    {budget.maintenanceKcal.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.workingRow}>
                  <Text style={styles.workingLabel}>
                    {maintaining ? 'No change' : `To ${direction} ${formatRate(rate, unit)} a week`}
                  </Text>
                  <Text style={styles.workingValue}>
                    {budget.adjustmentKcal > 0 ? '+' : ''}
                    {budget.adjustmentKcal.toLocaleString()}
                  </Text>
                </View>

                {budget.raisedToFloor && (
                  <Text style={styles.warning}>
                    The arithmetic came to {budget.arithmeticKcal.toLocaleString()} cal.
                    This app will not suggest below {budget.floorKcal.toLocaleString()},
                    so that is the figure shown. You can still set any target you
                    want under Daily targets.
                  </Text>
                )}

                <Text style={styles.help}>
                  {measuredBasis
                    ? 'Still an estimate: the resting rate comes from a population formula (Mifflin-St Jeor), digestion is a rule of thumb, and only the activity is measured. Treat it as a starting point and adjust it against what the scale actually does.'
                    : 'An estimate from a population formula (Mifflin-St Jeor), not a measurement of you. Treat it as a starting point and adjust it against what the scale actually does.'}
                </Text>

                {alreadyApplied ? (
                  <Text style={styles.appliedNote}>
                    This is your calorie target.
                  </Text>
                ) : (
                  <InlineAction
                    icon="flag-outline"
                    label={
                      existingCalorieTarget === undefined
                        ? 'Use as my calorie target'
                        : `Replace my target (${existingCalorieTarget.toLocaleString()})`
                    }
                    onPress={applyCalorieTarget}
                  />
                )}
              </>
            )}
          </View>

          {budget !== null && (
            <>
              <Text style={styles.sectionTitle}>MACROS</Text>
              <View style={styles.card}>
                <Text style={styles.help}>
                  Optional, and nothing is picked for you. Each of these is a common
                  way to divide a day's calories, not a recommendation. Pick one to
                  see what it comes out to, or leave this alone and set the three
                  numbers yourself under Daily targets.
                </Text>

                <SegmentedControl
                  options={MACRO_PRESETS.map(preset => ({
                    value: preset.id as string | null,
                    label: preset.label,
                  }))}
                  value={macroPresetId}
                  onChange={next => { haptics.tap(); setMacroPresetId(next); }}
                  columns={2}
                  label="Macro split"
                />

                {macroPreset !== null && macros !== null && (
                  <>
                    <View style={styles.macroRow}>
                      <MacroCell styles={styles} label="Protein" grams={macros.proteinG}
                        percent={macroPreset.split.proteinPct} />
                      <MacroCell styles={styles} label="Carbs" grams={macros.carbsG}
                        percent={macroPreset.split.carbsPct} />
                      <MacroCell styles={styles} label="Fat" grams={macros.fatG}
                        percent={macroPreset.split.fatPct} />
                    </View>
                    <InlineAction
                      icon="flag-outline"
                      label="Use these as my targets"
                      onPress={applyMacroTargets}
                    />
                    <Text style={styles.help}>
                      Sets calories as well, so the four numbers agree with each other.
                    </Text>
                  </>
                )}
              </View>
            </>
          )}

          {storedGoal && (
            <InlineAction
              icon="trash-outline"
              label="Remove this goal"
              variant="neutral"
              onPress={clear}
            />
          )}
        </>
      )}
    </EditorSheet>
  );
}

interface MacroCellProps {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  grams: number;
  percent: number;
}

function MacroCell({ styles, label, grams, percent }: MacroCellProps) {
  return (
    <View style={styles.macroCell} accessible accessibilityLabel={`${label}, ${grams} grams, ${percent} percent`}>
      <Text style={styles.macroGrams}>{grams}g</Text>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroPercent}>{percent}%</Text>
    </View>
  );
}

/**
 * A placeholder target: a round number a short way the chosen direction from
 * where they are. An **example**, prefixed "e.g." at the call site, and never a
 * recommendation — see CLAUDE.md on placeholders that look like saved values.
 */
function suggestPlaceholder(startKg: number, direction: WeightGoalDirection, unit: WeightUnit): string {
  const shown = kgToUnit(startKg, unit);
  const step = unit === 'kg' ? 5 : 10;
  return (direction === 'lose' ? shown - step : shown + step).toFixed(0);
}

function formatRate(rate: number | null, unit: WeightUnit): string {
  if (rate === null) return `0 ${unit}`;
  return `${rate.toFixed(unit === 'kg' ? 1 : 2)} ${unit}`;
}

/** Snaps a converted rate back onto the display unit's own step grid. */
function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  field: { paddingVertical: spacing.sm },
  fieldLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // No lineHeight on an input — see LogWeightSheet's note and CLAUDE.md.
  input: { flex: 1, height: 44, fontSize: font.xl, fontWeight: fontWeight.bold, color: colors.text },
  unit: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.textSecondary },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperCaption: { fontSize: font.md, color: colors.text },
  help: {
    fontSize: font.xs,
    color: colors.textTertiary,
    lineHeight: 17,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  warning: {
    fontSize: font.xs,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  budgetValue: {
    fontSize: font.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  workingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xxs,
  },
  workingLabel: { flex: 1, fontSize: font.sm, color: colors.textSecondary },
  workingValue: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.text },
  appliedNote: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  macroRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  macroCell: {
    flex: 1,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  macroGrams: { fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text },
  macroLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
  macroPercent: { fontSize: font.xs, color: colors.textTertiary },
  footnote: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
});
