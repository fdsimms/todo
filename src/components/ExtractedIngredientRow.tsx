import React, { useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing, radius, font, fontWeight, border, iconSize, interaction, checkboxRadius,
  type Colors,
} from '../theme';
import { GROCERY_NAME_MAX_LENGTH, GROCERY_QUANTITY_MAX_LENGTH } from '../types';
import type { RecipeGroceryItem } from '../services/aiSuggestions';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

interface Props {
  row: RecipeGroceryItem;
  checked: boolean;
  onToggle: () => void;
  onEditName: (name: string) => void;
  onEditQuantity: (quantity: string) => void;
  sectionHeader?: string | null;
  /**
   * Why this row arrived unticked, when something other than the user unticked
   * it — currently only "the recipe it names is being added as a component"
   * (see `coveredIngredients`). A row that unticks itself with no explanation
   * reads as a bug, and the explanation only fits under the name.
   */
  note?: string | null;
}

export interface ExtractedIngredientRowHandle {
  /**
   * Whatever's typed but not yet committed for this row, still keyed to
   * which field it's for — `null` when there's nothing pending. The
   * parent's Create/Add button can fire before this row's own blur does
   * (same race TaskEditor's resolveX functions guard against), so it reads
   * this directly instead of trusting `onEditName`/`onEditQuantity` to
   * have already landed in its own state.
   */
  resolvePendingEdit: () => { field: 'name' | 'quantity'; value: string } | null;
}

/**
 * One row of a recipe-import review list (#1608) — shared by `RecipeCreateSheet`
 * and `RecipeExtractSheet`, which otherwise render this identically.
 *
 * The checkbox and the rest of the row are two separate tap zones, exactly the
 * split `GroceryRow` already makes between toggling checked and renaming: a
 * single ambiguous tap can't mean both "leave this off the recipe" and "let me
 * fix what it says". Tapping the name turns it into a `TextInput`; tapping the
 * quantity pill does the same for just that field. Committing an edited *name*
 * to blank reverts rather than saving it — an ingredient needs one — but a
 * blank *quantity* is a real value (`RecipeGroceryItem.quantity`'s own doc:
 * "empty when the recipe didn't say"), so that one commits as typed.
 *
 * This is a plain rewrite of the line, not a substitute (#1565): "swap chicken
 * for tofu" here is unconditional and applies before the recipe is even saved,
 * where a substitute is "use this if that one's unavailable", recorded once on
 * the catalog item and read back through `probablyHaveReason`. Nothing here
 * writes to `grocery_item_subs`.
 */
export const ExtractedIngredientRow = forwardRef<ExtractedIngredientRowHandle, Props>(function ExtractedIngredientRow({
  row, checked, onToggle, onEditName, onEditQuantity, sectionHeader, note,
}: Props, ref) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editingField, setEditingField] = useState<'name' | 'quantity' | null>(null);
  const [draft, setDraft] = useState('');

  const startEdit = (field: 'name' | 'quantity', value: string) => {
    setDraft(value);
    setEditingField(field);
  };

  // Mirrors commit()'s own validation, so what the ref reports pending is
  // exactly what commit() would have written.
  const resolvePendingEdit = (): { field: 'name' | 'quantity'; value: string } | null => {
    if (!editingField) return null;
    const trimmed = draft.trim();
    if (editingField === 'name') {
      if (!trimmed || trimmed === row.name) return null;
      return { field: 'name', value: trimmed };
    }
    if (trimmed === row.quantity) return null;
    return { field: 'quantity', value: trimmed };
  };

  useImperativeHandle(ref, () => ({ resolvePendingEdit }));

  const commit = () => {
    // onSubmitEditing fires onBlur right behind it, and unmounting the field
    // on the way out fires onBlur again — guard so one edit writes once.
    if (!editingField) return;
    const field = editingField;
    setEditingField(null);
    const trimmed = draft.trim();
    if (field === 'name') {
      // Reverting silently is friendlier than an error for "changed my mind",
      // and an ingredient with no name isn't a row worth keeping around empty.
      if (!trimmed || trimmed === row.name) return;
      onEditName(trimmed);
    } else {
      if (trimmed === row.quantity) return;
      onEditQuantity(trimmed);
    }
  };

  return (
    <>
      {!!sectionHeader && <Text style={styles.sectionHeader}>{sectionHeader}</Text>}
      <View style={styles.row}>
        <TouchableOpacity
          onPress={() => { haptics.tap(); onToggle(); }}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={`${row.name}, ${note || row.aisle}`}
        >
          <View style={[styles.checkbox, checked && styles.checkboxOn]}>
            {checked && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.body}
          activeOpacity={interaction.activeOpacity}
          onPress={() => startEdit('name', row.name)}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${row.name}`}
        >
          {editingField === 'name' ? (
            <TextInput
              style={styles.nameInput}
              value={draft}
              onChangeText={setDraft}
              onBlur={commit}
              onSubmitEditing={commit}
              autoFocus
              selectTextOnFocus
              maxLength={GROCERY_NAME_MAX_LENGTH}
              returnKeyType="done"
              accessibilityLabel="Ingredient name"
            />
          ) : (
            <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
          )}
          <Text style={note ? styles.note : styles.meta} numberOfLines={2}>
            {note || row.aisle}
          </Text>
        </TouchableOpacity>

        {!!row.quantity && (
          <TouchableOpacity
            style={styles.qtyPill}
            activeOpacity={interaction.activeOpacity}
            onPress={() => startEdit('quantity', row.quantity)}
            accessibilityRole="button"
            accessibilityLabel={`Edit quantity, ${row.quantity}`}
          >
            {editingField === 'quantity' ? (
              <TextInput
                style={styles.qtyInput}
                value={draft}
                onChangeText={setDraft}
                onBlur={commit}
                onSubmitEditing={commit}
                autoFocus
                selectTextOnFocus
                maxLength={GROCERY_QUANTITY_MAX_LENGTH}
                returnKeyType="done"
                accessibilityLabel="Quantity"
              />
            ) : (
              <Text style={styles.qtyText} numberOfLines={1}>{row.quantity}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </>
  );
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    sectionHeader: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
    },
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    body: { flex: 1 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    // No lineHeight — RN maps it onto the iOS paragraph style with no
    // compensating baseline offset, so the glyphs sit low in the field.
    nameInput: {
      fontSize: font.md,
      fontWeight: fontWeight.medium,
      color: colors.text,
      padding: 0,
      minHeight: 20,
    },
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
    // Accent rather than tertiary: it explains a state the app put the row in,
    // where the aisle it replaces is just where the thing lives in the shop.
    note: { fontSize: font.xs, color: colors.accent, marginTop: 2 },
    qtyPill: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      maxWidth: 96,
    },
    qtyText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
    qtyInput: {
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
      padding: 0,
      minWidth: 48,
    },
  });
}
