import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTemplateStore } from '../store/useTemplateStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
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
import { TITLE_MAX_LENGTH } from '../types';
import type { TemplateItem, TaskTemplate } from '../types';

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

export function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const templates = useTemplateStore(useShallow(s => s.templates));
  const addTemplate = useTemplateStore(s => s.addTemplate);
  const deleteTemplate = useTemplateStore(s => s.deleteTemplate);
  const reorderTemplates = useTemplateStore(s => s.reorderTemplates);
  const deleteItem = useTemplateStore(s => s.deleteItem);
  const reorderItems = useTemplateStore(s => s.reorderItems);
  const deleteItemGroup = useTemplateStore(s => s.deleteItemGroup);
  const groupItems = useTemplateStore(s => s.groupItems);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);

  const [addingTemplate, setAddingTemplate] = useState(false);
  const [newTemplateText, setNewTemplateText] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<TemplateItem | null>(null);
  const [itemEditorVisible, setItemEditorVisible] = useState(false);
  const [itemEditorDraft, setItemEditorDraft] = useState<Partial<TemplateItem> | null>(null);
  const [suggestVisible, setSuggestVisible] = useState(false);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) ?? null;
  const applyTemplateObj = templates.find(t => t.id === applyTemplateId) ?? null;

  const handleStartAdding = () => {
    haptics.impactLight();
    animateLayout();
    setAddingTemplate(true);
  };

  const handleAddTemplate = () => {
    const trimmed = newTemplateText.trim();
    if (trimmed) {
      haptics.success();
      animateLayout();
      const tpl = addTemplate(trimmed);
      // Drop straight into the editor so the new template doesn't sit empty.
      setSelectedTemplateId(tpl.id);
    }
    setNewTemplateText('');
    setAddingTemplate(false);
  };

  const handleDeleteTemplate = (id: string, name: string) => {
    haptics.warning();
    Alert.alert(
      'Delete Template',
      `Delete "${name}"? Tasks already created from it are unaffected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (selectedTemplateId === id) setSelectedTemplateId(null);
            animateLayout();
            deleteTemplate(id);
          },
        },
      ]
    );
  };

  const handleDeleteItem = (itemId: string) => {
    if (!selectedTemplateId) return;
    haptics.tap();
    animateLayout();
    deleteItem(selectedTemplateId, itemId);
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
    if (!selectedTemplateId) return;
    haptics.impactMedium();
    animateLayout();
    selectedItemIds.forEach(id => deleteItem(selectedTemplateId, id));
    exitSelectionMode();
  };

  const handleBulkGroup = (title: string) => {
    if (!selectedTemplateId) return;
    haptics.success();
    animateLayout();
    groupItems(selectedTemplateId, Array.from(selectedItemIds), title);
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
    Alert.alert('Ungroup', `Remove the "${title}" group? Its items stay in the template.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Ungroup',
        style: 'destructive',
        onPress: () => {
          if (!selectedTemplateId) return;
          animateLayout();
          deleteItemGroup(selectedTemplateId, groupId);
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
    (selectedTemplate?.items ?? []).forEach(item => {
      if (item.groupId) {
        if (!seen.has(item.groupId)) {
          seen.add(item.groupId);
          first.add(item.id);
        }
        if (collapsedGroups.has(item.groupId)) hidden.add(item.id);
      }
    });
    return { firstOfGroup: first, hiddenByCollapse: hidden };
  }, [selectedTemplate, collapsedGroups]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Templates" />

      {addingTemplate && (
        <View style={styles.addRow}>
          <View style={[styles.tplIcon, { backgroundColor: colors.bgSecondary }]}>
            <Ionicons name="copy-outline" size={18} color={colors.textTertiary} />
          </View>
          <TextInput
            style={styles.addInput}
            value={newTemplateText}
            onChangeText={setNewTemplateText}
            placeholder="Template name"
            placeholderTextColor={colors.textTertiary}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleAddTemplate}
            onBlur={() => {
              if (!newTemplateText.trim()) setAddingTemplate(false);
            }}
          />
          <TouchableOpacity onPress={handleAddTemplate} style={styles.addConfirm} activeOpacity={interaction.activeOpacity} accessibilityRole="button" accessibilityLabel="Confirm new template">
            <Ionicons name="checkmark" size={20} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setNewTemplateText(''); setAddingTemplate(false); }}
            style={styles.addCancel}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Ionicons name="close" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      <ReorderableList
        data={templates}
        keyExtractor={t => t.id}
        onReorder={data => reorderTemplates(data.map(t => t.id))}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !addingTemplate ? (
            <EmptyState
              icon="copy-outline"
              title="No templates yet"
              subtitle="Create a reusable group of tasks — like a pre-vacation checklist — and add them all in one tap"
              actionLabel="Create template"
              onAction={handleStartAdding}
              bottomOffset={tabBarHeight}
            />
          ) : null
        }
        renderItem={({ item: tpl, drag }) => (
          <TemplateRow
            template={tpl}
            colors={colors}
            styles={styles}
            drag={drag}
            onPress={() => setSelectedTemplateId(tpl.id)}
            onApply={() => {
              if (tpl.items.length === 0) {
                setSelectedTemplateId(tpl.id);
                return;
              }
              haptics.tap();
              setApplyTemplateId(tpl.id);
            }}
            onDelete={() => handleDeleteTemplate(tpl.id, tpl.name)}
          />
        )}
      />

      <View style={[styles.fabContainer, { bottom: insets.bottom + tabBarHeight + spacing.md }]}>
        <PressableScale
          style={[styles.fab, shadows.fab, { shadowColor: colors.accent }]}
          pressScale={0.9}
          onPress={handleStartAdding}
          accessibilityLabel="Add template"
        >
          <Ionicons name="add" size={28} color={colors.onAccent} />
        </PressableScale>
      </View>

      {/* Template editor modal */}
      <Modal
        visible={selectedTemplate !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedTemplateId(null)}
      >
        <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setSelectedTemplateId(null)} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.detailTitle}>
              <View style={[styles.tplIconSm, { backgroundColor: colors.accent + '22' }]}>
                <Ionicons name="copy" size={14} color={colors.accent} />
              </View>
              <Text style={styles.detailTitleText}>{selectedTemplate?.name}</Text>
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
                  if (!selectedTemplate || selectedTemplate.items.length === 0) return;
                  haptics.tap();
                  setApplyTemplateId(selectedTemplate.id);
                }}
                disabled={!selectedTemplate || selectedTemplate.items.length === 0}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Apply template"
                accessibilityState={{ disabled: !selectedTemplate || selectedTemplate.items.length === 0 }}
              >
                <Ionicons
                  name="play-circle-outline"
                  size={24}
                  color={selectedTemplate && selectedTemplate.items.length > 0 ? colors.accent : colors.textTertiary}
                />
              </TouchableOpacity>
            </View>
          </View>

          <ReorderableList
            data={selectedTemplate?.items ?? []}
            keyExtractor={i => i.id}
            onReorder={data => {
              if (!selectedTemplateId) return;
              reorderItems(selectedTemplateId, data.map(i => i.id));
            }}
            contentContainerStyle={[styles.list, selectionMode && styles.listWithBulkBar]}
            renderItem={({ item, drag, isActive }) => {
              const hint = itemHint(item);
              const group = item.groupId ? selectedTemplate?.itemGroups.find(g => g.id === item.groupId) : null;
              const showHeader = group && firstOfGroup.has(item.id);
              const hidden = hiddenByCollapse.has(item.id);
              const categoryEmoji = item.category ? getCategoryByName(item.category)?.emoji ?? null : null;

              return (
                <View>
                  {showHeader && group && (
                    <TemplateGroupHeader
                      title={group.title}
                      count={selectedTemplate!.items.filter(i => i.groupId === group.id).length}
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
                style={[styles.fab, styles.fabSmall, shadows.fab, { shadowColor: colors.accent }]}
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

          {selectedTemplate && (
            <TemplateItemQuickAdd
              visible={quickAddVisible}
              templateId={selectedTemplate.id}
              onClose={() => setQuickAddVisible(false)}
              onOpenFull={(draft) => {
                setQuickAddVisible(false);
                openItemEditor(null, draft);
              }}
            />
          )}

          {selectedTemplate && (
            <TemplateItemEditor
              visible={itemEditorVisible}
              templateId={selectedTemplate.id}
              item={editingItem}
              initialDraft={itemEditorDraft}
              onClose={() => setItemEditorVisible(false)}
            />
          )}

          {selectedTemplate && (
            <TemplateSuggestionsSheet
              visible={suggestVisible}
              templateId={selectedTemplate.id}
              templateName={selectedTemplate.name}
              existingTitles={selectedTemplate.items.map(i => i.title)}
              onClose={() => setSuggestVisible(false)}
            />
          )}

          {/* Nested inside the editor's own Modal — a sibling top-level Modal
              can't present over it on iOS while the editor is open (it silently
              waits until the editor dismisses). */}
          {selectedTemplate && (
            <ApplyTemplateSheet
              visible={applyTemplateObj !== null}
              template={applyTemplateObj}
              onClose={() => setApplyTemplateId(null)}
            />
          )}
        </View>
      </Modal>

      {/* Used only when applying from the template list, i.e. the editor is closed. */}
      <ApplyTemplateSheet
        visible={applyTemplateObj !== null && selectedTemplate === null}
        template={applyTemplateObj}
        onClose={() => setApplyTemplateId(null)}
      />
    </View>
  );
}

/** Template list row: swipe left to reveal Delete. */
function TemplateRow({
  template, colors, styles, drag, onPress, onApply, onDelete,
}: {
  template: TaskTemplate;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  drag: () => void;
  onPress: () => void;
  onApply: () => void;
  onDelete: () => void;
}) {
  const renderLeftActions = () => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={onDelete}
      accessibilityRole="button"
      accessibilityLabel={`Delete template ${template.name}`}
    >
      <Ionicons name="trash" size={iconSize.md} color={colors.text} />
    </TouchableOpacity>
  );

  return (
    <Swipeable renderLeftActions={renderLeftActions} overshootLeft={false}>
      <TouchableOpacity
        style={styles.tplRow}
        onPress={onPress}
        onLongPress={drag}
        delayLongPress={interaction.delayLongPress}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`${template.name}, ${template.items.length === 0 ? 'no items' : `${template.items.length} item${template.items.length === 1 ? '' : 's'}`}`}
        accessibilityHint="Double tap to edit template"
      >
        <View style={[styles.tplIcon, { backgroundColor: colors.accent + '22' }]}>
          <Ionicons name="copy" size={18} color={colors.accent} />
        </View>
        <View style={styles.tplInfo}>
          <Text style={styles.tplName}>{template.name}</Text>
          <Text style={styles.tplHint}>
            {template.items.length === 0
              ? 'No items'
              : `${template.items.length} item${template.items.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onApply}
          style={styles.rowButton}
          activeOpacity={interaction.activeOpacity}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Apply template ${template.name}`}
        >
          <Ionicons name="play-circle-outline" size={18} color={colors.accent} />
        </TouchableOpacity>
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      </TouchableOpacity>
    </Swipeable>
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
      <TouchableOpacity onPress={onUngroup} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Ungroup ${title}`}>
        <Ionicons name="close-circle-outline" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Mirrors the inset-grouped card footprint of the template rows below.
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
    fontWeight: '500',
    paddingVertical: 0,
  },
  addConfirm: {
    padding: 4,
  },
  addCancel: {
    padding: 4,
  },
  list: {
    paddingTop: spacing.sm,
    paddingBottom: 120,
  },
  listWithBulkBar: {
    paddingBottom: 200,
  },
  // Same inset-grouped card footprint as TaskItem rows.
  tplRow: {
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
  tplIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tplInfo: {
    flex: 1,
    gap: 2,
  },
  tplName: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: '500',
  },
  tplHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  rowButton: {
    padding: 4,
  },
  fabContainer: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 20,
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  fabSmall: { width: 48, height: 48, borderRadius: 24 },
  detailFabContainer: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    zIndex: 20,
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
