import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import {
  GROCERY_BRAND_MAX_LENGTH,
  GROCERY_PRODUCT_NOTE_MAX_LENGTH,
  GROCERY_VARIANT_MAX_LENGTH,
  type ProductRating,
} from '../types';
import { describeProduct, productsForItem } from '../utils/groceryProduct';
import { haptics } from '../utils/haptics';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  /** The item this is a product of — the Bread that Arnold's wheat is one of. */
  itemId: string | null;
  /** The product being reviewed. Null adds a new one. */
  editingProductId?: string | null;
  onClose: () => void;
}

/**
 * One box, written down — where a product is added and where it's reviewed.
 *
 * The same split `SubstituteSheet` makes, and for the same reason: the item
 * sheet's Products field shows what you've already answered, and this is where
 * answering happens. Two fields and a rating is more than a field row can hold,
 * and a rating in particular is the thing you come back to change months later,
 * on the box you're standing in front of.
 *
 * **Nothing is written until Save**, the shape every other sheet here uses.
 *
 * The brand and variant suggestions are drawn from *this item's own products*,
 * never from the whole catalog. That's the correction the whole remodel is
 * about: brands don't generalise across items — "Siggi's" is nothing to a loaf
 * of bread — while within one item they repeat constantly, because a maker
 * you buy makes two or three of the thing and you're picking between them.
 */
export function ProductSheet({ visible, itemId, editingProductId = null, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const itemProducts = useGroceryStore(useShallow(s => s.itemProducts));
  const addProduct = useGroceryStore(s => s.addProduct);
  const updateProduct = useGroceryStore(s => s.updateProduct);
  const deleteProduct = useGroceryStore(s => s.deleteProduct);
  const setPreferredProduct = useGroceryStore(s => s.setPreferredProduct);

  const item = items.find(i => i.id === itemId) ?? null;
  const editing = itemProducts.find(p => p.id === editingProductId) ?? null;

  const [brand, setBrand] = useState('');
  const [variant, setVariant] = useState('');
  const [note, setNote] = useState('');
  const [rating, setRating] = useState<ProductRating | null>(null);
  // Set when Save would collide with another product of this item. Shown
  // rather than swallowed, and cleared on the next keystroke: the text stays
  // on screen so the fix is an edit, not a retype.
  const [clash, setClash] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setBrand(editing?.brand ?? '');
    setVariant(editing?.variant ?? '');
    setNote(editing?.note ?? '');
    setRating(editing?.rating ?? null);
    setClash(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingProductId]);

  // This item's own vocabulary, minus the product being edited — the same
  // shape the catalog-wide chips had, scoped to where a brand actually
  // repeats. Adding "Arnold's white" to a Bread that already knows Arnold's
  // is one tap instead of a retype.
  const siblings = useMemo(
    () => (itemId ? productsForItem(itemId, itemProducts).filter(p => p.id !== editingProductId) : []),
    [itemId, itemProducts, editingProductId]
  );
  const brandChips = useMemo(
    () => distinct(siblings.map(p => p.brand)).filter(v => v.toLowerCase() !== brand.trim().toLowerCase()),
    [siblings, brand]
  );
  const variantChips = useMemo(
    () => distinct(siblings.map(p => p.variant)).filter(v => v.toLowerCase() !== variant.trim().toLowerCase()),
    [siblings, variant]
  );

  const canSave = !!brand.trim() || !!variant.trim();

  const handleSave = () => {
    if (!item || !canSave) return;
    if (editing) {
      const ok = updateProduct(editing.id, {
        brand: brand.trim() || null,
        variant: variant.trim() || null,
        note,
        rating,
      });
      if (!ok) {
        haptics.error();
        setClash(true);
        return;
      }
    } else {
      const created = addProduct(item.id, {
        brand: brand.trim() || null,
        variant: variant.trim() || null,
        note,
        rating,
      });
      if (!created) {
        haptics.error();
        return;
      }
      // A box the user typed out in full and saved on a product that already
      // existed is still the box they meant, so the sheet reports the same
      // success either way — `addProduct` matching an existing one is the
      // no-duplicates rule working, not a failure to record anything.
    }
    haptics.success();
    onClose();
  };

  const handleDelete = () => {
    if (!editing || !item) return;
    // Deleting is the one action here that loses something the user can't get
    // back by retyping: the rating and the purchase count are the record of
    // having tried it. So it confirms, and the alternative is named — marking
    // it "Never again" keeps exactly the memory that deleting throws away.
    Alert.alert(
      `Forget ${describeProduct(editing) ?? 'this one'}?`,
      'This also forgets how it was rated and how often you bought it. To remember not to buy it again, mark it "Never again" instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            haptics.warning();
            deleteProduct(editing.id);
            onClose();
          },
        },
      ]
    );
  };

  if (!item) return null;

  const isPreferred = !!editing && item.preferredProductId === editing.id;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {editing ? 'Edit product' : `Which ${item.name.toLowerCase()}?`}
          </Text>
          <SheetHeaderButton label="Save" onPress={handleSave} disabled={!canSave} minWidth={64} />
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>BRAND</Text>
          <TextInput
            style={styles.input}
            value={brand}
            onChangeText={t => { setBrand(t); setClash(false); }}
            placeholder="e.g. Arnold’s"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            maxLength={GROCERY_BRAND_MAX_LENGTH}
            accessibilityLabel="Brand"
          />
          <Chips values={brandChips} onPick={v => { setBrand(v); setClash(false); }} noun="brand" styles={styles} />

          <Text style={[styles.label, styles.labelSpaced]}>VARIANT</Text>
          <TextInput
            style={styles.input}
            value={variant}
            onChangeText={t => { setVariant(t); setClash(false); }}
            placeholder="e.g. whole wheat"
            placeholderTextColor={colors.textTertiary}
            maxLength={GROCERY_VARIANT_MAX_LENGTH}
            accessibilityLabel="Variant"
          />
          <Chips values={variantChips} onPick={v => { setVariant(v); setClash(false); }} noun="variant" styles={styles} />
          <Text style={styles.hint}>
            Either one on its own is fine. Together they name one thing on the
            shelf, and that’s what the list shows under the item’s name.
          </Text>

          {clash && (
            <Text style={styles.error}>
              You’ve already got this one under {item.name.toLowerCase()}. Change
              the brand or the variant, or close and edit the other one.
            </Text>
          )}

          {/* A closed set of three, so a track rather than pills — see
              SegmentedControl. Three states and not a 1-to-5 scale: the
              question you ask at the shelf is whether you've had this and
              hated it. See ProductRating. */}
          <Text style={[styles.label, styles.labelSpaced]}>RATING</Text>
          <SegmentedControl<ProductRating | null>
            options={[
              { value: 'loved', label: 'Loved it' },
              { value: null, label: 'No opinion' },
              { value: 'avoid', label: 'Never again' },
            ]}
            value={rating}
            onChange={setRating}
            label="Rating"
            surface="page"
          />
          <Text style={styles.hint}>
            Shown beside this one wherever you pick between them, so you don’t
            buy something twice to find out you didn’t like it.
          </Text>

          <Text style={[styles.label, styles.labelSpaced]}>NOTE</Text>
          <TextInput
            style={[styles.input, styles.noteInput]}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. the blue bag, on the bottom shelf"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={GROCERY_PRODUCT_NOTE_MAX_LENGTH}
            accessibilityLabel="Note"
          />

          {editing && (
            <View style={styles.actions}>
              {/* Only when it isn't already the one — a button that does
                  nothing is a button you have to read twice to find that out. */}
              {!isPreferred && (
                <TouchableOpacity
                  style={styles.action}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => {
                    haptics.tap();
                    setPreferredProduct(item.id, editing.id);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Make ${describeProduct(editing) ?? 'this'} the one you want`}
                >
                  <Text style={styles.actionText}>Make this the one I want</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.action}
                activeOpacity={interaction.activeOpacity}
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel={`Forget ${describeProduct(editing) ?? 'this product'}`}
              >
                <Text style={[styles.actionText, styles.actionDestructive]}>Forget this one</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * The suggestion chips under a field. Its own component only because the two
 * fields want exactly the same thing and an inline copy is how the second one
 * drifts.
 */
function Chips({
  values, onPick, noun, styles,
}: {
  values: string[];
  onPick: (value: string) => void;
  noun: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (values.length === 0) return null;
  return (
    <View style={styles.chips}>
      {values.map(value => (
        <TouchableOpacity
          key={value}
          style={styles.chip}
          activeOpacity={interaction.activeOpacity}
          onPress={() => onPick(value)}
          accessibilityRole="button"
          accessibilityLabel={`Use ${noun} ${value}`}
        >
          <Text style={styles.chipText} numberOfLines={1}>{value}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Distinct non-empty values, in the order they arrived. */
function distinct(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  body: { flex: 1 },
  bodyContent: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  // Both sides, not just the one that happened to matter: the field above
  // has no bottom margin of its own.
  labelSpaced: { marginTop: spacing.lg },
  input: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    fontSize: font.md,
  },
  noteInput: { minHeight: 72, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
  chipText: { color: colors.textSecondary, fontSize: font.sm },
  hint: { color: colors.textTertiary, fontSize: font.sm, marginTop: spacing.xs },
  error: { color: colors.red, fontSize: font.sm, marginTop: spacing.sm },
  actions: { marginTop: spacing.lg, gap: spacing.xs },
  action: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  actionText: { color: colors.accent, fontSize: font.md, fontWeight: fontWeight.medium },
  actionDestructive: { color: colors.red },
});
