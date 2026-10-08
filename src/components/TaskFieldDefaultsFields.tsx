import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
import { EFFORT_LABELS, type Difficulty, type Effort, type Priority, type TaskFieldDefaults } from '../types';
import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import { DIFFICULTY_SEGMENTS } from '../utils/rewards';
import { effortTimeLabel } from '../utils/effort';
import { ESTIMATE_EFFORTS } from '../utils/fieldBackfill';
import { NO_TASK_FIELD_DEFAULTS, hasTaskFieldDefaults } from '../utils/taskFieldDefaults';

interface Props {
  value: TaskFieldDefaults | null | undefined;
  onChange: (next: TaskFieldDefaults | null) => void;
  /** Whether to ask for a difficulty. Off with rewards, which are all that read one. */
  showDifficulty: boolean;
}

// `null` in a segmented control can't be a "no answer" the way a missing field
// is, so each set leads with it as a named option. "Ask each time" is the state
// every field starts in: the backfill screen asks about it as before.
const PRIORITY_OPTIONS: SegmentOption<Priority | null>[] = [
  { value: null, label: 'Ask each time' },
  { value: 0, label: 'No priority' },
  ...PRIORITY_SEGMENTS.filter(s => s.value !== 0),
];

const DIFFICULTY_OPTIONS: SegmentOption<Difficulty | null>[] = [
  { value: null, label: 'Ask each time' },
  ...DIFFICULTY_SEGMENTS,
];

const ESTIMATE_OPTIONS: SegmentOption<Effort | null>[] = [
  { value: null, label: 'Ask each time' },
  { value: 0, label: 'No estimate' },
  ...ESTIMATE_EFFORTS.map(e => ({
    value: e as Effort | null,
    // The time, not the size letter: the letter is only a name for these
    // minutes, and a picker that shows just "XS" makes you remember what it is.
    label: effortTimeLabel(e, EFFORT_LABELS[e]),
  })),
];

/**
 * The three answers the backfill screen asks about each task, as controls, for
 * a place that can answer them once for a whole group: a project's editor and a
 * kind of generated task in Settings. One component for both so the two can't
 * word or order them differently.
 */
export function TaskFieldDefaultsFields({ value, onChange, showDifficulty }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = value ?? NO_TASK_FIELD_DEFAULTS;
  const set = (patch: Partial<TaskFieldDefaults>) => {
    const next = { ...current, ...patch };
    onChange(hasTaskFieldDefaults(next) ? next : null);
  };
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Priority</Text>
      <SegmentedControl<Priority | null>
        label="Default priority"
        value={current.priority}
        onChange={priority => set({ priority })}
        columns={3}
        options={PRIORITY_OPTIONS}
      />
      {showDifficulty && (
        <>
          <Text style={styles.label}>Difficulty</Text>
          <SegmentedControl<Difficulty | null>
            label="Default difficulty"
            value={current.difficulty}
            onChange={difficulty => set({ difficulty })}
            columns={2}
            options={DIFFICULTY_OPTIONS}
          />
        </>
      )}
      <Text style={styles.label}>Time estimate</Text>
      <SegmentedControl<Effort | null>
        label="Default time estimate"
        value={current.effort}
        onChange={effort => set({ effort })}
        columns={3}
        options={ESTIMATE_OPTIONS}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: { gap: spacing.sm },
  label: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
