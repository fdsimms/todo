import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { RATING_LABELS } from '../utils/groceryProduct';
import type { ProductRating } from '../types';
import { SegmentedControl } from './SegmentedControl';

interface Props {
  productId: string;
  /**
   * What the person has picked in this sheet, or null for nothing picked. Not
   * the product's current rating: that is shown by the control itself and never
   * flows back through here, so a null `value` means the sheet writes nothing.
   */
  value: ProductRating | null;
  onChange: (rating: ProductRating | null) => void;
  /** Names the group for screen readers. */
  label?: string;
  surface?: 'page' | 'card';
  style?: StyleProp<ViewStyle>;
}

const OPTIONS: { value: ProductRating; label: string }[] = [
  { value: 'loved', label: RATING_LABELS.loved },
  { value: 'fine', label: RATING_LABELS.fine },
  { value: 'avoid', label: RATING_LABELS.avoid },
];

/**
 * "How was it?" for a scanned product, answered in the sheet that logs it.
 *
 * `PantryAnswerField`'s shape for the same reasons: it shows the verdict the
 * product already carries, starts with nothing picked when it has none, and
 * reports only a *different* answer, so the sheet's write (`updateProduct`)
 * happens for something the person changed and never for a standing the row
 * already held. The banner after a finish (`ProductRatingOffer`) is the other
 * way in and records the same value.
 */
export function ProductRatingField({ productId, value, onChange, label = 'How was it?', surface, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = useGroceryStore(s => s.itemProducts.find(p => p.id === productId)?.rating ?? null);
  const shown = value ?? current;

  return (
    <View style={[styles.root, style]}>
      <Text style={styles.label}>HOW WAS IT?</Text>
      <SegmentedControl<ProductRating | null>
        options={OPTIONS}
        value={shown}
        onChange={v => onChange(v === current ? null : v)}
        label={label}
        surface={surface}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { gap: spacing.xsm },
  label: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, letterSpacing: 0.8 },
});
