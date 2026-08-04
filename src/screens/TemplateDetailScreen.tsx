import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTemplateStore } from '../store/useTemplateStore';
import { EmptyState } from '../components/EmptyState';
import { TemplateItemEditor } from '../components/TemplateItemEditor';
import { TemplateSuggestionsSheet } from '../components/TemplateSuggestionsSheet';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatOffsetLabel } from '../utils/templateUtils';
import { TITLE_MAX_LENGTH } from '../types';
import type { TemplateItem } from '../types';

type RootStackParamList = {
  TemplateDetail: { templateId: string };
};

/** "Due 3 days before · Shows 1 day before · morning" hint under an item row. */
function itemHint(item: TemplateItem): string | null {
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const parts: string[] = [];
  if (item.dueOffsetDays !== null) parts.push(`Due ${lower(formatOffsetLabel(item.dueOffsetDays))}`);
  if (item.deferOffsetDays !== null) parts.push(`Shows ${lower(formatOffsetLabel(item.deferOffsetDays))}`);
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
  const addItem = useTemplateStore(s => s.addItem);
  const deleteItem = useTemplateStore(s => s.deleteItem);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);

  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<TemplateItem | null>(null);
  const [itemEditorVisible, setItemEditorVisible] = useState(false);
  const [suggestVisible, setSuggestVisible] = useState(false);
  const [newItemText, setNewItemText] = useState('');

  const template = templates.find(t => t.id === templateId) ?? null;
  const applyTemplateObj = templates.find(t => t.id === applyTemplateId) ?? null;

  const onClose = () => navigation.goBack();

  const handleAddItem = () => {
    if (!templateId) return;
    const trimmed = newItemText.trim();
    if (trimmed) {
      haptics.success();
      animateLayout();
      addItem(templateId, { title: trimmed });
    }
    setNewItemText('');
  };

  const handleDeleteItem = (itemId: string) => {
    if (!templateId) return;
    haptics.tap();
    animateLayout();
    deleteItem(templateId, itemId);
  };

  const openItemEditor = (item: TemplateItem | null) => {
    setEditingItem(item);
    setItemEditorVisible(true);
  };

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

      {/* Quick title-only item entry */}
      <View style={styles.itemAddRow}>
        <Ionicons name="add-circle-outline" size={20} color={colors.textTertiary} />
        <TextInput
          style={styles.itemAddInput}
          value={newItemText}
          onChangeText={setNewItemText}
          placeholder="Add a task…"
          placeholderTextColor={colors.textTertiary}
          maxLength={TITLE_MAX_LENGTH}
          returnKeyType="done"
          blurOnSubmit={false}
          onSubmitEditing={handleAddItem}
        />
      </View>

      <FlatList
        data={template?.items ?? []}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const hint = itemHint(item);
          return (
            <TouchableOpacity
              style={styles.itemRow}
              onPress={() => openItemEditor(item)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}${item.optional ? ', optional' : ''}`}
              accessibilityHint="Double tap to edit item"
            >
              <View style={styles.itemInfo}>
                <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                {hint && <Text style={styles.itemHintText} numberOfLines={1}>{hint}</Text>}
              </View>
              {item.optional && (
                <View style={styles.optionalBadge}>
                  <Text style={styles.optionalBadgeText}>Optional</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => handleDeleteItem(item.id)}
                style={styles.rowButton}
                activeOpacity={interaction.activeOpacity}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Delete item ${item.title}`}
              >
                <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
              <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="list-outline"
            title="No items yet"
            subtitle="Add tasks above — tap one after adding to set dates, tags and more"
            actionLabel={anthropicApiKey ? 'Suggest tasks with AI' : undefined}
            onAction={anthropicApiKey ? () => { haptics.tap(); setSuggestVisible(true); } : undefined}
          />
        }
      />

      {template && (
        <TemplateItemEditor
          visible={itemEditorVisible}
          templateId={template.id}
          item={editingItem}
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
  itemAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  itemAddInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 0,
  },
  list: {
    paddingTop: spacing.sm,
    paddingBottom: 120,
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
  rowButton: {
    padding: 4,
  },
});
