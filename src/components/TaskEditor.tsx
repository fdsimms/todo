import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NestableScrollContainer, NestableDraggableFlatList, ScaleDecorator } from 'react-native-draggable-flatlist';
import type { RenderItemParams } from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import { CalendarPicker } from './CalendarPicker';
import { format } from 'date-fns';
import type { Task, Priority, Effort, RecurrenceType, CycleItem, TimeOfDay } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, EFFORT_LABELS, EFFORT_HINTS } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, type Colors } from '../theme';
import { tagColor } from '../utils/tagColor';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useShallow } from 'zustand/react/shallow';
import { formatDueDate, formatDeferUntil } from '../utils/dateUtils';
import { generateId } from '../utils/id';

interface Props {
  visible: boolean;
  task?: Task | null;
  initialSomeday?: boolean;
  initialTitle?: string;
  onClose: () => void;
}

type PickerMode = 'none' | 'dueDate' | 'deferUntil' | 'reminder';

const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  none: 'Never',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

export function TaskEditor({ visible, task, initialSomeday, initialTitle, onClose }: Props) {
  const addTask = useTaskStore(s => s.addTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const setLastEditSnapshot = useTaskStore(s => s.setLastEditSnapshot);
  const addSubtask = useTaskStore(s => s.addSubtask);
  const toggleSubtask = useTaskStore(s => s.toggleSubtask);
  const deleteSubtask = useTaskStore(s => s.deleteSubtask);
  const reorderSubtasks = useTaskStore(s => s.reorderSubtasks);
  const subtasksOf = useTaskStore(s => s.subtasksOf);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allProjects = useProjectStore(useShallow(s => s.projects));
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay | null>(null);
  const [deferUntil, setDeferUntil] = useState<Date | null>(null);
  const [reminderTime, setReminderTime] = useState<Date | null>(null);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceFromCompletion, setRecurrenceFromCompletion] = useState(false);
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [focused, setFocused] = useState(false);
  const [someday, setSomeday] = useState(false);

  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>('none');
  const [pickerDate, setPickerDate] = useState(new Date());
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);

  const [cycleEnabled, setCycleEnabled] = useState(false);
  const [cycleItems, setCycleItems] = useState<CycleItem[]>([]);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [newCycleItemTitle, setNewCycleItemTitle] = useState('');
  const [addingCycleItem, setAddingCycleItem] = useState(false);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);

  const titleRef = useRef<TextInput>(null);
  const cycleInputRef = useRef<TextInput>(null);
  const cycleItemSavedRef = useRef(false);
  const subtaskInputRef = useRef<TextInput>(null);
  const subtaskSavedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    if (task) {
      setTitle(task.title); setNotes(task.notes); setTags(task.tags);
      setDueDate(task.dueDate ? new Date(task.dueDate) : null);
      setTimeOfDay(task.timeOfDay ?? null);
      setDeferUntil(task.deferUntil ? new Date(task.deferUntil) : null);
      setReminderTime(task.reminderTime ? new Date(task.reminderTime) : null);
      setRecurrenceType(task.recurrenceType); setRecurrenceInterval(task.recurrenceInterval);
      setRecurrenceFromCompletion(task.recurrenceFromCompletion);
      setPriority(task.priority); setEffort(task.effort); setFocused(task.focused);
      setSomeday(task.someday);
      setCycleEnabled(task.cycleEnabled); setCycleItems(task.cycleItems);
      setCycleIndex(task.cycleIndex);
      setProjectId(task.projectId ?? null);
    } else {
      setTitle(initialTitle ?? ''); setNotes(''); setTags([]);
      setDueDate(null); setTimeOfDay(null); setDeferUntil(null); setReminderTime(null);
      setRecurrenceType('none'); setRecurrenceInterval(1); setRecurrenceFromCompletion(false);
      setPriority(0); setEffort(0); setFocused(false);
      setSomeday(initialSomeday ?? false);
      setCycleEnabled(false); setCycleItems([]); setCycleIndex(0);
      setProjectId(null);
    }
    setPickerMode('none'); setPickerDate(new Date()); setNewTag(''); setAddingTag(false);
    setNewSubtaskTitle(''); setAddingSubtask(false);
    setNewCycleItemTitle(''); setAddingCycleItem(false);
    setProjectPickerVisible(false);
    setTimeout(() => titleRef.current?.focus(), 100);
  }, [visible, task]);

  const save = () => {
    if (!title.trim()) return;
    const data = {
      title: title.trim(), notes, tags,
      dueDate: dueDate?.toISOString() ?? null,
      timeOfDay, deferUntil: deferUntil?.toISOString() ?? null,
      reminderTime: reminderTime?.toISOString() ?? null,
      recurrenceType, recurrenceInterval,
      recurrenceDays: task?.recurrenceDays ?? [],
      recurrenceEndDate: null,
      recurrenceFromCompletion,
      sortOrder: task?.sortOrder ?? 0,
      focused, someday, priority, effort,
      cycleEnabled: cycleEnabled && cycleItems.length > 0,
      cycleItems,
      cycleIndex,
      projectId,
    };
    if (task) {
      setLastEditSnapshot({ id: task.id, snapshot: { ...task } });
      updateTask(task.id, data);
    } else {
      addTask(data);
    }
    onClose();
  };

  const openPicker = (mode: PickerMode) => {
    if (mode === 'dueDate') setPickerDate(dueDate ?? new Date());
    if (mode === 'deferUntil') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setPickerDate(deferUntil ?? tomorrow);
    }
    if (mode === 'reminder') {
      const defaultDate = dueDate ?? new Date();
      defaultDate.setHours(9, 0, 0, 0);
      setPickerDate(reminderTime ?? defaultDate);
    }
    setPickerMode(mode);
  };

  const confirmPicker = (confirmed: Date) => {
    if (pickerMode === 'dueDate') setDueDate(confirmed);
    if (pickerMode === 'deferUntil') {
      // Store noon of the selected day to ensure day-level comparison works
      const noon = new Date(confirmed);
      noon.setHours(12, 0, 0, 0);
      setDeferUntil(noon);
    }
    if (pickerMode === 'reminder') setReminderTime(confirmed);
    setPickerMode('none');
  };

  const addTagFromInput = () => {
    const t = newTag.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setNewTag(''); setAddingTag(false);
  };

  const cycleRecurrence = () => {
    const types: RecurrenceType[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
    setRecurrenceType(types[(types.indexOf(recurrenceType) + 1) % types.length]);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.headerBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{task ? 'Edit Task' : 'New Task'}</Text>
          <TouchableOpacity onPress={save} hitSlop={8}>
            <Text style={[styles.headerBtn, styles.headerSave, !title.trim() && styles.disabled]}>
              {task ? 'Save' : 'Add'}
            </Text>
          </TouchableOpacity>
        </View>

        <NestableScrollContainer style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
          <TextInput
            ref={titleRef}
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Task title"
            placeholderTextColor={colors.textTertiary}
            multiline blurOnSubmit
          />
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes"
            placeholderTextColor={colors.textTertiary}
            multiline
          />

          {/* Tags */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Tags</Text>
            <View style={styles.tagRow}>
              {tags.map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={[styles.tagChip, { backgroundColor: tagColor(tag) + '33' }]}
                  onPress={() => setTags(prev => prev.filter(t => t !== tag))}
                >
                  <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                  <Text style={[styles.tagChipText, { color: tagColor(tag) }]}>{tag}</Text>
                  <Ionicons name="close" size={12} color={tagColor(tag)} />
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
                <TouchableOpacity style={styles.addTagBtn} onPress={() => setAddingTag(true)}>
                  <Ionicons name="add" size={14} color={colors.accent} />
                  <Text style={styles.addTagText}>Add tag</Text>
                </TouchableOpacity>
              )}
            </View>
            {allTags.filter(t => !tags.includes(t)).length > 0 && (
              <View style={styles.tagSuggestions}>
                {allTags.filter(t => !tags.includes(t)).slice(0, 6).map(tag => (
                  <TouchableOpacity
                    key={tag}
                    style={styles.tagSuggestion}
                    onPress={() => setTags(prev => [...prev, tag])}
                  >
                    <Text style={styles.tagSuggestionText}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Priority */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Priority</Text>
            <View style={styles.pillRow}>
              {([0, 1, 2, 3, 4] as Priority[]).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.pill,
                    priority === p && p === 0 && styles.pillActiveNeutral,
                    priority === p && p > 0 && { backgroundColor: PRIORITY_COLORS[p] },
                  ]}
                  onPress={() => setPriority(p)}
                >
                  <Text style={[styles.pillText, priority === p && styles.pillTextActive]}>
                    {PRIORITY_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Effort */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Effort</Text>
            <View style={styles.pillRow}>
              {([0, 1, 2, 3, 4, 5] as Effort[]).map(e => (
                <TouchableOpacity
                  key={e}
                  style={[
                    styles.pill,
                    effort === e && styles.pillActiveNeutral,
                  ]}
                  onPress={() => setEffort(e)}
                >
                  <Text style={[styles.pillText, effort === e && styles.pillTextActive]}>
                    {e === 0 ? '—' : EFFORT_LABELS[e]}
                  </Text>
                  {EFFORT_HINTS[e] ? (
                    <Text style={styles.pillHint}>{EFFORT_HINTS[e]}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Subtasks — only shown when editing an existing task */}
          {task && (() => {
            const subtasks = subtasksOf(task.id);
            const doneCount = subtasks.filter(s => s.completed).length;
            return (
              <View style={styles.section}>
                <View style={styles.subtaskHeader}>
                  <Text style={styles.sectionLabel}>Subtasks</Text>
                  {subtasks.length > 0 && (
                    <Text style={styles.subtaskProgress}>{doneCount}/{subtasks.length}</Text>
                  )}
                </View>
                <NestableDraggableFlatList
                  data={subtasks}
                  keyExtractor={sub => sub.id}
                  onDragEnd={({ data }) => reorderSubtasks(task.id, data.map(s => s.id))}
                  renderItem={({ item: sub, drag }: RenderItemParams<typeof subtasks[0]>) => (
                    <ScaleDecorator>
                      <View style={styles.subtaskRow}>
                        <TouchableOpacity
                          onPress={() => toggleSubtask(sub.id)}
                          hitSlop={6}
                          style={styles.subtaskCheck}
                        >
                          <Ionicons
                            name={sub.completed ? 'checkmark-circle' : 'ellipse-outline'}
                            size={20}
                            color={sub.completed ? colors.green : colors.bgQuaternary}
                          />
                        </TouchableOpacity>
                        <Text style={[styles.subtaskTitle, sub.completed && styles.subtaskDone]}>
                          {sub.title}
                        </Text>
                        <TouchableOpacity
                          onLongPress={drag}
                          delayLongPress={150}
                          hitSlop={8}
                          style={styles.dragHandle}
                        >
                          <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => deleteSubtask(sub.id)}
                          hitSlop={8}
                          style={styles.subtaskDelete}
                        >
                          <Ionicons name="close" size={14} color={colors.textTertiary} />
                        </TouchableOpacity>
                      </View>
                    </ScaleDecorator>
                  )}
                />
                {addingSubtask ? (
                  <View style={styles.subtaskInputRow}>
                    <Ionicons name="ellipse-outline" size={20} color={colors.bgQuaternary} />
                    <TextInput
                      ref={subtaskInputRef}
                      autoFocus
                      style={styles.subtaskInput}
                      value={newSubtaskTitle}
                      onChangeText={setNewSubtaskTitle}
                      placeholder="Subtask title"
                      placeholderTextColor={colors.textTertiary}
                      returnKeyType="done"
                      onSubmitEditing={() => {
                        subtaskSavedRef.current = true;
                        const t = newSubtaskTitle.trim();
                        if (t) addSubtask(task.id, t);
                        setNewSubtaskTitle('');
                        setTimeout(() => {
                          subtaskSavedRef.current = false;
                          subtaskInputRef.current?.focus();
                        }, 50);
                      }}
                      onBlur={() => {
                        if (subtaskSavedRef.current) return;
                        const t = newSubtaskTitle.trim();
                        if (t) addSubtask(task.id, t);
                        setNewSubtaskTitle('');
                        setAddingSubtask(false);
                      }}
                    />
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addSubtaskBtn}
                    onPress={() => setAddingSubtask(true)}
                  >
                    <Ionicons name="add" size={14} color={colors.accent} />
                    <Text style={styles.addSubtaskText}>Add subtask</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}

          {/* Cycle items */}
          <View style={styles.section}>
            <View style={styles.cycleHeader}>
              <Ionicons name="sync" size={14} color={cycleEnabled ? colors.accent : colors.textTertiary} />
              <Text style={[styles.sectionLabel, { marginBottom: 0, flex: 1 }]}>Cycle</Text>
              <TouchableOpacity
                style={[styles.cycleToggle, cycleEnabled && styles.cycleToggleOn]}
                onPress={() => setCycleEnabled(v => !v)}
              >
                <View style={[styles.cycleToggleKnob, cycleEnabled && styles.cycleToggleKnobOn]} />
              </TouchableOpacity>
            </View>
            {!cycleEnabled && (
              <Text style={styles.cycleHint}>
                Rotate through different versions of this task on each recurrence.
              </Text>
            )}
            {cycleEnabled && (
              <>
                <NestableDraggableFlatList
                  data={cycleItems}
                  keyExtractor={item => item.id}
                  onDragEnd={({ data, from, to }) => {
                    setCycleItems(data);
                    const activeItem = cycleItems[cycleIndex];
                    if (activeItem) {
                      const newIdx = data.findIndex(item => item.id === activeItem.id);
                      if (newIdx !== -1) setCycleIndex(newIdx);
                    }
                  }}
                  renderItem={({ item, drag, getIndex }: RenderItemParams<CycleItem>) => {
                    const i = getIndex() ?? 0;
                    return (
                      <ScaleDecorator>
                        <View style={styles.cycleItemRow}>
                          <TouchableOpacity
                            onPress={() => setCycleIndex(i)}
                            hitSlop={6}
                            style={styles.cycleItemIndexBtn}
                          >
                            <View style={[styles.cycleItemDot, i === cycleIndex && styles.cycleItemDotActive]}>
                              <Text style={[styles.cycleItemDotText, i === cycleIndex && styles.cycleItemDotTextActive]}>
                                {i + 1}
                              </Text>
                            </View>
                          </TouchableOpacity>
                          <Text style={[styles.cycleItemTitle, i === cycleIndex && styles.cycleItemTitleActive]}>
                            {item.title}
                          </Text>
                          <TouchableOpacity
                            onLongPress={drag}
                            delayLongPress={150}
                            hitSlop={8}
                            style={styles.dragHandle}
                          >
                            <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              const next = cycleItems.filter((_, idx) => idx !== i);
                              setCycleItems(next);
                              if (cycleIndex >= next.length) setCycleIndex(Math.max(0, next.length - 1));
                            }}
                            hitSlop={8}
                            style={styles.cycleItemDelete}
                          >
                            <Ionicons name="close" size={14} color={colors.textTertiary} />
                          </TouchableOpacity>
                        </View>
                      </ScaleDecorator>
                    );
                  }}
                />
                {addingCycleItem ? (
                  <View style={styles.cycleInputRow}>
                    <View style={styles.cycleItemDot}>
                      <Text style={styles.cycleItemDotText}>{cycleItems.length + 1}</Text>
                    </View>
                    <TextInput
                      ref={cycleInputRef}
                      autoFocus
                      style={styles.cycleInput}
                      value={newCycleItemTitle}
                      onChangeText={setNewCycleItemTitle}
                      placeholder="Item title"
                      placeholderTextColor={colors.textTertiary}
                      returnKeyType="done"
                      onSubmitEditing={() => {
                        cycleItemSavedRef.current = true;
                        const t = newCycleItemTitle.trim();
                        if (t) setCycleItems(prev => [...prev, { id: generateId(), title: t, notes: '' }]);
                        setNewCycleItemTitle('');
                        setTimeout(() => {
                          cycleItemSavedRef.current = false;
                          cycleInputRef.current?.focus();
                        }, 50);
                      }}
                      onBlur={() => {
                        if (cycleItemSavedRef.current) return;
                        const t = newCycleItemTitle.trim();
                        if (t) setCycleItems(prev => [...prev, { id: generateId(), title: t, notes: '' }]);
                        setNewCycleItemTitle('');
                        setAddingCycleItem(false);
                      }}
                    />
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addCycleItemBtn}
                    onPress={() => setAddingCycleItem(true)}
                  >
                    <Ionicons name="add" size={14} color={colors.accent} />
                    <Text style={styles.addCycleItemText}>Add item</Text>
                  </TouchableOpacity>
                )}
                {cycleIndex < cycleItems.length && cycleItems.length > 1 && (
                  <Text style={styles.cycleCurrentHint}>
                    Tap a number to set the current position. Next up: {cycleItems[(cycleIndex + 1) % cycleItems.length]?.title}
                  </Text>
                )}
              </>
            )}
          </View>

          {/* Options */}
          <View style={styles.optionsCard}>
            <TouchableOpacity style={styles.optionRow} onPress={() => setSomeday(s => !s)}>
              <Ionicons
                name={someday ? 'moon' : 'moon-outline'}
                size={18}
                color={someday ? colors.accent : colors.textSecondary}
              />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Someday</Text>
                <Text style={styles.optionHint}>Park in Someday, not Today</Text>
              </View>
              <View style={[styles.toggle, someday && styles.toggleOnSomeday]}>
                <View style={[styles.toggleKnob, someday && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            <View style={styles.sep} />
            <OptionRow
              icon="calendar"
              label="Due date"
              value={dueDate ? formatDueDate(dueDate.toISOString()) : undefined}
              onPress={() => openPicker('dueDate')}
              onClear={dueDate ? () => setDueDate(null) : undefined}
              colors={colors}
              styles={styles}
            />
            <View style={styles.sep} />
            <View style={styles.optionRow}>
              <Ionicons name="time-outline" size={18} color={timeOfDay ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Time of day</Text>
                {!timeOfDay && <Text style={styles.optionHint}>Show from a specific part of the day</Text>}
              </View>
            </View>
            <View style={styles.timePillRow}>
              {([null, 'morning', 'afternoon', 'evening'] as (TimeOfDay | null)[]).map(tod => (
                <TouchableOpacity
                  key={tod ?? 'any'}
                  style={[styles.timePill, timeOfDay === tod && styles.timePillActive]}
                  onPress={() => setTimeOfDay(tod)}
                >
                  <Text style={[styles.timePillText, timeOfDay === tod && styles.timePillTextActive]}>
                    {tod === null ? 'Any' : tod.charAt(0).toUpperCase() + tod.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.sep} />
            <OptionRow
              icon="time"
              label="Defer until"
              hint="Hide until this day"
              value={deferUntil ? formatDeferUntil(deferUntil.toISOString()) : undefined}
              onPress={() => openPicker('deferUntil')}
              onClear={deferUntil ? () => setDeferUntil(null) : undefined}
              colors={colors}
              styles={styles}
            />
            <View style={styles.sep} />
            <OptionRow
              icon="notifications"
              label="Remind me"
              hint="Send a notification at this time"
              value={reminderTime ? format(reminderTime, "MMM d 'at' h:mm a") : undefined}
              onPress={() => openPicker('reminder')}
              onClear={reminderTime ? () => setReminderTime(null) : undefined}
              colors={colors}
              styles={styles}
            />
            <View style={styles.sep} />
            <OptionRow
              icon="repeat"
              label="Repeat"
              value={recurrenceType !== 'none' ? RECURRENCE_LABELS[recurrenceType] : undefined}
              onPress={cycleRecurrence}
              onClear={recurrenceType !== 'none' ? () => setRecurrenceType('none') : undefined}
              colors={colors}
              styles={styles}
            />
            {recurrenceType !== 'none' && (
              <>
                <View style={styles.intervalRow}>
                  <Text style={styles.intervalLabel}>Every</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => setRecurrenceInterval(Math.max(1, recurrenceInterval - 1))}
                  >
                    <Ionicons name="remove" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.intervalValue}>{recurrenceInterval}</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => setRecurrenceInterval(recurrenceInterval + 1)}
                  >
                    <Ionicons name="add" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.intervalLabel}>{RECURRENCE_LABELS[recurrenceType].toLowerCase()}</Text>
                </View>
                <View style={styles.scheduleRow}>
                  <TouchableOpacity
                    style={[styles.schedulePill, !recurrenceFromCompletion && styles.schedulePillActive]}
                    onPress={() => setRecurrenceFromCompletion(false)}
                  >
                    <Text style={[styles.schedulePillText, !recurrenceFromCompletion && styles.schedulePillTextActive]}>
                      On schedule
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceFromCompletion && styles.schedulePillActive]}
                    onPress={() => setRecurrenceFromCompletion(true)}
                  >
                    <Text style={[styles.schedulePillText, recurrenceFromCompletion && styles.schedulePillTextActive]}>
                      After completion
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            <View style={styles.sep} />
            <TouchableOpacity style={styles.optionRow} onPress={() => setFocused(f => !f)}>
              <Ionicons
                name={focused ? 'star' : 'star-outline'}
                size={18}
                color={focused ? colors.orange : colors.textSecondary}
              />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>In Focus</Text>
                <Text style={styles.optionHint}>Show in Focus tab</Text>
              </View>
              <View style={[styles.toggle, focused && styles.toggleOn]}>
                <View style={[styles.toggleKnob, focused && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            {allProjects.length > 0 && (
              <>
                <View style={styles.sep} />
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => setProjectPickerVisible(true)}
                  activeOpacity={0.7}
                >
                  {(() => {
                    const proj = allProjects.find(p => p.id === projectId);
                    return (
                      <>
                        <Ionicons
                          name="folder"
                          size={18}
                          color={proj ? proj.color : colors.textSecondary}
                        />
                        <View style={styles.optionContent}>
                          <Text style={styles.optionLabel}>Project</Text>
                        </View>
                        {proj ? (
                          <View style={styles.optionValueRow}>
                            <Text style={[styles.optionValue, { color: proj.color }]}>{proj.name}</Text>
                            <TouchableOpacity onPress={() => setProjectId(null)} hitSlop={8}>
                              <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                        )}
                      </>
                    );
                  })()}
                </TouchableOpacity>
              </>
            )}
          </View>
        </NestableScrollContainer>

        <CalendarPicker
          visible={pickerMode !== 'none'}
          value={pickerDate}
          mode={pickerMode === 'deferUntil' ? 'date' : 'datetime'}
          title={
            pickerMode === 'dueDate' ? 'Due Date'
              : pickerMode === 'reminder' ? 'Remind Me'
              : 'Defer Until'
          }
          nlEnabled={pickerMode !== 'deferUntil'}
          onConfirm={confirmPicker}
          onCancel={() => setPickerMode('none')}
        />
      </KeyboardAvoidingView>
      </GestureHandlerRootView>

      <Modal
        visible={projectPickerVisible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setProjectPickerVisible(false)}
      >
        <View style={[styles.projectPickerRoot, { paddingTop: 20 }]}>
          <View style={styles.projectPickerHeader}>
            <Text style={styles.projectPickerTitle}>Project</Text>
            <TouchableOpacity onPress={() => setProjectPickerVisible(false)} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.projectPickerItem}
            onPress={() => { setProjectId(null); setProjectPickerVisible(false); }}
          >
            <Ionicons name="folder-outline" size={20} color={colors.textTertiary} />
            <Text style={styles.projectPickerItemText}>No Project</Text>
            {projectId === null && <Ionicons name="checkmark" size={18} color={colors.accent} />}
          </TouchableOpacity>
          {allProjects.map(p => (
            <TouchableOpacity
              key={p.id}
              style={styles.projectPickerItem}
              onPress={() => { setProjectId(p.id); setProjectPickerVisible(false); }}
            >
              <Ionicons name="folder" size={20} color={p.color} />
              <Text style={[styles.projectPickerItemText, { flex: 1 }]}>{p.name}</Text>
              {projectId === p.id && <Ionicons name="checkmark" size={18} color={colors.accent} />}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>
    </Modal>
  );
}

function OptionRow({
  icon, label, value, hint, onPress, onClear, colors, styles,
}: {
  icon: string; label: string; value?: string; hint?: string;
  onPress: () => void; onClear?: () => void;
  colors: Colors; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={styles.optionRow} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon as never} size={18} color={value ? colors.accent : colors.textSecondary} />
      <View style={styles.optionContent}>
        <Text style={styles.optionLabel}>{label}</Text>
        {hint && !value && <Text style={styles.optionHint}>{hint}</Text>}
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
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  headerBtn: { color: colors.accent, fontSize: font.md },
  headerSave: { fontWeight: '600' },
  disabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 320 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm, minHeight: 60,
    letterSpacing: -0.3,
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md, minHeight: 50,
    lineHeight: 22,
  },
  section: { paddingHorizontal: spacing.md, marginBottom: spacing.md },
  sectionLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagChipText: { fontSize: font.sm, fontWeight: '500' },
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
  tagSuggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  tagSuggestion: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  tagSuggestionText: { color: colors.textSecondary, fontSize: font.xs },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  pillActiveNeutral: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
  pillHint: { color: colors.textTertiary, fontSize: 10, marginTop: 2 },
  timePillRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  timePill: {
    flex: 1, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, alignItems: 'center',
  },
  timePillActive: { backgroundColor: colors.accent },
  timePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  timePillTextActive: { color: colors.bg, fontWeight: '600' },
  optionsCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 1 },
  optionValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  optionValue: { color: colors.accent, fontSize: font.sm },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md + 18 + spacing.md },
  intervalRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  intervalLabel: { color: colors.textSecondary, fontSize: font.sm },
  scheduleRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  schedulePill: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  schedulePillActive: { backgroundColor: colors.accent },
  schedulePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  schedulePillTextActive: { color: colors.bg },
  intervalBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  intervalValue: {
    color: colors.text, fontSize: font.md, fontWeight: '600',
    minWidth: 24, textAlign: 'center',
  },
  toggle: {
    width: 46, height: 27, borderRadius: 14,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: colors.orange },
  toggleOnSomeday: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 21, height: 21, borderRadius: 11,
    backgroundColor: colors.textSecondary,
  },
  toggleKnobOn: { backgroundColor: colors.text, alignSelf: 'flex-end' },
  subtaskHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  subtaskProgress: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '600',
  },
  subtaskRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  subtaskCheck: { padding: 2 },
  subtaskTitle: {
    flex: 1, color: colors.text, fontSize: font.md,
  },
  subtaskDone: {
    color: colors.textTertiary, textDecorationLine: 'line-through',
  },
  subtaskDelete: { padding: 4 },
  dragHandle: { padding: 4 },
  subtaskInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
  },
  subtaskInput: {
    flex: 1, color: colors.text, fontSize: font.md,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 2,
  },
  addSubtaskBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: spacing.sm,
  },
  addSubtaskText: { color: colors.accent, fontSize: font.sm },
  cycleHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cycleToggle: {
    width: 42, height: 25, borderRadius: 13,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  cycleToggleOn: { backgroundColor: colors.accent },
  cycleToggleKnob: {
    width: 19, height: 19, borderRadius: 10,
    backgroundColor: colors.textSecondary,
  },
  cycleToggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
  cycleHint: {
    color: colors.textTertiary, fontSize: font.xs, lineHeight: 16,
  },
  cycleItemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  cycleItemIndexBtn: { padding: 2 },
  cycleItemDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  cycleItemDotActive: { backgroundColor: colors.accent },
  cycleItemDotText: {
    color: colors.textSecondary, fontSize: 11, fontWeight: '700',
  },
  cycleItemDotTextActive: { color: colors.bg },
  cycleItemTitle: {
    flex: 1, color: colors.text, fontSize: font.md,
  },
  cycleItemTitleActive: { color: colors.accent, fontWeight: '600' },
  cycleItemDelete: { padding: 4 },
  cycleInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
  },
  cycleInput: {
    flex: 1, color: colors.text, fontSize: font.md,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 2,
  },
  addCycleItemBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: spacing.sm,
  },
  addCycleItemText: { color: colors.accent, fontSize: font.sm },
  cycleCurrentHint: {
    color: colors.textTertiary, fontSize: font.xs, lineHeight: 16,
    marginTop: spacing.xs,
  },
  projectPickerRoot: { flex: 1, backgroundColor: colors.bg },
  projectPickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  projectPickerTitle: { color: colors.text, fontSize: font.lg, fontWeight: '600' },
  projectPickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  projectPickerItemText: { color: colors.text, fontSize: font.md },
});
