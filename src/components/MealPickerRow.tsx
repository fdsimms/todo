import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { disclosureValue } from '../theme/textStyles';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, type MealSlot } from '../types/mealPlan';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { RotatingChevron } from './RotatingChevron';
import { SegmentedControl } from './SegmentedControl';

interface Props {
  value: MealSlot | null;
  onChange: (next: MealSlot | null) => void;
  /** What no meal is called here: "Other" in most sheets, "None" where nothing is filed. */
  noneLabel?: string;
}

/**
 * "Which meal" as one row: `Which meal … Lunch ⌄`, opening the five choices
 * in place and closing again once one is picked. The five labels in two rows
 * took more of a short sheet than the choice is worth, and a single row of
 * five truncates "Breakfast" at larger text sizes (see `SegmentedControl`'s
 * doc comment), so the options are tucked behind the row and the current
 * value stays on it. Every sheet that files a log under a meal uses this, so
 * they read the same and sit in the same place, at the top.
 */
export function MealPickerRow({ value, onChange, noneLabel = 'Other' }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  const labelFor = (slot: MealSlot | null) => (slot ? MEAL_SLOT_LABELS[slot] : noneLabel);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.row}
        activeOpacity={interaction.activeOpacity}
        onPress={() => { haptics.tap(); animateLayout(); setOpen(o => !o); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Which meal: ${labelFor(value)}`}
      >
        <Text style={styles.label}>Which meal</Text>
        <View style={styles.valueRow}>
          <Text style={styles.value} numberOfLines={1}>{labelFor(value)}</Text>
          <RotatingChevron open={open} size={14} color={colors.textSecondary} />
        </View>
      </TouchableOpacity>
      {open && (
        <View style={styles.options}>
          <SegmentedControl<MealSlot | null>
            options={[
              ...MEAL_SLOTS.map(s => ({ value: s as MealSlot | null, label: MEAL_SLOT_LABELS[s] })),
              { value: null, label: noneLabel },
            ]}
            value={value}
            onChange={next => { animateLayout(); onChange(next); setOpen(false); }}
            columns={3}
            label="Which meal"
            surface="page"
          />
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Margin on both sides, so whatever sits above or below it is never jammed
  // against the row.
  wrap: { marginVertical: spacing.smd },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  label: { color: colors.text, fontSize: font.md },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  value: { ...disclosureValue(colors), flexShrink: 1, textAlign: 'right' },
  options: { marginTop: spacing.sm },
});
