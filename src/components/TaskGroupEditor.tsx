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
import type { Task, TaskGroup } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { isRelevantToGroupToday, isTaskVisible } from '../utils/visibilityUtils';
import { formatTaskDate } from '../utils/dateUtils';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { CollapsibleField } from './CollapsibleField';
import { SortableList } from './SortableList';
import { EditorSheet } from './EditorSheet';
import { InlineAction } from './InlineAction';
import { PinIcon } from './PinIcon';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TaskEditor } from './TaskEditor';

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
  return formatTaskDate(task) ?? '';
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
  const applyGroupCategory = useTaskStore(s => s.applyGroupCategory);
  const pinGroup = useTaskStore(s => s.pinGroup);
  const setLastAction = useTaskStore(s => s.setLastAction);
  const updateTask = useTaskStore(s => s.updateTask);
  const updateGroup = useTaskGroupStore(s => s.updateGroup);
  const deleteGroup = useTaskStore(s => s.deleteGroup);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [category, setCategory] = useState<string | null>(null);

  // Set while a member row is being dragged, purely to take the sheet's own
  // ScrollView out of the running for the touch (see SortableList's
  // onDragStateChange) — without it the scroll eats the gesture and the row
  // never moves.
  const [draggingChild, setDraggingChild] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [newChildTitle, setNewChildTitle] = useState('');
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const [existingSearch, setExistingSearch] = useState('');
  // Pickers collapse to their current value, matching the task editor.
  const [openFields, setOpenFields] = useState<Partial<Record<FieldKey, boolean>>>({});
  // A member row opens the task's own editor on top of this one, same as
  // tapping a task row anywhere else in the app.
  const [editingTask, setEditingTask] = useState<Task | null>(null);

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

  // Same subset pinGroup itself acts on — completed occurrences aren't
  // members any more (see groupRoster) and a member not due today is left
  // alone rather than stranded in the Pinned block regardless of its date.
  const pinEligible = members.filter(c => !c.completed && isRelevantToGroupToday(c));
  const allPinned = pinEligible.length > 0 && pinEligible.every(c => c.pinned);

  const handlePin = () => {
    if (!group || pinEligible.length === 0) return;
    haptics.tap();
    pinGroup(group.id);
  };

  // New members always land at the end of the roster — drag the row afterward
  // to move it, same as TaskEditor's own subtask/chain-step lists.
  const commitChild = (title: string) => {
    const trimmed = title.trim();
    if (!group || !trimmed) return;
    addNewGroupedTask(group.id, trimmed);
    // The field closes on submit here (returnKeyType="done", no
    // blurOnSubmit={false}), so there's no burst to keep together.
  };

  const commitExisting = (taskId: string) => {
    if (!group) return;
    addExistingToGroup(taskId, group.id);
    // The picker stays open for a run of adds.
  };

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

  // Tapping Done can beat the new-tag/new-task fields' own blur or Enter —
  // same race TaskEditor's resolveX functions guard against.
  const resolvePendingTags = () => {
    const t = newTag.trim().toLowerCase();
    return t && !tags.includes(t) ? [...tags, t] : tags;
  };
  const commitPendingChild = () => {
    if (!addingChild) return;
    commitChild(newChildTitle);
    setNewChildTitle('');
  };

  const saveAndClose = () => {
    if (!group) { onClose(); return; }
    commitPendingChild();
    const resolvedTags = resolvePendingTags();
    // A blank title only skips the *title* write — an untitled brand-new
    // stack is garbage-collected by the caller anyway (see TodayScreen), and
    // silently dropping notes/tags/category along with it meant
    // clearing the title threw away every other edit in the sheet.
    const trimmed = title.trim();
    const categoryChanged = category !== group.category;
    updateGroup(group.id, {
      ...(trimmed ? { title: trimmed } : {}),
      notes,
      tags: resolvedTags,
      category,
    });
    // The stack owns its members' category, so changing it here re-files
    // them. Deliberately on save rather than as the pills are tapped: the
    // cascade can move tasks between category sections and, where a category
    // carries a schedule or hides on vacation, change what's visible — not
    // something to run three times while someone browses the options.
    if (categoryChanged) {
      const previous = applyGroupCategory(group.id, category);
      if (previous.length > 0) {
        setLastAction({
          label: `${previous.length} task${previous.length === 1 ? '' : 's'} moved to ${category ? categoryLabel(category, categories) : 'no category'}`,
          undo: () => previous.forEach(p => updateTask(p.id, { category: p.category })),
        });
      }
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
    // The roster is exactly what a cascading delete destroys (see deleteGroup),
    // so with an empty one both choices do the same thing — offering "and all
    // its tasks" there asks the user to weigh a consequence that doesn't
    // exist, in a destructive-red button. A stack whose only children are
    // completed occurrences still counts as empty: those are unfiled either
    // way, never deleted.
    const deleteThenClose = (cascade: boolean) => () => {
      deleteGroup(group.id, { cascade });
      onClose();
    };
    Alert.alert(
      `Delete "${group.title}"?`,
      members.length === 0
        ? undefined
        : 'Its tasks can stay in your list unstacked, or be deleted with it.',
      members.length === 0
        ? [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: deleteThenClose(false) },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete stack only', onPress: deleteThenClose(false) },
            {
              text: 'Delete stack and tasks',
              style: 'destructive',
              onPress: deleteThenClose(true),
            },
          ],
    );
  };

  if (!group) return null;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      scrollEnabled={!draggingChild}
      /*
        Inside this sheet's own Modal, not beside it — the same call GroceryCatalogSheet
        makes about GroceryItemSheet. A Modal presents from the view controller
        its React parent belongs to, so a sibling asks the *screen's* controller
        to present a second sheet while this one is already up: iOS refuses, and
        tapping a task in the list did nothing at all.
      */
      footer={
        <TaskEditor
          visible={!!editingTask}
          task={editingTask}
          onClose={() => setEditingTask(null)}
        />
      }
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} />
          <Text style={styles.headerTitle}>{isNew ? 'New stack' : 'Edit stack'}</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handlePin}
              disabled={pinEligible.length === 0}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ disabled: pinEligible.length === 0, selected: allPinned }}
              accessibilityLabel={`${allPinned ? 'Unpin' : 'Pin'} all tasks in ${group.title}`}
            >
              <PinIcon
                filled={allPinned}
                size={20}
                color={pinEligible.length === 0 ? colors.textTertiary : (allPinned ? colors.orange : colors.textSecondary)}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete stack">
              <Ionicons name="trash-outline" size={20} color={colors.red} />
            </TouchableOpacity>
          </View>
        </>
      }
    >
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
          hint="Every task in this stack takes this category. Changing it moves them all."
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
                placeholder="Tag name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="none"
              />
            ) : (
              <InlineAction icon="add" label="Add tag" variant="neutral" onPress={() => setAddingTag(true)} />
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
            onDragStateChange={setDraggingChild}
            renderItem={(child, _i, drag) => {
              const subtitle = memberSchedule(child);
              return (
                <View style={styles.childRow}>
                  <TouchableOpacity
                    style={styles.childText}
                    onPress={() => setEditingTask(child)}
                    onLongPress={drag}
                    delayLongPress={interaction.delayLongPress}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${child.title}`}
                  >
                    <Text
                      style={[styles.childTitle, child.completed && styles.childTitleDone]}
                      numberOfLines={1}
                    >
                      {child.title}
                    </Text>
                    {subtitle !== '' && <Text style={styles.childSubtitle}>{subtitle}</Text>}
                  </TouchableOpacity>
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
          {addingChild && (
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
                  commitChild(newChildTitle);
                  setNewChildTitle('');
                  haptics.tap();
                }}
                onBlur={() => {
                  commitChild(newChildTitle);
                  setNewChildTitle('');
                  setAddingChild(false);
                }}
              />
            </View>
          )}
          {showExistingPicker && (
            <View style={styles.existingPicker}>
              <TextInput
                style={styles.existingSearch}
                value={existingSearch}
                onChangeText={setExistingSearch}
                placeholder="Search tasks"
                placeholderTextColor={colors.textTertiary}
              />
              {eligibleForAdd.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.existingRow}
                  onPress={() => { commitExisting(t.id); haptics.tap(); }}
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
                  Showing {EXISTING_TASK_PICKER_LIMIT} of {eligibleMatches.length} matches. Refine your search to see the rest.
                </Text>
            )}
            </View>
          )}
          <View style={styles.addRow}>
            {!addingChild && (
              <InlineAction icon="add" label="New task" onPress={() => setAddingChild(true)} />
            )}
            {!showExistingPicker && (
              <InlineAction
                icon="albums-outline"
                label="Add existing"
                variant="neutral"
                onPress={() => setShowExistingPicker(true)}
              />
            )}
          </View>

        </View>
      </View>
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 80 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, minHeight: 60,
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.lg, minHeight: 44,
    // No lineHeight on a TextInput. RN maps it onto the iOS paragraph style's
    // minimum/maximum line height with no compensating baseline offset, so the
    // glyphs are drawn a full line height below the top of the line box rather
    // than one ascent below it: the notes sat low in the field while the caret
    // stayed centred, and the placeholder inherited the same attributes so an
    // empty field looked wrong too. The minHeight above is what keeps the box
    // the size the lineHeight used to imply.
  },
  sectionCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  cardSection: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  cardSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  sectionLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.bold,
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
  childRemove: { padding: 4 },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
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
