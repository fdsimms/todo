import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useRecipeStore } from '../store/useRecipeStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { CookbookEditor } from '../components/CookbookEditor';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import type { Cookbook } from '../types';

/**
 * The shelf: every `Cookbook` a recipe has ever been linked to, with a
 * recipe count and a way to rename or delete one — none of which existed
 * before this screen, since a book was previously only reachable through a
 * recipe's own Source row (see docs/arch/recipes.md, "Where a recipe is from").
 *
 * No add button: a book is created by linking (or importing) a recipe to it —
 * `useRecipeStore.linkNewCookbook` — never by typing a title with nothing on
 * the shelf yet to attach it to.
 */
export function CookbooksScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cookbooks = useRecipeStore(useShallow(s => s.cookbooks));
  const recipes = useRecipeStore(useShallow(s => s.recipes));

  const [editingId, setEditingId] = useState<string | null>(null);

  const recipeCountOf = (id: string) => recipes.filter(r => r.cookbookId === id).length;

  // Alphabetical rather than creation order — a shelf you're looking something
  // up on wants to be browsable, and `sortOrder` is presently just "the order
  // books happened to get linked in", not a deliberate arrangement worth
  // exposing as one.
  const sorted = useMemo(
    () => [...cookbooks].sort((a, b) => a.title.localeCompare(b.title)),
    [cookbooks]
  );

  const renderItem = ({ item }: { item: Cookbook }) => {
    const count = recipeCountOf(item.id);
    const countLabel = `${count} ${count === 1 ? 'recipe' : 'recipes'}`;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('CookbookDetail', { cookbookId: item.id })}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}${item.author ? `, by ${item.author}` : ''}. ${countLabel}`}
        accessibilityHint="Double tap to view recipes from this book"
      >
        <View style={styles.icon}>
          <Ionicons name="library-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <View style={styles.metaRow}>
            {item.author && (
              <>
                <Text style={styles.metaText} numberOfLines={1}>{item.author}</Text>
                <Text style={styles.metaDot}>·</Text>
              </>
            )}
            <Text style={styles.metaText}>{countLabel}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => { haptics.tap(); setEditingId(item.id); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.title}`}
        >
          <Ionicons name="ellipsis-horizontal" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Cookbooks"
        subtitle={sorted.length > 0
          ? `${sorted.length} ${sorted.length === 1 ? 'book' : 'books'}`
          : undefined}
      />
      <HubPills hub="kitchen" active="Cookbooks" />

      {sorted.length === 0 ? (
        <EmptyState
          icon="library-outline"
          title="No cookbooks yet"
          subtitle="Link a recipe to a book from its Source row, or import one from a photo, and it shows up here"
          bottomOffset={tabBarHeight}
        />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={c => c.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: tabBarHeight + spacing.xl }} />}
        />
      )}

      <CookbookEditor
        visible={editingId !== null}
        cookbookId={editingId}
        onClose={() => setEditingId(null)}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
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
