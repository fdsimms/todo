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
import type { Task, TaskGroup } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { isRelevantToGroupToday, isTaskVisible } from '../utils/visibilityUtils';
import { formatDueDate } from '../utils/dateUtils';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { CollapsibleField } from './CollapsibleField';
import { SortableList } from './SortableList';

/** Editor sections that collapse to a one-line summary of their current value. */
type FieldKey = 'category' | 'tags';

/**
 * One line answering "where does this member stand today?" — the question the
 * list otherwise leaves open, since a stack's members run on their own
 * schedules and only some of them are due on any given day. Without it, a
 * roster showing iron alongside seven daily supplements looks like the stack
 * is wrong rather than like iron isn't due until Thursday.
 */
function memberSchedule(task: Task): string {
  if (task.completed) return 'Done today';
  if (isTaskVisible(task)) return 'Due today';
  if (task.dueDate) return formatDueDate(task.dueDate);
  if (task.deferUntil) return formatDueDate(task.deferUntil);
  return '';
}

interface Props {
  visible: boolean;
  group: TaskGroup | null;
  /** True when this stack was just created and hasn't been titled yet — changes the header title. */
  isNew?: boolean;
  onClose: () => void;
}

export function TaskGroupEditor({ visible, group, isNew, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const allTasks = useTaskStore(s => s.tasks);
  const groupRosterOf = useTaskStore(s => s.groupRosterOf);
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
  const [category, setCategory] = useState<string | null>(null);

  const [addingChild, setAddingChild] = useState(false);
  const [newChildTitle, setNewChildTitle] = useState('');
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const [existingSearch, setExistingSearch] = useState('');
  // Pickers collapse to their current value, matching the task editor.
  const [openFields, setOpenFields] = useState<Partial<Record<FieldKey, boolean>>>({});

  useEffect(() => {
    if (!group) return;
    setTitle(group.title);
    setNotes(group.notes);
    setTags(group.tags);
    setCategory(group.category);
    setShowExistingPicker(false);
    setExistingSearch('');
    setOpenFields({});
  }, [group]);

  const fieldOpen = (key: FieldKey) => openFields[key] ?? false;
  const toggleField = (key: FieldKey) => setOpenFields(prev => ({ ...prev, [key]: !prev[key] }));
  const closeField = (key: FieldKey) => {
    animateLayout();
    setOpenFields(prev => ({ ...prev, [key]: false }));
  };

  // The roster, never the raw child rows: a recurring member leaves a
  // completed row behind on every completion and they all keep the stack's
  // groupId, so counting rows made an 8-task stack read "14/22" and climbing
  // (see groupRoster). Members are what the user put in the stack; the
  // occurrences they've generated are Logbook history.
  const members = group ? groupRosterOf(group.id) : [];
  const dueToday = members.filter(isRelevantToGroupToday);
  const doneToday = dueToday.filter(c => c.completed).length;

  // Capped so a large task list doesn't render hundreds of rows into an
  // unvirtualized ScrollView; matchCount (pre-slice) drives the "showing 30
  // of N" hint below so a task missing from the list reads as "narrow your
  // search" rather than "doesn't exist" (see #660).
  const eligibleMatches = useMemo(() => {
    if (!group) return [];
    const q = existingSearch.trim().toLowerCase();
    return allTasks.filter(t =>
      !t.parentId &&
      !t.groupId &&
      !t.completed &&
      (q === '' || t.title.toLowerCase().includes(q))
    );
  }, [allTasks, existingSearch, group]);
  const EXISTING_TASK_PICKER_LIMIT = 30;
  const eligibleForAdd = useMemo(
    () => eligibleMatches.slice(0, EXISTING_TASK_PICKER_LIMIT),
    [eligibleMatches],
  );

  const saveAndClose = () => {
    if (!group) { onClose(); return; }
    // A blank title only skips the *title* write — an untitled brand-new
    // stack is garbage-collected by the caller anyway (see TodayScreen), and
    // silently dropping notes/tags/category along with it meant
    // clearing the title threw away every other edit in the sheet.
    const trimmed = title.trim();
    updateGroup(group.id, {
      ...(trimmed ? { title: trimmed } : {}),
      notes,
      tags,
      category,
    });
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
      'Delete Stack',
      `Delete "${group.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete This Stack', onPress: () => { deleteGroup(group.id, { cascade: false }); onClose(); } },
        {
          text: 'Delete Stack and All Its Tasks',
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
          <Text style={styles.headerTitle}>{isNew ? 'New Stack' : 'Edit Stack'}</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete stack">
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Stack title"
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
            <CollapsibleField
              label="Category"
              summary={category ? categoryLabel(category, categories) : undefined}
              hint="Applies to the stack itself — tasks inside keep their own."
              expanded={fieldOpen('category')}
              onToggle={() => toggleField('category')}
            >
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, !category && styles.pillActive]}
                  onPress={() => { haptics.tap(); setCategory(null); closeField('category'); }}
                >
                  <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
                </TouchableOpacity>
                {allCategories.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.pill, category === cat && styles.pillActive]}
                    onPress={() => { haptics.tap(); setCategory(cat); closeField('category'); }}
                  >
                    <Text style={[styles.pillText, category === cat && styles.pillTextActive]}>{categoryLabel(cat, categories)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </CollapsibleField>
            <View style={styles.cardSep} />
            <CollapsibleField
              label="Tags"
              summary={tags.length > 0 ? tags.join(', ') : undefined}
              hint="Free-form labels you can filter and search by."
              expanded={fieldOpen('tags')}
              onToggle={() => toggleField('tags')}
            >
              <View style={styles.pillRow}>
                {tags.map(tag => (
                  <TouchableOpacity key={tag} style={styles.pill} onPress={() => { haptics.tap(); setTags(prev => prev.filter(t => t !== tag)); }}>
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
            </CollapsibleField>
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.cardSection}>
              <View style={styles.subtaskHeader}>
                <Text style={styles.sectionLabel}>Tasks in this stack</Text>
                <Text style={styles.subtaskProgress}>
                  {members.length}
                  {dueToday.length > 0 ? ` · ${doneToday}/${dueToday.length} today` : ''}
                </Text>
              </View>
              <SortableList
                data={members}
                onReorder={newData => reorderGroupChildren(group.id, newData.map(c => c.id))}
                renderItem={(child, _i, drag) => {
                  const subtitle = memberSchedule(child);
                  return (
                    <View style={styles.childRow}>
                      <TouchableOpacity
                        onLongPress={e => drag(e.nativeEvent.pageY)}
                        delayLongPress={150}
                        hitSlop={8}
                        style={styles.dragHandle}
                        accessibilityRole="button"
                        accessibilityLabel={`Reorder ${child.title}`}
                      >
                        <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                      </TouchableOpacity>
                      <View style={styles.childText}>
                        <Text
                          style={[styles.childTitle, child.completed && styles.childTitleDone]}
                          numberOfLines={1}
                        >
                          {child.title}
                        </Text>
                        {subtitle !== '' && <Text style={styles.childSubtitle}>{subtitle}</Text>}
                      </View>
                      <TouchableOpacity
                        onPress={() => removeFromGroup(child.id)}
                        hitSlop={8}
                        style={styles.childRemove}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${child.title} from stack`}
                      >
                        <Ionicons name="close" size={14} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />

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
                    <Text style={styles.existingEmpty}>No matching unstacked tasks</Text>
                  )}
                  {eligibleMatches.length > EXISTING_TASK_PICKER_LIMIT && (
                    <Text style={styles.existingEmpty}>
                      Showing {EXISTING_TASK_PICKER_LIMIT} of {eligibleMatches.length} matches — refine your search
                    </Text>
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
  childText: { flex: 1, gap: 1 },
  childTitle: { color: colors.text, fontSize: font.md },
  childSubtitle: { color: colors.textTertiary, fontSize: font.xs },
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
