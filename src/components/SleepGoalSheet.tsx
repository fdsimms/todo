import React from 'react';
import { GoalStepperSheet } from './GoalStepperSheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { SLEEP_GOAL_RANGE, formatSleepDuration } from '../utils/sleepLog';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The hours a day's sleep is read against, set from the Sleep screen. The same
 * setting is also a row in Settings › Health. Nothing here suggests a figure:
 * the stepper's bounds (`SLEEP_GOAL_RANGE`) are an absurdity check, not advice.
 */
export function SleepGoalSheet({ visible, onClose }: Props) {
  const saved = useSettingsStore(s => s.sleepGoalMinutes);
  const setSleepGoalMinutes = useSettingsStore(s => s.setSleepGoalMinutes);
  return (
    <GoalStepperSheet
      visible={visible}
      onClose={onClose}
      name="SleepGoalSheet"
      heading="Sleep goal"
      hint="Hours asleep you want each day to reach. The Sleep screen draws it as a line and counts the days that reach it."
      saved={saved}
      onSave={setSleepGoalMinutes}
      range={SLEEP_GOAL_RANGE}
      format={formatSleepDuration}
      label="sleep goal"
    />
  );
}
