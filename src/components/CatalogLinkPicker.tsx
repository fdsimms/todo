import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import type { GroceryItem } from '../types';
import { rankGrocerySuggestions } from '../utils/grocerySuggest';
import { haptics } from '../utils/haptics';

interface Props {
  items: readonly GroceryItem[];
  /** Seeds the search field — usually the ingredient's name as typed so far. */
  initialQuery: string;
  /** The item this line already resolves to, if any — left out of its own results. */
  excludeItemId?: string | null;
  onPick: (item: GroceryItem) => void;
}

/**
 * "This is actually the thing I already have" — a fuzzy search over the
 * grocery catalog, opened from a recipe ingredient line so it can be tied to
 * an existing item instead of quietly minting a new one.
 *
 * There is no separate field to write: `RecipeIngredient.nameKey` is always
 * derived from `name` (see `groceryNameKey`, "the join is nameKey and nothing
 * else" in docs/arch/groceries.md), so picking a result here doesn't set a
 * key directly — it renames the line to the catalog item's own name, the same
 * `commit(item.name)` convergence `GroceryAddField`'s suggestions use, and the
 * existing derivation takes it from there.
 *
 * Ranking is `rankGrocerySuggestions` (frequency × recency over a fuzzy
 * prefix/substring match), the same function that powers the grocery list's
 * own add field — a second scoring function here would be a second one to
 * keep in step with it.
 */
export function CatalogLinkPicker({ items, initialQuery, excludeItemId, onPick }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState(initialQuery);

  const results = useMemo(
    () => rankGrocerySuggestions(query, items, new Date(), 6)
      .map(s => s.item)
      .filter(item => item.id !== excludeItemId),
    [query, items, excludeItemId]
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Find an item in your grocery catalog…"
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Find an item in your grocery catalog"
        />
      </View>
      {results.length > 0 ? (
        results.map(item => (
          <TouchableOpacity
            key={item.id}
            style={styles.row}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); onPick(item); }}
            accessibilityRole="button"
            accessibilityLabel={`Link to ${item.name}, ${item.aisle}`}
          >
            <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.rowAisle} numberOfLines={1}>{item.aisle}</Text>
          </TouchableOpacity>
        ))
      ) : (
        <Text style={styles.empty}>
          {query.trim()
            ? 'Nothing in your grocery catalog matches.'
            : 'Type to search your grocery catalog.'}
        </Text>
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { paddingTop: spacing.xs },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
    },
    // No lineHeight on a TextInput — RN maps it onto the iOS paragraph style
    // with no compensating baseline offset, so the glyphs sit low in the field
    // while the caret stays centered.
    search: { flex: 1, fontSize: font.sm, color: colors.text, paddingVertical: spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    rowName: { flex: 1, fontSize: font.sm, fontWeight: fontWeight.medium, color: colors.text },
    rowAisle: { fontSize: font.xs, color: colors.textTertiary },
    empty: {
      fontSize: font.xs,
      color: colors.textTertiary,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
  });
}
