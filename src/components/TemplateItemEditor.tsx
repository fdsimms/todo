import React, { useState, useEffect, useMemo } from 'react';
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
import type { Priority, Effort, TimeOfDay, TemplateItem } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, EFFORT_LABELS, EFFORT_HINTS, TITLE_MAX_LENGTH } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, lineHeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { tagColor } from '../utils/tagColor';
import { useTaskStore } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useShallow } from 'zustand/react/shallow';
import { formatOffsetLabel } from '../utils/templateUtils';

interface Props {
  visible: boolean;
  templateId: string;
  /** Item being edited, or null to create a new one. */
  item: TemplateItem | null;
  onClose: () => void;
}

/**
 * Trimmed TaskEditor-style form for a single template item: title, notes,
 * optional flag, due/defer offsets relative to the anchor date, time of day,
 * category, tags, priority and effort.
 */
export function TemplateItemEditor({ visible, templateId, item, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const addItem = useTemplateStore(s => s.addItem);
  const updateItem = useTemplateStore(s => s.updateItem);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [optional, setOptional] = useState(false);
  const [dueOffsetDays, setDueOffsetDays] = useState<number | null>(null);
  const [deferOffsetDays, setDeferOffsetDays] = useState<number | null>(null);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    if (!visible) return;
    setTitle(item?.title ?? '');
    setNotes(item?.notes ?? '');
    setOptional(item?.optional ?? false);
    setDueOffsetDays(item?.dueOffsetDays ?? null);
    setDeferOffsetDays(item?.deferOffsetDays ?? null);
    setTimeSegments(item?.timeSegments ?? []);
    setTags(item?.tags ?? []);
    setCategory(item?.category ?? null);
    setPriority(item?.priority ?? 0);
    setEffort(item?.effort ?? 0);
    setAddingTag(false);
    setNewTag('');
  }, [visible, item]);

  const handleSave = () => {
    if (!title.trim()) return;
    haptics.success();
    const updates = {
      title: title.trim(),
      notes,
      optional,
      dueOffsetDays,
      deferOffsetDays,
      timeSegments,
      tags,
      category,
      priority,
      effort,
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
          <Text style={styles.headerTitle}>{item ? 'Edit Item' : 'New Item'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={!title.trim()}>
            <Text style={[styles.headerBtn, styles.headerSave, !title.trim() && styles.disabled]}>
              {item ? 'Save' : 'Add'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
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

          {/* Scheduling relative to the anchor date */}
          <View style={styles.optionsCard}>
            <OffsetRow
              icon="calendar"
              label="Due date"
              offset={dueOffsetDays}
              onChange={setDueOffsetDays}
              colors={colors}
              styles={styles}
            />
            <View style={styles.sep} />
            <OffsetRow
              icon="eye-off-outline"
              label="Hide until"
              offset={deferOffsetDays}
              onChange={setDeferOffsetDays}
              colors={colors}
              styles={styles}
            />
            <View style={styles.sep} />
            <View style={styles.optionRow}>
              <Ionicons name="time-outline" size={18} color={timeSegments.length > 0 ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Time of day</Text>
                {timeSegments.length === 0 && <Text style={styles.optionHint}>Show from a specific part of the day</Text>}
              </View>
              {timeSegments.length > 0 && (
                <TouchableOpacity onPress={() => setTimeSegments([])} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.timePillRow}>
              {(['morning', 'afternoon', 'evening'] as TimeOfDay[]).map(tod => {
                const active = timeSegments.includes(tod);
                return (
                  <TouchableOpacity
                    key={tod}
                    style={[styles.timePill, active && styles.timePillActive]}
                    onPress={() => setTimeSegments(prev =>
                      prev.includes(tod) ? [] : [tod]
                    )}
                  >
                    <Text style={[styles.timePillText, active && styles.timePillTextActive]}>
                      {tod.charAt(0).toUpperCase() + tod.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); setOptional(!optional); }}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons name="help-circle-outline" size={18} color={optional ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Optional</Text>
                <Text style={styles.optionHint}>Starts unchecked when using the template</Text>
              </View>
              <View style={[styles.toggle, optional && styles.toggleOn]}>
                <View style={[styles.toggleKnob, optional && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Category + Tags */}
          <View style={styles.sectionCard}>
            <View style={styles.cardSection}>
              <Text style={styles.sectionLabel}>Category</Text>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, !category && styles.pillActiveNeutral]}
                  onPress={() => setCategory(null)}
                >
                  <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
                </TouchableOpacity>
                {allCategories.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.pill, category === cat && styles.pillActiveNeutral]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={[styles.pillText, category === cat && styles.pillTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.cardSep} />

            <View style={styles.cardSection}>
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
          </View>

          {/* Priority + Effort */}
          <View style={styles.sectionCard}>
            <View style={styles.cardSection}>
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

            <View style={styles.cardSep} />

            <View style={styles.cardSection}>
              <Text style={styles.sectionLabel}>Effort</Text>
              <View style={styles.pillRow}>
                {([0, 1, 2, 3, 4, 5, 6] as Effort[]).map(e => (
                  <TouchableOpacity
                    key={e}
                    style={[styles.pill, effort === e && styles.pillActiveNeutral]}
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
  icon, label, offset, onChange, colors, styles,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  offset: number | null;
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
          {offset === null && <Text style={styles.optionHint}>Relative to the anchor date</Text>}
        </View>
        {offset !== null ? (
          <TouchableOpacity onPress={() => onChange(null)} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => { haptics.tap(); onChange(0); }} hitSlop={8}>
            <Text style={styles.setOffsetText}>Set</Text>
          </TouchableOpacity>
        )}
      </View>
      {offset !== null && (
        <View style={styles.intervalRow}>
          <TouchableOpacity style={styles.intervalBtn} onPress={() => onChange(offset - 1)}>
            <Ionicons name="remove" size={16} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.intervalValue}>{formatOffsetLabel(offset)}</Text>
          <TouchableOpacity style={styles.intervalBtn} onPress={() => onChange(offset + 1)}>
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
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  headerBtn: { color: colors.accent, fontSize: font.md },
  headerSave: { fontWeight: '600' },
  disabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, minHeight: 68,
    lineHeight: lineHeight.xl,
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
  setOffsetText: { color: colors.accent, fontSize: font.sm },
  intervalRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  intervalBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  intervalValue: {
    color: colors.text, fontSize: font.md, fontWeight: '600',
    minWidth: 120, textAlign: 'center',
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
});
