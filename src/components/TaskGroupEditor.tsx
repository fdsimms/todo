import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { getVisibleAt, isRelevantToGroupToday, isTaskDeferred, isTaskVisible } from '../utils/visibilityUtils';
import { formatTaskDate, getCurrentDayStart, getDayStart } from '../utils/dateUtils';
import { useTaskStore } from '../store/useTaskStore';
import { useTasksWhileOpen } from '../hooks/useTasksWhileOpen';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
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
import { useSheetMount } from '../hooks/useSheetMount';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useStableCallback } from '../hooks/useStableCallback';
import { SheetHeader } from './SheetHeader';
import { TaskEditor, type TaskDraft } from './TaskEditor';
import { QuickAddModal } from './QuickAddModal';
import { useFilterField } from '../hooks/useFilterField';
import { useScrollFieldIntoView } from '../hooks/useKeyboardInsetScroll';
import { TextField } from './TextField';

/** Editor sections that collapse to a one-line summary of their current value. */
type FieldKey = 'category' | 'tags' | 'project';

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
  // A deferred member due later today (an unreached time segment or window,
  // a quota already met for now, ...) still resolves to "Today" below, which
  // read as a bare repeat of "Due today" — say when it'll actually show up
  // instead. Anything not deferred in that sense (blocked, vacation-paused)
  // has no such moment to give, so it falls through unchanged.
  if (isTaskDeferred(task)) {
    const visibleAt = getVisibleAt(task);
    if (getDayStart(visibleAt).getTime() === getCurrentDayStart().getTime()) {
      return 'Later today';
    }
  }
  return formatTaskDate(task) ?? '';
}

interface Props {
  visible: boolean;
  group: TaskGroup | null;
  /** True when this stack was just created and hasn't been titled yet — changes the header title. */
  isNew?: boolean;
  onClose: () => void;
  /**
   * When set, every task added to this stack — new or existing — also joins
   * this project, and the existing-task picker only offers tasks with no
   * project yet, the same rule the project screen's own "Add existing task"
   * list uses. Set by the project detail screen's "Stack" FAB item; every
   * other caller (Today, Search, the Stacks screen) leaves this unset and a
   * stack built there stays project-less, same as before.
   */
  projectId?: string | null;
  /**
   * Completes the given members (today's open ones), from a row in the sheet.
   * The visible way to do what a long press on the stack's icon does. Only
   * Today passes it: elsewhere there's no "today" for the stack to be about.
   */
  onCompleteToday?: (groupId: string, ids: string[]) => void;
}

export function TaskGroupEditor({ visible, group: liveGroup, isNew, onClose, projectId, onCompleteToday }: Props) {
  // Every caller clears `group` in the same commit it lowers `visible`, and
  // this component used to return null the moment it did: the open sheet was
  // torn out of the tree rather than closed, which skips SheetModal's ordered
  // close (see useSheetMount) and left the screen unresponsive for seconds
  // after Done. It also meant every open mounted the whole sheet from scratch.
  // Holding the last group keeps it mounted from its first open onward.
  const group = useSheetSubject(liveGroup);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const projects = useProjectStore(useShallow(s => s.projects));
  const allTasks = useTasksWhileOpen(visible);
  const groupRosterOf = useTaskStore(s => s.groupRosterOf);
  const addExistingToGroup = useTaskStore(s => s.addExistingToGroup);
  const addExistingToProject = useTaskStore(s => s.addExistingToProject);
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
  // The stack's own home (TaskGroup.projectId), not the `projectId` prop —
  // that one is the screen the sheet was opened from.
  const [homeProjectId, setHomeProjectId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState(false);

  // Set while a member row is being dragged, purely to take the sheet's own
  // ScrollView out of the running for the touch (see SortableList's
  // onDragStateChange) — without it the scroll eats the gesture and the row
  // never moves.
  const [draggingChild, setDraggingChild] = useState(false);
  // The "New task" InlineAction raises QuickAddModal (nested in this sheet's
  // own Modal, seeded with this stack) rather than an inline field — a bare
  // TextInput at the bottom of a long roster sits right where the keyboard
  // covers it, and the full sheet gives a date/category/tags picker for free.
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const { query: existingSearch, clear: clearExistingSearch, props: filterField } = useFilterField();
  // The tag field and existing-task search both open (and autofocus) while a
  // keyboard may already be up from another field on this sheet — see
  // useKeyboardInsetScroll's doc comment for why
  // automaticallyAdjustKeyboardInsets alone misses exactly that case.
  const scrollIntoView = useScrollFieldIntoView();
  // Pickers collapse to their current value, matching the task editor.
  const [openFields, setOpenFields] = useState<Partial<Record<FieldKey, boolean>>>({});
  // A member row opens the task's own editor on top of this one, same as
  // tapping a task row anywhere else in the app. A task created through the
  // nested QuickAddModal's "..." handoff opens the same editor via a draft
  // instead of an existing row — see handleQuickAddOpenFull.
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingDraft, setEditingDraft] = useState<Partial<TaskDraft> | null>(null);
  const titleInputRef = useRef<TextInput>(null);
  // The task editor and quick add are nested here for the presentation reason
  // noted at the footer, and each is a large component that runs all of its
  // hooks even while hidden. Mounted on first use rather than on every open
  // of this sheet, which is most of what made opening it slow.
  const mountTaskEditor = useSheetMount(!!editingTask || !!editingDraft);
  const mountQuickAdd = useSheetMount(quickAddVisible);

  // Seeded on each open as well as on a new group: the sheet stays mounted
  // between opens (see useSheetSubject above), so reopening the same stack
  // must not hand back the fields and pickers it was last closed with.
  useEffect(() => {
    if (!group || !visible) return;
    setTitle(group.title);
    setNotes(group.notes);
    setTags(group.tags);
    setCategory(group.category);
    setHomeProjectId(group.projectId);
    setChecklist(group.checklist ?? false);
    setShowExistingPicker(false);
    clearExistingSearch();
    setOpenFields({});
  }, [group, visible]);

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
  // The members the stack's Today tally counts as still to do, which is what
  // its long press completes too (see TaskGroupHeader's completeAll).
  const openToday = members.filter(t => !t.completed && isRelevantToGroupToday(t));
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

  // Which project a task added here gets filed into. The screen the sheet was
  // opened from wins, so adding on a project's page files into the project
  // you're looking at. Falling back to the stack's own home is what keeps a
  // homed stack coherent when it's edited from anywhere else: without it, a
  // task added from Today joins a stack that sits on a project's page while
  // not being in that project.
  const filingProjectId = projectId ?? homeProjectId;
  const checklistShown = !!homeProjectId || !!projectId
    ? projects.find(p => p.id === (projectId ?? homeProjectId))?.kind !== 'list'
    : false;

  // Same TaskGroup, two names: homed on a project it reads as "section" (the
  // vocabulary the project screen's own FAB and empty-state copy already use),
  // unhomed it's a "stack" (Today, Search, the standalone Stacks screen). Tied
  // to filingProjectId rather than the group's stored projectId alone, so the
  // wording updates live if the Project field below is changed while this
  // sheet is still open.
  const sectionWord = filingProjectId ? 'section' : 'stack';
  const sectionWordCap = filingProjectId ? 'Section' : 'Stack';

  // Stable, because QuickAddModal is memoized and stays mounted once used: a
  // fresh prop each render would re-render the hidden sheet with this one.
  const onQuickAddClose = useStableCallback(() => setQuickAddVisible(false));
  const onQuickAddCreated = useStableCallback((task: Task) => {
    if (filingProjectId) addExistingToProject(task.id, filingProjectId);
  });
  const onQuickAddOpenFull = useStableCallback((draft: Partial<TaskDraft>) => {
    setQuickAddVisible(false);
    setEditingTask(null);
    setEditingDraft(draft);
  });
  const groupId = group?.id;
  const quickAddSeed = useMemo(() => (groupId ? { groupId, category } : undefined), [groupId, category]);

  const commitExisting = (taskId: string) => {
    if (!group) return;
    addExistingToGroup(taskId, group.id);
    if (filingProjectId) addExistingToProject(taskId, filingProjectId);
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
      (!filingProjectId || !t.projectId) &&
      (q === '' || t.title.toLowerCase().includes(q))
    );
  }, [allTasks, existingSearch, group, filingProjectId]);
  const EXISTING_TASK_PICKER_LIMIT = 30;
  const eligibleForAdd = useMemo(
    () => eligibleMatches.slice(0, EXISTING_TASK_PICKER_LIMIT),
    [eligibleMatches],
  );

  // Tapping Done can beat the new-tag field's own blur or Enter — same race
  // TaskEditor's resolveX functions guard against.
  const resolvePendingTags = () => {
    const t = newTag.trim().toLowerCase();
    return t && !tags.includes(t) ? [...tags, t] : tags;
  };

  const saveAndClose = () => {
    if (!group) { onClose(); return; }
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
      // Deliberately no cascade onto the members, unlike category below. A
      // stack owns its members' category; it does not own their project —
      // tasks in one stack can sit in different projects, and this field only
      // says which project's page shows the stack when it has nothing in it.
      projectId: homeProjectId,
      checklist,
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
        : `Its tasks can stay in your list un${sectionWord}ed, or be deleted with it.`,
      members.length === 0
        ? [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: deleteThenClose(false) },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: `Delete ${sectionWord} only`, onPress: deleteThenClose(false) },
            {
              text: `Delete ${sectionWord} and tasks`,
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
      // Only for a brand-new stack — editing an existing one opens onto a
      // title it's fine to leave alone. The sheet stays mounted across opens,
      // so a bare `autoFocus` on the field would only ever fire once.
      onShow={() => { if (isNew) titleInputRef.current?.focus(); }}
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
        <>
          {mountTaskEditor && <TaskEditor
            visible={!!editingTask || !!editingDraft}
            task={editingTask}
            initialDraft={editingDraft}
            onClose={() => { setEditingTask(null); setEditingDraft(null); }}
          />}
          {/*
            Also inside this sheet's own Modal, for the same reason as
            TaskEditor above — raised by the "New task" InlineAction rather
            than a bare inline field, so a long roster's add field doesn't
            sit right where the keyboard covers it.
          */}
          {mountQuickAdd && <QuickAddModal
            visible={quickAddVisible}
            onClose={onQuickAddClose}
            context="unscheduled"
            seed={quickAddSeed}
            seedLabel={title.trim() || sectionWordCap}
            // Filed at creation rather than only in onCreated, which a burst
            // of "Add another" never calls.
            intoProjectId={filingProjectId}
            onCreated={onQuickAddCreated}
            onOpenFull={onQuickAddOpenFull}
          />}
        </>
      }
      header={
        <SheetHeader
          bare
          title={isNew ? `New ${sectionWord}` : `Edit ${sectionWord}`}
          left={<SheetHeaderButton label="Done" onPress={saveAndClose} />}
          right={
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
                  color={pinEligible.length === 0 ? colors.textTertiary : (allPinned ? colors.orangeText : colors.textSecondary)}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${sectionWord}`}>
                <Ionicons name="trash-outline" size={20} color={colors.red} />
              </TouchableOpacity>
            </View>
          }
        />
      }
    >
      <TextField
        ref={titleInputRef}
        style={styles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder={`${sectionWordCap} title`}
        placeholderTextColor={colors.textTertiary}
        maxLength={TITLE_MAX_LENGTH}
        multiline
        // A new one's name is what the sheet was opened to type.
        autoFocus={!!isNew}
      />
      <TextField
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes"
        placeholderTextColor={colors.textTertiary}
        multiline
      />

      {/* A new section made on a project's page is a heading and nothing more
          yet: a name, like "Plumbing". Category, project and tags are stack
          settings it can pick up later, from the same sheet, once it exists.
          The project field is left off a section opened from its own project
          page outright, since that answer is the page it was opened on. */}
      {/* A section on a project page can be a checklist: a packing list
          inside a trip. Only on a project's own section (not a stack on
          Today), and not on a list project, whose lines are already undated. */}
      {checklistShown && (
        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { haptics.tap(); setChecklist(v => !v); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityLabel="Checklist"
            accessibilityState={{ checked: checklist }}
          >
            <Ionicons name="checkbox-outline" size={18} color={checklist ? colors.accent : colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Checklist</Text>
              <Text style={styles.optionHint}>
                {checklist
                  ? "Its tasks are checked off, not scheduled. Rows hide their dates and Pull doesn't offer them. A task that already has a date still shows on Today that day"
                  : 'Its tasks are scheduled like the rest of the project'}
              </Text>
            </View>
            <View style={[styles.toggle, checklist && styles.toggleOn]}>
              <View style={[styles.toggleKnob, checklist && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {!(isNew && projectId) && (
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Category"
          summary={category ? categoryLabel(category, categories) : undefined}
          hint={`Every task in this ${sectionWord} takes this category. Changing it moves them all.`}
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
        {projects.length > 0 && !projectId && (
          <>
            <View style={styles.cardSep} />
            <CollapsibleField
              label="Project"
              summary={projects.find(p => p.id === homeProjectId)?.title}
              hint="Keeps the stack on that project's page even while it has no tasks in it. Doesn't move the tasks it already has."
              expanded={fieldOpen('project')}
              onToggle={() => toggleField('project')}
            >
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, !homeProjectId && styles.pillActive]}
                  onPress={() => { haptics.tap(); setHomeProjectId(null); closeField('project'); }}
                >
                  <Text style={[styles.pillText, !homeProjectId && styles.pillTextActive]}>None</Text>
                </TouchableOpacity>
                {projects.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.pill, homeProjectId === p.id && styles.pillActive]}
                    onPress={() => { haptics.tap(); setHomeProjectId(p.id); closeField('project'); }}
                  >
                    <Text style={[styles.pillText, homeProjectId === p.id && styles.pillTextActive]}>{p.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </CollapsibleField>
          </>
        )}
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
              <TextField
                autoFocus
                style={styles.tagInput}
                value={newTag}
                onChangeText={setNewTag}
                onFocus={scrollIntoView}
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
      )}

      <View style={styles.sectionCard}>
        <View style={styles.cardSection}>
          <View style={styles.subtaskHeader}>
            <Text style={styles.sectionLabel}>Tasks in this {sectionWord}</Text>
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
                    accessibilityLabel={`Remove ${child.title} from ${sectionWord}`}
                  >
                    <Ionicons name="close" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              );
            }}
          />
          {showExistingPicker && (
            <View style={styles.existingPicker}>
              <TextInput
                style={styles.existingSearch}
                {...filterField}
                onFocus={scrollIntoView}
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
                <Text style={styles.existingEmpty}>
                  {filingProjectId ? 'No matching tasks with no section or project yet' : 'No matching unstacked tasks'}
                </Text>
            )}
              {eligibleMatches.length > EXISTING_TASK_PICKER_LIMIT && (
                <Text style={styles.existingEmpty}>
                  Showing {EXISTING_TASK_PICKER_LIMIT} of {eligibleMatches.length} matches. Refine your search to see the rest.
                </Text>
            )}
            </View>
          )}
          <View style={styles.addRow}>
            <InlineAction icon="add" label="New task" onPress={() => setQuickAddVisible(true)} />
            {!showExistingPicker && (
              <InlineAction
                icon="albums-outline"
                label="Add existing"
                variant="neutral"
                onPress={() => setShowExistingPicker(true)}
              />
            )}
          </View>
          {onCompleteToday && openToday.length > 0 && (
            <View style={styles.addRow}>
              <InlineAction
                icon="checkmark-done-outline"
                label={openToday.length === 1 ? "Complete today's task" : `Complete today's ${openToday.length} tasks`}
                variant="neutral"
                onPress={() => {
                  const ids = openToday.map(t => t.id);
                  const groupId = group.id;
                  // Closed first, so any answer prompt the completion raises
                  // isn't held behind this sheet.
                  saveAndClose();
                  onCompleteToday(groupId, ids);
                }}
              />
            </View>
          )}

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
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.xxs },
  toggle: {
    width: 44, height: 26, borderRadius: radius.full,
    backgroundColor: colors.bgQuaternary, padding: spacing.xxs, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.bg,
  },
  toggleKnobOn: { alignSelf: 'flex-end' },
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
  pillText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
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
  existingPicker: {
    marginTop: spacing.sm, backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    padding: spacing.sm,
  },
  existingSearch: {
    color: colors.text, fontSize: font.sm,
    backgroundColor: colors.bgQuaternary, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xsm, marginBottom: spacing.xs,
  },
  existingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  existingRowText: { flex: 1, color: colors.text, fontSize: font.sm },
  existingEmpty: { color: colors.textTertiary, fontSize: font.sm, paddingVertical: 8 },
});
