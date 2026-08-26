import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing, radius, font, fontWeight, border, iconSize, interaction, checkboxRadius,
  type Colors,
} from '../theme';
import { GROCERY_NAME_MAX_LENGTH, GROCERY_QUANTITY_MAX_LENGTH, RECIPE_SECTION_MAX_LENGTH } from '../types';
import type { GroceryItem } from '../types';
import type { RecipeGroceryItem } from '../services/aiSuggestions';
import { InlineEditableText } from './InlineEditableText';
import { PillGroup } from './PillGroup';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { type PendingEdits } from '../hooks/usePendingEdits';
import { groceryNameKey } from '../utils/groceryParse';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';

const CHECKBOX_SIZE = 22;

interface Props {
  row: RecipeGroceryItem;
  /** The sheet's pending-edit registry — see `usePendingEdits`. */
  edits: PendingEdits;
  /** This row's index, namespacing its two fields in that registry. */
  index: number;
  checked: boolean;
  onToggle: () => void;
  onEditName: (name: string) => void;
  onEditQuantity: (quantity: string) => void;
  onEditSection: (section: string | null) => void;
  /** Every section label already in play — this recipe's own plus this import's — offered as picks before falling back to typing a new one. */
  existingSections: string[];
  /** The grocery catalog, searched by the link picker below — see its own doc comment. */
  catalogItems: readonly GroceryItem[];
  sectionHeader?: string | null;
  /**
   * Why this row arrived unticked, when something other than the user unticked
   * it — currently only "the recipe it names is being added as a component"
   * (see `coveredIngredients`). A row that unticks itself with no explanation
   * reads as a bug, and the explanation only fits under the name.
   */
  note?: string | null;
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
 * Both fields are `InlineEditableText` now (#1618), which is this row's own
 * tap-to-edit lifted out so the rest of the review list could have it too. The
 * imperative `resolvePendingEdit` handle went with it: a mid-edit field
 * registers itself with the sheet's `PendingEdits` registry instead, so the
 * sheets no longer keep a `Map` of row refs each — one registry answers for
 * every editable field on the sheet, of which there are now four kinds.
 *
 * This is a plain rewrite of the line, not a substitute (#1565): "swap chicken
 * for tofu" here is unconditional and applies before the recipe is even saved,
 * where a substitute is "use this if that one's unavailable", recorded once on
 * the catalog item and read back through `probablyHaveReason`. Nothing here
 * writes to `grocery_item_subs`.
 */
export function ExtractedIngredientRow({
  row, edits, index, checked, onToggle, onEditName, onEditQuantity, onEditSection,
  existingSections, catalogItems, sectionHeader, note,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Local, not lifted: which row's section picker is open is throwaway UI
  // state, not something the sheet needs to know about.
  const [sectionOpen, setSectionOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  // Whether this line, as currently named, already resolves to a real row —
  // nameKey is always derived from name (see CatalogLinkPicker's own doc
  // comment), so this is the same lookup the store does on save, run early so
  // the icon can say which way this line is headed.
  const linkedItem = useMemo(
    () => catalogItems.find(i => i.nameKey === groceryNameKey(row.name)) ?? null,
    [catalogItems, row.name]
  );

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

        <View style={styles.body}>
          <InlineEditableText
            edits={edits}
            editKey={`ingredient:${index}:name`}
            value={row.name}
            onCommit={onEditName}
            textStyle={styles.name}
            accessibilityLabel={row.name}
            maxLength={GROCERY_NAME_MAX_LENGTH}
            numberOfLines={1}
          />
          <Text style={note ? styles.note : styles.meta} numberOfLines={2}>
            {note || row.aisle}
          </Text>
        </View>

        {!!row.quantity && (
          <View style={styles.qtyPill}>
            <InlineEditableText
              edits={edits}
              editKey={`ingredient:${index}:quantity`}
              value={row.quantity}
              onCommit={onEditQuantity}
              allowEmpty
              textStyle={styles.qtyText}
              accessibilityLabel={`quantity, ${row.quantity}`}
              maxLength={GROCERY_QUANTITY_MAX_LENGTH}
              numberOfLines={1}
            />
          </View>
        )}

        <TouchableOpacity
          onPress={() => { haptics.tap(); animateLayout(); setLinkOpen(v => !v); }}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityState={{ expanded: linkOpen }}
          accessibilityLabel={
            linkedItem
              ? `Linked to ${linkedItem.name} in your grocery catalog`
              : 'Link to an existing item'
          }
        >
          <Ionicons
            name={linkedItem ? 'link' : 'link-outline'}
            size={iconSize.sm}
            color={linkedItem ? colors.purple : colors.textTertiary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => { haptics.tap(); animateLayout(); setSectionOpen(v => !v); }}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityState={{ expanded: sectionOpen }}
          accessibilityLabel={row.section ? `Section: ${row.section}` : 'Add a section'}
        >
          <Ionicons
            name={row.section ? 'pricetag' : 'pricetag-outline'}
            size={iconSize.sm}
            color={row.section ? colors.purple : colors.textTertiary}
          />
        </TouchableOpacity>
      </View>

      {linkOpen && (
        <View style={styles.expandedCard}>
          <CatalogLinkPicker
            items={catalogItems}
            initialQuery={row.name}
            excludeItemId={linkedItem?.id}
            onPick={item => {
              onEditName(item.name);
              animateLayout();
              setLinkOpen(false);
            }}
          />
          <Text style={styles.expandedHint}>
            Renames this line to match, so it lands on the item you already have instead of a
            new one.
          </Text>
        </View>
      )}

      {sectionOpen && (
        <View style={styles.expandedCard}>
          <PillGroup
            noun="section"
            surface="card"
            filterPlaceholder="Find or name a section…"
            createMaxLength={RECIPE_SECTION_MAX_LENGTH}
            onCreate={label => {
              const cleaned = label.trim().slice(0, RECIPE_SECTION_MAX_LENGTH);
              if (!cleaned) return 'Give the section a name.';
              onEditSection(cleaned);
              animateLayout();
              setSectionOpen(false);
            }}
            options={[
              {
                key: '__none__',
                label: 'No section',
                pinned: true,
                selected: !row.section,
                onPress: () => {
                  haptics.tap(); animateLayout(); onEditSection(null); setSectionOpen(false);
                },
              },
              ...existingSections.map(label => ({
                key: label,
                label,
                selected: row.section === label,
                onPress: () => {
                  haptics.tap(); animateLayout(); onEditSection(label); setSectionOpen(false);
                },
              })),
            ]}
          />
          <Text style={styles.expandedHint}>
            Puts this ingredient under a heading, like “For the cake” or “For the frosting”.
          </Text>
        </View>
      )}
    </>
  );
}

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
    expandedCard: {
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginTop: -2,
      marginBottom: spacing.xs,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.sm,
    },
    expandedHint: {
      fontSize: font.xs,
      color: colors.textTertiary,
      paddingHorizontal: spacing.xs,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
    },
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
