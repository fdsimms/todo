import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { ReorderableList } from '../components/ReorderableList';
import { CategoryEditor } from '../components/CategoryEditor';
import { QuickAddNameSheet } from '../components/QuickAddNameSheet';
import { Fab, FAB_SIZE } from '../components/Fab';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatCategorySchedule } from '../utils/categorySchedule';

export function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation();
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const tasksByCategory = useTaskStore(s => s.tasksByCategory);
  const addCategory = useTaskStore(s => s.addCategory);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const reorderCategories = useCategoryStore(s => s.reorderCategories);
  const setCategoryEmoji = useCategoryStore(s => s.setCategoryEmoji);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);

  const getCategoryObj = (name: string) => categories.find(c => c.name === name) ?? null;

  const createCategory = (name: string, emoji: string | null) => {
    animateLayout();
    addCategory(name);
    if (emoji) setCategoryEmoji(name, emoji);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Categories"
        subtitle={allCategories.length > 0
          ? `${allCategories.length} ${allCategories.length === 1 ? 'category' : 'categories'}`
          : undefined}
      />
      <HubPills hub="organize" active="Categories" />

      {allCategories.length === 0 ? (
        <EmptyState
          icon="folder-open-outline"
          title="No categories yet"
          subtitle="Group tasks by the part of life they belong to (work, health, errands) and give each one its own visibility schedule"
          actionLabel="New category"
          onAction={() => setQuickAddVisible(true)}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ReorderableList
          data={allCategories}
          keyExtractor={c => c}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />}
          placeholderStyle={styles.dropSlot}
          // dragTick, not tap: a fast drag crosses several rows between frames
          // and unthrottled selection ticks run together into one long buzz
          // (see haptics.ts). The lift itself is fired by ReorderableList.
          onHoverChange={haptics.dragTick}
          onReorder={reordered => reorderCategories(reordered)}
          renderItem={({ item: cat, drag, isActive }) => {
            const count = tasksByCategory(cat).length;
            const catObj = getCategoryObj(cat);
            const scheduleLabel = formatCategorySchedule(catObj);
            const hideOnVacation = !!catObj?.hideOnVacation;
            const excludeFromSuggestions = !!catObj?.excludeFromSuggestions;
            const excludeFromNewBanner = !!catObj?.excludeFromNewTasksBanner;
            const countLabel = `${count} ${count === 1 ? 'task' : 'tasks'}`;
            // Everything the row used to show as a button now reads as one
            // quiet summary line; the "…" opens the editor that owns them.
            const spokenMeta = [
              countLabel,
              scheduleLabel,
              hideOnVacation ? 'Hidden on vacation' : null,
              excludeFromSuggestions ? 'Skipped in suggestions' : null,
              excludeFromNewBanner ? 'Skipped in new todos banner' : null,
            ]
              .filter(Boolean)
              .join('. ');
            return (
              <TouchableOpacity
                style={[styles.catRow, isActive && styles.catRowActive]}
                onPress={() => (navigation as any).navigate('CategoryDetail', { category: cat })}
                onLongPress={drag}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${cat}. ${spokenMeta}`}
                accessibilityHint="Double tap to view tasks in this category. Long press to reorder."
              >
                <View style={[styles.catIcon, { backgroundColor: colors.accentSubtle }]}>
                  {catObj?.emoji ? (
                    <Text style={styles.catIconEmoji}>{catObj.emoji}</Text>
                  ) : (
                    <Ionicons name="folder" size={18} color={colors.accent} />
                  )}
                </View>
                <View style={styles.catInfo}>
                  <Text style={styles.catName} numberOfLines={1}>{cat}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaText}>{countLabel}</Text>
                    {scheduleLabel && (
                      <>
                        <Text style={styles.metaDot}>·</Text>
                        <Ionicons name="time-outline" size={11} color={colors.textTertiary} />
                        <Text style={[styles.metaText, styles.metaSchedule]} numberOfLines={1}>
                          {scheduleLabel}
                        </Text>
                      </>
                    )}
                    {hideOnVacation && (
                      <>
                        <Text style={styles.metaDot}>·</Text>
                        <Ionicons name="airplane" size={11} color={colors.textTertiary} />
                      </>
                    )}
                    {excludeFromSuggestions && (
                      <>
                        <Text style={styles.metaDot}>·</Text>
                        <Ionicons name="color-wand-outline" size={11} color={colors.textTertiary} />
                      </>
                    )}
                    {excludeFromNewBanner && (
                      <>
                        <Text style={styles.metaDot}>·</Text>
                        <Ionicons name="notifications-off-outline" size={11} color={colors.textTertiary} />
                      </>
                    )}
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); setEditingCategory(cat); }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${cat}`}
                >
                  <Ionicons name="ellipsis-horizontal" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Fab
        onPress={() => setQuickAddVisible(true)}
        accessibilityLabel="Add category"
        bottom={insets.bottom + tabBarHeight + spacing.md}
      />

      <QuickAddNameSheet
        visible={quickAddVisible}
        placeholder="New category…"
        noun="category"
        withEmoji
        moreLabel="More details"
        onSubmit={createCategory}
        // "More details" creates it first, then hands straight over to the
        // editor — same move Projects makes from its quick add.
        onOpenFull={(name, emoji) => { createCategory(name, emoji); setEditingCategory(name); }}
        onClose={() => setQuickAddVisible(false)}
      />

      <CategoryEditor
        visible={editingCategory !== null}
        category={editingCategory}
        onClose={() => setEditingCategory(null)}
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
  // Same inset-grouped card footprint as TaskItem rows.
  catRow: {
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
  // Lifted look while being dragged, mirroring TaskItem's drag treatment.
  catRowActive: {
    backgroundColor: colors.bgTertiary,
  },
  // Subtle slot marking where a dragged category will land; mirrors the
  // row's own footprint (margin + radius).
  dropSlot: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
  catIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catIconEmoji: {
    fontSize: 18,
  },
  catInfo: {
    flex: 1,
    gap: 3,
  },
  catName: {
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
  // Only the schedule can get long enough to need truncating.
  metaSchedule: {
    flexShrink: 1,
  },
  metaDot: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
});
