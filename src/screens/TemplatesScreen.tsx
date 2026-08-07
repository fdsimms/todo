import React, { useState, useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTemplateStore } from '../store/useTemplateStore';
import { useTemplateCategoryStore } from '../store/useTemplateCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { QuickAddNameSheet } from '../components/QuickAddNameSheet';
import { Fab, FAB_SIZE } from '../components/Fab';
import { ReorderableList } from '../components/ReorderableList';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { TemplateEditor } from '../components/TemplateEditor';
import { ListBulkBar } from '../components/ListBulkBar';
import { useRowSelection } from '../hooks/useRowSelection';
import { groupTemplatesByCategory, resolveTemplateDrop } from '../utils/templateGrouping';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { templateHasBrokenRefs, templateHasMissingRefs } from '../utils/templateUtils';
import type { TaskTemplate } from '../types';

export function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const templates = useTemplateStore(useShallow(s => s.templates));
  // Flags a template whose items name a category or tag that's since been
  // deleted or renamed — nothing rewrites templates when that happens, so this
  // is the only place you'd find out before applying it (see findMissingRefs).
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const addTemplate = useTemplateStore(s => s.addTemplate);
  const reorderTemplatesWithCategoryUpdates = useTemplateStore(s => s.reorderTemplatesWithCategoryUpdates);
  const bulkSetTemplateCategory = useTemplateStore(s => s.bulkSetTemplateCategory);
  const bulkDeleteTemplates = useTaskStore(s => s.bulkDeleteTemplates);
  const templateCategories = useTemplateCategoryStore(useShallow(s => s.categories));
  const addTemplateCategory = useTemplateCategoryStore(s => s.addCategory);

  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);

  // Selection is entered from the header rather than from a row: both of a
  // row's gestures are already spoken for here — tap opens the template, long
  // press starts a reorder drag.
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
  } = useRowSelection();

  const applyTemplateObj = templates.find(t => t.id === applyTemplateId) ?? null;
  const templatesById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates]);

  const templateCategoryOrder = useMemo(
    () => [...templateCategories].sort((a, b) => a.sortOrder - b.sortOrder).map(c => c.name),
    [templateCategories]
  );
  const templateListItems = useMemo(
    () => groupTemplatesByCategory(templates, templateCategoryOrder),
    [templates, templateCategoryOrder]
  );
  // What the bulk bar offers to file into: the registered categories, plus any
  // name a template still carries that was never registered — the list shows a
  // section for those (see groupTemplatesByCategory), so the picker has to name
  // them too or moving a template back into one would mean retyping it.
  const bulkCategoryOptions = useMemo(
    () => Array.from(new Set([
      ...templateCategoryOrder,
      ...templates.map(t => t.category).filter((c): c is string => !!c).sort(),
    ])),
    [templates, templateCategoryOrder]
  );

  const handleAddTemplate = (name: string) => {
    animateLayout();
    const tpl = addTemplate(name);
    // Drop straight into the editor so the new template doesn't sit empty.
    (navigation as any).navigate('TemplateDetail', { templateId: tpl.id });
  };

  // Extra bottom padding so the last rows aren't hidden behind the floating
  // bulk bar, same as the other bulk-selecting screens.
  const selectionListPadding = tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm;

  const handleBulkSetCategory = (category: string | null) => {
    animateLayout();
    bulkSetTemplateCategory(Array.from(selectedIds), category);
    exitSelection();
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const plural = ids.length === 1 ? 'template' : 'templates';
    haptics.warning();
    Alert.alert(
      `Delete ${ids.length} ${plural}?`,
      `You're about to delete ${ids.length} ${plural}. You can undo this by shaking your phone right after.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            bulkDeleteTemplates(ids);
            exitSelection();
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Templates"
        actions={templates.length > 0 ? [
          {
            icon: 'checkmark-circle-outline',
            onPress: () => (selectionMode ? exitSelection() : enterSelectionMode()),
            active: selectionMode,
            accessibilityLabel: selectionMode ? 'Done selecting' : 'Select templates',
          },
        ] : undefined}
      />

      <ReorderableList
        data={templateListItems}
        keyExtractor={item => item.key}
        onReorder={data => {
          const { templateIds, categoryUpdates } = resolveTemplateDrop(data, templateCategoryOrder);
          reorderTemplatesWithCategoryUpdates(templateIds, categoryUpdates);
        }}
        contentContainerStyle={templateListItems.length === 0 ? styles.emptyContainer : styles.list}
        // No spacer when the list is empty — the empty state centres itself in
        // whatever box the content container gives it, and a fixed-height
        // footer takes that height off the bottom of the box. When there are
        // rows, the spacer clears whichever thing is floating over them.
        ListFooterComponent={
          templateListItems.length === 0
            ? null
            : <View style={{ height: selectionMode ? selectionListPadding : tabBarHeight + FAB_SIZE + spacing.xl }} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="copy-outline"
            title="No templates yet"
            subtitle="Create a reusable stack of tasks — like a pre-vacation checklist — and add them all in one tap"
            actionLabel="Create template"
            onAction={() => setQuickAddVisible(true)}
            bottomOffset={tabBarHeight}
          />
        }
        renderItem={({ item, drag }) => {
          if (item.type === 'header') {
            return (
              <View style={styles.categorySectionHeader}>
                <Text style={styles.categorySectionHeaderText}>{item.label}</Text>
              </View>
            );
          }
          const tpl = item.template;
          return (
            <TemplateRow
              template={tpl}
              broken={templateHasBrokenRefs(tpl, templatesById)}
              missingRefs={templateHasMissingRefs(tpl, allCategories, allTags)}
              colors={colors}
              styles={styles}
              // Reordering is off while selecting: the long press that would
              // start a drag is how a mis-tapped row gets picked up instead.
              drag={selectionMode ? undefined : drag}
              selectionMode={selectionMode}
              selected={selectedIds.has(tpl.id)}
              onPress={() =>
                selectionMode
                  ? toggleSelection(tpl.id)
                  : (navigation as any).navigate('TemplateDetail', { templateId: tpl.id })
              }
              onEdit={() => setEditingTemplate(tpl)}
              onApply={() => {
                if (tpl.items.length === 0) {
                  (navigation as any).navigate('TemplateDetail', { templateId: tpl.id });
                  return;
                }
                haptics.tap();
                setApplyTemplateId(tpl.id);
              }}
            />
          );
        }}
      />

      {/* The bulk bar sits where the button does, and adding a template isn't
          something you're doing mid-selection anyway. */}
      {!selectionMode && (
        <Fab
          onPress={() => setQuickAddVisible(true)}
          accessibilityLabel="Add template"
          bottom={insets.bottom + tabBarHeight + spacing.md}
        />
      )}

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={templates.length}
          category={{
            title: 'Move to Category',
            options: bulkCategoryOptions,
            onSet: handleBulkSetCategory,
            onCreate: name => addTemplateCategory(name),
          }}
          actions={[
            { key: 'delete', icon: 'trash', label: 'Delete', tone: 'destructive', onPress: handleBulkDelete },
          ]}
          onSelectAll={() => selectAll(templates.map(t => t.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <QuickAddNameSheet
        visible={quickAddVisible}
        placeholder="New template…"
        onSubmit={handleAddTemplate}
        onClose={() => setQuickAddVisible(false)}
      />

      {/* Used when applying from the template list. */}
      <ApplyTemplateSheet
        visible={applyTemplateObj !== null}
        template={applyTemplateObj}
        onClose={() => setApplyTemplateId(null)}
      />

      <TemplateEditor
        visible={editingTemplate !== null}
        template={editingTemplate}
        onClose={() => setEditingTemplate(null)}
      />
    </View>
  );
}

/**
 * Template list row. No swipe: bulk mode is entered from the header here (both
 * of the row's gestures are taken — tap opens, long press reorders), and
 * there's nothing to reschedule. Deleting used to be a swipe *right* — the
 * direction that reschedules everywhere else — and now lives in
 * TemplateEditor behind the ⋯ button, or in the bulk bar.
 */
function TemplateRow({
  template, broken, missingRefs, colors, styles, drag, selectionMode, selected, onPress, onEdit, onApply,
}: {
  template: TaskTemplate;
  /** True if a template this one nests (at any depth) was deleted or is itself broken. */
  broken: boolean;
  /** True if one of this template's own items names a category or tag that no longer exists. */
  missingRefs: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  /** Omitted while selecting, which is what turns reordering off. */
  drag?: () => void;
  selectionMode: boolean;
  selected: boolean;
  onPress: () => void;
  onEdit: () => void;
  onApply: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tplRow, selectionMode && selected && styles.tplRowSelected]}
      onPress={onPress}
      onLongPress={drag}
      delayLongPress={interaction.delayLongPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole={selectionMode ? 'checkbox' : 'button'}
      accessibilityState={selectionMode ? { checked: selected } : undefined}
      accessibilityLabel={`${template.name}, ${template.items.length === 0 ? 'no items' : `${template.items.length} item${template.items.length === 1 ? '' : 's'}`}${broken ? ', a nested template is missing' : missingRefs ? ', uses a category or tag that no longer exists' : ''}`}
      accessibilityHint={selectionMode ? 'Double tap to select template' : 'Double tap to edit template'}
    >
      {selectionMode ? (
        // Takes the icon tile's place rather than sitting beside it: every row
        // shifts by the same amount, so the names stay in one column.
        <View style={styles.tplSelect}>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={selected ? colors.accent : colors.textTertiary}
          />
        </View>
      ) : (
        <View style={[styles.tplIcon, { backgroundColor: colors.accentSubtle }]}>
          <Ionicons name="copy" size={18} color={colors.accent} />
        </View>
      )}
      <View style={styles.tplInfo}>
        <View style={styles.tplNameRow}>
          <Text style={styles.tplName}>{template.name}</Text>
          {/* One glyph for both faults rather than two side by side — either
              way the row is saying "open me, something in here is stale", and
              the detail screen is where they're told apart per item. A missing
              nested template is named first: it's the one that stops the
              template working rather than just applying a dead name. */}
          {(broken || missingRefs) && (
            <Ionicons
              name="alert-circle"
              size={14}
              color={colors.warning}
              accessibilityLabel={
                broken
                  ? 'A nested template is missing'
                  : 'Uses a category or tag that no longer exists'
              }
            />
          )}
        </View>
        <Text style={styles.tplHint}>
          {template.items.length === 0
            ? 'No items'
            : `${template.items.length} item${template.items.length === 1 ? '' : 's'}`}
        </Text>
      </View>
      {/* Nothing a row can do to itself while a selection is being built —
          each of these acts on one template and would fight the bar. */}
      {!selectionMode && (
        <>
          <TouchableOpacity
            onPress={onEdit}
            style={styles.rowButton}
            activeOpacity={interaction.activeOpacity}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${template.name}`}
          >
            <Ionicons name="ellipsis-horizontal" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onApply}
            style={styles.rowButton}
            activeOpacity={interaction.activeOpacity}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Apply template ${template.name}`}
          >
            <Ionicons name="chevron-down-circle-outline" size={18} color={colors.accent} />
          </TouchableOpacity>
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        </>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Mirrors the inset-grouped card footprint of the template rows below.
  list: {
    paddingTop: spacing.sm,
    paddingBottom: 120,
  },
  // See the note on TemplateDetailScreen's: `flex: 1` needs a full-height box
  // to centre in, and the list's padding would move that centre.
  emptyContainer: { flexGrow: 1 },
  categorySectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  categorySectionHeaderText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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
  tplRowSelected: {
    backgroundColor: colors.accent + '1A',
  },
  tplIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same footprint as the icon tile it replaces, so entering selection mode
  // doesn't move the row's text.
  tplSelect: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tplInfo: {
    flex: 1,
    gap: 2,
  },
  tplNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
});
