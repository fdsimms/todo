import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PinIcon } from './PinIcon';
import { WhenPicker } from './WhenPicker';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { PRIORITY_LABELS, PRIORITY_COLORS, type Priority, type TimeOfDay } from '../types';
import { tagColor } from '../utils/tagColor';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useShallow } from 'zustand/react/shallow';

interface Props {
  selectedCount: number;
  totalCount: number;
  existingTags: string[];
  existingCategories: string[];
  onComplete: () => void;
  onDelete: () => void;
  onSetWhen: (date: Date | null, timeSegments: TimeOfDay[]) => void;
  onSetCategory: (category: string | null) => void;
  onAddCategory: (name: string) => void;
  onAddTags: (tags: string[]) => void;
  onSetPriority: (priority: Priority) => void;
  // Grouping is Today/Later-only for now — other screens that bulk-select
  // tasks (Categories, Inbox, Tags) simply omit this and the action hides.
  onGroup?: (title: string) => void;
  // Pinning is a Today concept, so it's omitted the same way grouping is.
  onTogglePin?: () => void;
  /** True when every selected task is already pinned — the action then reads "Unpin". */
  allPinned?: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  /** Clearance to leave below the bar — the floating tab bar's rendered height, not just the safe-area inset. */
  bottomInset: number;
  /** Reports the bar's rendered height so the caller can reserve matching space at the bottom of its list, keeping the bar from covering the last rows. */
  onHeightChange?: (height: number) => void;
}

type Panel = 'actions' | 'more' | 'priority' | 'tags' | 'category' | 'group';

/** Four rows of chips (34pt each, spacing.sm between) before the grid starts scrolling. */
const CATEGORY_LIST_MAX_HEIGHT = 172;

export function BulkActionBar({
  selectedCount,
  totalCount,
  existingTags,
  existingCategories,
  onComplete,
  onDelete,
  onSetWhen,
  onSetCategory,
  onAddCategory,
  onAddTags,
  onSetPriority,
  onGroup,
  onTogglePin,
  allPinned = false,
  onSelectAll,
  onDeselectAll,
  onCancel,
  bottomInset,
  onHeightChange,
}: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const [panel, setPanel] = useState<Panel>('actions');
  const [whenVisible, setWhenVisible] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [newTagText, setNewTagText] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [newCategoryText, setNewCategoryText] = useState('');

  const allSelected = selectedCount === totalCount;

  const handleConfirmWhen = (date: Date | null, segs: TimeOfDay[]) => {
    setWhenVisible(false);
    onSetWhen(date, segs);
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const handleApplyTags = () => {
    const trimmed = newTagText.trim();
    const tags = Array.from(new Set([...selectedTags, ...(trimmed ? [trimmed] : [])]));
    if (tags.length > 0) onAddTags(tags);
    setPanel('actions');
    setSelectedTags(new Set());
    setNewTagText('');
  };

  const handleSetPriority = (p: Priority) => {
    haptics.tap();
    onSetPriority(p);
    setPanel('actions');
  };

  const handleApplyGroup = () => {
    const trimmed = groupTitle.trim();
    if (!trimmed || !onGroup) return;
    onGroup(trimmed);
    setPanel('actions');
    setGroupTitle('');
  };

  const handleSetCategory = (category: string | null) => {
    haptics.tap();
    onSetCategory(category);
    setNewCategoryText('');
    setPanel('actions');
  };

  const handleAddNewCategory = () => {
    const trimmed = newCategoryText.trim();
    if (!trimmed) return;
    onAddCategory(trimmed);
    onSetCategory(trimmed);
    setNewCategoryText('');
    setPanel('actions');
  };

  // The category field doubles as a filter and as the create-new input: with ten
  // categories the grid is the fast path, and typing narrows it to a couple of
  // chips rather than making the list something to hunt through.
  const categoryQuery = newCategoryText.trim().toLowerCase();

  const filteredCategories = useMemo(() => {
    if (!categoryQuery) return existingCategories;
    return existingCategories.filter(
      c =>
        c.toLowerCase().includes(categoryQuery) ||
        categoryLabel(c, categories).toLowerCase().includes(categoryQuery),
    );
  }, [existingCategories, categories, categoryQuery]);

  const exactCategory = useMemo(
    () => (categoryQuery ? existingCategories.find(c => c.toLowerCase() === categoryQuery) ?? null : null),
    [existingCategories, categoryQuery],
  );

  // Return picks the obvious match when there is one, so typing a few letters and
  // hitting done never silently creates a duplicate of a category that exists.
  const handleCategorySubmit = () => {
    if (!categoryQuery) return;
    if (exactCategory) return handleSetCategory(exactCategory);
    if (filteredCategories.length === 1) return handleSetCategory(filteredCategories[0]);
    handleAddNewCategory();
  };

  const goBack = () => {
    setPanel('actions');
    setSelectedTags(new Set());
    setNewTagText('');
    setGroupTitle('');
    setNewCategoryText('');
  };

  return (
    <>
      <View
        style={[styles.container, shadows.sheet, { bottom: bottomInset + spacing.sm }]}
        onLayout={onHeightChange ? e => onHeightChange(e.nativeEvent.layout.height) : undefined}
      >
        {panel === 'actions' && (
          <>
            <View style={styles.topRow}>
              <TouchableOpacity
                style={styles.selectAllBtn}
                onPress={() => { haptics.tap(); allSelected ? onDeselectAll() : onSelectAll(); }}
              >
                <Text style={styles.selectAllText}>
                  {allSelected ? 'Deselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.countText}>{selectedCount} selected</Text>
              <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel selection">
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.actionRow}>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.success(); onComplete(); }}
              >
                <Ionicons name="checkmark-circle" size={24} color={colors.green} />
                <Text style={[styles.actionLabel, { color: colors.green }]}>Complete</Text>
              </PressableScale>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.tap(); setWhenVisible(true); }}
              >
                <Ionicons name="calendar" size={24} color={colors.accent} />
                <Text style={[styles.actionLabel, { color: colors.accent }]}>When</Text>
              </PressableScale>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.tap(); setPanel('category'); }}
              >
                <Ionicons name="folder" size={24} color={colors.purple} />
                <Text style={[styles.actionLabel, { color: colors.purple }]}>Move</Text>
              </PressableScale>
              {onTogglePin && (
                <PressableScale
                  style={styles.actionBtn}
                  onPress={() => { haptics.tap(); onTogglePin(); }}
                >
                  <PinIcon filled={allPinned} size={24} color={colors.orange} />
                  <Text style={[styles.actionLabel, { color: colors.orange }]}>
                    {allPinned ? 'Unpin' : 'Pin'}
                  </Text>
                </PressableScale>
              )}
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.impactMedium(); onDelete(); }}
              >
                <Ionicons name="trash" size={24} color={colors.red} />
                <Text style={[styles.actionLabel, { color: colors.red }]}>Delete</Text>
              </PressableScale>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.tap(); setPanel('more'); }}
              >
                <Ionicons name="ellipsis-horizontal-circle" size={24} color={colors.textSecondary} />
                <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>More</Text>
              </PressableScale>
            </View>
          </>
        )}

        {panel === 'more' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>More Actions</Text>
              <View style={{ width: 28 }} />
            </View>
            {onGroup && (
              <TouchableOpacity style={styles.moreRow} onPress={() => setPanel('group')}>
                <Ionicons name="layers-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.moreRowText}>Stack</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.moreRow} onPress={() => setPanel('tags')}>
              <Ionicons name="pricetag-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.moreRowText}>Tag</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.moreRow} onPress={() => setPanel('priority')}>
              <Ionicons name="arrow-up-circle-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.moreRowText}>Priority</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}

        {panel === 'priority' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>Set Priority</Text>
              <View style={{ width: 28 }} />
            </View>
            <View style={styles.priorityRow}>
              {([0, 1, 2, 3, 4] as Priority[]).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityBtn,
                    { borderColor: p === 0 ? colors.bgQuaternary : PRIORITY_COLORS[p] },
                  ]}
                  onPress={() => handleSetPriority(p)}
                >
                  {p > 0 && (
                    <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[p] }]} />
                  )}
                  <Text style={[
                    styles.priorityLabel,
                    { color: p === 0 ? colors.textSecondary : PRIORITY_COLORS[p] },
                  ]}>
                    {PRIORITY_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {panel === 'tags' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>Add Tags</Text>
              <TouchableOpacity
                style={[styles.applyBtn, (selectedTags.size === 0 && !newTagText.trim()) && styles.applyBtnDisabled]}
                onPress={handleApplyTags}
              >
                <Text style={[
                  styles.applyBtnText,
                  (selectedTags.size === 0 && !newTagText.trim()) && styles.applyBtnTextDisabled,
                ]}>
                  Apply
                </Text>
              </TouchableOpacity>
            </View>
            {existingTags.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tagScroll}
                contentContainerStyle={styles.tagScrollContent}
              >
                {existingTags.map(tag => (
                  <TouchableOpacity
                    key={tag}
                    style={[
                      styles.tagChip,
                      selectedTags.has(tag) && { backgroundColor: tagColor(tag) + '33', borderColor: tagColor(tag) },
                    ]}
                    onPress={() => { haptics.tap(); handleTagToggle(tag); }}
                  >
                    <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                    <Text style={[
                      styles.tagChipText,
                      selectedTags.has(tag) && { color: tagColor(tag) },
                    ]}>
                      {tag}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View style={styles.tagInputRow}>
              <TextInput
                style={styles.tagInput}
                placeholder="New tag…"
                placeholderTextColor={colors.textTertiary}
                value={newTagText}
                onChangeText={setNewTagText}
                returnKeyType="done"
                onSubmitEditing={handleApplyTags}
                autoCapitalize="none"
              />
            </View>
          </View>
        )}

        {panel === 'category' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>Move to Category</Text>
              <View style={{ width: 28 }} />
            </View>
            <View style={styles.tagInputRow}>
              <TextInput
                style={styles.tagInput}
                placeholder="Find or add a category…"
                placeholderTextColor={colors.textTertiary}
                value={newCategoryText}
                onChangeText={setNewCategoryText}
                returnKeyType="done"
                onSubmitEditing={handleCategorySubmit}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>
            <ScrollView
              style={styles.categoryList}
              contentContainerStyle={styles.categoryListContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {!categoryQuery && (
                <TouchableOpacity
                  style={styles.categoryChip}
                  onPress={() => handleSetCategory(null)}
                >
                  <Text style={styles.categoryChipText}>None</Text>
                </TouchableOpacity>
              )}
              {filteredCategories.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={styles.categoryChip}
                  onPress={() => handleSetCategory(cat)}
                >
                  <Ionicons name="folder-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.categoryChipText}>{categoryLabel(cat, categories)}</Text>
                </TouchableOpacity>
              ))}
              {categoryQuery !== '' && !exactCategory && (
                <TouchableOpacity
                  style={[styles.categoryChip, styles.categoryCreateChip]}
                  onPress={handleAddNewCategory}
                >
                  <Ionicons name="add" size={13} color={colors.accent} />
                  <Text style={[styles.categoryChipText, styles.categoryCreateChipText]} numberOfLines={1}>
                    Create “{newCategoryText.trim()}”
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        )}

        {panel === 'group' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>Stack Tasks</Text>
              <TouchableOpacity
                style={[styles.applyBtn, !groupTitle.trim() && styles.applyBtnDisabled]}
                onPress={handleApplyGroup}
              >
                <Text style={[styles.applyBtnText, !groupTitle.trim() && styles.applyBtnTextDisabled]}>
                  Create
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.tagInputRow}>
              <TextInput
                style={styles.tagInput}
                placeholder="Stack name, e.g. 'Take supplements'…"
                placeholderTextColor={colors.textTertiary}
                value={groupTitle}
                onChangeText={setGroupTitle}
                returnKeyType="done"
                onSubmitEditing={handleApplyGroup}
                autoFocus
              />
            </View>
          </View>
        )}
      </View>

      <WhenPicker
        visible={whenVisible}
        value={null}
        onConfirm={handleConfirmWhen}
        onClear={() => handleConfirmWhen(null, [])}
        onCancel={() => setWhenVisible(false)}
      />
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  countText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '600',
  },
  selectAllBtn: {
    paddingVertical: 4,
  },
  selectAllText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: '500',
  },
  cancelBtn: {
    padding: 4,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: spacing.xs,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 56,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  subPanel: {
    gap: spacing.sm,
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: '600',
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
  },
  moreRowText: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: '500',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
    paddingBottom: spacing.xs,
  },
  priorityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.full,
    borderWidth: 1.5,
    backgroundColor: colors.bgTertiary,
  },
  priorityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  priorityLabel: {
    fontSize: font.sm,
    fontWeight: '600',
  },
  applyBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  applyBtnDisabled: {
    backgroundColor: colors.bgTertiary,
  },
  applyBtnText: {
    color: colors.onAccent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  applyBtnTextDisabled: {
    color: colors.textTertiary,
  },
  tagScroll: {
    flexGrow: 0,
  },
  tagScrollContent: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.bgQuaternary,
    backgroundColor: colors.bgTertiary,
  },
  tagDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  tagChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '500',
  },
  // Four rows of chips, then it scrolls — enough that a normal set of categories
  // is on screen at once, without the bar growing tall enough to swallow the list
  // it's floating over.
  categoryList: {
    maxHeight: CATEGORY_LIST_MAX_HEIGHT,
    flexGrow: 0,
  },
  categoryListContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.bgQuaternary,
    backgroundColor: colors.bgTertiary,
  },
  categoryChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '500',
  },
  categoryCreateChip: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '33',
    maxWidth: '100%',
  },
  categoryCreateChipText: {
    color: colors.accent,
    flexShrink: 1,
  },
  tagInputRow: {
    paddingBottom: spacing.xs,
  },
  tagInput: {
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
});
