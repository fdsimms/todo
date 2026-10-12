import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Keyboard, Alert } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useRecipeStore } from '../store/useRecipeStore';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { EmptyNote } from '../components/EmptyNote';
import { CookbookIndexEntrySheet } from '../components/CookbookIndexEntrySheet';
import { InlineAction } from '../components/InlineAction';
import { SheetModal } from '../components/SheetModal';
import { SheetHeader } from '../components/SheetHeader';
import { SheetHeaderButton } from '../components/SheetHeaderButton';
import { SearchField } from '../components/SearchField';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { totalMinutes } from '../utils/recipeUtils';
import {
  cookbookLinkCandidates, cookbookLinkPrompt, recipesInCookbook, type CookbookLinkCandidate,
} from '../utils/cookbookRecipes';
import { entriesInCookbook } from '../utils/cookbookIndex';
import type { CookbookIndexEntry, Recipe } from '../types';
import { useFilterField } from '../hooks/useFilterField';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';
import { usePullToSearch } from '../hooks/usePullToSearch';

type RootStackParamList = {
  CookbookDetail: { cookbookId: string };
};

/**
 * One book's title, author, the recipes linked to it, and its index.
 *
 * The index is the book's dishes as its index lists them, which aren't
 * recipes (see `CookbookIndexEntry`): this page and Cook with… are the only
 * two places they're shown, and this is the one where they're added and
 * corrected.
 */
export function CookbookDetailScreen() {
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'CookbookDetail'>>();
  const { cookbookId } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cookbook = useRecipeStore(s => s.cookbookById(cookbookId));
  const allRecipes = useRecipeStore(useShallow(s => s.recipes));
  const linkCookbook = useRecipeStore(s => s.linkCookbook);
  const cookbooks = useRecipeStore(s => s.cookbooks);
  // Page order, the way a cookbook is browsed: each row already says "Page N".
  const recipes = useMemo(() => recipesInCookbook(allRecipes, cookbookId), [allRecipes, cookbookId]);
  const allEntries = useRecipeStore(useShallow(s => s.indexEntries));
  const indexEntries = useMemo(() => entriesInCookbook(allEntries, cookbookId), [allEntries, cookbookId]);

  // Which index line the entry sheet is editing; null while adding one.
  const [entrySheetOpen, setEntrySheetOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  const openEntrySheet = (entryId: string | null) => {
    haptics.tap();
    setEditingEntryId(entryId);
    setEntrySheetOpen(true);
  };

  const [linkPickerVisible, setLinkPickerVisible] = useState(false);
  const searchFilter = useFilterField();
  const linkSearch = searchFilter.query;
  // The picker's Modal stays mounted across opens, and SearchField's own
  // `autoFocus` only remounts the field on a `seed()` call — so it would
  // otherwise only focus the very first time this picker is ever opened.
  useEffect(() => {
    if (linkPickerVisible) searchFilter.inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkPickerVisible]);
  // Recipes not already claimed by this book — one already filed under it
  // would just link to itself again, and the search is over what's left.
  // `total` is what matched before the cap, so the footer can say the list
  // is a slice rather than letting 30 rows pass for the whole box.
  const { shown: linkable, total: linkableTotal } = useMemo(
    () => cookbook
      ? cookbookLinkCandidates(allRecipes, cookbook, linkSearch, id => cookbooks.find(c => c.id === id))
      : { shown: [], total: 0 },
    [allRecipes, cookbook, cookbooks, linkSearch]
  );

  // Linking mirrors the book's title and author onto the recipe, so it moves a
  // recipe out of another book, or replaces a website's credit, with no undo.
  // Those two ask first; a recipe with nothing to lose links on the tap.
  const handleLink = (candidate: CookbookLinkCandidate) => {
    if (!cookbook) return;
    const link = () => { haptics.tap(); linkCookbook(candidate.recipe.id, cookbookId); };
    const prompt = cookbookLinkPrompt(candidate.recipe.name, cookbook, candidate.effect, candidate.recipe.sourcePage);
    if (!prompt) { link(); return; }
    Keyboard.dismiss();
    Alert.alert(prompt.title, prompt.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: prompt.confirm, onPress: link },
    ]);
  };

  const closeLinkPicker = () => {
    Keyboard.dismiss();
    setLinkPickerVisible(false);
    searchFilter.clear();
  };

  const renderItem = ({ item }: { item: Recipe }) => {
    const minutes = totalMinutes(item);
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id })}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={item.name}
      >
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{item.name}</Text>
          <View style={styles.metaRow}>
            {item.sourcePage && (
              <>
                <Text style={styles.metaText}>Page {item.sourcePage}</Text>
                {minutes !== null && <Text style={styles.metaDot}>·</Text>}
              </>
            )}
            {minutes !== null && <Text style={styles.metaText}>{minutes} min</Text>}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  const renderIndexEntry = (entry: CookbookIndexEntry) => (
    <TouchableOpacity
      key={entry.id}
      style={styles.row}
      onPress={() => openEntrySheet(entry.id)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${entry.title} in the index`}
    >
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{entry.title}</Text>
        <Text style={styles.metaText} numberOfLines={1}>
          {[entry.page ? `Page ${entry.page}` : null, entry.ingredients.join(', ') || null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  // The row can be gone while this screen is still mounted (deleted from
  // another screen), same reasoning RecipeDetailScreen's own guard gives.
  if (!cookbook) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader title="Cookbook" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="library-outline"
          title="This cookbook is gone"
          subtitle="It was deleted from another screen"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader title={cookbook.title} onBack={() => navigation.goBack()} />
      <Text style={styles.subtitle}>
        {cookbook.author ? `${cookbook.author} · ` : ''}
        {recipes.length === 0 ? 'No recipes' : recipes.length === 1 ? '1 recipe' : `${recipes.length} recipes`}
        {indexEntries.length > 0 ? ` · ${indexEntries.length} in the index` : ''}
      </Text>

      <FlatList
        ref={scrollTop.ref}
        {...scrollTop.listProps}
        refreshControl={pullSearch.refreshControl}
        data={recipes}
        keyExtractor={r => r.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <Text style={styles.sectionLabel}>RECIPES</Text>
            <InlineAction
              label="Link a recipe"
              icon="add"
              onPress={() => setLinkPickerVisible(true)}
              style={styles.linkAction}
            />
          </>
        }
        ListEmptyComponent={
          <View style={styles.note}>
            <EmptyNote icon="restaurant-outline">
              No recipes from this book yet. Link a recipe to it from the recipe’s Source row.
            </EmptyNote>
          </View>
        }
        ListFooterComponent={
          <>
            <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>INDEX</Text>
            <View style={styles.indexActions}>
              <InlineAction label="Add to index" icon="add" onPress={() => openEntrySheet(null)} />
            </View>
            {indexEntries.length === 0 ? (
              <View style={styles.note}>
                <EmptyNote icon="list-outline">
                  Add the dishes in this book’s index with the ingredients it lists. Cook with… finds them by ingredient, and they stay out of your recipe box.
                </EmptyNote>
              </View>
            ) : (
              indexEntries.map(renderIndexEntry)
            )}
            <View style={{ height: insets.bottom + spacing.xl }} />
          </>
        }
      />

      <CookbookIndexEntrySheet
        visible={entrySheetOpen}
        cookbookId={cookbookId}
        entryId={editingEntryId}
        onClose={() => setEntrySheetOpen(false)}
      />

      {/* Existing recipes only — a brand new one still starts from the
          Recipes screen's own add menu, same as any other recipe. */}
      <SheetModal
        visible={linkPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeLinkPicker}
      >
        <View style={[styles.pickerRoot, { paddingTop: insets.top + spacing.md }]}>
          <SheetHeader
            title="Link a recipe"
            size="lg"
            left={
              <SheetHeaderButton
                label="Cancel"
                role="cancel"
                onPress={closeLinkPicker}
                accessibilityLabel="Close"
              />
            }
            right={<View style={styles.headerSpacer} />}
          />
          <SearchField
            style={styles.searchBar}
            field={searchFilter}
            placeholder="Search recipes"
            accessibilityLabel="Search recipes to link"
          />
          <FlatList
            data={linkable}
            keyExtractor={c => c.recipe.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={linkable.length === 0 ? styles.emptyContainer : undefined}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => handleLink(item)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={item.note ? `Link ${item.recipe.name}, ${item.note}` : `Link ${item.recipe.name}`}
              >
                <View style={styles.info}>
                  <Text style={styles.pickerRowText} numberOfLines={1}>{item.recipe.name}</Text>
                  {item.note && (
                    <Text style={styles.pickerRowNote} numberOfLines={1}>{item.note}</Text>
                  )}
                </View>
                <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <EmptyState icon="search" title="No matching recipes" subtitle="Recipes already in this book won’t show here" />
            }
            ListFooterComponent={
              linkableTotal > linkable.length ? (
                <Text style={styles.pickerFooter}>
                  Showing {linkable.length} of {linkableTotal} recipes. Search to find the rest.
                </Text>
              ) : null
            }
          />
        </View>
      </SheetModal>
      <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  list: {
    paddingTop: spacing.sm,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionLabelSpaced: { marginTop: spacing.lg },
  note: { marginHorizontal: spacing.md, marginVertical: spacing.xxs },
  linkAction: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
  },
  indexActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  pickerRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  headerSpacer: { width: 48 },
  searchBar: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  emptyContainer: { flexGrow: 1 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    gap: spacing.md,
  },
  pickerRowText: {
    color: colors.text,
    fontSize: font.md,
  },
  pickerRowNote: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  pickerFooter: {
    color: colors.textSecondary,
    fontSize: font.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    gap: spacing.md,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  metaDot: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
});
