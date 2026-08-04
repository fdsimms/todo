import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTemplateStore } from '../store/useTemplateStore';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { ReorderableList } from '../components/ReorderableList';
import { TemplateItemEditor } from '../components/TemplateItemEditor';
import { TemplateItemQuickAdd } from '../components/TemplateItemQuickAdd';
import { TemplateItemBulkBar } from '../components/TemplateItemBulkBar';
import { TemplateSuggestionsSheet } from '../components/TemplateSuggestionsSheet';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, font, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatOffsetLabel } from '../utils/templateUtils';
import type { TemplateItem } from '../types';

type RootStackParamList = {
  TemplateDetail: { templateId: string };
};

/** "Due 3 days before · Shows 1 day before · Deadline 1 day before · morning" hint under an item row. */
function itemHint(item: TemplateItem): string | null {
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const parts: string[] = [];
  if (item.dueOffsetDays !== null) parts.push(`Due ${lower(formatOffsetLabel(item.dueOffsetDays))}`);
  if (item.deferOffsetDays !== null) parts.push(`Shows ${lower(formatOffsetLabel(item.deferOffsetDays))}`);
  if (item.deadlineOffsetDays !== null) parts.push(`Deadline ${lower(formatOffsetLabel(item.deadlineOffsetDays))}`);
  if (item.timeSegments.length > 0) parts.push(item.timeSegments.join(', '));
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function TemplateDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'TemplateDetail'>>();
  const { templateId } = route.params;
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const templates = useTemplateStore(s => s.templates);
  const deleteItem = useTemplateStore(s => s.deleteItem);
  const reorderItems = useTemplateStore(s => s.reorderItems);
  const deleteItemGroup = useTemplateStore(s => s.deleteItemGroup);
  const groupItems = useTemplateStore(s => s.groupItems);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);

  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<TemplateItem | null>(null);
  const [itemEditorVisible, setItemEditorVisible] = useState(false);
  const [itemEditorDraft, setItemEditorDraft] = useState<Partial<TemplateItem> | null>(null);
  const [suggestVisible, setSuggestVisible] = useState(false);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const template = templates.find(t => t.id === templateId) ?? null;
  const applyTemplateObj = templates.find(t => t.id === applyTemplateId) ?? null;

  const onClose = () => navigation.goBack();

  const handleDeleteItem = (itemId: string) => {
    if (!templateId) return;
    haptics.tap();
    animateLayout();
    deleteItem(templateId, itemId);
  };

  const openItemEditor = (item: TemplateItem | null, draft?: Partial<TemplateItem> | null) => {
    setEditingItem(item);
    setItemEditorDraft(draft ?? null);
    setItemEditorVisible(true);
  };

  const enterSelectionMode = (itemId: string) => {
    animateLayout();
    setSelectionMode(true);
    setSelectedItemIds(new Set([itemId]));
  };

  const toggleItemSelection = (itemId: string) => {
    haptics.tap();
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  const exitSelectionMode = () => {
    animateLayout();
    setSelectionMode(false);
    setSelectedItemIds(new Set());
  };

  const handleBulkDelete = () => {
    if (!templateId) return;
    haptics.impactMedium();
    animateLayout();
    selectedItemIds.forEach(id => deleteItem(templateId, id));
    exitSelectionMode();
  };

  const handleBulkGroup = (title: string) => {
    if (!templateId) return;
    haptics.success();
    animateLayout();
    groupItems(templateId, Array.from(selectedItemIds), title);
    exitSelectionMode();
  };

  const toggleGroupCollapsed = (groupId: string) => {
    haptics.tap();
    animateLayout();
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const handleUngroup = (groupId: string, title: string) => {
    haptics.warning();
    Alert.alert('Unstack', `Remove the "${title}" stack? Its items stay in the template.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unstack',
        style: 'destructive',
        onPress: () => {
          if (!templateId) return;
          animateLayout();
          deleteItemGroup(templateId, groupId);
        },
      },
    ]);
  };

  // Which item in each group renders the header above it (first occurrence in
  // current order), and which items are hidden while their group is collapsed.
  const { firstOfGroup, hiddenByCollapse } = useMemo(() => {
    const first = new Set<string>();
    const hidden = new Set<string>();
    const seen = new Set<string>();
    (template?.items ?? []).forEach(item => {
      if (item.groupId) {
        if (!seen.has(item.groupId)) {
          seen.add(item.groupId);
          first.add(item.id);
        }
        if (collapsedGroups.has(item.groupId)) hidden.add(item.id);
      }
    });
    return { firstOfGroup: first, hiddenByCollapse: hidden };
  }, [template, collapsedGroups]);

  return (
    <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.detailTitle}>
          <View style={[styles.tplIconSm, { backgroundColor: colors.accent + '22' }]}>
            <Ionicons name="copy" size={14} color={colors.accent} />
          </View>
          <Text style={styles.detailTitleText}>{template?.name}</Text>
        </View>
        <View style={styles.detailHeaderActions}>
          {!!anthropicApiKey && (
            <TouchableOpacity
              onPress={() => { haptics.tap(); setSuggestVisible(true); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Suggest tasks with AI"
            >
              <Ionicons name="sparkles-outline" size={22} color={colors.purple} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              if (!template || template.items.length === 0) return;
              haptics.tap();
              setApplyTemplateId(template.id);
            }}
            disabled={!template || template.items.length === 0}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Apply template"
            accessibilityState={{ disabled: !template || template.items.length === 0 }}
          >
            <Ionicons
              name="play-circle-outline"
              size={24}
              color={template && template.items.length > 0 ? colors.accent : colors.textTertiary}
            />
          </TouchableOpacity>
        </View>
      </View>

      <ReorderableList
        data={template?.items ?? []}
        keyExtractor={i => i.id}
        onReorder={data => {
          if (!templateId) return;
          reorderItems(templateId, data.map(i => i.id));
        }}
        contentContainerStyle={[styles.list, selectionMode && styles.listWithBulkBar]}
        renderItem={({ item, drag, isActive }) => {
          const hint = itemHint(item);
          const group = item.groupId ? template?.itemGroups.find(g => g.id === item.groupId) : null;
          const showHeader = group && firstOfGroup.has(item.id);
          const hidden = hiddenByCollapse.has(item.id);
          const categoryEmoji = item.category ? getCategoryByName(item.category)?.emoji ?? null : null;

          return (
            <View>
              {showHeader && group && (
                <TemplateGroupHeader
                  title={group.title}
                  count={template!.items.filter(i => i.groupId === group.id).length}
                  collapsed={collapsedGroups.has(group.id)}
                  colors={colors}
                  styles={styles}
                  onToggle={() => toggleGroupCollapsed(group.id)}
                  onUngroup={() => handleUngroup(group.id, group.title)}
                />
              )}
              {!hidden && (
                <TemplateItemRow
                  item={item}
                  hint={hint}
                  categoryEmoji={categoryEmoji}
                  colors={colors}
                  styles={styles}
                  drag={selectionMode ? undefined : drag}
                  isActive={isActive}
                  selectionMode={selectionMode}
                  selected={selectedItemIds.has(item.id)}
                  onPress={() => (selectionMode ? toggleItemSelection(item.id) : openItemEditor(item))}
                  onDelete={() => handleDeleteItem(item.id)}
                  onSwipeSelect={() => enterSelectionMode(item.id)}
                />
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="list-outline"
            title="No items yet"
            subtitle="Add tasks below — tap one after adding to set dates, tags and more"
            actionLabel={anthropicApiKey ? 'Suggest tasks with AI' : undefined}
            onAction={anthropicApiKey ? () => { haptics.tap(); setSuggestVisible(true); } : undefined}
          />
        }
      />

      {!selectionMode && (
        <View style={styles.detailFabContainer}>
          <PressableScale
            style={[styles.fab, shadows.fab, { shadowColor: colors.accent }]}
            pressScale={0.9}
            onPress={() => { haptics.impactLight(); setQuickAddVisible(true); }}
            accessibilityLabel="Add item"
          >
            <Ionicons name="add" size={24} color={colors.onAccent} />
          </PressableScale>
        </View>
      )}

      {selectionMode && (
        <TemplateItemBulkBar
          selectedCount={selectedItemIds.size}
          onDelete={handleBulkDelete}
          onGroup={handleBulkGroup}
          onCancel={exitSelectionMode}
          bottomInset={insets.bottom}
        />
      )}

      {template && (
        <TemplateItemQuickAdd
          visible={quickAddVisible}
          templateId={template.id}
          onClose={() => setQuickAddVisible(false)}
          onOpenFull={(draft) => {
            setQuickAddVisible(false);
            openItemEditor(null, draft);
          }}
        />
      )}

      {template && (
        <TemplateItemEditor
          visible={itemEditorVisible}
          templateId={template.id}
          item={editingItem}
          initialDraft={itemEditorDraft}
          onClose={() => setItemEditorVisible(false)}
        />
      )}

      {template && (
        <TemplateSuggestionsSheet
          visible={suggestVisible}
          templateId={template.id}
          templateName={template.name}
          existingTitles={template.items.map(i => i.title)}
          onClose={() => setSuggestVisible(false)}
        />
      )}

      {/* Nested inside this screen's own tree — a sibling top-level Modal
          can't present over it on iOS while this screen is open (it silently
          waits until the screen dismisses). */}
      {template && (
        <ApplyTemplateSheet
          visible={applyTemplateObj !== null}
          template={applyTemplateObj}
          onClose={() => setApplyTemplateId(null)}
        />
      )}
    </View>
  );
}

/** Item row: swipe left reveals both Delete and Select (enters bulk mode). */
function TemplateItemRow({
  item, hint, categoryEmoji, colors, styles, drag, isActive, selectionMode, selected, onPress, onDelete, onSwipeSelect,
}: {
  item: TemplateItem;
  hint: string | null;
  categoryEmoji: string | null;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  drag?: () => void;
  isActive: boolean;
  selectionMode: boolean;
  selected: boolean;
  onPress: () => void;
  onDelete: () => void;
  onSwipeSelect: () => void;
}) {
  const renderLeftActions = () => (
    <View style={styles.leftActionsRow}>
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={`Delete item ${item.title}`}
      >
        <Ionicons name="trash" size={iconSize.md} color={colors.text} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.selectAction}
        onPress={onSwipeSelect}
        accessibilityRole="button"
        accessibilityLabel={`Select ${item.title}`}
      >
        <Ionicons name="checkbox-outline" size={iconSize.md} color={colors.onAccent} />
      </TouchableOpacity>
    </View>
  );

  const rowBody = (
    <TouchableOpacity
      style={[styles.itemRow, isActive && styles.itemRowActive]}
      onPress={onPress}
      onLongPress={selectionMode ? undefined : drag}
      delayLongPress={interaction.delayLongPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${item.optional ? ', optional' : ''}`}
      accessibilityHint="Double tap to edit item"
    >
      {selectionMode && (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={20}
          color={selected ? colors.accent : colors.textTertiary}
        />
      )}
      <View style={styles.itemInfo}>
        <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
        {hint && <Text style={styles.itemHintText} numberOfLines={1}>{hint}</Text>}
        {categoryEmoji !== null || item.category ? (
          <View style={styles.categoryRow}>
            <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textTertiary} />
            <Text style={styles.itemHintText} numberOfLines={1}>
              {categoryEmoji ? `${categoryEmoji} ${item.category}` : item.category}
            </Text>
          </View>
        ) : null}
      </View>
      {item.optional && (
        <View style={styles.optionalBadge}>
          <Text style={styles.optionalBadgeText}>Optional</Text>
        </View>
      )}
      {!selectionMode && <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
    </TouchableOpacity>
  );

  if (selectionMode) return rowBody;

  return (
    <Swipeable renderLeftActions={renderLeftActions} overshootLeft={false}>
      {rowBody}
    </Swipeable>
  );
}

/** Collapsible header above a template item group. */
function TemplateGroupHeader({
  title, count, collapsed, colors, styles, onToggle, onUngroup,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onToggle: () => void;
  onUngroup: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.groupHeader}
      onPress={onToggle}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${title}, ${count} item${count === 1 ? '' : 's'}`}
    >
      <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={14} color={colors.textTertiary} />
      <Ionicons name="layers-outline" size={14} color={colors.textSecondary} />
      <Text style={styles.groupHeaderText}>{title}</Text>
      <Text style={styles.groupHeaderCount}>{count}</Text>
      <TouchableOpacity onPress={onUngroup} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Unstack ${title}`}>
        <Ionicons name="close-circle-outline" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  detailRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  detailTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  detailTitleText: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: '600',
  },
  tplIconSm: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingTop: spacing.sm,
    paddingBottom: 120,
  },
  listWithBulkBar: {
    paddingBottom: 200,
  },
  detailFabContainer: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    zIndex: 20,
  },
  fab: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  deleteAction: {
    backgroundColor: colors.red,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    gap: 5,
  },
  selectAction: {
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    gap: 5,
  },
  leftActionsRow: {
    flexDirection: 'row',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.sm,
  },
  itemRowActive: {
    opacity: 0.85,
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    color: colors.text,
    fontSize: font.md,
  },
  itemHintText: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  optionalBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  optionalBadgeText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: '600',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  groupHeaderText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  groupHeaderCount: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
});
