import React, { useState, useMemo } from 'react';
import {
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
  const templateCategories = useTemplateCategoryStore(useShallow(s => s.categories));

  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);

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

  const handleAddTemplate = (name: string) => {
    animateLayout();
    const tpl = addTemplate(name);
    // Drop straight into the editor so the new template doesn't sit empty.
    (navigation as any).navigate('TemplateDetail', { templateId: tpl.id });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Templates" />

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
        // footer takes that height off the bottom of the box.
        ListFooterComponent={
          templateListItems.length === 0
            ? null
            : <View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />
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
              drag={drag}
              onPress={() => (navigation as any).navigate('TemplateDetail', { templateId: tpl.id })}
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

      <Fab
        onPress={() => setQuickAddVisible(true)}
        accessibilityLabel="Add template"
        bottom={insets.bottom + tabBarHeight + spacing.md}
      />

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
 * Template list row. No swipe: there's no bulk mode for templates to swipe
 * left into, and nothing to reschedule. Deleting used to be a swipe *right* —
 * the direction that reschedules everywhere else — and now lives in
 * TemplateEditor behind the ⋯ button.
 */
function TemplateRow({
  template, broken, missingRefs, colors, styles, drag, onPress, onEdit, onApply,
}: {
  template: TaskTemplate;
  /** True if a template this one nests (at any depth) was deleted or is itself broken. */
  broken: boolean;
  /** True if one of this template's own items names a category or tag that no longer exists. */
  missingRefs: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  drag: () => void;
  onPress: () => void;
  onEdit: () => void;
  onApply: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.tplRow}
      onPress={onPress}
      onLongPress={drag}
      delayLongPress={interaction.delayLongPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${template.name}, ${template.items.length === 0 ? 'no items' : `${template.items.length} item${template.items.length === 1 ? '' : 's'}`}${broken ? ', a nested template is missing' : missingRefs ? ', uses a category or tag that no longer exists' : ''}`}
      accessibilityHint="Double tap to edit template"
    >
      <View style={[styles.tplIcon, { backgroundColor: colors.accentSubtle }]}>
        <Ionicons name="copy" size={18} color={colors.accent} />
      </View>
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
