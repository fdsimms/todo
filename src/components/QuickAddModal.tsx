import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useShallow } from 'zustand/react/shallow';
import type { Priority, Effort } from '../types';
import { PRIORITY_COLORS, EFFORT_LABELS } from '../types';
import { tagColor } from '../utils/tagColor';
import { format, addDays, startOfDay } from 'date-fns';
import { suggestTaskAttributes } from '../services/aiSuggestions';

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenFull: (title: string) => void;
}

type ActivePanel = 'date' | 'priority' | 'effort' | 'tags' | null;

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: '+7 days', days: 7 },
];

export function QuickAddModal({ visible, onClose, onOpenFull }: Props) {
  const addTask = useTaskStore(s => s.addTask);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const colors = useColors();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);
  const tagInputRef = useRef<TextInput>(null);
  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) {
          Animated.parallel([
            Animated.spring(translateY, { toValue: 700, damping: 28, stiffness: 320, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
          ]).start(() => { translateY.setValue(600); onClose(); });
        } else {
          Animated.spring(translateY, { toValue: 0, damping: 22, stiffness: 300, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 700, damping: 28, stiffness: 320, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => { translateY.setValue(600); onClose(); });
  };

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setPriority(0);
      setEffort(0);
      setDueDate(null);
      setTags([]);
      setTagInput('');
      setActivePanel(null);
      setAiLoading(false);
      translateY.setValue(600);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, damping: 26, stiffness: 220, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  const handleAdd = () => {
    if (!title.trim()) return;
    addTask({
      title: title.trim(),
      priority,
      effort,
      dueDate: dueDate?.toISOString() ?? null,
      tags,
    });
    onClose();
  };

  const handleOpenFull = () => {
    onOpenFull(title);
  };

  const togglePanel = (panel: ActivePanel) => {
    setActivePanel(prev => prev === panel ? null : panel);
    if (panel === 'tags') {
      setTimeout(() => tagInputRef.current?.focus(), 100);
    }
  };

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  };

  const toggleExistingTag = (tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleSuggest = async () => {
    if (!title.trim()) return;
    setAiLoading(true);
    try {
      const result = await suggestTaskAttributes(title.trim(), '', allTags);
      if (result.effort > 0 && effort === 0) setEffort(result.effort);
      if (result.tags.length > 0) setTags(prev => [...new Set([...prev, ...result.tags])]);
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.overlayTap} activeOpacity={1} onPress={dismiss} />
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm, transform: [{ translateY }] }]}>
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

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
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.addBtn, !title.trim() && styles.addBtnDisabled]}
              onPress={handleAdd}
              disabled={!title.trim()}
            >
              <Ionicons name="arrow-up" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Attribute toolbar */}
          <View style={styles.toolbar}>
            {/* Due date chip */}
            <TouchableOpacity
              style={[styles.toolChip, activePanel === 'date' && styles.toolChipActive, dueDate != null && styles.toolChipSet]}
              onPress={() => togglePanel('date')}
              activeOpacity={0.7}
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
              activeOpacity={0.7}
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
              activeOpacity={0.7}
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
              activeOpacity={0.7}
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

            {/* AI Suggest chip */}
            {!!anthropicApiKey && !!title.trim() && (
              <TouchableOpacity
                style={[styles.toolChip, styles.aiChip]}
                onPress={handleSuggest}
                disabled={aiLoading}
                activeOpacity={0.7}
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
          {activePanel === 'date' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {DATE_PRESETS.map(({ label, days }) => {
                  const d = startOfDay(addDays(new Date(), days));
                  const selected = dueDate?.toDateString() === d.toDateString();
                  return (
                    <TouchableOpacity
                      key={label}
                      style={[styles.presetChip, selected && styles.presetChipActive]}
                      onPress={() => {
                        setDueDate(selected ? null : d);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.presetChipText, selected && styles.presetChipTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {dueDate && (
                  <TouchableOpacity
                    style={styles.clearChip}
                    onPress={() => setDueDate(null)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={12} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

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
                    onPress={() => setPriority(p)}
                    activeOpacity={0.7}
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
                    onPress={() => setEffort(prev => prev === e ? 0 : e)}
                    activeOpacity={0.7}
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
                      activeOpacity={0.7}
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
                        activeOpacity={0.7}
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

          {/* More details */}
          <TouchableOpacity style={styles.moreBtn} onPress={handleOpenFull}>
            <Ionicons name="expand-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.moreBtnText}>More details</Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  flex: { flex: 1 },
  backdropDim: { backgroundColor: 'rgba(0,0,0,0.3)' },
  overlayTap: { flex: 1 },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
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
    color: colors.text,
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
    gap: 5,
    paddingVertical: spacing.sm,
  },
  moreBtnText: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  aiChip: {
    backgroundColor: colors.purple + '22',
  },
  aiChipText: {
    color: colors.purple,
    fontWeight: '600',
  },
});
