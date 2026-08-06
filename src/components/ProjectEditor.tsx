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
import type { Project } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectCategoryStore } from '../store/useProjectCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { CalendarPicker } from './CalendarPicker';
import { CollapsibleField } from './CollapsibleField';
import { EditorRow } from './EditorRow';
import { EditorSheet } from './EditorSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { formatDueDate, formatStartDate } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';

interface Props {
  visible: boolean;
  project: Project | null;
  /** Titles the sheet "New Project" — set when arriving from quick add's "More details". */
  isNew?: boolean;
  onClose: () => void;
}

export function ProjectEditor({ visible, project, isNew, onClose }: Props) {
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
  // Collapsed to the chosen category until tapped, like every other editor.
  const [categoryOpen, setCategoryOpen] = useState(false);

  useEffect(() => {
    if (!project) return;
    setTitle(project.title);
    setNotes(project.notes);
    setCategory(project.category);
    setTargetStartDate(project.targetStartDate ? new Date(project.targetStartDate) : null);
    setTargetEndDate(project.targetEndDate ? new Date(project.targetEndDate) : null);
    setCategoryOpen(false);
  }, [project]);

  const closeCategory = () => { animateLayout(); setCategoryOpen(false); };

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
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <TouchableOpacity onPress={saveAndClose} hitSlop={8}>
            <Text style={styles.headerBtn}>Done</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isNew ? 'New Project' : 'Edit Project'}</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete project">
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </>
      }
      footer={
        <>
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
        </>
      }
    >
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
        <CollapsibleField
          label="Category"
          summary={category ?? undefined}
          hint="Groups this project with others of the same kind."
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
              <TouchableOpacity style={styles.addTagBtn} onPress={() => setAddingCategory(true)}>
                <Ionicons name="add" size={14} color={colors.accent} />
                <Text style={styles.addTagText}>New</Text>
              </TouchableOpacity>
            )}
          </View>
        </CollapsibleField>
      </View>

      <View style={[styles.card, { marginTop: spacing.lg }]}>
        <EditorRow
          icon="play-outline"
          label="Start date"
          value={targetStartDate ? formatStartDate(targetStartDate.toISOString()) : undefined}
          onPress={() => setShowStartDatePicker(true)}
          onClear={targetStartDate ? () => setTargetStartDate(null) : undefined}
        />
        <View style={styles.sep} />
        <EditorRow
          icon="flag-outline"
          label="Target date"
          value={targetEndDate ? formatDueDate(targetEndDate.toISOString()) : undefined}
          onPress={() => setShowEndDatePicker(true)}
          onClear={targetEndDate ? () => setTargetEndDate(null) : undefined}
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
          accessibilityRole="switch"
          accessibilityLabel="Archive"
          accessibilityState={{ checked: project.archived }}
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
    </EditorSheet>
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
