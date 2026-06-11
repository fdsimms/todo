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
import type { Priority, Effort, TimeOfDay } from '../types';
import { PRIORITY_COLORS, EFFORT_LABELS, TITLE_MAX_LENGTH } from '../types';
import { WhenPicker } from './WhenPicker';
import { tagColor } from '../utils/tagColor';
import { format, addDays, startOfDay } from 'date-fns';
import { suggestTaskAttributes } from '../services/aiSuggestions';
import { SuggestedCategorySheet } from './SuggestedCategorySheet';
import type { TaskDraft } from './TaskEditor';

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenFull: (draft: TaskDraft) => void;
}

type ActivePanel = 'priority' | 'effort' | 'tags' | 'category' | null;


export function QuickAddModal({ visible, onClose, onOpenFull }: Props) {
  const addTask = useTaskStore(s => s.addTask);
  const addCategory = useTaskStore(s => s.addCategory);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
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
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [whenPickerVisible, setWhenPickerVisible] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setPriority(0);
      setEffort(0);
      setDueDate(startOfDay(new Date()));
      setTimeSegments([]);
      setTags([]);
      setCategory(null);
      setTagInput('');
      setActivePanel(null);
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

  const handleAdd = () => {
    if (!title.trim()) return;
    haptics.success();
    animateLayout();
    addTask({
      title: title.trim(),
      priority,
      effort,
      dueDate: dueDate?.toISOString() ?? null,
      timeSegments,
      tags,
      category,
    });
    dismiss();
  };

  const handleOpenFull = () => {
    onOpenFull({ title, priority, effort, dueDate, timeSegments, tags, category });
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
      if (result.effort > 0 && effort === 0) setEffort(result.effort);
      if (result.tags.length > 0) setTags(prev => [...new Set([...prev, ...result.tags])]);
      if (result.category && !category) setCategory(result.category);
      else if (result.newCategory && !category) setPendingCategory(result.newCategory);
    } catch {
      // silent fail
    } finally {
      setAiLoading(false);
    }
  };

  const PRIORITY_LABELS_SHORT = ['None', 'Low', 'Med', 'High', 'Urgent'] as const;

  const formatDate = (d: Date) => {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
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
                {effort > 0 ? EFFORT_LABELS[effort] : 'Effort'}
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

          {activePanel === 'effort' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {([1, 2, 3, 4, 5] as Effort[]).map(e => (
                  <TouchableOpacity
                    key={e}
                    style={[styles.presetChip, effort === e && styles.presetChipActive]}
                    onPress={() => {
                      haptics.tap();
                      setEffort(prev => prev === e ? 0 : e);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.presetChipText, effort === e && styles.presetChipTextActive]}>
                      {EFFORT_LABELS[e]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
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
          setWhenPickerVisible(false);
        }}
        onClear={() => {
          setDueDate(null);
          setTimeSegments([]);
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
