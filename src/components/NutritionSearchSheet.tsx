import React, { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { type RankedFood } from '../utils/foodSearchMatch';
import { useFoodDatabaseSearch } from '../hooks/useFoodDatabaseSearch';
import { haptics } from '../utils/haptics';
import { EmptyState } from './EmptyState';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';
import type { FoodNutrition } from '../types';
import { useFilterField } from '../hooks/useFilterField';

/**
 * Finding what a catalog food is made of, in a food database, by name.
 *
 * **It offers and never applies.** The list is ranked (`foodSearchMatch.ts`)
 * and a person picks from it, because FoodData Central answers "milk" with
 * several dozen rows differing by fat content and fortification, and choosing
 * one on somebody's behalf is how a recipe silently acquires the calories of
 * evaporated milk.
 *
 * **Each row says how many nutrients it actually carries**, which is not
 * decoration: real rows in this corpus report a great deal and no calories at
 * all — the Foundation entry for "Butter, stick, salted" lists 130 analysed
 * nutrients with no energy among them. Ranking already prefers a row that has
 * them, and showing the count is what lets someone see why two near-identical
 * names are not equally useful.
 *
 * **No unsaved-changes guard, deliberately.** Picking a food commits it
 * immediately, so the only thing a swipe-down can lose is a half-typed search
 * term. That is the other valid answer to the `pageSheet` `onRequestClose`
 * rule, not a workaround — same call `GroceryItemSheet` itself makes.
 *
 * **"Open Settings" is the caller's job, not this sheet's.** This sheet is
 * routinely nested inside another Modal (`GroceryItemSheet`, `FoodLogEntrySheet`,
 * `RecipeNutritionSheet`, and `GroceryItemSheet` again nested a level further
 * inside `RecipeIngredientSheet`/`GroceryCatalogSheet`/`RecipeNutritionSheet`).
 * Closing only this sheet and navigating leaves every ancestor Modal still
 * presented on top of the Settings screen that just got pushed behind it —
 * the button read as doing nothing, and dismissing the stack of sheets
 * afterward could freeze the app the same way the stacked-Modal notes
 * elsewhere in this file's rules describe. `onOpenSettings` mirrors
 * `GroceryItemSheet`'s own `onOpenRecipe`: the callback is handed the row to
 * open, and the caller closes itself (and forwards to its own ancestor, if
 * it has one) before navigating.
 */

interface Props {
  visible: boolean;
  /** What the catalog calls this food, used to seed the search. */
  itemName: string;
  onClose: () => void;
  /**
   * Called with the chosen food's panel, portions already fetched, and the
   * database's own name for it — a caller with no name of its own yet (a food
   * log entry with nothing to log against) needs something to show besides
   * the panel.
   */
  onPick: (nutrition: FoodNutrition, description: string) => void;
  /**
   * Closes this sheet (and any ancestor sheet the caller is itself nested
   * in) and opens the Settings row named by `entryId`. See the note above.
   */
  onOpenSettings: (entryId: string) => void;
}

/** Where "Open Settings" from this sheet always lands — one row in one group. */
export function navigateToFoodSearchSettings(navigation: unknown, entryId: string) {
  (navigation as never as { navigate: (n: string, p: object) => void })
    .navigate('SettingsGroup', { groupId: 'privacyAi', entryId });
}

export function NutritionSearchSheet({ visible, itemName, onClose, onPick, onOpenSettings }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const searchFilter = useFilterField(itemName);
  const query = searchFilter.query;
  const db = useFoodDatabaseSearch(query);
  const { ranked, searching, searched, picking, error, errorSettingsEntryId, run, reset } = db;

  // SheetModal holds the close until the keyboard is gone (see its doc
  // comment), so this dismiss isn't what prevents the freeze; it only starts
  // the keyboard moving a beat sooner.
  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  // Closing is entirely the caller's job — see the note on `onOpenSettings`
  // above. This just dismisses the keyboard (the search field may still hold
  // it) and hands the row off.
  const openSettings = () => {
    haptics.tap();
    if (!errorSettingsEntryId) return;
    Keyboard.dismiss();
    onOpenSettings(errorSettingsEntryId);
  };

  // Opening with the item's own name already searched: the answer is nearly
  // always among the first results for it, and making someone retype the name
  // of the row they are already looking at is a step for nothing. Every open
  // and close resets the search, which also retires a reply still in flight
  // from the last opening (see `useFoodDatabaseSearch`).
  useEffect(() => {
    reset();
    if (!visible) return;
    searchFilter.seed(itemName);
    void run(itemName);
  }, [visible, itemName, run, reset]);

  const handlePick = async (row: RankedFood) => {
    if (picking) return;
    haptics.tap();
    const picked = await db.pick(row);
    if (!picked) return;
    onPick(picked.nutrition, picked.description);
    haptics.success();
    close();
  };

  const renderRow = ({ item }: { item: RankedFood }) => {
    const busy = picking === item.candidate.fdcId;
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={interaction.activeOpacity}
        disabled={!!picking}
        onPress={() => void handlePick(item)}
        accessibilityRole="button"
        accessibilityLabel={`Use ${item.candidate.description}`}
      >
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{item.candidate.description}</Text>
          <Text style={styles.rowMeta}>
            {[item.candidate.category, `${item.candidate.reports.length} nutrients`]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {busy
          ? <ActivityIndicator color={colors.textSecondary} />
          : <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />}
      </TouchableOpacity>
    );
  };

  return (
    <SheetModal
      name="Food database search"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <View style={styles.root}>
        <SheetHeader
          title="Find nutrition"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={close} minWidth={64} />}
          right={<View style={styles.headerSpacer} />}
        />

        <View style={styles.searchRow}>
          <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
          <TextInput
            key={searchFilter.fieldKey}
            {...searchFilter.props}
            style={styles.searchInput}
            onSubmitEditing={() => void run(query)}
            placeholder="Search foods"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searching && <ActivityIndicator color={colors.textSecondary} />}
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={ranked}
          keyExtractor={r => r.candidate.fdcId}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            searching || !searched ? null : (
              <EmptyState
                icon="nutrition-outline"
                title={error ? 'Nothing to show' : 'No matching foods'}
                subtitle={
                  error
                    ? 'The search could not be run, so there is nothing to choose from.'
                    : 'Try a plainer name. This database files foods as "Onions, raw" rather than by brand.'
                }
                actionLabel={errorSettingsEntryId ? 'Open Settings' : undefined}
                onAction={errorSettingsEntryId ? openSettings : undefined}
              />
            )
          }
        />
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    headerSpacer: { minWidth: 64 },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.md, padding: 0 },
    error: {
      color: colors.textSecondary,
      fontSize: font.sm,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    list: { flex: 1 },
    listContent: { flexGrow: 1, paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
    },
    rowText: { flex: 1, gap: spacing.xxs },
    rowTitle: { color: colors.text, fontSize: font.md },
    rowMeta: { color: colors.textSecondary, fontSize: font.sm },
  });
}
