import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { Priority, Effort, TimeOfDay, TemplateAnchor, TemplateItem, RecurrenceType, ChainItem } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, EFFORT_LABELS, EFFORT_HINTS, TITLE_MAX_LENGTH } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { tagColor } from '../utils/tagColor';
import { useTaskStore } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { anchorLabel, formatOffsetWithAnchor } from '../utils/templateUtils';
import { categoryLabel } from '../utils/categoryLabel';
import { formatHHMM, hhmmToDate, dateToHHMM } from '../utils/dateUtils';
import { generateId } from '../utils/id';
import { SortableList } from './SortableList';
import { RecurrencePicker } from './RecurrencePicker';
import { CollapsibleField } from './CollapsibleField';
import { EditorRow } from './EditorRow';

function formatMinutesOffset(mins: number): string {
  if (mins % 1440 === 0) { const d = mins / 1440; return `${d} day${d === 1 ? '' : 's'} before`; }
  if (mins % 60 === 0) { const h = mins / 60; return `${h} hour${h === 1 ? '' : 's'} before`; }
  return `${mins} min before`;
}

/** Editor sections that collapse to a one-line summary of their current value. */
type FieldKey = 'category' | 'tags' | 'priority' | 'effort' | 'subtasks';

interface Props {
  visible: boolean;
  templateId: string;
  /** Shown under the header title so it's clear which template is being edited. */
  templateName?: string;
  /** Item being edited, or null to create a new one. */
  item: TemplateItem | null;
  /** Pre-fill for a new item handed off from TemplateItemQuickAdd. Ignored when editing an existing item. */
  initialDraft?: Partial<TemplateItem> | null;
  onClose: () => void;
}

/**
 * Trimmed TaskEditor-style form for a single template item: title, notes,
 * optional flag, due/defer offsets relative to the anchor date, time of day,
 * category, tags, priority and effort.
 */
export function TemplateItemEditor({ visible, templateId, templateName, item, initialDraft, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const addItem = useTemplateStore(s => s.addItem);
  const updateItem = useTemplateStore(s => s.updateItem);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [optional, setOptional] = useState(false);
  // True while a subtask/chain row is mid-drag. The sheet's ScrollView has to
  // stand down for the drag to survive the first finger move — a JS responder
  // nested *inside* a scroll view doesn't stop it from claiming the touch (see
  // SortableList's onDragStateChange).
  const [draggingRow, setDraggingRow] = useState(false);
  const [anchor, setAnchor] = useState<TemplateAnchor>('start');
  const [dueOffsetDays, setDueOffsetDays] = useState<number | null>(null);
  const [deferOffsetDays, setDeferOffsetDays] = useState<number | null>(null);
  const [deadlineOffsetDays, setDeadlineOffsetDays] = useState<number | null>(null);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [windowEnd, setWindowEnd] = useState<string | null>(null);
  const [windowPickerMode, setWindowPickerMode] = useState<'none' | 'start' | 'end'>('none');
  const [windowPickerDate, setWindowPickerDate] = useState(new Date());
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState<number | null>(null);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [vacationPause, setVacationPause] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState<number | null>(null);
  const [recurrenceFromCompletion, setRecurrenceFromCompletion] = useState(false);
  const [recurrenceCount, setRecurrenceCount] = useState<number | null>(null);
  const [chainEnabled, setChainEnabled] = useState(false);
  const [chainItems, setChainItems] = useState<ChainItem[]>([]);
  const [addingChainItem, setAddingChainItem] = useState(false);
  const [newChainItemTitle, setNewChainItemTitle] = useState('');
  const chainInputRef = useRef<TextInput>(null);
  const chainItemSavedRef = useRef(false);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string }[]>([]);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const subtaskInputRef = useRef<TextInput>(null);
  const subtaskSavedRef = useRef(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  // Same progressive disclosure as TaskEditor: each picker collapses to its
  // current value so the form reads as a list of fields, not a wall of pills.
  const [openFields, setOpenFields] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [showTimeOfDay, setShowTimeOfDay] = useState(false);
  const [showTimeWindow, setShowTimeWindow] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const draft = item ? null : initialDraft;
    setTitle(item?.title ?? draft?.title ?? '');
    setNotes(item?.notes ?? draft?.notes ?? '');
    setOptional(item?.optional ?? draft?.optional ?? false);
    setAnchor(item?.anchor ?? draft?.anchor ?? 'start');
    setDueOffsetDays(item?.dueOffsetDays ?? draft?.dueOffsetDays ?? null);
    setDeferOffsetDays(item?.deferOffsetDays ?? draft?.deferOffsetDays ?? null);
    setDeadlineOffsetDays(item?.deadlineOffsetDays ?? draft?.deadlineOffsetDays ?? null);
    setWindowStart(item?.windowStart ?? draft?.windowStart ?? null);
    setWindowEnd(item?.windowEnd ?? draft?.windowEnd ?? null);
    setReminderOffsetMinutes(item?.reminderOffsetMinutes ?? draft?.reminderOffsetMinutes ?? null);
    setTimeSegments(item?.timeSegments ?? draft?.timeSegments ?? []);
    setTags(item?.tags ?? draft?.tags ?? []);
    setCategory(item?.category ?? draft?.category ?? null);
    setPriority(item?.priority ?? draft?.priority ?? 0);
    setEffort(item?.effort ?? draft?.effort ?? 0);
    setEstimatedMinutes(item?.estimatedMinutes ?? draft?.estimatedMinutes ?? null);
    setVacationPause(item?.vacationPause ?? draft?.vacationPause ?? false);
    setRecurrenceType(item?.recurrenceType ?? draft?.recurrenceType ?? 'none');
    setRecurrenceInterval(item?.recurrenceInterval ?? draft?.recurrenceInterval ?? 1);
    setRecurrenceDays(item?.recurrenceDays ?? draft?.recurrenceDays ?? []);
    setRecurrenceMonthDay(item?.recurrenceMonthDay ?? draft?.recurrenceMonthDay ?? null);
    setRecurrenceFromCompletion(item?.recurrenceFromCompletion ?? draft?.recurrenceFromCompletion ?? false);
    setRecurrenceCount(item?.recurrenceCount ?? draft?.recurrenceCount ?? null);
    setChainEnabled(item?.chainEnabled ?? draft?.chainEnabled ?? false);
    setChainItems(item?.chainItems ?? draft?.chainItems ?? []);
    setSubtasks(item?.subtasks ?? draft?.subtasks ?? []);
    setAddingTag(false);
    setNewTag('');
    setAddingChainItem(false);
    setNewChainItemTitle('');
    setAddingSubtask(false);
    setNewSubtaskTitle('');
    setOpenFields({});
    setShowTimeOfDay(false);
    setShowTimeWindow(false);
  }, [visible, item, initialDraft]);

  const fieldOpen = (key: FieldKey, fallback = false) => openFields[key] ?? fallback;
  const toggleField = (key: FieldKey, fallback = false) =>
    setOpenFields(prev => ({ ...prev, [key]: !(prev[key] ?? fallback) }));
  const closeField = (key: FieldKey) => {
    animateLayout();
    setOpenFields(prev => ({ ...prev, [key]: false }));
  };

  const openWindowPicker = (which: 'start' | 'end') => {
    const current = which === 'start' ? windowStart : windowEnd;
    const fallback = which === 'start' ? '08:00' : '13:00';
    setWindowPickerDate(hhmmToDate(current ?? fallback));
    setWindowPickerMode(which);
  };

  const confirmWindowPicker = () => {
    const hhmm = dateToHHMM(windowPickerDate);
    if (windowPickerMode === 'start') setWindowStart(hhmm);
    else if (windowPickerMode === 'end') setWindowEnd(hhmm);
    setWindowPickerMode('none');
  };

  const handleSave = () => {
    if (!title.trim()) return;
    haptics.success();
    const updates = {
      title: title.trim(),
      notes,
      optional,
      anchor,
      dueOffsetDays,
      deferOffsetDays,
      deadlineOffsetDays,
      windowStart,
      windowEnd,
      reminderOffsetMinutes: dueOffsetDays !== null ? reminderOffsetMinutes : null,
      timeSegments,
      tags,
      category,
      priority,
      effort,
      estimatedMinutes,
      vacationPause,
      recurrenceType,
      recurrenceInterval,
      recurrenceDays: recurrenceType === 'weekly' ? recurrenceDays : [],
      recurrenceMonthDay: recurrenceType === 'monthly' ? recurrenceMonthDay : null,
      recurrenceFromCompletion,
      recurrenceCount: recurrenceType !== 'none' ? recurrenceCount : null,
      chainEnabled: chainEnabled && chainItems.length > 0,
      chainItems,
      subtasks,
    };
    if (item) {
      updateItem(templateId, item.id, updates);
    } else {
      addItem(templateId, updates);
    }
    onClose();
  };

  const addTagFromInput = () => {
    const t = newTag.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setNewTag('');
    setAddingTag(false);
  };

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
  const timeOfDaySummary = timeSegments.length > 0
    ? timeSegments.map(capitalize).join(', ')
    : undefined;
  const timeWindowSummary = (windowStart || windowEnd)
    ? `${windowStart ? formatHHMM(windowStart) : 'Any'} – ${windowEnd ? formatHHMM(windowEnd) : 'Any'}`
    : undefined;

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
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.headerBtn}>Cancel</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>{item ? 'Edit Item' : 'New Item'}</Text>
            {!!templateName && (
              <Text style={styles.headerSubtitle} numberOfLines={1}>{templateName}</Text>
            )}
          </View>
          <TouchableOpacity onPress={handleSave} disabled={!title.trim()}>
            <Text style={[styles.headerBtn, styles.headerSave, !title.trim() && styles.disabled]}>
              {item ? 'Save' : 'Add'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          scrollEnabled={!draggingRow}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Task title"
            placeholderTextColor={colors.textTertiary}
            maxLength={TITLE_MAX_LENGTH}
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

          {/* Scheduling relative to one of the template's two anchor dates */}
          <Text style={styles.groupLabel}>Schedule</Text>
          <View style={styles.optionsCard}>
            <View style={styles.optionRow}>
              <Ionicons name="pin-outline" size={18} color={colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Count days from</Text>
                <Text style={styles.optionHint}>
                  Template items have no fixed date. Every offset below counts from this date, which you pick when applying the template.
                </Text>
              </View>
            </View>
            <View style={styles.timePillRow}>
              {(['start', 'end'] as TemplateAnchor[]).map(a => {
                const active = anchor === a;
                return (
                  <TouchableOpacity
                    key={a}
                    style={[styles.timePill, active && styles.timePillActive]}
                    onPress={() => { haptics.tap(); setAnchor(a); }}
                  >
                    <Text style={[styles.timePillText, active && styles.timePillTextActive]}>
                      {anchorLabel(a)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.sep} />
            <OffsetRow
              icon="calendar"
              label="Due date"
              hint="When the task is due"
              offset={dueOffsetDays}
              anchor={anchor}
              onChange={setDueOffsetDays}
              colors={colors}
              styles={styles}
            />
            <View style={styles.sep} />
            <OffsetRow
              icon="eye-off-outline"
              label="Hide until"
              hint="Keeps the task off Today until this day"
              offset={deferOffsetDays}
              anchor={anchor}
              onChange={setDeferOffsetDays}
              colors={colors}
              styles={styles}
            />
            <View style={styles.sep} />
            <OffsetRow
              icon="flag-outline"
              label="Deadline"
              hint="A hard cut-off, shown separately from the due date"
              offset={deadlineOffsetDays}
              anchor={anchor}
              onChange={setDeadlineOffsetDays}
              colors={colors}
              styles={styles}
            />
            <View style={styles.sep} />
            <EditorRow
              icon="time-outline"
              label="Time of day"
              hint="Hold it back until a part of the day"
              value={timeOfDaySummary}
              expanded={showTimeOfDay}
              onPress={() => { animateLayout(); setShowTimeOfDay(v => !v); }}
              onClear={timeSegments.length > 0 ? () => setTimeSegments([]) : undefined}
            />
            {showTimeOfDay && (
              <View style={styles.timePillRow}>
                {(['morning', 'afternoon', 'evening', 'night'] as TimeOfDay[]).map(tod => {
                  const active = timeSegments.includes(tod);
                  return (
                    <TouchableOpacity
                      key={tod}
                      style={[styles.timePill, active && styles.timePillActive]}
                      onPress={() => {
                        haptics.tap();
                        setTimeSegments(prev => prev.includes(tod) ? [] : [tod]);
                      }}
                    >
                      <Text style={[styles.timePillText, active && styles.timePillTextActive]}>
                        {capitalize(tod)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <View style={styles.sep} />
            <EditorRow
              icon="hourglass-outline"
              label="Time window"
              hint="Only active for part of the day, then expires"
              value={timeWindowSummary}
              expanded={showTimeWindow}
              onPress={() => { animateLayout(); setShowTimeWindow(v => !v); }}
              onClear={(windowStart || windowEnd)
                ? () => { setWindowStart(null); setWindowEnd(null); setWindowPickerMode('none'); }
                : undefined}
            />
            {showTimeWindow && (
              <>
                <View style={styles.timePillRow}>
                  <TouchableOpacity
                    style={[styles.timePill, !!windowStart && styles.timePillActive]}
                    onPress={() => openWindowPicker('start')}
                  >
                    <Text style={[styles.timePillText, !!windowStart && styles.timePillTextActive]}>
                      {windowStart ? formatHHMM(windowStart) : 'Start'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.timePill, !!windowEnd && styles.timePillActive]}
                    onPress={() => openWindowPicker('end')}
                  >
                    <Text style={[styles.timePillText, !!windowEnd && styles.timePillTextActive]}>
                      {windowEnd ? formatHHMM(windowEnd) : 'End'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {windowPickerMode !== 'none' && (
                  <>
                    <DateTimePicker
                      value={windowPickerDate}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(_e, d) => d && setWindowPickerDate(d)}
                      themeVariant={isDark ? 'dark' : 'light'}
                    />
                    <View style={styles.intervalRow}>
                      <TouchableOpacity style={styles.intervalBtn} onPress={() => setWindowPickerMode('none')}>
                        <Ionicons name="close" size={16} color={colors.textSecondary} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.intervalBtn} onPress={confirmWindowPicker}>
                        <Ionicons name="checkmark" size={16} color={colors.accent} />
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </>
            )}
            <View style={styles.sep} />
            <View style={styles.optionRow}>
              <Ionicons
                name="notifications"
                size={18}
                color={reminderOffsetMinutes !== null ? colors.accent : colors.textSecondary}
              />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Remind me</Text>
                {dueOffsetDays === null ? (
                  <Text style={styles.optionHint}>Set a due date first</Text>
                ) : reminderOffsetMinutes === null ? (
                  <Text style={styles.optionHint}>Minutes before the resolved due date</Text>
                ) : null}
              </View>
              {dueOffsetDays !== null && (
                reminderOffsetMinutes !== null ? (
                  <TouchableOpacity onPress={() => setReminderOffsetMinutes(null)} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.setBtn}
                    onPress={() => { haptics.tap(); setReminderOffsetMinutes(60); }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Set a reminder"
                  >
                    <Text style={styles.setOffsetText}>Set</Text>
                  </TouchableOpacity>
                )
              )}
            </View>
            {dueOffsetDays !== null && reminderOffsetMinutes !== null && (
              <View style={styles.intervalRow}>
                <TouchableOpacity
                  style={styles.intervalBtn}
                  onPress={() => setReminderOffsetMinutes(m => Math.max(5, (m ?? 60) - 15))}
                >
                  <Ionicons name="remove" size={16} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.intervalValue}>{formatMinutesOffset(reminderOffsetMinutes)}</Text>
                <TouchableOpacity
                  style={styles.intervalBtn}
                  onPress={() => setReminderOffsetMinutes(m => (m ?? 60) + 15)}
                >
                  <Ionicons name="add" size={16} color={colors.text} />
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.sep} />
            <View style={styles.optionRow}>
              <Ionicons name="repeat" size={18} color={recurrenceType !== 'none' ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Repeat</Text>
                {recurrenceType === 'none' && <Text style={styles.optionHint}>Recreates on this schedule when applied and completed</Text>}
              </View>
              {recurrenceType !== 'none' ? (
                <TouchableOpacity onPress={() => setRecurrenceType('none')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.setBtn}
                  onPress={() => { haptics.tap(); setRecurrenceType('daily'); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Set a repeat schedule"
                >
                  <Text style={styles.setOffsetText}>Set</Text>
                </TouchableOpacity>
              )}
            </View>
            {recurrenceType !== 'none' && (
              <RecurrencePicker
                recurrenceType={recurrenceType}
                onChangeType={setRecurrenceType}
                recurrenceInterval={recurrenceInterval}
                onChangeInterval={setRecurrenceInterval}
                recurrenceDays={recurrenceDays}
                onChangeDays={setRecurrenceDays}
                recurrenceMonthDay={recurrenceMonthDay}
                onChangeMonthDay={setRecurrenceMonthDay}
                seedMonthDay={() => 1}
                recurrenceFromCompletion={recurrenceFromCompletion}
                onChangeFromCompletion={setRecurrenceFromCompletion}
                recurrenceCount={recurrenceCount}
                onChangeCount={setRecurrenceCount}
                countUnitLabel={() => 'occurrences'}
                neverEndsLabel="Never ends"
                afterCountLabel="After N"
                onSelectEndNever={() => setRecurrenceCount(null)}
                onSelectEndCount={() => setRecurrenceCount(c => c ?? 5)}
              />
            )}
          </View>

          {/* How the task behaves once the template is applied */}
          <Text style={styles.groupLabel}>Options</Text>
          <View style={styles.optionsCard}>
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); setOptional(!optional); }}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons name="help-circle-outline" size={18} color={optional ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Optional</Text>
                <Text style={styles.optionHint}>Starts unticked in the apply sheet, so it's skipped by default</Text>
              </View>
              <View style={[styles.toggle, optional && styles.toggleOn]}>
                <View style={[styles.toggleKnob, optional && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); setVacationPause(!vacationPause); }}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons name="airplane-outline" size={18} color={vacationPause ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Pause on vacation</Text>
                <Text style={styles.optionHint}>Hidden while vacation mode is on</Text>
              </View>
              <View style={[styles.toggle, vacationPause && styles.toggleOn]}>
                <View style={[styles.toggleKnob, vacationPause && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Chain */}
          <View style={styles.sectionCard}>
            <View style={styles.cardSection}>
              <View style={styles.chainHeader}>
                <Ionicons name="link" size={14} color={chainEnabled ? colors.accent : colors.textTertiary} />
                <Text style={[styles.sectionLabel, { marginBottom: 0, flex: 1 }]}>Chain</Text>
                <TouchableOpacity
                  style={[styles.toggle, chainEnabled && styles.toggleOn]}
                  onPress={() => { haptics.tap(); setChainEnabled(v => !v); }}
                  accessibilityRole="switch"
                  accessibilityLabel="Chain"
                  accessibilityState={{ checked: chainEnabled }}
                >
                  <View style={[styles.toggleKnob, chainEnabled && styles.toggleKnobOn]} />
                </TouchableOpacity>
              </View>
              {!chainEnabled && (
                <Text style={styles.optionHint}>
                  Step through a list of items, one per completion — finishing one reveals the next.
                  {recurrenceType !== 'none' ? ' With Repeat on, the whole chain starts over once it finishes.' : ''}
                </Text>
              )}
              {chainEnabled && (
                <>
                  <SortableList
                    onDragStateChange={setDraggingRow}
                    data={chainItems}
                    onReorder={setChainItems}
                    renderItem={(chainItem, displayIndex, drag) => (
                      <View style={styles.chainItemRow}>
                        <View style={styles.chainItemDot}>
                          <Text style={styles.chainItemDotText}>{displayIndex + 1}</Text>
                        </View>
                        <Text style={styles.chainItemTitle}>{chainItem.title}</Text>
                        <TouchableOpacity
                          onLongPress={(e) => drag(e.nativeEvent.pageY)}
                          delayLongPress={150}
                          hitSlop={8}
                          style={styles.dragHandle}
                          accessibilityRole="button"
                          accessibilityLabel={`Reorder chain step ${chainItem.title}`}
                        >
                          <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setChainItems(prev => prev.filter(c => c.id !== chainItem.id))}
                          hitSlop={8}
                          style={styles.chainItemDelete}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove chain step ${chainItem.title}`}
                        >
                          <Ionicons name="close" size={14} color={colors.textTertiary} />
                        </TouchableOpacity>
                      </View>
                    )}
                  />
                  {addingChainItem ? (
                    <View style={styles.chainInputRow}>
                      <View style={styles.chainItemDot}>
                        <Text style={styles.chainItemDotText}>{chainItems.length + 1}</Text>
                      </View>
                      <TextInput
                        ref={chainInputRef}
                        autoFocus
                        style={styles.chainInput}
                        value={newChainItemTitle}
                        onChangeText={setNewChainItemTitle}
                        placeholder="Item title"
                        placeholderTextColor={colors.textTertiary}
                        maxLength={TITLE_MAX_LENGTH}
                        returnKeyType="done"
                        onSubmitEditing={() => {
                          chainItemSavedRef.current = true;
                          const t = newChainItemTitle.trim();
                          if (t) setChainItems(prev => [...prev, { id: generateId(), title: t, notes: '' }]);
                          setNewChainItemTitle('');
                          setTimeout(() => {
                            chainItemSavedRef.current = false;
                            chainInputRef.current?.focus();
                          }, 50);
                        }}
                        onBlur={() => {
                          if (chainItemSavedRef.current) return;
                          const t = newChainItemTitle.trim();
                          if (t) setChainItems(prev => [...prev, { id: generateId(), title: t, notes: '' }]);
                          setNewChainItemTitle('');
                          setAddingChainItem(false);
                        }}
                      />
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.addTagBtn} onPress={() => setAddingChainItem(true)}>
                      <Ionicons name="add" size={14} color={colors.accent} />
                      <Text style={styles.addTagText}>Add item</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>

          {/* Subtasks */}
          <View style={styles.sectionCard}>
            <CollapsibleField
              label="Subtasks"
              summary={subtasks.length > 0 ? `${subtasks.length} step${subtasks.length === 1 ? '' : 's'}` : undefined}
              hint="Checklist items created alongside the task when the template is applied."
              expanded={fieldOpen('subtasks', subtasks.length > 0)}
              onToggle={() => toggleField('subtasks', subtasks.length > 0)}
            >
              <SortableList
                onDragStateChange={setDraggingRow}
                data={subtasks}
                onReorder={setSubtasks}
                renderItem={(sub, _displayIndex, drag) => (
                  <View style={styles.chainItemRow}>
                    <Text style={styles.chainItemTitle}>{sub.title}</Text>
                    <TouchableOpacity
                      onLongPress={(e) => drag(e.nativeEvent.pageY)}
                      delayLongPress={150}
                      hitSlop={8}
                      style={styles.dragHandle}
                    >
                      <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setSubtasks(prev => prev.filter(s => s.id !== sub.id))}
                      hitSlop={8}
                      style={styles.chainItemDelete}
                    >
                      <Ionicons name="close" size={14} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                )}
              />
              {addingSubtask ? (
                <View style={styles.chainInputRow}>
                  <TextInput
                    ref={subtaskInputRef}
                    autoFocus
                    style={styles.chainInput}
                    value={newSubtaskTitle}
                    onChangeText={setNewSubtaskTitle}
                    placeholder="Subtask title"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={TITLE_MAX_LENGTH}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      subtaskSavedRef.current = true;
                      const t = newSubtaskTitle.trim();
                      if (t) setSubtasks(prev => [...prev, { id: generateId(), title: t }]);
                      setNewSubtaskTitle('');
                      setTimeout(() => {
                        subtaskSavedRef.current = false;
                        subtaskInputRef.current?.focus();
                      }, 50);
                    }}
                    onBlur={() => {
                      if (subtaskSavedRef.current) return;
                      const t = newSubtaskTitle.trim();
                      if (t) setSubtasks(prev => [...prev, { id: generateId(), title: t }]);
                      setNewSubtaskTitle('');
                      setAddingSubtask(false);
                    }}
                  />
                </View>
              ) : (
                <TouchableOpacity style={styles.addTagBtn} onPress={() => setAddingSubtask(true)}>
                  <Ionicons name="add" size={14} color={colors.accent} />
                  <Text style={styles.addTagText}>Add subtask</Text>
                </TouchableOpacity>
              )}
            </CollapsibleField>
          </View>

          {/* Category + Tags */}
          <Text style={styles.groupLabel}>Organize</Text>
          <View style={styles.sectionCard}>
            <CollapsibleField
              label="Category"
              summary={category ? categoryLabel(category, categories) : undefined}
              hint="One home for the task — drives the Categories screen and its filters."
              expanded={fieldOpen('category')}
              onToggle={() => toggleField('category')}
            >
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, !category && styles.pillActiveNeutral]}
                  onPress={() => { haptics.tap(); setCategory(null); closeField('category'); }}
                >
                  <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
                </TouchableOpacity>
                {allCategories.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.pill, category === cat && styles.pillActiveNeutral]}
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
              hint="Free-form labels. A task can carry several, and you can filter or search by them."
              expanded={fieldOpen('tags')}
              onToggle={() => toggleField('tags')}
            >
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
            </CollapsibleField>
          </View>

          {/* Priority + Effort */}
          <Text style={styles.groupLabel}>Priority & effort</Text>
          <View style={styles.sectionCard}>
            <CollapsibleField
              label="Priority"
              summary={priority > 0 ? PRIORITY_LABELS[priority] : undefined}
              hint="Ranks the task against everything else on Today."
              expanded={fieldOpen('priority')}
              onToggle={() => toggleField('priority')}
            >
              <View style={styles.pillRow}>
                {([0, 1, 2, 3, 4] as Priority[]).map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.pill,
                      priority === p && p === 0 && styles.pillActiveNeutral,
                      priority === p && p > 0 && { backgroundColor: PRIORITY_COLORS[p] },
                    ]}
                    onPress={() => { haptics.tap(); setPriority(p); closeField('priority'); }}
                  >
                    <Text style={[styles.pillText, priority === p && styles.pillTextActive]}>
                      {PRIORITY_LABELS[p]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </CollapsibleField>

            <View style={styles.cardSep} />

            <CollapsibleField
              label="Effort"
              summary={estimatedMinutes !== null ? `${estimatedMinutes} min` : effort > 0 ? EFFORT_LABELS[effort] : undefined}
              emptySummary="Not set"
              hint="Roughly how long this takes, so a day's list can be sized realistically."
              expanded={fieldOpen('effort')}
              onToggle={() => toggleField('effort')}
            >
              <View style={styles.pillRow}>
                {([0, 1, 2, 3, 4, 5, 6] as Effort[]).map(e => (
                  <TouchableOpacity
                    key={e}
                    style={[styles.pill, effort === e && styles.pillActiveNeutral]}
                    onPress={() => { haptics.tap(); setEffort(e); }}
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
              <View style={styles.intervalRow}>
                {estimatedMinutes !== null ? (
                  <>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setEstimatedMinutes(m => Math.max(5, (m ?? 30) - 5))}
                    >
                      <Ionicons name="remove" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.intervalValueSm}>{estimatedMinutes} min (custom)</Text>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setEstimatedMinutes(m => (m ?? 30) + 5)}
                    >
                      <Ionicons name="add" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setEstimatedMinutes(null)} hitSlop={8}>
                      <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity onPress={() => { haptics.tap(); setEstimatedMinutes(30); }}>
                    <Text style={styles.addTagText}>Set a custom estimate</Text>
                  </TouchableOpacity>
                )}
              </View>
            </CollapsibleField>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * A due/defer offset row: "None" until set, then a − / + stepper over the
 * human offset label ("3 days before", "On anchor day") with a clear button.
 */
function OffsetRow({
  icon, label, hint, offset, anchor, onChange, colors, styles,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  offset: number | null;
  anchor: TemplateAnchor;
  onChange: (offset: number | null) => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <>
      <View style={styles.optionRow}>
        <Ionicons name={icon} size={18} color={offset !== null ? colors.accent : colors.textSecondary} />
        <View style={styles.optionContent}>
          <Text style={styles.optionLabel}>{label}</Text>
          <Text style={styles.optionHint}>
            {offset !== null ? formatOffsetWithAnchor(offset, anchor) : hint}
          </Text>
        </View>
        {offset !== null ? (
          <TouchableOpacity
            onPress={() => onChange(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
          >
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.setBtn}
            onPress={() => { haptics.tap(); onChange(0); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Set ${label.toLowerCase()}`}
          >
            <Text style={styles.setOffsetText}>Set</Text>
          </TouchableOpacity>
        )}
      </View>
      {offset !== null && (
        <View style={styles.intervalRow}>
          <TouchableOpacity
            style={styles.intervalBtn}
            onPress={() => onChange(offset - 1)}
            accessibilityRole="button"
            accessibilityLabel="One day earlier"
          >
            <Ionicons name="remove" size={16} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.intervalValue}>{formatOffsetWithAnchor(offset, anchor)}</Text>
          <TouchableOpacity
            style={styles.intervalBtn}
            onPress={() => onChange(offset + 1)}
            accessibilityRole="button"
            accessibilityLabel="One day later"
          >
            <Ionicons name="add" size={16} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  headerSubtitle: { color: colors.textTertiary, fontSize: font.xs, marginTop: 1 },
  headerBtn: { color: colors.accent, fontSize: font.md },
  headerSave: { fontWeight: '600' },
  disabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, minHeight: 68,
    letterSpacing: -0.3,
    textAlignVertical: 'top',
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.lg, minHeight: 50,
    lineHeight: 22,
  },
  sectionCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  cardSection: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  cardSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
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
  groupLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: spacing.md + spacing.xs, marginBottom: spacing.xs,
  },
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
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md + 18 + spacing.md },
  setBtn: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  setOffsetText: { color: colors.accent, fontSize: font.sm, fontWeight: '600' },
  intervalRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  intervalBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  intervalValue: {
    flex: 1, color: colors.text, fontSize: font.md, fontWeight: '600',
    textAlign: 'center',
  },
  toggle: {
    width: 46, height: 27, borderRadius: 14,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 21, height: 21, borderRadius: 11,
    backgroundColor: colors.bg,
  },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
  intervalValueSm: { color: colors.text, fontSize: font.sm, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  chainHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm,
  },
  chainItemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  chainItemDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  chainItemDotText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  chainItemTitle: { flex: 1, color: colors.text, fontSize: font.md },
  dragHandle: { padding: 4 },
  chainItemDelete: { padding: 4 },
  chainInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  chainInput: {
    flex: 1, color: colors.text, fontSize: font.md,
    borderBottomWidth: 1, borderBottomColor: colors.accent, paddingVertical: 2,
  },
});
