import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { AlarmMission } from '../types';
import { spacing } from '../theme';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { CountStepper } from './CountStepper';
import { DEFAULT_MISSION } from '../utils/missions';
import { PUSHUP_MAX_COUNT } from '../utils/pushupCounter';

type MissionChoice = 'none' | AlarmMission['kind'];

const MISSION_OPTIONS: SegmentOption<MissionChoice>[] = [
  { value: 'none', label: 'None' },
  { value: 'pushups', label: 'Pushups' },
];

interface Props {
  value: AlarmMission | null;
  onChange: (next: AlarmMission | null) => void;
  /** The track's surface, for SegmentedControl's contrast: 'card' inside a card. */
  surface?: 'page' | 'card';
}

/**
 * Picks an alarm's or a task's mission: which kind, then its own settings
 * (a count, for pushups). One control for the task editor, the alarm editor
 * and the quick alarm, so a new kind is added in one place.
 */
export function MissionPicker({ value, onChange, surface = 'card' }: Props) {
  const choice: MissionChoice = value?.kind ?? 'none';
  return (
    <View style={styles.root}>
      <SegmentedControl
        label="Mission"
        options={MISSION_OPTIONS}
        value={choice}
        surface={surface}
        onChange={next => {
          if (next === 'none') onChange(null);
          else if (next !== choice) onChange({ ...DEFAULT_MISSION, kind: next });
        }}
      />
      {value?.kind === 'pushups' && (
        <CountStepper
          style={styles.stepper}
          value={value.count}
          onChange={n => onChange(n === null ? null : { kind: 'pushups', count: n })}
          min={1}
          max={PUSHUP_MAX_COUNT}
          label="Pushups"
          describeValue={n => (n === null ? 'no mission' : `${n} pushups`)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.smd },
  stepper: { alignSelf: 'flex-start' },
});
