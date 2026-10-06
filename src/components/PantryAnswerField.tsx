import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { pantryStanding, type PantryStanding } from '../utils/pantryStanding';
import type { PantryReviewAnswer } from '../utils/pantryReview';
import { SegmentedControl } from './SegmentedControl';

interface Props {
  itemId: string;
  /**
   * What the person has picked in this sheet, or null for nothing picked. Not
   * the item's current answer: that is shown by the control itself and never
   * flows back through here, so a null `value` means the sheet writes nothing.
   */
  value: PantryReviewAnswer | null;
  onChange: (answer: PantryReviewAnswer | null) => void;
  /** Names the group for screen readers. */
  label?: string;
  surface?: 'page' | 'card';
  style?: StyleProp<ViewStyle>;
}

const OPTIONS: { value: PantryReviewAnswer | null; label: string }[] = [
  { value: 'have', label: 'Still have it' },
  { value: 'low', label: 'Running low' },
  { value: 'out', label: 'Out of it' },
];

/**
 * The "what is the stock of this item" answer shared by the two sheets that log
 * a food (Describe and the scanned-package portion sheet).
 *
 * **It shows where the item stands now and starts with nothing picked.** The
 * old control opened on "No change", which said nothing about the item. Now the
 * status sits beside the label and, when the row already carries one of the
 * three answers, that segment is raised. Tapping the raised one back to itself
 * is a no-op by design: `onChange` only reports a *different* answer, so the
 * sheet's write (`answerPantryReview`) happens only for something the person
 * changed, never for a standing the row already held.
 */
export function PantryAnswerField({ itemId, value, onChange, label = 'Pantry', surface, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const item = useGroceryStore(s => s.items.find(i => i.id === itemId));
  const itemProducts = useGroceryStore(s => s.itemProducts);
  const standing: PantryStanding | null = useMemo(
    () => (item ? pantryStanding(item, new Date(), itemProducts.filter(p => p.itemId === itemId)) : null),
    [item, itemProducts, itemId]
  );

  const shown = value ?? standing?.answer ?? null;
  const dot =
    standing?.tone === 'good' ? colors.green
    : standing?.tone === 'warn' ? colors.orange
    : standing?.tone === 'bad' ? colors.red
    : colors.textTertiary;

  return (
    <View style={[styles.root, style]}>
      <View style={styles.header}>
        <Text style={styles.label}>PANTRY</Text>
        {standing && (
          <View style={styles.status} accessibilityLabel={`Currently: ${standing.text}`}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={styles.statusText} numberOfLines={1}>{standing.text}</Text>
          </View>
        )}
      </View>
      <SegmentedControl<PantryReviewAnswer | null>
        options={OPTIONS}
        value={shown}
        onChange={v => onChange(v === (standing?.answer ?? null) ? null : v)}
        columns={3}
        label={label}
        surface={surface}
      />
      {value === 'low' && <Text style={styles.hint}>Running low also adds it to your grocery list.</Text>}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { gap: spacing.xsm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd },
  label: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, letterSpacing: 0.8 },
  // The status takes what the label leaves and truncates, so a long purchase
  // line can't push the label itself off the row.
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: colors.text, fontSize: font.xs, fontWeight: fontWeight.medium, flexShrink: 1 },
  hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
});
