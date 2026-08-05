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
import { Fab } from '../components/Fab';
import { ReorderableList } from '../components/ReorderableList';
import { TemplateItemEditor } from '../components/TemplateItemEditor';
import { TemplateItemQuickAdd } from '../components/TemplateItemQuickAdd';
import { TemplateItemBulkBar } from '../components/TemplateItemBulkBar';
import { TemplateSuggestionsSheet } from '../components/TemplateSuggestionsSheet';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { NestedTemplatePicker } from '../components/NestedTemplatePicker';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { anchorLabel, formatOffsetLabel, getDirectBrokenRefItemIds } from '../utils/templateUtils';
import type { TaskTemplate, TemplateItem } from '../types';

type RootStackParamList = {
  TemplateDetail: { templateId: string };
};

/** "Due same day · shows 1 day before · from start date · morning" hint under an item row. The anchor is named once at the end rather than repeated per offset. */
function itemHint(item: TemplateItem): string | null {
  const lower = (s: string) => s.toLowerCase();
  const parts: string[] = [];
  if (item.dueOffsetDays !== null) parts.push(`Due ${lower(formatOffsetLabel(item.dueOffsetDays))}`);
  if (item.deferOffsetDays !== null) parts.push(`shows ${lower(formatOffsetLabel(item.deferOffsetDays))}`);
  if (item.deadlineOffsetDays !== null) parts.push(`deadline ${lower(formatOffsetLabel(item.deadlineOffsetDays))}`);
  if (parts.length > 0) parts.push(`from ${anchorLabel(item.anchor).toLowerCase()}`);
  if (item.timeSegments.length > 0) parts.push(item.timeSegments.join(', '));
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function TemplateDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'TemplateDetail'>>();
  const { templateId } = route.params;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const templates = useTemplateStore(s => s.templates);
  const deleteItem = useTemplateStore(s => s.deleteItem);
  const updateItem = useTemplateStore(s => s.updateItem);
  const addItem = useTemplateStore(s => s.addItem);
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
  // Nested-template picker: null = closed; a string itemId means "replace
  // that item's reference"; the sentinel below means "add a new ref item".
  const [nestedPickerReplacingId, setNestedPickerReplacingId] = useState<string | null>(null);
  const [nestedPickerVisible, setNestedPickerVisible] = useState(false);

  const template = templates.find(t => t.id === templateId) ?? null;
  const applyTemplateObj = templates.find(t => t.id === applyTemplateId) ?? null;

  const templatesById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates]);
  const brokenItemIds = useMemo(
    () => (template ? getDirectBrokenRefItemIds(template, templatesById) : new Set<string>()),
    [template, templatesById]
  );

  const openNestedPicker = (replacingItemId: string | null) => {
    haptics.tap();
    setNestedPickerReplacingId(replacingItemId);
    setNestedPickerVisible(true);
  };

  const handleNestedTemplateSelected = (target: TaskTemplate) => {
    if (!templateId) return;
    if (nestedPickerReplacingId) {
      updateItem(templateId, nestedPickerReplacingId, {
        refTemplateId: target.id,
        refTemplateName: target.name,
      });
    } else {
      addItem(templateId, {
        title: target.name,
        refTemplateId: target.id,
        refTemplateName: target.name,
      });
    }
  };

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
              name="chevron-down-circle-outline"
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
          const resolvedRefTemplate = item.refTemplateId ? templatesById.get(item.refTemplateId) ?? null : null;
          const broken = brokenItemIds.has(item.id);

          const handlePress = () => {
            if (selectionMode) {
              toggleItemSelection(item.id);
            } else if (broken) {
              // Broken rows expose Replace/Remove inline instead of navigating.
              return;
            } else if (resolvedRefTemplate) {
              haptics.tap();
              (navigation as any).navigate('TemplateDetail', { templateId: resolvedRefTemplate.id });
            } else {
              openItemEditor(item);
            }
          };

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
                  resolvedRefTemplate={resolvedRefTemplate}
                  broken={broken}
                  colors={colors}
                  styles={styles}
                  drag={selectionMode ? undefined : drag}
                  isActive={isActive}
                  selectionMode={selectionMode}
                  selected={selectedItemIds.has(item.id)}
                  onPress={handlePress}
                  onDelete={() => handleDeleteItem(item.id)}
                  onSwipeSelect={() => enterSelectionMode(item.id)}
                  onReplace={() => openNestedPicker(item.id)}
                />
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="list-outline"
            title="No items yet"
            subtitle="Tap + to add a task — then tap it in the list to set dates, tags and more"
            actionLabel={anthropicApiKey ? 'Suggest tasks with AI' : undefined}
            onAction={anthropicApiKey ? () => { haptics.tap(); setSuggestVisible(true); } : undefined}
          />
        }
      />

      {!selectionMode && (
        <Fab
          onPress={() => setQuickAddVisible(true)}
          accessibilityLabel="Add item"
          bottom={spacing.xl}
          size={48}
        />
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
          templateName={template.name}
          onClose={() => setQuickAddVisible(false)}
          onOpenFull={(draft) => {
            setQuickAddVisible(false);
            openItemEditor(null, draft);
          }}
          onAddNested={() => {
            setQuickAddVisible(false);
            openNestedPicker(null);
          }}
        />
      )}

      {template && (
        <NestedTemplatePicker
          visible={nestedPickerVisible}
          currentTemplateId={template.id}
          onClose={() => setNestedPickerVisible(false)}
          onSelect={handleNestedTemplateSelected}
        />
      )}

      {template && (
        <TemplateItemEditor
          visible={itemEditorVisible}
          templateId={template.id}
          templateName={template.name}
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

/** Item row: swipe left reveals Select (enters bulk mode). */
function TemplateItemRow({
  item, hint, categoryEmoji, resolvedRefTemplate, broken, colors, styles, drag, isActive, selectionMode, selected, onPress, onDelete, onSwipeSelect, onReplace,
}: {
  item: TemplateItem;
  hint: string | null;
  categoryEmoji: string | null;
  /** The live template this item references, or null if it isn't a reference item. */
  resolvedRefTemplate: TaskTemplate | null;
  /** True if this item references a template that no longer exists. */
  broken: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  drag?: () => void;
  isActive: boolean;
  selectionMode: boolean;
  selected: boolean;
  onPress: () => void;
  onDelete: () => void;
  onSwipeSelect: () => void;
  onReplace: () => void;
}) {
  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.selectAction}
      onPress={onSwipeSelect}
      accessibilityRole="button"
      accessibilityLabel={`Select ${item.title}`}
    >
      <Ionicons name="checkbox-outline" size={iconSize.md} color={colors.onAccent} />
    </TouchableOpacity>
  );

  const isRef = resolvedRefTemplate !== null || broken;
  const refTitle = resolvedRefTemplate ? resolvedRefTemplate.name : item.refTemplateName || 'Nested template';
  const refCount = resolvedRefTemplate?.items.length ?? 0;

  const rowBody = (
    <TouchableOpacity
      style={[styles.itemRow, isActive && styles.itemRowActive, broken && styles.itemRowBroken]}
      onPress={onPress}
      onLongPress={selectionMode ? undefined : drag}
      delayLongPress={interaction.delayLongPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={
        broken
          ? `${refTitle} was deleted, remove or replace this`
          : isRef
            ? `Nested template ${refTitle}, ${refCount} item${refCount === 1 ? '' : 's'}`
            : `${item.title}${item.optional ? ', optional' : ''}`
      }
      accessibilityHint={broken ? undefined : isRef ? 'Double tap to open the nested template' : 'Double tap to edit item'}
    >
      {selectionMode && (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={20}
          color={selected ? colors.accent : colors.textTertiary}
        />
      )}
      {!selectionMode && isRef && (
        <Ionicons
          name={broken ? 'alert-circle' : 'git-branch-outline'}
          size={20}
          color={broken ? colors.warning : colors.accent}
        />
      )}
      <View style={styles.itemInfo}>
        {broken ? (
          <>
            <Text style={[styles.itemTitle, styles.itemTitleBroken]} numberOfLines={1}>{refTitle} was deleted</Text>
            <Text style={styles.itemHintBroken} numberOfLines={1}>Remove or replace this</Text>
          </>
        ) : isRef ? (
          <>
            <Text style={styles.itemTitle} numberOfLines={1}>{refTitle}</Text>
            <Text style={styles.itemHintText} numberOfLines={1}>
              {refCount === 0 ? 'No items' : `${refCount} item${refCount === 1 ? '' : 's'}`}
            </Text>
          </>
        ) : (
          <>
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
          </>
        )}
      </View>
      {item.optional && !broken && (
        <View style={styles.optionalBadge}>
          <Text style={styles.optionalBadgeText}>Optional</Text>
        </View>
      )}
      {!selectionMode && broken && (
        <View style={styles.brokenActions}>
          <TouchableOpacity
            onPress={onReplace}
            hitSlop={8}
            style={styles.brokenActionBtn}
            accessibilityRole="button"
            accessibilityLabel="Replace nested template"
          >
            <Ionicons name="swap-horizontal-outline" size={16} color={colors.warning} />
            <Text style={styles.brokenActionText}>Replace</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={8}
            style={styles.brokenActionBtn}
            accessibilityRole="button"
            accessibilityLabel="Remove nested template item"
          >
            <Ionicons name="trash-outline" size={16} color={colors.warning} />
            <Text style={styles.brokenActionText}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}
      {!selectionMode && !broken && isRef && (
        <TouchableOpacity
          onPress={onReplace}
          hitSlop={8}
          style={styles.rowButton}
          accessibilityRole="button"
          accessibilityLabel="Swap which template this points at"
        >
          <Ionicons name="swap-horizontal-outline" size={14} color={colors.textTertiary} />
          <Text style={styles.rowButtonText}>Swap</Text>
        </TouchableOpacity>
      )}
      {!selectionMode && !broken && <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
    </TouchableOpacity>
  );

  if (selectionMode) return rowBody;

  return (
    <Swipeable renderRightActions={renderRightActions}>
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
  selectAction: {
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    gap: 5,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
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
  itemRowBroken: {
    backgroundColor: colors.warningBg,
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    color: colors.text,
    fontSize: font.md,
  },
  itemTitleBroken: {
    color: colors.warning,
    fontWeight: '600',
  },
  itemHintText: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  itemHintBroken: {
    color: colors.warning,
    fontSize: font.xs,
  },
  brokenActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  brokenActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  brokenActionText: {
    color: colors.warning,
    fontSize: font.xs,
    fontWeight: '600',
  },
  rowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  rowButtonText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: '600',
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
