import React, { useMemo, useState } from 'react';
import { View, Platform } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { CountStepper } from '../../components/CountStepper';
import { MaxHeartRateSheet } from '../../components/MaxHeartRateSheet';
import type { WeightUnit } from '../../utils/weightLog';
import { REST_SECONDS_MAX, REST_SECONDS_MIN, formatRestSeconds } from '../../utils/workoutData';
import { describeMaxHeartRate, resolveMaxHeartRate } from '../../utils/heartRateZones';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';

/**
 * The Workouts area's own settings: the unit, the default rest, the Live
 * Activity and the maximum heart rate the zones are measured against.
 *
 * These were a section of Apple Health until Workouts got a menu row of its
 * own. That group is `iosOnly`, so the unit and the rest timer couldn't be set
 * off iOS at all; this group is gated by the Workouts switch instead
 * (`workoutsOnly`), the way Groceries & meals is gated by its own.
 *
 * **Two things stay where they were, deliberately.** The switch that writes
 * workouts to Health is in Apple Health › Log to Health, beside every other
 * thing the app writes there and the access row that goes with it, and the
 * footer below says so. The Workouts switch itself is in Feature areas, for
 * the reason `KitchenSettings` gives: a group that vanishes when its switch is
 * off can't hold the switch.
 */
export function WorkoutsSettings() {
  const workoutUnit = useSettingsStore(s => s.workoutUnit);
  const setWorkoutUnit = useSettingsStore(s => s.setWorkoutUnit);
  const defaultRestSeconds = useSettingsStore(s => s.defaultRestSeconds);
  const setDefaultRestSeconds = useSettingsStore(s => s.setDefaultRestSeconds);
  const workoutLiveActivity = useSettingsStore(s => s.workoutLiveActivity);
  const setWorkoutLiveActivity = useSettingsStore(s => s.setWorkoutLiveActivity);
  const maxHeartRate = useSettingsStore(s => s.maxHeartRate);
  const birthYear = useSettingsStore(s => s.bodyProfile.birthYear);
  const [maxHeartRateOpen, setMaxHeartRateOpen] = useState(false);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  return (
    <>
      <SettingsSection
        label="Workouts"
        footer={Platform.OS === 'ios'
          ? 'Weights are stored in kilograms either way, so switching units changes only what workouts show and step by. Saving workouts to Apple Health is under Apple Health › Log to Health, with everything else the app writes there.'
          : 'Weights are stored in kilograms either way, so switching units changes only what workouts show and step by.'}
      >
        <SettingsRow
          entryId="workoutUnit"
          icon="barbell-outline"
          label="Workout weights"
          value={workoutUnit === 'kg' ? 'Kilograms' : 'Pounds'}
          tight
        />
        <SettingsSegments
          attached
          label="Workout weights"
          options={[
            { value: 'kg' as WeightUnit, label: 'kg' },
            { value: 'lb' as WeightUnit, label: 'lb' },
          ]}
          selected={workoutUnit}
          onSelect={unit => setWorkoutUnit(unit)}
          accessibilityLabelFor={o => (o.value === 'kg' ? 'Kilograms' : 'Pounds')}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="defaultRestSeconds"
          icon="timer-outline"
          label="Rest between sets"
          hint="The rest timer after a set, for an exercise whose routine doesn’t set its own."
          tight
        />
        <View style={styles.cadenceRow}>
          <CountStepper
            value={defaultRestSeconds}
            onChange={next => { if (next !== null) setDefaultRestSeconds(next); }}
            min={REST_SECONDS_MIN}
            max={REST_SECONDS_MAX}
            step={15}
            format={formatRestSeconds}
            label="Rest between sets"
            describeValue={n => (n === null ? 'not set' : `${n} seconds`)}
          />
        </View>
        {/* Both iOS-only rows, as their index entries say: a Live Activity and
            heart rate from Health exist nowhere else. */}
        {Platform.OS === 'ios' && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              entryId="workoutLiveActivity"
              icon="phone-portrait-outline"
              iconColor={workoutLiveActivity ? colors.accent : undefined}
              label="Live Activity while working out"
              hint={workoutLiveActivity
                ? 'The set you’re on and the rest countdown show on the Lock Screen and Dynamic Island, with buttons to finish a set or skip the rest'
                : 'Workouts stay in the app only'}
              toggle={workoutLiveActivity}
              onPress={() => setWorkoutLiveActivity(!workoutLiveActivity)}
            />
            <View style={styles.sep} />
            <SettingsRow
              entryId="maxHeartRate"
              icon="heart-outline"
              label="Maximum heart rate"
              hint="Used to split a workout’s heart rate into five zones. Estimated as 220 minus your age until you set it. Your age comes from your year of birth in Settings › Apple Health."
              // "186, from age" while it is the estimate: it says so wherever it shows.
              value={describeMaxHeartRate(resolveMaxHeartRate(maxHeartRate, birthYear, new Date()))}
              onPress={() => { haptics.tap(); setMaxHeartRateOpen(true); }}
            />
          </>
        )}
      </SettingsSection>
      <MaxHeartRateSheet
        visible={Platform.OS === 'ios' && maxHeartRateOpen}
        onClose={() => setMaxHeartRateOpen(false)}
      />
    </>
  );
}
