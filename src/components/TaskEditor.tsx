import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import type { Task, Priority, Effort, RecurrenceType } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, EFFORT_LABELS, EFFORT_HINTS } from '../types';
import { colors, spacing, radius, font } from '../theme';
import { tagColor } from '../utils/tagColor';
import { useTaskStore } from '../store/useTaskStore';
import { formatDueDate, formatShowAfterTime } from '../utils/dateUtils';

interface Props {
  visible: boolean;
  task?: Task | null;
  onClose: () => void;
}

type PickerMode = 'none' | 'dueDate' | 'showAfterTime' | 'deferUntil';

const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  none: 'Never',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

export function TaskEditor({ visible, task, onClose }: Props) {
  const addTask = useTaskStore(s => s.addTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const allTags = useTaskStore(s => s.allTags());

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [showAfterTime, setShowAfterTime] = useState<string | null>(null);
  const [deferUntil, setDeferUntil] = useState<Date | null>(null);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceFromCompletion, setRecurrenceFromCompletion] = useState(false);
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [focused, setFocused] = useState(false);

  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>('none');
  const [pickerDate, setPickerDate] = useState(new Date());

  const titleRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    if (task) {
      setTitle(task.title); setNotes(task.notes); setTags(task.tags);
      setDueDate(task.dueDate ? new Date(task.dueDate) : null);
      setShowAfterTime(task.showAfterTime);
      setDeferUntil(task.deferUntil ? new Date(task.deferUntil) : null);
      setRecurrenceType(task.recurrenceType); setRecurrenceInterval(task.recurrenceInterval);
      setRecurrenceFromCompletion(task.recurrenceFromCompletion);
      setPriority(task.priority); setEffort(task.effort); setFocused(task.focused);
    } else {
      setTitle(''); setNotes(''); setTags([]);
      setDueDate(null); setShowAfterTime(null); setDeferUntil(null);
      setRecurrenceType('none'); setRecurrenceInterval(1); setRecurrenceFromCompletion(false);
      setPriority(0); setEffort(0); setFocused(false);
    }
    setPickerMode('none'); setNewTag(''); setAddingTag(false);
    setTimeout(() => titleRef.current?.focus(), 100);
  }, [visible, task]);

  const save = () => {
    if (!title.trim()) return;
    const data = {
      title: title.trim(), notes, tags,
      dueDate: dueDate?.toISOString() ?? null,
      showAfterTime, deferUntil: deferUntil?.toISOString() ?? null,
      recurrenceType, recurrenceInterval,
      recurrenceDays: task?.recurrenceDays ?? [],
      recurrenceEndDate: null,
      recurrenceFromCompletion,
      sortOrder: task?.sortOrder ?? 0,
      focused, priority, effort,
    };
    if (task) { updateTask(task.id, data); }
    else { addTask(data); }
    onClose();
  };

  const openPicker = (mode: PickerMode) => {
    if (mode === 'dueDate') setPickerDate(dueDate ?? new Date());
    if (mode === 'showAfterTime') {
      const d = new Date();
      if (showAfterTime) {
        const [h, m] = showAfterTime.split(':').map(Number);
        d.setHours(h, m, 0, 0);
      } else { d.setHours(20, 0, 0, 0); }
      setPickerDate(d);
    }
    if (mode === 'deferUntil') setPickerDate(deferUntil ?? new Date());
    setPickerMode(mode);
  };

  const confirmPicker = () => {
    if (pickerMode === 'dueDate') setDueDate(pickerDate);
    if (pickerMode === 'showAfterTime') {
      const h = pickerDate.getHours().toString().padStart(2, '0');
      const m = pickerDate.getMinutes().toString().padStart(2, '0');
      setShowAfterTime(`${h}:${m}`);
    }
    if (pickerMode === 'deferUntil') setDeferUntil(pickerDate);
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

        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
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

          {/* Options */}
          <View style={styles.optionsCard}>
            <OptionRow
              icon="calendar"
              label="Due date"
              value={dueDate ? formatDueDate(dueDate.toISOString()) : undefined}
              onPress={() => openPicker('dueDate')}
              onClear={dueDate ? () => setDueDate(null) : undefined}
            />
            <View style={styles.sep} />
            <OptionRow
              icon="eye"
              label="Show after"
              hint="Hidden until this time every day"
              value={showAfterTime ? formatShowAfterTime(showAfterTime) : undefined}
              onPress={() => openPicker('showAfterTime')}
              onClear={showAfterTime ? () => setShowAfterTime(null) : undefined}
            />
            <View style={styles.sep} />
            <OptionRow
              icon="time"
              label="Defer until"
              hint="One-time snooze"
              value={deferUntil ? format(deferUntil, "MMM d 'at' h:mm a") : undefined}
              onPress={() => openPicker('deferUntil')}
              onClear={deferUntil ? () => setDeferUntil(null) : undefined}
            />
            <View style={styles.sep} />
            <OptionRow
              icon="repeat"
              label="Repeat"
              value={recurrenceType !== 'none' ? RECURRENCE_LABELS[recurrenceType] : undefined}
              onPress={cycleRecurrence}
              onClear={recurrenceType !== 'none' ? () => setRecurrenceType('none') : undefined}
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
          </View>
        </ScrollView>

        {pickerMode !== 'none' && (
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setPickerMode('none')}>
                <Text style={styles.pickerBtn}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>
                {pickerMode === 'dueDate' ? 'Due Date' : pickerMode === 'showAfterTime' ? 'Show After' : 'Defer Until'}
              </Text>
              <TouchableOpacity onPress={confirmPicker}>
                <Text style={[styles.pickerBtn, { color: colors.accent }]}>Done</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={pickerDate}
              mode={pickerMode === 'showAfterTime' ? 'time' : 'datetime'}
              display="spinner"
              onChange={(_e, d) => d && setPickerDate(d)}
              themeVariant="dark"
              style={styles.picker}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OptionRow({
  icon, label, value, hint, onPress, onClear,
}: {
  icon: string; label: string; value?: string; hint?: string;
  onPress: () => void; onClear?: () => void;
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

const styles = StyleSheet.create({
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
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm, minHeight: 60,
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md, minHeight: 50,
  },
  section: { paddingHorizontal: spacing.md, marginBottom: spacing.md },
  sectionLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
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
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  pillActiveNeutral: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text },
  pillHint: { color: colors.textTertiary, fontSize: 10, marginTop: 1 },
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
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: colors.orange },
  toggleKnob: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.textSecondary,
  },
  toggleKnobOn: { backgroundColor: colors.text, alignSelf: 'flex-end' },
  pickerSheet: {
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
    paddingBottom: 20,
  },
  pickerHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  pickerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  pickerBtn: { color: colors.textSecondary, fontSize: font.md },
  picker: { height: 200 },
});
