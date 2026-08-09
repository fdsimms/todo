import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { TaskTemplate, TemplateContainer } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { useTemplateStore } from '../store/useTemplateStore';
import { useTemplateCategoryStore } from '../store/useTemplateCategoryStore';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { findTemplatesReferencing } from '../utils/templateUtils';
import { CollapsibleField } from './CollapsibleField';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';

interface Props {
  visible: boolean;
  template: TaskTemplate | null;
  onClose: () => void;
}

export function TemplateEditor({ visible, template, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const renameTemplate = useTemplateStore(s => s.renameTemplate);
  const setTemplateCategory = useTemplateStore(s => s.setTemplateCategory);
  const setTemplateContainer = useTemplateStore(s => s.setTemplateContainer);
  const deleteTemplate = useTaskStore(s => s.deleteTemplate);
  const templates = useTemplateStore(useShallow(s => s.templates));
  const categories = useTemplateCategoryStore(useShallow(s => s.categories));
  const addCategory = useTemplateCategoryStore(s => s.addCategory);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [container, setContainer] = useState<TemplateContainer>('stack');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  // Collapsed to the chosen category until tapped, like every other editor.
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [containerOpen, setContainerOpen] = useState(false);

  useEffect(() => {
    if (!template) return;
    setName(template.name);
    setCategory(template.category);
    setContainer(template.applyContainer);
    setCategoryOpen(false);
    setContainerOpen(false);
  }, [template]);

  const closeCategory = () => { animateLayout(); setCategoryOpen(false); };
  const closeContainer = () => { animateLayout(); setContainerOpen(false); };

  const saveAndClose = () => {
    if (!template) { onClose(); return; }
    const trimmed = name.trim();
    if (trimmed) renameTemplate(template.id, trimmed);
    setTemplateCategory(template.id, category);
    setTemplateContainer(template.id, container);
    onClose();
  };

  // Deleting lives here rather than on the row's swipe, so it takes a
  // deliberate trip into the editor and can spell out what breaks — a template
  // nested inside others leaves them showing a broken-reference warning.
  const handleDelete = () => {
    if (!template) return;
    haptics.warning();
    const referencing = findTemplatesReferencing(templates, template.id);
    const base = `Delete "${template.name}"? Tasks already created from it are unaffected. This can be undone with shake-to-undo.`;
    const message = referencing.length === 0
      ? base
      : referencing.length === 1
        ? `${base} It's used inside "${referencing[0].name}", which will show a warning until you remove or replace the reference.`
        : `${base} It's used inside ${referencing.length} other templates (${referencing.map(t => t.name).join(', ')}), which will show a warning until you remove or replace the reference.`;
    Alert.alert(
      'Delete Template',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            deleteTemplate(template.id);
            onClose();
          },
        },
      ]
    );
  };

  if (!template) return null;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} minWidth={40} />
          <Text style={styles.headerTitle}>Edit Template</Text>
          <TouchableOpacity
            onPress={handleDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete template ${template.name}`}
          >
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </>
      }
    >
      <TextInput
        style={styles.titleInput}
        value={name}
        onChangeText={setName}
        placeholder="Template name"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={TITLE_MAX_LENGTH}
      />

      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Category"
          summary={category ?? undefined}
          hint="Groups this template with others of the same kind."
          expanded={categoryOpen}
          onToggle={() => setCategoryOpen(v => !v)}
        >
          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[styles.pill, !category && styles.pillActiveNeutral]}
              onPress={() => { haptics.tap(); setCategory(null); closeCategory(); }}
            >
              <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
            </TouchableOpacity>
            {categories.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.pill, category === cat.name && styles.pillActiveNeutral]}
                onPress={() => { haptics.tap(); setCategory(cat.name); closeCategory(); }}
              >
                <Text style={[styles.pillText, category === cat.name && styles.pillTextActive]}>{cat.name}</Text>
              </TouchableOpacity>
            ))}
            {addingCategory ? (
              <TextInput
                autoFocus
                style={styles.tagInput}
                value={newCategory}
                onChangeText={setNewCategory}
                onSubmitEditing={() => {
                  const c = newCategory.trim();
                  if (c) { addCategory(c); setCategory(c); closeCategory(); }
                  setNewCategory(''); setAddingCategory(false);
                }}
                onBlur={() => {
                  const c = newCategory.trim();
                  if (c) { addCategory(c); setCategory(c); closeCategory(); }
                  setNewCategory(''); setAddingCategory(false);
                }}
                placeholder="category name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="words"
              />
            ) : (
              <InlineAction icon="add" label="New" accessibilityLabel="New category" onPress={() => setAddingCategory(true)} />
            )}
          </View>
        </CollapsibleField>
      </View>

      <View style={styles.sectionCard}>
        <CollapsibleField
          label="When applied"
          summary={CONTAINER_LABELS[container]}
          hint="Where a run of this template puts its tasks, once you name the run."
          expanded={containerOpen}
          onToggle={() => setContainerOpen(v => !v)}
        >
          <View style={styles.pillRow}>
            {CONTAINER_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.pill, container === opt && styles.pillActiveNeutral]}
                onPress={() => { haptics.tap(); setContainer(opt); closeContainer(); }}
              >
                <Text style={[styles.pillText, container === opt && styles.pillTextActive]}>
                  {CONTAINER_LABELS[opt]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.containerNote}>{CONTAINER_NOTES[container]}</Text>
          {container === 'stack' && template.itemGroups.length > 0 && (
            <Text style={styles.containerNote}>
              This template has item groups, which already become stacks — a named run of it
              will use a project instead, so the groups have somewhere to sit.
            </Text>
          )}
        </CollapsibleField>
      </View>
    </EditorSheet>
  );
}

const CONTAINER_OPTIONS: TemplateContainer[] = ['none', 'stack', 'project'];

const CONTAINER_LABELS: Record<TemplateContainer, string> = {
  none: 'Nothing',
  stack: 'A stack',
  project: 'A project',
};

const CONTAINER_NOTES: Record<TemplateContainer, string> = {
  none: 'Tasks are added loose, and the run name only fills in {blanks}.',
  stack: 'Tasks are headed by a stack named after the run — best for most templates.',
  project: 'Tasks go in a project named after the run, dated by the two anchors. Best for long, multi-week ones.',
};

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  titleInput: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: fontWeight.semibold,
    paddingVertical: spacing.sm,
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  pillActiveNeutral: {
    backgroundColor: colors.accent,
  },
  pillText: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  pillTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.medium,
  },
  tagInput: {
    color: colors.text,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    minWidth: 100,
  },
  containerNote: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: spacing.sm,
  },
});
