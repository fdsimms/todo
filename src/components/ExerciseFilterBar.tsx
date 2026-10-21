import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Exercise, ExerciseEquipment, MuscleGroup } from '../types';
import { ActiveFilterPill } from './ActiveFilterPill';
import { ChipFilterSheet } from './ChipFilterSheet';
import { InlineAction } from './InlineAction';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { useColors } from '../theme/ThemeContext';
import { spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { equipmentFilterOptions, muscleFilterOptions, type ExerciseFilters } from '../utils/exerciseCatalog';
import { EQUIPMENT_LABELS, MUSCLE_LABELS, type EquipmentGroup } from '../utils/workoutData';

const GROUP_OPTIONS: SegmentOption<EquipmentGroup | 'all'>[] = [
  { value: 'all', label: 'All' },
  { value: 'free', label: 'Weights' },
  { value: 'machine', label: 'Machines' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'cardio', label: 'Cardio' },
];

/** What an exercise list is narrowed by, held by the screen so it can feed `searchExercises`. */
export function useExerciseFilters() {
  const [group, setGroup] = useState<EquipmentGroup | 'all'>('all');
  const [muscles, setMuscles] = useState<MuscleGroup[]>([]);
  const [equipments, setEquipments] = useState<ExerciseEquipment[]>([]);
  const filters = useMemo<ExerciseFilters>(
    () => ({ group: group === 'all' ? null : group, muscles, equipments }),
    [group, muscles, equipments],
  );
  return {
    group, setGroup, muscles, setMuscles, equipments, setEquipments, filters,
    /** Anything set, the segmented control included. */
    narrowed: group !== 'all' || muscles.length > 0 || equipments.length > 0,
    clear: () => { setGroup('all'); setMuscles([]); setEquipments([]); },
  };
}

type Filters = ReturnType<typeof useExerciseFilters>;

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item]);

/**
 * The controls that narrow an exercise list: weights, machines, bodyweight or
 * cardio in one tap, then a sheet for muscles and specific equipment, with what
 * is picked shown as removable pills. The picker and the Exercises tab both
 * use it, so a change is made once. `leading` sits before the sheet's button
 * (the picker's "Create an exercise").
 *
 * The sheet is rendered here, so a host that is itself a Modal renders this
 * inside it: two sibling sheets can't both present (CLAUDE.md).
 */
export function ExerciseFilterBar({ state, exercises, leading }: {
  state: Filters;
  exercises: readonly Exercise[];
  leading?: React.ReactNode;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const muscleOptions = useMemo(() => muscleFilterOptions(exercises), [exercises]);
  const equipmentOptions = useMemo(() => equipmentFilterOptions(exercises), [exercises]);
  const count = state.muscles.length + state.equipments.length;

  return (
    <>
      <View style={styles.group}>
        <SegmentedControl
          options={GROUP_OPTIONS}
          value={state.group}
          onChange={g => { animateLayout(); state.setGroup(g); }}
          label="Kind of equipment"
          surface="page"
        />
      </View>
      <View style={styles.row}>
        {leading}
        <InlineAction
          icon="options-outline"
          label={count > 0 ? `Muscles & equipment (${count})` : 'Muscles & equipment'}
          variant="neutral"
          surface="page"
          onPress={() => { haptics.tap(); setOpen(true); }}
        />
      </View>
      {count > 0 && (
        <View style={styles.row}>
          {state.muscles.map(m => (
            <ActiveFilterPill key={m} label={MUSCLE_LABELS[m]} color={colors.accent}
              onRemove={() => { animateLayout(); state.setMuscles(prev => prev.filter(x => x !== m)); }} />
          ))}
          {state.equipments.map(q => (
            <ActiveFilterPill key={q} label={EQUIPMENT_LABELS[q]} color={colors.accent}
              onRemove={() => { animateLayout(); state.setEquipments(prev => prev.filter(x => x !== q)); }} />
          ))}
        </View>
      )}
      <ChipFilterSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Muscles & equipment"
        onClearAll={() => { state.setMuscles([]); state.setEquipments([]); }}
        groups={[
          {
            label: 'Muscle',
            options: muscleOptions.map(m => ({ key: m, label: MUSCLE_LABELS[m] })),
            selected: state.muscles,
            onToggle: k => state.setMuscles(prev => toggle(prev, k as MuscleGroup)),
            checkbox: true,
          },
          {
            label: 'Equipment',
            options: equipmentOptions.map(q => ({ key: q, label: EQUIPMENT_LABELS[q] })),
            selected: state.equipments,
            onToggle: k => state.setEquipments(prev => toggle(prev, k as ExerciseEquipment)),
            checkbox: true,
          },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  group: { paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
});
