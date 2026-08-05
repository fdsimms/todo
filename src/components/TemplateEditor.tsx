import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { TaskTemplate } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { useTemplateStore } from '../store/useTemplateStore';
import { useTemplateCategoryStore } from '../store/useTemplateCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';

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
  const categories = useTemplateCategoryStore(useShallow(s => s.categories));
  const addCategory = useTemplateCategoryStore(s => s.addCategory);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    if (!template) return;
    setName(template.name);
    setCategory(template.category);
  }, [template]);

  const saveAndClose = () => {
    if (!template) { onClose(); return; }
    const trimmed = name.trim();
    if (trimmed) renameTemplate(template.id, trimmed);
    setTemplateCategory(template.id, category);
    onClose();
  };

  if (!template) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={saveAndClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={saveAndClose} hitSlop={8}>
            <Text style={styles.headerBtn}>Done</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Template</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
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
            <View style={styles.cardSection}>
              <Text style={styles.sectionLabel}>Category</Text>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, !category && styles.pillActiveNeutral]}
                  onPress={() => setCategory(null)}
                >
                  <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
                </TouchableOpacity>
                {categories.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.pill, category === cat.name && styles.pillActiveNeutral]}
                    onPress={() => setCategory(cat.name)}
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
                      if (c) { addCategory(c); setCategory(c); }
                      setNewCategory(''); setAddingCategory(false);
                    }}
                    onBlur={() => {
                      const c = newCategory.trim();
                      if (c) { addCategory(c); setCategory(c); }
                      setNewCategory(''); setAddingCategory(false);
                    }}
                    placeholder="category name"
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="done"
                    autoCapitalize="words"
                  />
                ) : (
                  <TouchableOpacity style={styles.addTagBtn} onPress={() => setAddingCategory(true)}>
                    <Ionicons name="add" size={14} color={colors.accent} />
                    <Text style={styles.addTagText}>New</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerBtn: {
    color: colors.accent,
    fontSize: font.md,
    minWidth: 40,
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
  cardSection: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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
  addTagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  addTagText: {
    color: colors.accent,
    fontSize: font.sm,
  },
});
