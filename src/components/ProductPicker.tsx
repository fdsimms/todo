import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, spacing, type Colors } from '../theme';
import type { ItemProduct } from '../types';
import { describeProduct, productsForItem } from '../utils/groceryProduct';
import { haptics } from '../utils/haptics';

/**
 * "Which box of it?" — one item's products, to pick one of or none.
 *
 * The companion to `CatalogLinkPicker` one level in. That one asks which food
 * this is and searches the whole catalog; this one asks which box, over the
 * handful an item has, so it is a plain list rather than a search. Both exist
 * because the two questions have different answers and only the first of them
 * could be asked before: a scanned or logged food could say it was Bread and
 * not that it was Dave's Killer.
 *
 * **"Just the food" is a real answer, not an escape hatch**, which is why it is
 * the first row rather than a way to cancel. Plenty of foods are eaten without
 * the box mattering, and a log entry that names no product is the ordinary
 * state for everything bought loose. It is also the only way back from a box
 * picked by mistake.
 *
 * **`allowNone` is off for the scan sheet, and that is not squeamishness about
 * an extra row.** A barcode's claim on a box lives in `ItemProduct.gtin` and is
 * only ever released by another box claiming the same code, so a scan saying
 * "just the food" would leave the code still pointing at the box it named last
 * time — and the entry would come back carrying that box, having been told not
 * to. Offering an answer the write path cannot honour is worse than not
 * offering it. Saying it about one meal is what the log's own relink is for,
 * where no barcode is involved and the answer means exactly what it says.
 *
 * Order is `productsForItem`'s, the same the item sheet lists boxes in:
 * preferred first, then loved, then unrated, then the ones marked never again.
 * A rating sorts rather than filters here too — remembering that you hated a
 * box is worth most at the moment you are about to name it again.
 *
 * Renders nothing when the item has no boxes. A question with one answer is not
 * a question, and the caller should not have to check first.
 */
interface Props {
  itemId: string | null;
  products: readonly ItemProduct[];
  /** The box currently filed, or null for the food itself. */
  value: string | null;
  /** Null means "just the food". */
  onPick: (product: ItemProduct | null) => void;
  /** Shown above the rows, so a caller can say what is being filed. */
  label?: string;
  /** Whether "just the food" is offered. See the note above before turning it off. */
  allowNone?: boolean;
}

export function ProductPicker({ itemId, products, value, onPick, label, allowNone = true }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const boxes = useMemo(
    () => (itemId ? productsForItem(itemId, products) : []),
    [itemId, products]
  );

  if (boxes.length === 0) return null;

  const row = (key: string, text: string, selected: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={key}
      style={styles.row}
      activeOpacity={interaction.activeOpacity}
      onPress={() => { haptics.tap(); onPress(); }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={text}
    >
      {/* The name wins the row and the mark is the short fixed sibling, which is
          the way round CLAUDE.md's note on this requires: a box's words are
          data somebody typed and can be long. */}
      <Text style={[styles.rowText, selected && styles.rowTextOn]} numberOfLines={2}>{text}</Text>
      {selected && (
        <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.wrap}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      {allowNone && row('none', 'Just the food, no particular box', value === null, () => onPick(null))}
      {boxes.map(box =>
        row(box.id, describeProduct(box) ?? 'Unnamed box', value === box.id, () => onPick(box))
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { marginTop: spacing.sm },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginBottom: spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    rowText: { flex: 1, color: colors.text, fontSize: font.md },
    rowTextOn: { color: colors.accent, fontWeight: fontWeight.medium },
  });
}
