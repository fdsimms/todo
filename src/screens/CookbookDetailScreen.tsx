import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useRecipeStore } from '../store/useRecipeStore';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { SheetModal } from '../components/SheetModal';
import { SheetHeader } from '../components/SheetHeader';
import { SheetHeaderButton } from '../components/SheetHeaderButton';
import { SearchField } from '../components/SearchField';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { totalMinutes } from '../utils/recipeUtils';
import type { Recipe } from '../types';
import { useFilterField } from '../hooks/useFilterField';

type RootStackParamList = {
  CookbookDetail: { cookbookId: string };
};

/** One book's title, author, and the recipes linked to it. */
export function CookbookDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'CookbookDetail'>>();
  const { cookbookId } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cookbook = useRecipeStore(s => s.cookbookById(cookbookId));
  const allRecipes = useRecipeStore(useShallow(s => s.recipes));
  const linkCookbook = useRecipeStore(s => s.linkCookbook);
  const recipes = useMemo(
    () => allRecipes.filter(r => r.cookbookId === cookbookId).sort((a, b) => a.name.localeCompare(b.name)),
    [allRecipes, cookbookId]
  );

  const [linkPickerVisible, setLinkPickerVisible] = useState(false);
  const searchFilter = useFilterField();
  const linkSearch = searchFilter.query;
  // Recipes not already claimed by this book — one already filed under it
  // would just link to itself again, and the search is over what's left.
  const linkable = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    return allRecipes
      .filter(r => r.cookbookId !== cookbookId && (q === '' || r.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 30);
  }, [allRecipes, cookbookId, linkSearch]);

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
      </Text>

      {recipes.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title="No recipes from this book yet"
          subtitle="Link a recipe to it from the recipe's Source row, or find one already in your box"
          actionLabel="Link a recipe"
          onAction={() => setLinkPickerVisible(true)}
        />
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={r => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <InlineAction
              label="Link a recipe"
              icon="add"
              onPress={() => setLinkPickerVisible(true)}
              style={styles.linkAction}
            />
          }
          ListFooterComponent={<View style={{ height: insets.bottom + spacing.xl }} />}
        />
      )}

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
            autoFocus
            style={styles.searchBar}
            field={searchFilter}
            placeholder="Search recipes"
            accessibilityLabel="Search recipes to link"
          />
          <FlatList
            data={linkable}
            keyExtractor={r => r.id}
            contentContainerStyle={linkable.length === 0 ? styles.emptyContainer : undefined}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => { haptics.tap(); linkCookbook(item.id, cookbookId); }}
                activeOpacity={interaction.activeOpacity}
              >
                <Text style={styles.pickerRowText} numberOfLines={1}>{item.name}</Text>
                <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <EmptyState icon="search" title="No matching recipes" subtitle="Recipes already in this book won't show here" />
            }
          />
        </View>
      </SheetModal>
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
  linkAction: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
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
    flex: 1,
    color: colors.text,
    fontSize: font.md,
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
