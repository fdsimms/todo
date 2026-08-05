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
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Project } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { CalendarPicker } from './CalendarPicker';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { formatDueDate, formatStartDate } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  project: Project | null;
  onClose: () => void;
}

export function ProjectEditor({ visible, project, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const updateProject = useProjectStore(s => s.updateProject);
  const archiveProject = useProjectStore(s => s.archiveProject);
  const unarchiveProject = useProjectStore(s => s.unarchiveProject);
  const deleteProject = useTaskStore(s => s.deleteProject);
  const categories = useProjectCategoryStore(useShallow(s => s.categories));
  const addCategory = useProjectCategoryStore(s => s.addCategory);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [targetStartDate, setTargetStartDate] = useState<Date | null>(null);
  const [targetEndDate, setTargetEndDate] = useState<Date | null>(null);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    if (!project) return;
    setTitle(project.title);
    setNotes(project.notes);
    setCategory(project.category);
    setTargetStartDate(project.targetStartDate ? new Date(project.targetStartDate) : null);
    setTargetEndDate(project.targetEndDate ? new Date(project.targetEndDate) : null);
  }, [project]);

  const saveAndClose = () => {
    if (!project) { onClose(); return; }
    const trimmed = title.trim();
    if (trimmed) {
      updateProject(project.id, {
        title: trimmed,
        notes,
        category,
        targetStartDate: targetStartDate ? targetStartDate.toISOString() : null,
        targetEndDate: targetEndDate ? targetEndDate.toISOString() : null,
      });
    }
    onClose();
  };

  const handleDelete = () => {
    if (!project) return;
    Alert.alert(
      'Delete Project',
      `Delete "${project.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete This Project', onPress: () => { deleteProject(project.id, { cascade: false }); onClose(); } },
        {
          text: 'Delete Project and All Its Tasks',
          style: 'destructive',
          onPress: () => { deleteProject(project.id, { cascade: true }); onClose(); },
        },
      ],
    );
  };

  if (!project) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={saveAndClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={saveAndClose} hitSlop={8}>
            <Text style={styles.headerBtn}>Done</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Project</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Project name"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={TITLE_MAX_LENGTH}
          />
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes"
            placeholderTextColor={colors.textTertiary}
            multiline
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

          <View style={[styles.card, { marginTop: spacing.lg }]}>
            <OptionRow
              icon="play-outline"
              label="Start date"
              value={targetStartDate ? formatStartDate(targetStartDate.toISOString()) : undefined}
              onPress={() => setShowStartDatePicker(true)}
              onClear={targetStartDate ? () => setTargetStartDate(null) : undefined}
              colors={colors}
              styles={styles}
            />
            <View style={styles.sep} />
            <OptionRow
              icon="flag-outline"
              label="Target date"
              value={targetEndDate ? formatDueDate(targetEndDate.toISOString()) : undefined}
              onPress={() => setShowEndDatePicker(true)}
              onClear={targetEndDate ? () => setTargetEndDate(null) : undefined}
              colors={colors}
              styles={styles}
            />
          </View>
          <Text style={styles.sectionFooter}>
            Optional. If the target date passes before the project's done, nothing happens automatically — it's just flagged so you can decide what to do.
          </Text>

          <View style={[styles.card, { marginTop: spacing.xl }]}>
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                if (project.archived) {
                  unarchiveProject(project.id);
                } else {
                  haptics.success();
                  archiveProject(project.id);
                  onClose();
                }
              }}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons name="archive-outline" size={18} color={project.archived ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Archive</Text>
                <Text style={styles.optionHint}>
                  {project.archived ? 'Hidden from the active list' : 'Move to the archived list'}
                </Text>
              </View>
              <View style={[styles.toggle, project.archived && styles.toggleOn]}>
                <View style={[styles.toggleKnob, project.archived && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>

        <CalendarPicker
          visible={showStartDatePicker}
          value={targetStartDate}
          mode="date"
          title="Start Date"
          onConfirm={(date) => { setTargetStartDate(date); setShowStartDatePicker(false); }}
          onCancel={() => setShowStartDatePicker(false)}
        />
        <CalendarPicker
          visible={showEndDatePicker}
          value={targetEndDate}
          mode="date"
          title="Target Date"
          onConfirm={(date) => { setTargetEndDate(date); setShowEndDatePicker(false); }}
          onCancel={() => setShowEndDatePicker(false)}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OptionRow({
  icon, label, value, onPress, onClear, colors, styles,
}: {
  icon: string; label: string; value?: string;
  onPress: () => void; onClear?: () => void;
  colors: Colors; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={styles.optionRow} onPress={onPress} activeOpacity={interaction.activeOpacity}>
      <Ionicons name={icon as never} size={18} color={value ? colors.accent : colors.textSecondary} />
      <View style={styles.optionContent}>
        <Text style={styles.optionLabel}>{label}</Text>
      </View>
      {value ? (
        <View style={styles.optionValueRow}>
          <Text style={styles.optionValue}>{value}</Text>
          {onClear && (
            <TouchableOpacity onPress={onClear} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  headerBtn: { color: colors.accent, fontSize: font.md, fontWeight: fontWeight.semibold },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: fontWeight.medium,
    paddingVertical: spacing.sm, minHeight: 44,
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingBottom: spacing.lg, minHeight: 44,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cardSection: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  sectionLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  pillActiveNeutral: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
  tagInput: {
    color: colors.text, fontSize: font.sm,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 4, paddingHorizontal: 4, minWidth: 80,
  },
  addTagBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.bgQuaternary, borderStyle: 'dashed',
  },
  addTagText: { color: colors.accent, fontSize: font.sm },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  sectionFooter: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  optionValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionValue: { color: colors.textSecondary, fontSize: font.md },
  toggle: {
    width: 44, height: 26, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, padding: 2, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.bg,
  },
  toggleKnobOn: { alignSelf: 'flex-end' },
});
