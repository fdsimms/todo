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
import type { TaskGroup, Priority } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, TITLE_MAX_LENGTH } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SortableList } from './SortableList';

interface Props {
  visible: boolean;
  group: TaskGroup | null;
  onClose: () => void;
}

export function TaskGroupEditor({ visible, group, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const allTasks = useTaskStore(useShallow(s => s.tasks));
  const groupChildrenOf = useTaskStore(s => s.groupChildrenOf);
  const addNewGroupedTask = useTaskStore(s => s.addNewGroupedTask);
  const addExistingToGroup = useTaskStore(s => s.addExistingToGroup);
  const removeFromGroup = useTaskStore(s => s.removeFromGroup);
  const reorderGroupChildren = useTaskStore(s => s.reorderGroupChildren);
  const updateGroup = useTaskGroupStore(s => s.updateGroup);
  const deleteGroup = useTaskStore(s => s.deleteGroup);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [priority, setPriority] = useState<Priority>(0);
  const [category, setCategory] = useState<string | null>(null);

  const [addingChild, setAddingChild] = useState(false);
  const [newChildTitle, setNewChildTitle] = useState('');
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const [existingSearch, setExistingSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (!group) return;
    setTitle(group.title);
    setNotes(group.notes);
    setTags(group.tags);
    setPriority(group.priority);
    setCategory(group.category);
    setShowExistingPicker(false);
    setExistingSearch('');
  }, [group]);

  const children = group ? groupChildrenOf(group.id) : [];
  const activeChildren = children.filter(c => !c.completed);
  const completedChildren = children.filter(c => c.completed);

  const eligibleForAdd = useMemo(() => {
    if (!group) return [];
    const q = existingSearch.trim().toLowerCase();
    return allTasks.filter(t =>
      !t.parentId &&
      !t.groupId &&
      !t.completed &&
      (q === '' || t.title.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [allTasks, existingSearch, group]);

  const saveAndClose = () => {
    if (!group) { onClose(); return; }
    const trimmed = title.trim();
    if (trimmed) {
      updateGroup(group.id, { title: trimmed, notes, tags, priority, category });
    }
    onClose();
  };

  const addTagFromInput = () => {
    const t = newTag.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setNewTag('');
    setAddingTag(false);
  };

  const handleDelete = () => {
    if (!group) return;
    Alert.alert(
      'Delete Group',
      `Delete "${group.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete This Group', onPress: () => { deleteGroup(group.id, { cascade: false }); onClose(); } },
        {
          text: 'Delete Group and All Its Tasks',
          style: 'destructive',
          onPress: () => { deleteGroup(group.id, { cascade: true }); onClose(); },
        },
      ],
    );
  };

  if (!group) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={saveAndClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={saveAndClose} hitSlop={8}>
            <Text style={styles.headerBtn}>Done</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Group</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Group title"
            placeholderTextColor={colors.textTertiary}
            maxLength={TITLE_MAX_LENGTH}
            multiline
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
                <TouchableOpacity style={[styles.pill, !category && styles.pillActive]} onPress={() => setCategory(null)}>
                  <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
                </TouchableOpacity>
                {allCategories.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.pill, category === cat && styles.pillActive]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={[styles.pillText, category === cat && styles.pillTextActive]}>{categoryLabel(cat, categories)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.cardSep} />
            <View style={styles.cardSection}>
              <Text style={styles.sectionLabel}>Priority</Text>
              <View style={styles.pillRow}>
                {([0, 1, 2, 3, 4] as Priority[]).map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.pill, priority === p && styles.pillActive, p > 0 && { borderColor: PRIORITY_COLORS[p], borderWidth: 1 }]}
                    onPress={() => setPriority(p)}
                  >
                    <Text style={[styles.pillText, priority === p && styles.pillTextActive]}>{PRIORITY_LABELS[p]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.cardSep} />
            <View style={styles.cardSection}>
              <Text style={styles.sectionLabel}>Tags</Text>
              <View style={styles.pillRow}>
                {tags.map(tag => (
                  <TouchableOpacity key={tag} style={styles.pill} onPress={() => setTags(prev => prev.filter(t => t !== tag))}>
                    <Text style={styles.pillText}>{tag} ✕</Text>
                  </TouchableOpacity>
                ))}
                {addingTag ? (
                  <TextInput
                    autoFocus
                    style={styles.tagInput}
                    value={newTag}
                    onChangeText={setNewTag}
                    onSubmitEditing={addTagFromInput}
                    onBlur={addTagFromInput}
                    placeholder="tag name"
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="done"
                    autoCapitalize="none"
                  />
                ) : (
                  <TouchableOpacity style={styles.addPillBtn} onPress={() => setAddingTag(true)}>
                    <Ionicons name="add" size={14} color={colors.accent} />
                    <Text style={styles.addPillText}>Add tag</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.cardSection}>
              <View style={styles.subtaskHeader}>
                <Text style={styles.sectionLabel}>Tasks in this group</Text>
                <Text style={styles.subtaskProgress}>{completedChildren.length}/{children.length}</Text>
              </View>
              <SortableList
                data={activeChildren}
                onReorder={newData => reorderGroupChildren(group.id, [...newData.map(c => c.id), ...completedChildren.map(c => c.id)])}
                renderItem={(child, _i, drag) => (
                  <View style={styles.childRow}>
                    <Text style={styles.childTitle} numberOfLines={1}>
                      {child.title}
                    </Text>
                    <TouchableOpacity
                      onLongPress={e => drag(e.nativeEvent.pageY)}
                      delayLongPress={150}
                      hitSlop={8}
                      style={styles.dragHandle}
                    >
                      <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeFromGroup(child.id)} hitSlop={8} style={styles.childRemove}>
                      <Ionicons name="close" size={14} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                )}
              />

              {completedChildren.length > 0 && (
                <View style={styles.completedSection}>
                  <TouchableOpacity
                    style={styles.completedHeader}
                    onPress={() => setShowCompleted(v => !v)}
                    hitSlop={8}
                  >
                    <Ionicons name={showCompleted ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textTertiary} />
                    <Text style={styles.completedHeaderText}>Completed ({completedChildren.length})</Text>
                  </TouchableOpacity>
                  {showCompleted && completedChildren.map(child => (
                    <View key={child.id} style={styles.childRow}>
                      <Text style={[styles.childTitle, styles.childTitleDone]} numberOfLines={1}>
                        {child.title}
                      </Text>
                      <TouchableOpacity onPress={() => removeFromGroup(child.id)} hitSlop={8} style={styles.childRemove}>
                        <Ionicons name="close" size={14} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {addingChild ? (
                <View style={styles.subtaskInputRow}>
                  <TextInput
                    autoFocus
                    style={styles.subtaskInput}
                    value={newChildTitle}
                    onChangeText={setNewChildTitle}
                    placeholder="New task title"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={TITLE_MAX_LENGTH}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      const t = newChildTitle.trim();
                      if (t) addNewGroupedTask(group.id, t);
                      setNewChildTitle('');
                      haptics.tap();
                    }}
                    onBlur={() => {
                      const t = newChildTitle.trim();
                      if (t) addNewGroupedTask(group.id, t);
                      setNewChildTitle('');
                      setAddingChild(false);
                    }}
                  />
                </View>
              ) : (
                <TouchableOpacity style={styles.addPillBtn} onPress={() => setAddingChild(true)}>
                  <Ionicons name="add" size={14} color={colors.accent} />
                  <Text style={styles.addPillText}>Add new task</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.addPillBtn} onPress={() => setShowExistingPicker(v => !v)}>
                <Ionicons name={showExistingPicker ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
                <Text style={styles.addPillText}>Add existing task</Text>
              </TouchableOpacity>

              {showExistingPicker && (
                <View style={styles.existingPicker}>
                  <TextInput
                    style={styles.existingSearch}
                    value={existingSearch}
                    onChangeText={setExistingSearch}
                    placeholder="Search tasks…"
                    placeholderTextColor={colors.textTertiary}
                  />
                  {eligibleForAdd.map(t => (
                    <TouchableOpacity
                      key={t.id}
                      style={styles.existingRow}
                      onPress={() => { addExistingToGroup(t.id, group.id); haptics.tap(); }}
                    >
                      <Text style={styles.existingRowText} numberOfLines={1}>{t.title}</Text>
                      <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                    </TouchableOpacity>
                  ))}
                  {eligibleForAdd.length === 0 && (
                    <Text style={styles.existingEmpty}>No matching ungrouped tasks</Text>
                  )}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
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
  scrollContent: { paddingBottom: 80 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, minHeight: 60,
    lineHeight: lineHeight.xl,
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.lg, minHeight: 44,
    lineHeight: 22,
  },
  sectionCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  cardSection: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  cardSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  sectionLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.bold,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  pillActive: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  pillTextActive: { color: colors.text, fontWeight: fontWeight.semibold },
  tagInput: {
    color: colors.text, fontSize: font.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 8,
    backgroundColor: colors.bgTertiary, borderRadius: radius.full, minWidth: 100,
  },
  addPillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginTop: spacing.xs,
  },
  addPillText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  subtaskHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subtaskProgress: { color: colors.textTertiary, fontSize: font.sm, fontWeight: fontWeight.medium },
  childRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  completedSection: {
    marginTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  completedHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingTop: spacing.sm,
  },
  completedHeaderText: { color: colors.textTertiary, fontSize: font.sm, fontWeight: fontWeight.medium },
  childTitle: { flex: 1, color: colors.text, fontSize: font.md },
  childTitleDone: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  dragHandle: { padding: 4 },
  childRemove: { padding: 4 },
  subtaskInputRow: { paddingVertical: spacing.xs },
  subtaskInput: {
    color: colors.text, fontSize: font.md,
    backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 8,
  },
  existingPicker: {
    marginTop: spacing.sm, backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    padding: spacing.sm,
  },
  existingSearch: {
    color: colors.text, fontSize: font.sm,
    backgroundColor: colors.bgQuaternary, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 6, marginBottom: spacing.xs,
  },
  existingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  existingRowText: { flex: 1, color: colors.text, fontSize: font.sm },
  existingEmpty: { color: colors.textTertiary, fontSize: font.sm, paddingVertical: 8 },
});
