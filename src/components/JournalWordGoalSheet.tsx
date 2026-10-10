import React from 'react';
import { GoalStepperSheet } from './GoalStepperSheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { JOURNAL_WORD_GOAL_RANGE, formatWordCount } from '../utils/journal';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The words a day of journaling is read against, set from the Journal screen.
 * The same setting is also a row in Settings › Health.
 */
export function JournalWordGoalSheet({ visible, onClose }: Props) {
  const saved = useSettingsStore(s => s.journalWordGoal);
  const setJournalWordGoal = useSettingsStore(s => s.setJournalWordGoal);
  return (
    <GoalStepperSheet
      visible={visible}
      onClose={onClose}
      name="JournalWordGoalSheet"
      heading="Word goal"
      hint="Words you want each journal day to reach. The Journal shows each day's count against it and counts the days that reach it."
      saved={saved}
      onSave={setJournalWordGoal}
      range={JOURNAL_WORD_GOAL_RANGE}
      format={formatWordCount}
      label="word goal"
    />
  );
}
