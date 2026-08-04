import React, { useState, useMemo } from 'react';
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
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTemplateStore } from '../store/useTemplateStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { ReorderableList } from '../components/ReorderableList';
import { ApplyTemplateSheet } from '../components/ApplyTemplateSheet';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, font, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { TaskTemplate } from '../types';

export function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const templates = useTemplateStore(useShallow(s => s.templates));
  const addTemplate = useTemplateStore(s => s.addTemplate);
  const deleteTemplate = useTemplateStore(s => s.deleteTemplate);
  const reorderTemplates = useTemplateStore(s => s.reorderTemplates);

  const [addingTemplate, setAddingTemplate] = useState(false);
  const [newTemplateText, setNewTemplateText] = useState('');
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);

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
            animateLayout();
            deleteTemplate(id);
          },
        },
      ]
    );
  };

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
            onPress={() => (navigation as any).navigate('TemplateDetail', { templateId: tpl.id })}
            onApply={() => {
              if (tpl.items.length === 0) {
                (navigation as any).navigate('TemplateDetail', { templateId: tpl.id });
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

      {/* Used when applying from the template list. */}
      <ApplyTemplateSheet
        visible={applyTemplateObj !== null}
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
  fabContainer: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 20,
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  deleteAction: {
    backgroundColor: colors.red,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    gap: 5,
  },
});
