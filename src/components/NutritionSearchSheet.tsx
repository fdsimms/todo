import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { rankFoodCandidates, type RankedFood } from '../utils/foodSearchMatch';
import { describeFoodSearchError, fetchFoodPortions, searchFoods, type FoodSearchHit } from '../services/foodSearch';
import { haptics } from '../utils/haptics';
import { EmptyState } from './EmptyState';
import { SheetHeaderButton } from './SheetHeaderButton';
import type { FoodNutrition } from '../types';

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
 */

interface Props {
  visible: boolean;
  /** What the catalog calls this food, used to seed the search. */
  itemName: string;
  onClose: () => void;
  /** Called with the chosen food's panel, portions already fetched. */
  onPick: (nutrition: FoodNutrition) => void;
}

export function NutritionSearchSheet({ visible, itemName, onClose, onPick }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState(itemName);
  const [hits, setHits] = useState<FoodSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const run = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    try {
      setHits(await searchFoods(trimmed));
    } catch (e) {
      setHits([]);
      setError(describeFoodSearchError(e));
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }, []);

  // Opening with the item's own name already searched: the answer is nearly
  // always among the first results for it, and making someone retype the name
  // of the row they are already looking at is a step for nothing.
  useEffect(() => {
    if (!visible) return;
    setQuery(itemName);
    setHits([]);
    setError(null);
    setSearched(false);
    setPicking(null);
    void run(itemName);
  }, [visible, itemName, run]);

  const ranked = useMemo(
    () => rankFoodCandidates(query, hits.map(h => h.candidate)),
    [query, hits],
  );

  const handlePick = async (row: RankedFood) => {
    const hit = hits.find(h => h.candidate.fdcId === row.candidate.fdcId);
    if (!hit || picking) return;
    haptics.tap();
    setPicking(row.candidate.fdcId);
    setError(null);
    try {
      // The second request, and the reason there is one: the portion table is
      // on the detail endpoint only, and without it a recipe line written as a
      // volume or a count can never become grams. See `readFdcPortions`.
      const portions = await fetchFoodPortions(row.candidate.fdcId);
      onPick({ ...hit.nutrition, portions });
      haptics.success();
      onClose();
    } catch (e) {
      setError(describeFoodSearchError(e));
      setPicking(null);
    }
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
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>Find nutrition</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
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
              />
            )
          }
        />
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
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
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
    rowText: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text, fontSize: font.md },
    rowMeta: { color: colors.textSecondary, fontSize: font.sm },
  });
}
