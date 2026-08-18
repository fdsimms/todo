import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { groceryNameKey } from '../utils/groceryParse';
import { recipesUsingIngredient } from '../utils/recipeComponents';
import { haptics } from '../utils/haptics';
import { EmptyState } from './EmptyState';
import { SheetHeaderButton } from './SheetHeaderButton';
import type { GroceryItem } from '../types';

interface Props {
  visible: boolean;
  /** The item the merge was opened from — one side of the pair. */
  itemId: string | null;
  onClose: () => void;
  /**
   * Fired after a successful merge, with the id of the row that survived.
   * The caller — not this sheet — decides what that means for whatever it's
   * showing: GroceryItemSheet closes outright when its own item was the one
   * that lost, and just dismisses this picker otherwise.
   */
  onMerged: (survivorId: string) => void;
}

/**
 * "cilantro" and "coriander" are one item wearing two names — this is where
 * that gets fixed. Pick another catalog row, then pick which of the two
 * survives: the other one's purchases, store links, substitutes and recipe
 * references fold into it, and it's deleted. See useGroceryStore.mergeItems
 * for the field-by-field reconciliation this hands off to.
 *
 * No shake-to-undo here, unlike almost everything else in the grocery list —
 * a merge is confirmed instead, the same discipline GroceryItemSheet's own
 * "Forget this item" uses, and for the same reason: there is no undo
 * anywhere in this store, so a destructive action is behind a confirm rather
 * than a swipe.
 */
export function MergeItemSheet({ visible, itemId, onClose, onMerged }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const mergeItems = useGroceryStore(s => s.mergeItems);
  const recipes = useRecipeStore(useShallow(s => s.recipes));

  const item = items.find(i => i.id === itemId) ?? null;

  const [query, setQuery] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);

  const picked = items.find(i => i.id === pickedId) ?? null;

  const typed = query.trim();
  const typedKey = groceryNameKey(typed) || typed.toLowerCase();

  const results = useMemo(() => {
    if (!item) return [];
    const pool = items.filter(i => i.id !== item.id);
    const matches = typed
      ? pool.filter(i => i.nameKey.includes(typedKey) || i.name.toLowerCase().includes(typed.toLowerCase()))
      : pool;
    return matches.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [items, item, typed, typedKey]);

  const reset = () => {
    setQuery('');
    setPickedId(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // What's at stake for this row, named rather than left implicit — the same
  // "names the parents first" discipline TemplateEditor's delete confirm
  // uses before a merge that can't be undone.
  const describeRow = (row: GroceryItem): string => {
    const parts: string[] = [];
    if (row.purchaseCount > 0) {
      parts.push(`${row.purchaseCount} ${row.purchaseCount === 1 ? 'purchase' : 'purchases'}`);
    }
    const usedIn = recipesUsingIngredient(row.nameKey, recipes).length;
    if (usedIn > 0) parts.push(`${usedIn} ${usedIn === 1 ? 'recipe' : 'recipes'}`);
    return parts.length > 0 ? parts.join(' · ') : 'No purchases yet';
  };

  const confirmKeep = (survivor: GroceryItem, loser: GroceryItem) => {
    Alert.alert(
      `Merge ${loser.name} into ${survivor.name}?`,
      `${loser.name}’s purchases, store links and recipes combine into ${survivor.name}. ` +
        `${loser.name} is deleted, and this can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          style: 'destructive',
          onPress: () => {
            mergeItems(loser.id, survivor.id);
            haptics.warning();
            reset();
            onMerged(survivor.id);
          },
        },
      ]
    );
  };

  if (!item) return null;

  const renderRow = ({ item: row }: { item: GroceryItem }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={interaction.activeOpacity}
      onPress={() => { haptics.tap(); setPickedId(row.id); }}
      accessibilityRole="button"
      accessibilityLabel={`Merge ${item.name} with ${row.name}`}
    >
      <Text style={styles.rowName} numberOfLines={1}>{row.name}</Text>
      <Text style={styles.rowMeta} numberOfLines={1}>{row.aisle}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleClose} minWidth={64} />
          <Text style={styles.headerTitle} numberOfLines={1}>Merge {item.name}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {picked ? (
          <View style={styles.body}>
            <Text style={styles.caption}>
              These are the same thing. Pick which one to keep — the other’s history folds into
              it, and it’s deleted.
            </Text>

            {[item, picked].map(row => (
              <TouchableOpacity
                key={row.id}
                style={styles.keepRow}
                activeOpacity={interaction.activeOpacity}
                onPress={() => confirmKeep(row, row.id === item.id ? picked : item)}
                accessibilityRole="button"
                accessibilityLabel={`Keep ${row.name}`}
              >
                <View style={styles.keepBody}>
                  <Text style={styles.keepName} numberOfLines={1}>{row.name}</Text>
                  <Text style={styles.keepMeta} numberOfLines={1}>{describeRow(row)}</Text>
                </View>
                <Text style={styles.keepAction}>Keep</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <>
            <Text style={styles.caption}>
              Pick the other catalog row that’s really {item.name.toLowerCase()}. Its purchases,
              store links and recipes will combine with this one.
            </Text>

            <View style={styles.searchWrap}>
              <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                placeholder="Find an item…"
                placeholderTextColor={colors.textTertiary}
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="Find the item to merge with"
              />
            </View>

            <FlatList
              data={results}
              keyExtractor={row => row.id}
              renderItem={renderRow}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={results.length === 0 ? styles.emptyContainer : styles.list}
              ListEmptyComponent={
                <EmptyState
                  icon="git-merge-outline"
                  title={typed ? 'Nothing matches' : 'Nothing to merge with yet'}
                  subtitle={
                    typed
                      ? 'Nothing in your catalog goes by that name.'
                      : 'A merge combines two rows already in your catalog.'
                  }
                />
              }
            />
          </>
        )}
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
    headerSpacer: { minWidth: 64 },
    caption: {
      color: colors.textSecondary,
      fontSize: font.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
    },
    // No lineHeight on a TextInput — RN maps it onto the iOS paragraph style
    // with no compensating baseline offset, so the glyphs sit low in the field
    // while the caret stays centered.
    search: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: spacing.sm + 2 },
    list: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },
    emptyContainer: { flexGrow: 1, paddingHorizontal: spacing.md },
    row: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      marginBottom: spacing.sm,
    },
    rowName: { color: colors.text, fontSize: font.md },
    rowMeta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    body: { padding: spacing.md },
    keepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      marginTop: spacing.md,
    },
    keepBody: { flex: 1, marginRight: spacing.md },
    keepName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    keepMeta: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    keepAction: { color: colors.accent, fontSize: font.md, fontWeight: fontWeight.semibold },
  });
}
