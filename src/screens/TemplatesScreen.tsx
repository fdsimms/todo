import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTemplateStore } from '../store/useTemplateStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
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

/** "Due 3 days before · Shows 1 day before · morning" hint under an item row. */
function itemHint(item: TemplateItem): string | null {
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const parts: string[] = [];
  if (item.dueOffsetDays !== null) parts.push(`Due ${lower(formatOffsetLabel(item.dueOffsetDays))}`);
  if (item.deferOffsetDays !== null) parts.push(`Shows ${lower(formatOffsetLabel(item.deferOffsetDays))}`);
  if (item.timeSegments.length > 0) parts.push(item.timeSegments.join(', '));
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const templates = useTemplateStore(useShallow(s => s.templates));
  const addTemplate = useTemplateStore(s => s.addTemplate);
  const deleteTemplate = useTemplateStore(s => s.deleteTemplate);
  const addItem = useTemplateStore(s => s.addItem);
  const deleteItem = useTemplateStore(s => s.deleteItem);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);

  const [addingTemplate, setAddingTemplate] = useState(false);
  const [newTemplateText, setNewTemplateText] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<TemplateItem | null>(null);
  const [itemEditorVisible, setItemEditorVisible] = useState(false);
  const [suggestVisible, setSuggestVisible] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) ?? null;
  const applyTemplateObj = templates.find(t => t.id === applyTemplateId) ?? null;

  const handleStartAdding = () => {
    animateLayout();
    setAddingTemplate(true);
    setTimeout(() => inputRef.current?.focus(), 50);
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

  const handleAddItem = () => {
    if (!selectedTemplateId) return;
    const trimmed = newItemText.trim();
    if (trimmed) {
      haptics.success();
      animateLayout();
      addItem(selectedTemplateId, { title: trimmed });
    }
    setNewItemText('');
  };

  const handleDeleteItem = (itemId: string) => {
    if (!selectedTemplateId) return;
    haptics.tap();
    animateLayout();
    deleteItem(selectedTemplateId, itemId);
  };

  const openItemEditor = (item: TemplateItem | null) => {
    setEditingItem(item);
    setItemEditorVisible(true);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Templates"
        actions={[{ icon: 'add', onPress: handleStartAdding, accessibilityLabel: 'Add template' }]}
      />

      {addingTemplate && (
        <View style={styles.addRow}>
          <View style={[styles.tplIcon, { backgroundColor: colors.bgSecondary }]}>
            <Ionicons name="copy-outline" size={18} color={colors.textTertiary} />
          </View>
          <TextInput
            ref={inputRef}
            style={styles.addInput}
            value={newTemplateText}
            onChangeText={setNewTemplateText}
            placeholder="Template name"
            placeholderTextColor={colors.textTertiary}
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

      {templates.length === 0 && !addingTemplate ? (
        <EmptyState
          icon="copy-outline"
          title="No templates yet"
          subtitle="Create a reusable group of tasks — like a pre-vacation checklist — and add them all in one tap"
          actionLabel="Create template"
          onAction={handleStartAdding}
        />
      ) : (
        <FlatList
          data={templates}
          keyExtractor={t => t.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: tpl }) => (
            <TouchableOpacity
              style={styles.tplRow}
              onPress={() => setSelectedTemplateId(tpl.id)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`${tpl.name}, ${tpl.items.length === 0 ? 'no items' : `${tpl.items.length} item${tpl.items.length === 1 ? '' : 's'}`}`}
              accessibilityHint="Double tap to edit template"
            >
              <View style={[styles.tplIcon, { backgroundColor: colors.accent + '22' }]}>
                <Ionicons name="copy" size={18} color={colors.accent} />
              </View>
              <View style={styles.tplInfo}>
                <Text style={styles.tplName}>{tpl.name}</Text>
                <Text style={styles.tplHint}>
                  {tpl.items.length === 0
                    ? 'No items'
                    : `${tpl.items.length} item${tpl.items.length === 1 ? '' : 's'}`}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (tpl.items.length === 0) {
                    setSelectedTemplateId(tpl.id);
                    return;
                  }
                  haptics.tap();
                  setApplyTemplateId(tpl.id);
                }}
                style={styles.rowButton}
                activeOpacity={interaction.activeOpacity}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Apply template ${tpl.name}`}
              >
                <Ionicons name="arrow-down-circle-outline" size={18} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDeleteTemplate(tpl.id, tpl.name)}
                style={styles.rowButton}
                activeOpacity={interaction.activeOpacity}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Delete template ${tpl.name}`}
              >
                <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
              <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        />
      )}

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
                  name="arrow-down-circle-outline"
                  size={24}
                  color={selectedTemplate && selectedTemplate.items.length > 0 ? colors.accent : colors.textTertiary}
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
            data={selectedTemplate?.items ?? []}
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

          {selectedTemplate && (
            <TemplateItemEditor
              visible={itemEditorVisible}
              templateId={selectedTemplate.id}
              item={editingItem}
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
        </View>
      </Modal>

      <ApplyTemplateSheet
        visible={applyTemplateObj !== null}
        template={applyTemplateObj}
        onClose={() => setApplyTemplateId(null)}
      />
    </View>
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
});
