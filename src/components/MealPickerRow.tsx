import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing } from '../theme';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, type MealSlot } from '../types/mealPlan';
import { animateLayout } from '../utils/layoutAnimation';
import { SegmentedControl } from './SegmentedControl';

interface Props {
  value: MealSlot | null;
  onChange: (next: MealSlot | null) => void;
  /** What no meal is called here: "Other" in most sheets, "None" where nothing is filed. */
  noneLabel?: string;
}

/**
 * "Which meal" as a segmented control that is always on screen: the five
 * choices in a three-column track, with the current one raised. It used to
 * collapse behind a `Which meal … Lunch ⌄` row, but the extra tap to see or
 * change a choice that files the log wasn't worth the height saved. A single
 * row of five truncates "Breakfast" at larger text sizes (see
 * `SegmentedControl`'s doc comment), hence the two rows. Every sheet that
 * files a log under a meal uses this, so they read the same and sit in the
 * same place, at the top.
 */
export function MealPickerRow({ value, onChange, noneLabel = 'Other' }: Props) {
  const options = useMemo(() => [
    ...MEAL_SLOTS.map(s => ({ value: s as MealSlot | null, label: MEAL_SLOT_LABELS[s] })),
    { value: null as MealSlot | null, label: noneLabel },
  ], [noneLabel]);

  return (
    <View style={styles.wrap}>
      <SegmentedControl<MealSlot | null>
        options={options}
        value={value}
        onChange={next => { animateLayout(); onChange(next); }}
        columns={3}
        label="Which meal"
        surface="page"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Margin on both sides, so whatever sits above or below it is never jammed
  // against the control.
  wrap: { marginVertical: spacing.smd },
});
