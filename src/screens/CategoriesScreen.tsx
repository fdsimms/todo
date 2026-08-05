import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
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
import { EmptyState } from '../components/EmptyState';
import { ReorderableList } from '../components/ReorderableList';
import { CategoryEditor } from '../components/CategoryEditor';
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
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryText, setNewCategoryText] = useState('');
  const [newCategoryEmoji, setNewCategoryEmoji] = useState('');
  const inputRef = useRef<TextInput>(null);

  const getCategoryObj = (name: string) => categories.find(c => c.name === name) ?? null;

  const handleAddCategory = () => {
    const trimmed = newCategoryText.trim();
    if (trimmed) {
      haptics.success();
      animateLayout();
      addCategory(trimmed);
      const trimmedEmoji = newCategoryEmoji.trim();
      if (trimmedEmoji) setCategoryEmoji(trimmed, trimmedEmoji);
    }
    setNewCategoryText('');
    setNewCategoryEmoji('');
    setAddingCategory(false);
  };

  const handleStartAdding = () => {
    animateLayout();
    setAddingCategory(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Categories"
        subtitle={allCategories.length > 0
          ? `${allCategories.length} ${allCategories.length === 1 ? 'category' : 'categories'}`
          : undefined}
        actions={[{ icon: 'add', onPress: handleStartAdding, accessibilityLabel: 'Add category' }]}
      />

      {addingCategory && (
        <View style={styles.addRow}>
          <View style={[styles.catIcon, { backgroundColor: colors.bgTertiary }]}>
            {newCategoryEmoji.trim() ? (
              <Text style={styles.catIconEmoji}>{newCategoryEmoji.trim()}</Text>
            ) : (
              <Ionicons name="folder-outline" size={18} color={colors.textTertiary} />
            )}
          </View>
          <TextInput
            style={styles.addEmojiInput}
            value={newCategoryEmoji}
            onChangeText={setNewCategoryEmoji}
            placeholder="🙂"
            placeholderTextColor={colors.textTertiary}
            maxLength={4}
            accessibilityLabel="Category emoji"
          />
          <TextInput
            ref={inputRef}
            style={styles.addInput}
            value={newCategoryText}
            onChangeText={setNewCategoryText}
            placeholder="Category name"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleAddCategory}
            onBlur={() => {
              if (!newCategoryText.trim()) setAddingCategory(false);
            }}
          />
          <TouchableOpacity onPress={handleAddCategory} style={styles.addConfirm} activeOpacity={interaction.activeOpacity} accessibilityRole="button" accessibilityLabel="Confirm new category">
            <Ionicons name="checkmark" size={20} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setNewCategoryText(''); setNewCategoryEmoji(''); setAddingCategory(false); }}
            style={styles.addCancel}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Ionicons name="close" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {allCategories.length === 0 && !addingCategory ? (
        <EmptyState
          icon="folder-open-outline"
          title="No categories yet"
          subtitle="Tap + to create a category, or assign one when editing a task"
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ReorderableList
          data={allCategories}
          keyExtractor={c => c}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: tabBarHeight + spacing.md }} />}
          placeholderStyle={styles.dropSlot}
          onHoverChange={haptics.tap}
          onReorder={reordered => reorderCategories(reordered)}
          renderItem={({ item: cat, drag, isActive }) => {
            const count = tasksByCategory(cat).length;
            const catObj = getCategoryObj(cat);
            const scheduleLabel = formatCategorySchedule(catObj);
            const hideOnVacation = !!catObj?.hideOnVacation;
            const countLabel = `${count} ${count === 1 ? 'task' : 'tasks'}`;
            // Everything the row used to show as a button now reads as one
            // quiet summary line; the "…" opens the editor that owns them.
            const spokenMeta = [countLabel, scheduleLabel, hideOnVacation ? 'Hidden on vacation' : null]
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
                <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
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
  // Mirrors the inset-grouped card footprint of the category rows below.
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.md,
  },
  addInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
    paddingVertical: 0,
  },
  addEmojiInput: {
    width: 36,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 0,
    textAlign: 'center',
  },
  addConfirm: {
    padding: 4,
  },
  addCancel: {
    padding: 4,
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
