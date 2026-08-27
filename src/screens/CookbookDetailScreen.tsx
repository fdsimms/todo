import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useRecipeStore } from '../store/useRecipeStore';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { totalMinutes } from '../utils/recipeUtils';
import type { Recipe } from '../types';

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
  const recipes = useMemo(
    () => allRecipes.filter(r => r.cookbookId === cookbookId).sort((a, b) => a.name.localeCompare(b.name)),
    [allRecipes, cookbookId]
  );

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
          subtitle="Link a recipe to it from the recipe's Source row"
        />
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={r => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: insets.bottom + spacing.xl }} />}
        />
      )}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
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
