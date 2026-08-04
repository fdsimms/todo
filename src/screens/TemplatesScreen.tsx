import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTemplateStore } from '../store/useTemplateStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';

export function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const templates = useTemplateStore(useShallow(s => s.templates));
  const addTemplate = useTemplateStore(s => s.addTemplate);
  const deleteTemplate = useTemplateStore(s => s.deleteTemplate);

  const [addingTemplate, setAddingTemplate] = useState(false);
  const [newTemplateText, setNewTemplateText] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

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
      (navigation as any).navigate('TemplateDetail', { templateId: tpl.id });
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

      <FlatList
        data={templates}
        keyExtractor={t => t.id}
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
        renderItem={({ item: tpl }) => (
          <TouchableOpacity
            style={styles.tplRow}
            onPress={() => {
              setSelectedTemplateId(tpl.id);
              (navigation as any).navigate('TemplateDetail', { templateId: tpl.id });
            }}
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
                  (navigation as any).navigate('TemplateDetail', { templateId: tpl.id });
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
              <Ionicons name="play-circle-outline" size={18} color={colors.accent} />
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

      {/* Used when applying from the template list. */}
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
