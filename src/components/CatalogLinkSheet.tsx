import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, spacing, type Colors } from '../theme';
import type { GroceryItem, ItemProduct } from '../types';
import { productsForItem } from '../utils/groceryProduct';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { ProductPicker } from './ProductPicker';
import { SheetHeaderButton } from './SheetHeaderButton';

/**
 * "Which item is this, and which box of it?" — for a caller with no room to ask
 * in place.
 *
 * The pickers themselves are plain views and every surface that asks these two
 * questions reuses them rather than growing a second ranked search or a second
 * box list: the scan review sheet renders both inline, under the row being
 * asked about. A list row has nowhere to put them, so this is the same pair of
 * questions in the shape a list can ask them.
 *
 * **Two steps, and the second one is skipped rather than shown empty.** An item
 * with no boxes has nothing to choose among, so picking it is the whole answer
 * and the sheet closes on one tap — which is every loose food and most of the
 * catalog. Only an item somebody has recorded boxes for asks again, and there
 * "just the food" is the first row rather than a way to back out.
 *
 * **No unsaved-changes guard, and that is the right answer rather than a
 * missing one.** Nothing is staged: picking an item with no boxes commits, and
 * picking a box commits. A swipe-down part way through leaves the entry exactly
 * as it was, which is the carve-out CLAUDE.md draws for the plain pickers
 * rather than the `handleCancel` case.
 */
interface Props {
  visible: boolean;
  /** What is being filed, named in the sheet so the question is answerable. */
  subject: string;
  items: readonly GroceryItem[];
  products: readonly ItemProduct[];
  /** Seeds the search — usually whatever the thing is already called. */
  initialQuery: string;
  /** The item it already points at, so its own box reads as current. */
  currentItemId?: string | null;
  /** The box it already points at. */
  currentProductId?: string | null;
  onPick: (item: GroceryItem, product: ItemProduct | null) => void;
  onClose: () => void;
}

export function CatalogLinkSheet({
  visible, subject, items, products, initialQuery,
  currentItemId, currentProductId, onPick, onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  /** The item chosen, while its boxes are being offered. Null on step one. */
  const [chosen, setChosen] = useState<GroceryItem | null>(null);

  // Reopening asks from the top. Handing somebody back the box list of an item
  // they picked last time, for an entry that may not be the same one, is a
  // question about the wrong thing.
  useEffect(() => { if (!visible) setChosen(null); }, [visible]);

  const handleItem = (item: GroceryItem) => {
    // One tap when there is nothing more to ask.
    if (productsForItem(item.id, products).length === 0) {
      onPick(item, null);
      return;
    }
    setChosen(item);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton
            label={chosen ? 'Back' : 'Cancel'}
            role="cancel"
            onPress={() => (chosen ? setChosen(null) : onClose())}
            minWidth={64}
          />
          <Text style={styles.title} numberOfLines={1}>
            {chosen ? 'Which one of it?' : 'Which item is this?'}
          </Text>
          {/* Balances the button on the left so the title stays optically centered. */}
          <View style={styles.spacer} />
        </View>
        <ScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.subject} numberOfLines={2}>{subject}</Text>
          {chosen ? (
            <ProductPicker
              itemId={chosen.id}
              products={products}
              // Its own box only where the item is unchanged: a box is one of
              // this item's, so carrying the old pointer onto a different food
              // would tick a row that isn't the one it names.
              value={chosen.id === currentItemId ? currentProductId ?? null : null}
              onPick={product => onPick(chosen, product)}
              label={`WHICH ${chosen.name.toUpperCase()}`}
            />
          ) : (
            <CatalogLinkPicker
              items={items}
              initialQuery={initialQuery}
              onPick={handleItem}
            />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold, flex: 1, textAlign: 'center' },
    spacer: { minWidth: 64 },
    bodyScroll: { flex: 1 },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    subject: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.md },
  });
}
