import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useShallow } from 'zustand/react/shallow';
import type { Priority, Effort, TimeOfDay, RecurrenceType } from '../types';
import { PRIORITY_COLORS, EFFORT_LABELS, TITLE_MAX_LENGTH } from '../types';
import { WhenPicker } from './WhenPicker';
import { WeekdaySelector } from './WeekdaySelector';
import { parseTaskInput, describeSchedule } from '../utils/parseTaskInput';
import { tagColor } from '../utils/tagColor';
import { format } from 'date-fns';
import { getLogicalToday, getLogicalTomorrow } from '../utils/dateUtils';
import { suggestTaskAttributes, suggestTaskEffort } from '../services/aiSuggestions';
import { EFFORT_MINUTES, effortToMinutes, minutesToEffort, formatDuration } from '../utils/effort';
import { SuggestedCategorySheet } from './SuggestedCategorySheet';
import { RECURRENCE_LABELS, type TaskDraft } from './TaskEditor';

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenFull: (draft: TaskDraft) => void;
}

type ActivePanel = 'priority' | 'effort' | 'tags' | 'category' | 'repeat' | null;

// Singular/plural units for the interval stepper ("Every 2 weeks").
const RECURRENCE_UNITS: Record<Exclude<RecurrenceType, 'none'>, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};


export function QuickAddModal({ visible, onClose, onOpenFull }: Props) {
  const addTask = useTaskStore(s => s.addTask);
  const addCategory = useTaskStore(s => s.addCategory);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);
  const tagInputRef = useRef<TextInput>(null);
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 120, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => { scaleAnim.setValue(0.95); sheetOpacity.setValue(0); onClose(); });
  };

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [customEffortText, setCustomEffortText] = useState('');
  const [effortNote, setEffortNote] = useState<string | null>(null);
  const [effortAiLoading, setEffortAiLoading] = useState(false);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceFromCompletion, setRecurrenceFromCompletion] = useState(false);
  // Natural-language parse bookkeeping: manual edits beat the parse, and a
  // dismissed phrase stays dismissed while the user keeps typing it.
  const [dateManuallySet, setDateManuallySet] = useState(false);
  const [recurrenceManuallySet, setRecurrenceManuallySet] = useState(false);
  const [dismissedMatch, setDismissedMatch] = useState<string | null>(null);
  const [whenPickerVisible, setWhenPickerVisible] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setPriority(0);
      setEffort(0);
      setEstimatedMinutes(null);
      setCustomEffortText('');
      setEffortNote(null);
      setEffortAiLoading(false);
      setDueDate(getLogicalToday(dayResetTime));
      setTimeSegments([]);
      setTags([]);
      setCategory(null);
      setTagInput('');
      setActivePanel(null);
      setRecurrenceType('none');
      setRecurrenceInterval(1);
      setRecurrenceDays([]);
      setRecurrenceFromCompletion(false);
      setDateManuallySet(false);
      setRecurrenceManuallySet(false);
      setDismissedMatch(null);
      setWhenPickerVisible(false);
      setAiLoading(false);
      setPendingCategory(null);
      scaleAnim.setValue(0.95);
      sheetOpacity.setValue(0);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
        Animated.timing(sheetOpacity, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  // Natural-language scheduling: detect a trailing date/recurrence phrase
  // in the title ("go for a run on tuesday", "water plants every 3 days").
  const parsed = useMemo(() => (title.trim() ? parseTaskInput(title) : null), [title]);
  const parseDismissed =
    parsed != null &&
    dismissedMatch != null &&
    (parsed.matchedText.startsWith(dismissedMatch) || dismissedMatch.startsWith(parsed.matchedText));
  const parseActive = parsed != null && !parseDismissed;
  // Invariant: chip visible ⇔ the phrase is stripped from the title on submit.
  // Once manual edits override everything the parse controls, it's inert.
  const chipVisible =
    parseActive &&
    (!dateManuallySet || (parsed!.schedule.recurrenceType !== 'none' && !recurrenceManuallySet));

  useEffect(() => {
    if (!visible) return;
    if (!dateManuallySet) {
      if (parseActive && parsed) {
        setDueDate(parsed.schedule.dueDate);
        setTimeSegments(parsed.schedule.timeSegments);
      } else {
        setDueDate(getLogicalToday(dayResetTime));
        setTimeSegments([]);
      }
    }
    if (!recurrenceManuallySet) {
      if (parseActive && parsed) {
        setRecurrenceType(parsed.schedule.recurrenceType);
        setRecurrenceInterval(parsed.schedule.recurrenceInterval);
        setRecurrenceDays(parsed.schedule.recurrenceDays);
      } else {
        setRecurrenceType('none');
        setRecurrenceInterval(1);
        setRecurrenceDays([]);
      }
    }
  }, [parsed, parseActive]);

  const dismissParse = () => {
    if (!parsed) return;
    haptics.tap();
    animateLayout();
    setDismissedMatch(parsed.matchedText);
  };

  const effectiveTitle = (chipVisible && parsed ? parsed.cleanTitle : title).trim();

  const handleAdd = () => {
    if (!effectiveTitle) return;
    haptics.success();
    animateLayout();
    addTask({
      title: effectiveTitle,
      priority,
      effort,
      estimatedMinutes,
      dueDate: dueDate?.toISOString() ?? null,
      timeSegments,
      tags,
      category,
      recurrenceType,
      recurrenceInterval,
      recurrenceDays,
      recurrenceFromCompletion,
    });
    dismiss();
  };

  const handleOpenFull = () => {
    onOpenFull({
      title: effectiveTitle,
      priority,
      effort,
      estimatedMinutes,
      dueDate,
      timeSegments,
      tags,
      category,
      recurrenceType,
      recurrenceInterval,
      recurrenceDays,
      recurrenceFromCompletion,
    });
  };

  const togglePanel = (panel: ActivePanel) => {
    haptics.tap();
    setActivePanel(prev => prev === panel ? null : panel);
    if (panel === 'tags') {
      setTimeout(() => tagInputRef.current?.focus(), 100);
    }
  };

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      haptics.tap();
      setTags(prev => [...prev, t]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    haptics.tap();
    setTags(prev => prev.filter(t => t !== tag));
  };

  const toggleExistingTag = (tag: string) => {
    haptics.tap();
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleSuggest = async () => {
    if (!title.trim()) return;
    setAiLoading(true);
    try {
      const result = await suggestTaskAttributes(title.trim(), '', allTags, allCategories);
      if (result.effort > 0 && effort === 0) { setEffort(result.effort); setEstimatedMinutes(EFFORT_MINUTES[result.effort]); }
      if (result.tags.length > 0) setTags(prev => [...new Set([...prev, ...result.tags])]);
      if (result.category && !category) setCategory(result.category);
      else if (result.newCategory && !category) setPendingCategory(result.newCategory);
    } catch {
      // silent fail
    } finally {
      setAiLoading(false);
    }
  };

  const customEffortActive = estimatedMinutes != null && estimatedMinutes !== effortToMinutes(effort);

  const applyEffortPreset = (e: Effort) => {
    haptics.tap();
    setEffortNote(null);
    setCustomEffortText('');
    // Tapping the active preset clears the estimate.
    if (!customEffortActive && effort === e) {
      setEffort(0);
      setEstimatedMinutes(null);
    } else {
      setEffort(e);
      setEstimatedMinutes(EFFORT_MINUTES[e]);
    }
  };

  const applyCustomEffort = (text: string) => {
    setCustomEffortText(text);
    setEffortNote(null);
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setEstimatedMinutes(null);
      setEffort(0);
      return;
    }
    setEstimatedMinutes(n);
    setEffort(minutesToEffort(n));
  };

  const handleEstimateEffort = async () => {
    if (!title.trim()) return;
    setEffortAiLoading(true);
    setEffortNote(null);
    try {
      const result = await suggestTaskEffort(title.trim(), '');
      if (result.minutes != null) {
        setEstimatedMinutes(result.minutes);
        setEffort(minutesToEffort(result.minutes));
        setCustomEffortText('');
        setEffortNote(result.reason);
      } else {
        setEffortNote(result.reason);
      }
    } catch {
      setEffortNote('Could not estimate right now.');
    } finally {
      setEffortAiLoading(false);
    }
  };

  const PRIORITY_LABELS_SHORT = ['None', 'Low', 'Med', 'High', 'Urgent'] as const;

  const formatDate = (d: Date) => {
    const today = getLogicalToday(dayResetTime);
    const tomorrow = getLogicalTomorrow(dayResetTime);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return format(d, 'MMM d');
  };

  const suggestedTags = allTags.filter(t => !tags.includes(t)).slice(0, 8);

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView
          intensity={isDark ? 20 : 15}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />
      <KeyboardAvoidingView
        style={styles.centeredContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.sheet, shadows.sheet, { opacity: sheetOpacity, transform: [{ scale: scaleAnim }] }]}>
          {/* Title input row */}
          <View style={styles.row}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="New task…"
              placeholderTextColor={colors.textTertiary}
              value={title}
              onChangeText={setTitle}
              onSubmitEditing={handleAdd}
              returnKeyType="done"
              maxLength={TITLE_MAX_LENGTH}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.addBtn, !title.trim() && styles.addBtnDisabled]}
              onPress={handleAdd}
              disabled={!title.trim()}
            >
              <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
            </TouchableOpacity>
          </View>

          {/* Parsed schedule chip */}
          {chipVisible && parsed && (
            <View style={styles.parseRow}>
              <View style={styles.parseChip}>
                <Ionicons
                  name={parsed.schedule.recurrenceType !== 'none' ? 'repeat' : 'calendar-outline'}
                  size={13}
                  color={colors.accent}
                />
                <Text style={styles.parseChipText}>{describeSchedule(parsed.schedule)}</Text>
                <TouchableOpacity onPress={dismissParse} hitSlop={8}>
                  <Ionicons name="close" size={13} color={colors.accent} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Attribute toolbar */}
          <View style={styles.toolbar}>
            {/* Due date chip */}
            <TouchableOpacity
              style={[styles.toolChip, dueDate != null && styles.toolChipSet]}
              onPress={() => setWhenPickerVisible(true)}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons
                name="calendar-outline"
                size={13}
                color={dueDate ? colors.accent : colors.textTertiary}
              />
              <Text style={[styles.toolChipText, dueDate != null && styles.toolChipTextSet]}>
                {dueDate ? formatDate(dueDate) : 'Date'}
              </Text>
            </TouchableOpacity>

            {/* Repeat chip */}
            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'repeat' && styles.toolChipActive, recurrenceType !== 'none' && styles.toolChipSet]}
              onPress={() => togglePanel('repeat')}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons
                name="repeat"
                size={13}
                color={recurrenceType !== 'none' ? colors.accent : colors.textTertiary}
              />
              <Text style={[styles.toolChipText, recurrenceType !== 'none' && styles.toolChipTextSet]}>
                {recurrenceType !== 'none' ? RECURRENCE_LABELS[recurrenceType] : 'Repeat'}
              </Text>
            </TouchableOpacity>

            {/* Priority chip */}
            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'priority' && styles.toolChipActive, priority > 0 && styles.toolChipSet]}
              onPress={() => togglePanel('priority')}
              activeOpacity={interaction.activeOpacity}
            >
              <View style={[styles.priorityDot, { backgroundColor: priority > 0 ? PRIORITY_COLORS[priority] : colors.textTertiary }]} />
              <Text style={[styles.toolChipText, priority > 0 && styles.toolChipTextSet]}>
                {priority > 0 ? PRIORITY_LABELS_SHORT[priority] : 'Priority'}
              </Text>
            </TouchableOpacity>

            {/* Effort chip */}
            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'effort' && styles.toolChipActive, effort > 0 && styles.toolChipSet]}
              onPress={() => togglePanel('effort')}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons
                name="flash-outline"
                size={13}
                color={effort > 0 ? colors.accent : colors.textTertiary}
              />
              <Text style={[styles.toolChipText, effort > 0 && styles.toolChipTextSet]}>
                {estimatedMinutes != null ? formatDuration(estimatedMinutes) : effort > 0 ? EFFORT_LABELS[effort] : 'Effort'}
              </Text>
            </TouchableOpacity>

            {/* Tags chip */}
            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'tags' && styles.toolChipActive, tags.length > 0 && styles.toolChipSet]}
              onPress={() => togglePanel('tags')}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons
                name="pricetag-outline"
                size={13}
                color={tags.length > 0 ? colors.accent : colors.textTertiary}
              />
              <Text style={[styles.toolChipText, tags.length > 0 && styles.toolChipTextSet]}>
                {tags.length > 0 ? tags.slice(0, 2).join(', ') : 'Tags'}
              </Text>
            </TouchableOpacity>

            {/* Category chip */}
            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'category' && styles.toolChipActive, category !== null && styles.toolChipSet]}
              onPress={() => togglePanel('category')}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons
                name="folder-outline"
                size={13}
                color={category ? colors.accent : colors.textTertiary}
              />
              <Text style={[styles.toolChipText, category !== null && styles.toolChipTextSet]}>
                {category ?? 'Category'}
              </Text>
            </TouchableOpacity>

            {/* AI Suggest chip */}
            {!!anthropicApiKey && !!title.trim() && (
              <TouchableOpacity
                style={[styles.toolChip, styles.aiChip]}
                onPress={handleSuggest}
                disabled={aiLoading}
                activeOpacity={interaction.activeOpacity}
              >
                {aiLoading
                  ? <ActivityIndicator size="small" color={colors.purple} />
                  : <Ionicons name="sparkles-outline" size={13} color={colors.purple} />
                }
                {!aiLoading && <Text style={[styles.toolChipText, styles.aiChipText]}>Suggest</Text>}
              </TouchableOpacity>
            )}
          </View>

          {/* Inline panels */}
          {activePanel === 'priority' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {([0, 1, 2, 3, 4] as Priority[]).map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.priorityChip,
                      priority === p && styles.priorityChipActive,
                      priority === p && p > 0 && { borderColor: PRIORITY_COLORS[p], backgroundColor: PRIORITY_COLORS[p] + '22' },
                    ]}
                    onPress={() => {
                      haptics.tap();
                      setPriority(p);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    {p > 0 && <View style={[styles.priorityChipDot, { backgroundColor: PRIORITY_COLORS[p] }]} />}
                    <Text style={[
                      styles.presetChipText,
                      priority === p && styles.presetChipTextActive,
                      priority === p && p > 0 && { color: PRIORITY_COLORS[p] },
                    ]}>
                      {PRIORITY_LABELS_SHORT[p]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {activePanel === 'repeat' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as RecurrenceType[]).map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.presetChip, recurrenceType === t && styles.presetChipActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceType(t);
                      setRecurrenceManuallySet(true);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.presetChipText, recurrenceType === t && styles.presetChipTextActive]}>
                      {RECURRENCE_LABELS[t]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {recurrenceType !== 'none' && (
                <View style={styles.intervalRow}>
                  <Text style={styles.intervalLabel}>Every</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceInterval(Math.max(1, recurrenceInterval - 1));
                      setRecurrenceManuallySet(true);
                    }}
                  >
                    <Ionicons name="remove" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.intervalValue}>{recurrenceInterval}</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceInterval(recurrenceInterval + 1);
                      setRecurrenceManuallySet(true);
                    }}
                  >
                    <Ionicons name="add" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.intervalLabel}>
                    {RECURRENCE_UNITS[recurrenceType][recurrenceInterval === 1 ? 0 : 1]}
                  </Text>
                </View>
              )}
              {recurrenceType === 'weekly' && (
                <View style={styles.weekdayRow}>
                  <WeekdaySelector
                    value={recurrenceDays}
                    onChange={days => {
                      setRecurrenceDays(days);
                      setRecurrenceManuallySet(true);
                    }}
                  />
                </View>
              )}
              {recurrenceType !== 'none' && (
                <View style={styles.scheduleRow}>
                  <TouchableOpacity
                    style={[styles.schedulePill, !recurrenceFromCompletion && styles.schedulePillActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceFromCompletion(false);
                      setRecurrenceManuallySet(true);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.schedulePillText, !recurrenceFromCompletion && styles.schedulePillTextActive]}>
                      On schedule
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceFromCompletion && styles.schedulePillActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceFromCompletion(true);
                      setRecurrenceManuallySet(true);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.schedulePillText, recurrenceFromCompletion && styles.schedulePillTextActive]}>
                      After completion
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {activePanel === 'effort' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {([1, 2, 3, 4, 5] as Effort[]).map(e => {
                  const active = !customEffortActive && effort === e;
                  return (
                    <TouchableOpacity
                      key={e}
                      style={[styles.presetChip, active && styles.presetChipActive]}
                      onPress={() => applyEffortPreset(e)}
                      activeOpacity={interaction.activeOpacity}
                    >
                      <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                        {EFFORT_LABELS[e]}
                      </Text>
                      <Text style={styles.presetChipHint}>{formatDuration(EFFORT_MINUTES[e]!)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.effortCustomRow}>
                <TextInput
                  style={styles.effortCustomInput}
                  value={customEffortText}
                  onChangeText={applyCustomEffort}
                  keyboardType="number-pad"
                  placeholder="custom min"
                  placeholderTextColor={colors.textTertiary}
                />
                {!!anthropicApiKey && (
                  <TouchableOpacity
                    style={styles.effortAiBtn}
                    onPress={handleEstimateEffort}
                    disabled={effortAiLoading || !title.trim()}
                    activeOpacity={interaction.activeOpacity}
                  >
                    {effortAiLoading
                      ? <ActivityIndicator size="small" color={colors.purple} />
                      : (
                        <>
                          <Ionicons name="sparkles-outline" size={12} color={colors.purple} />
                          <Text style={styles.effortAiBtnText}>AI estimate</Text>
                        </>
                      )
                    }
                  </TouchableOpacity>
                )}
              </View>
              {effortNote ? <Text style={styles.effortNote}>{effortNote}</Text> : null}
            </View>
          )}

          {activePanel === 'tags' && (
            <View style={styles.panel}>
              {/* Currently selected tags */}
              {tags.length > 0 && (
                <View style={styles.selectedTagsRow}>
                  {tags.map(tag => (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.selectedTagChip, { backgroundColor: tagColor(tag) + '33' }]}
                      onPress={() => removeTag(tag)}
                      activeOpacity={interaction.activeOpacity}
                    >
                      <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                      <Text style={[styles.selectedTagText, { color: tagColor(tag) }]}>{tag}</Text>
                      <Ionicons name="close" size={10} color={tagColor(tag)} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {/* Tag input */}
              <View style={styles.tagInputRow}>
                <TextInput
                  ref={tagInputRef}
                  style={styles.tagInput}
                  placeholder="Add tag…"
                  placeholderTextColor={colors.textTertiary}
                  value={tagInput}
                  onChangeText={setTagInput}
                  onSubmitEditing={() => { if (tagInput.trim()) addTag(tagInput); }}
                  returnKeyType="done"
                  blurOnSubmit={false}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {tagInput.trim().length > 0 && (
                  <TouchableOpacity onPress={() => addTag(tagInput)} hitSlop={8}>
                    <Ionicons name="add-circle" size={20} color={colors.accent} />
                  </TouchableOpacity>
                )}
              </View>
              {/* Existing tag suggestions */}
              {suggestedTags.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
                  <View style={styles.suggestionsRow}>
                    {suggestedTags.map(tag => (
                      <TouchableOpacity
                        key={tag}
                        style={styles.suggestionChip}
                        onPress={() => toggleExistingTag(tag)}
                        activeOpacity={interaction.activeOpacity}
                      >
                        <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                        <Text style={styles.suggestionText}>{tag}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>
          )}

          {activePanel === 'category' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                <TouchableOpacity
                  style={[styles.presetChip, category === null && styles.presetChipActive]}
                  onPress={() => setCategory(null)}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Text style={[styles.presetChipText, category === null && styles.presetChipTextActive]}>None</Text>
                </TouchableOpacity>
                {allCategories.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.presetChip, category === cat && styles.presetChipActive]}
                    onPress={() => {
                      haptics.tap();
                      setCategory(prev => prev === cat ? null : cat);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.presetChipText, category === cat && styles.presetChipTextActive]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* More details */}
          <TouchableOpacity style={styles.moreBtn} onPress={handleOpenFull} activeOpacity={interaction.activeOpacity}>
            <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.moreBtnText}>More details</Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>
      <WhenPicker
        visible={whenPickerVisible}
        value={dueDate}
        timeSegments={timeSegments}
        taskTitle={title}
        onConfirm={(date, segs) => {
          setDueDate(date);
          setTimeSegments(segs);
          setDateManuallySet(true);
          setWhenPickerVisible(false);
        }}
        onClear={() => {
          setDueDate(null);
          setTimeSegments([]);
          setDateManuallySet(true);
          setWhenPickerVisible(false);
        }}
        onCancel={() => setWhenPickerVisible(false)}
      />
      <SuggestedCategorySheet
        visible={pendingCategory !== null}
        categoryName={pendingCategory ?? ''}
        onConfirm={() => {
          if (pendingCategory) {
            addCategory(pendingCategory);
            setCategory(pendingCategory);
            haptics.success();
          }
          setPendingCategory(null);
        }}
        onDismiss={() => setPendingCategory(null)}
      />
    </Modal>

  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: font.md,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: colors.bgTertiary,
  },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  toolChipActive: {
    backgroundColor: colors.bgQuaternary,
  },
  toolChipSet: {
    backgroundColor: colors.accent + '22',
  },
  toolChipText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  toolChipTextSet: {
    color: colors.accent,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  parseRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  parseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent + '22',
  },
  parseChipText: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  intervalLabel: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  intervalBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intervalValue: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    minWidth: 24,
    textAlign: 'center',
  },
  weekdayRow: {
    marginTop: spacing.sm,
  },
  scheduleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  schedulePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  schedulePillActive: {
    backgroundColor: colors.accent,
  },
  schedulePillText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  schedulePillTextActive: {
    color: colors.onAccent,
  },
  panel: {
    marginBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  presetChipActive: {
    backgroundColor: colors.accent,
  },
  presetChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  presetChipTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.semibold,
  },
  presetChipHint: {
    color: colors.textTertiary,
    fontSize: 10,
    marginTop: 1,
  },
  effortCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  effortCustomInput: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 110,
  },
  effortAiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  effortAiBtnText: {
    color: colors.purple,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  effortNote: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: spacing.sm,
  },
  clearChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  priorityChipActive: {
    backgroundColor: colors.bgQuaternary,
  },
  priorityChipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  selectedTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  tagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  selectedTagText: {
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  tagInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgQuaternary,
    paddingVertical: 4,
  },
  suggestionsScroll: {
    marginTop: 2,
  },
  suggestionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: 2,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  suggestionText: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  moreBtnText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  aiChip: {
    backgroundColor: colors.purple + '22',
  },
  aiChipText: {
    color: colors.purple,
    fontWeight: '600',
  },
});
