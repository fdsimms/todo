import React from 'react';
import { GoalStepperSheet } from './GoalStepperSheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore } from '../store/useHealthStore';
import { getLogicalToday } from '../utils/dateUtils';
import { MIN_BIRTH_YEAR } from '../utils/energyBudget';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The year of birth, set from Settings › Apple Health. It is the same
 * `bodyProfile.birthYear` the weight goal sheet edits, so the calorie estimate
 * and a workout's heart rate zones read one value and either can be the place
 * it was entered: the zones no longer need the calorie budget set up first.
 *
 * Writes the whole profile with only the year changed (`setBodyProfile` takes
 * the form whole), then lets the weight-goal target follow it, since the age
 * term moves the calorie figure. Nothing here says what age is right: the
 * bounds are an absurdity check, as `ageFromBirthYear`'s are.
 */
export function YearOfBirthSheet({ visible, onClose }: Props) {
  const birthYear = useSettingsStore(s => s.bodyProfile.birthYear);
  const setBodyProfile = useSettingsStore(s => s.setBodyProfile);
  const currentYear = getLogicalToday().getFullYear();

  const save = (year: number | null) => {
    setBodyProfile({ ...useSettingsStore.getState().bodyProfile, birthYear: year });
    void useHealthStore.getState().syncWeightTargets();
  };

  return (
    <GoalStepperSheet
      visible={visible}
      onClose={onClose}
      name="YearOfBirthSheet"
      heading="Year of birth"
      hint="Used for the calorie estimate and to estimate your maximum heart rate. It isn’t sent anywhere or written to Apple Health."
      saved={birthYear}
      onSave={save}
      // Opens on the middle of the range, not a guess at anyone's age: same as
      // the weight goal sheet's stepper for this field.
      range={{ min: MIN_BIRTH_YEAR, max: currentYear, step: 1, start: Math.round((MIN_BIRTH_YEAR + currentYear) / 2) }}
      format={year => String(year)}
      label="year of birth"
      removeLabel="Clear year"
    />
  );
}
