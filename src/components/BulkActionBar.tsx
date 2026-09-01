import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  Animated,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PinIcon } from './PinIcon';
import { WhenPicker } from './WhenPicker';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useBulkBarEntrance } from '../hooks/useBulkBarEntrance';
import { PRIORITY_LABELS, PRIORITY_COLORS, type Priority, type TimeOfDay } from '../types';
import { tagColor } from '../utils/tagColor';
import { CategoryPickerSheet } from './CategoryPicker';

interface Props {
  selectedCount: number;
  totalCount: number;
  existingTags: string[];
  onComplete: () => void;
  /**
   * How many of the selection a Complete would actually complete. The action
   * hides at 0, which is a selection of nothing but negative habits — those are
   * never completed, so the button would do nothing. Optional, defaulting to
   * "there is something": a caller that never lists negative habits needn't
   * compute it. See useTaskSelection, which derives it for every caller.
   */
  completableCount?: number;
  onDelete: () => void;
  onSetWhen: (date: Date | null, timeSegments: TimeOfDay[]) => void;
  /** Where to move the selection. `null` clears the category. Creating a new one happens in the picker. */
  onSetCategory: (category: string | null) => void;
  onAddTags: (tags: string[]) => void;
  onSetPriority: (priority: Priority) => void;
  /** Marks every recurring task in the selection missed — a no-op for anything else, same guard as the per-row action. */
  onMarkMissed: () => void;
  // Grouping is Today/Later-only for now — other screens that bulk-select
  // tasks (Categories, Inbox, Tags) simply omit this and the action hides.
  onGroup?: (title: string) => void;
  // Pinning is a Today concept, so it's omitted the same way grouping is.
  onTogglePin?: () => void;
  /**
   * Unfiles the selection from the project it's in. Passed only by
   * ProjectDetailScreen, and hidden everywhere else the way grouping and
   * pinning are: on any other screen the selection spans projects, or none.
   *
   * It exists because adding a task to a project was a first-class flow with
   * its own picker while taking one out was reachable from nowhere on that
   * screen — the store action had one caller, the non-cascading delete, and by
   * hand it meant opening the task's own editor and setting Project to "Not
   * set".
   */
  onRemoveFromProject?: () => void;
  /** True when every selected task is already pinned — the action then reads "Unpin". */
  allPinned?: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  /** Clearance to leave below the bar — the floating tab bar's rendered height, not just the safe-area inset. */
  bottomInset: number;
  /** Reports the bar's rendered height so the caller can reserve matching space at the bottom of its list, keeping the bar from covering the last rows. */
  onHeightChange?: (height: number) => void;
}

// Category is absent on purpose: it opens `CategoryPickerSheet` rather than a
// panel in the bar, which had the same problem the quick-add pill grid did —
// four rows of chips over a floating bar is no room to find anything in.
type Panel = 'actions' | 'more' | 'priority' | 'tags' | 'group';

export function BulkActionBar({
  selectedCount,
  totalCount,
  existingTags,
  onComplete,
  completableCount,
  onDelete,
  onSetWhen,
  onSetCategory,
  onAddTags,
  onSetPriority,
  onMarkMissed,
  onGroup,
  onRemoveFromProject,
  onTogglePin,
  allPinned = false,
  onSelectAll,
  onDeselectAll,
  onCancel,
  bottomInset,
  onHeightChange,
}: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const entranceStyle = useBulkBarEntrance();
  const [panel, setPanel] = useState<Panel>('actions');
  const [whenVisible, setWhenVisible] = useState(false);
  const [categoryVisible, setCategoryVisible] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [newTagText, setNewTagText] = useState('');
  const [groupTitle, setGroupTitle] = useState('');

  const allSelected = selectedCount === totalCount;

  const handleConfirmWhen = (date: Date | null, segs: TimeOfDay[]) => {
    setWhenVisible(false);
    onSetWhen(date, segs);
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const handleApplyTags = () => {
    const trimmed = newTagText.trim();
    const tags = Array.from(new Set([...selectedTags, ...(trimmed ? [trimmed] : [])]));
    if (tags.length > 0) onAddTags(tags);
    setPanel('actions');
    setSelectedTags(new Set());
    setNewTagText('');
  };

  const handleSetPriority = (p: Priority) => {
    haptics.tap();
    onSetPriority(p);
    setPanel('actions');
  };

  const handleApplyGroup = () => {
    const trimmed = groupTitle.trim();
    if (!trimmed || !onGroup) return;
    onGroup(trimmed);
    setPanel('actions');
    setGroupTitle('');
  };

  const goBack = () => {
    setPanel('actions');
    setSelectedTags(new Set());
    setNewTagText('');
    setGroupTitle('');
  };

  return (
    <>
      <Animated.View
        style={[styles.container, shadows.sheet, { bottom: bottomInset + spacing.sm }, entranceStyle]}
        onLayout={onHeightChange ? e => onHeightChange(e.nativeEvent.layout.height) : undefined}
      >
        {panel === 'actions' && (
          <>
            <View style={styles.topRow}>
              <TouchableOpacity
                style={styles.selectAllBtn}
                onPress={() => { haptics.tap(); allSelected ? onDeselectAll() : onSelectAll(); }}
              >
                <Text style={styles.selectAllText}>
                  {allSelected ? 'Deselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.countText}>{selectedCount} selected</Text>
              <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel selection">
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.actionRow}>
              {(completableCount ?? 1) > 0 && (
                <PressableScale
                  style={styles.actionBtn}
                  onPress={() => { haptics.success(); onComplete(); }}
                >
                  <Ionicons name="checkmark-circle" size={24} color={colors.green} />
                  <Text style={[styles.actionLabel, { color: colors.green }]}>Complete</Text>
                </PressableScale>
              )}
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.tap(); setWhenVisible(true); }}
              >
                <Ionicons name="calendar" size={24} color={colors.accent} />
                <Text style={[styles.actionLabel, { color: colors.accent }]}>When</Text>
              </PressableScale>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.tap(); setCategoryVisible(true); }}
              >
                <Ionicons name="folder" size={24} color={colors.purple} />
                <Text style={[styles.actionLabel, { color: colors.purple }]}>Move</Text>
              </PressableScale>
              {onTogglePin && (
                <PressableScale
                  style={styles.actionBtn}
                  onPress={() => { haptics.tap(); onTogglePin(); }}
                >
                  <PinIcon filled={allPinned} size={24} color={colors.orange} />
                  <Text style={[styles.actionLabel, { color: colors.orange }]}>
                    {allPinned ? 'Unpin' : 'Pin'}
                  </Text>
                </PressableScale>
              )}
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.impactMedium(); onDelete(); }}
              >
                <Ionicons name="trash" size={24} color={colors.red} />
                <Text style={[styles.actionLabel, { color: colors.red }]}>Delete</Text>
              </PressableScale>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.tap(); setPanel('more'); }}
              >
                <Ionicons name="ellipsis-horizontal-circle" size={24} color={colors.textSecondary} />
                <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>More</Text>
              </PressableScale>
            </View>
          </>
        )}

        {panel === 'more' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to bulk actions">
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>More actions</Text>
              <View style={{ width: 28 }} />
            </View>
            {onGroup && (
              <TouchableOpacity style={styles.moreRow} onPress={() => setPanel('group')}>
                <Ionicons name="layers-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.moreRowText}>Stack</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.moreRow} onPress={() => setPanel('tags')}>
              <Ionicons name="pricetag-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.moreRowText}>Tag</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.moreRow} onPress={() => setPanel('priority')}>
              <Ionicons name="arrow-up-circle-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.moreRowText}>Priority</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            {/* No chevron — this fires immediately instead of opening a sub-panel. */}
            <TouchableOpacity
              style={styles.moreRow}
              onPress={() => { haptics.impactMedium(); onMarkMissed(); }}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.moreRowText}>Missed</Text>
            </TouchableOpacity>
            {/* Same immediate shape, and deliberately not destructive-tinted:
                the tasks keep everything else and stay in the list, they just
                stop being filed here. */}
            {onRemoveFromProject && (
              <TouchableOpacity
                style={styles.moreRow}
                onPress={() => { haptics.impactMedium(); onRemoveFromProject(); }}
                accessibilityRole="button"
                accessibilityLabel="Remove from project"
              >
                <Ionicons name="briefcase-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.moreRowText}>Remove from project</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {panel === 'priority' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to bulk actions">
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>Set priority</Text>
              <View style={{ width: 28 }} />
            </View>
            <View style={styles.priorityRow}>
              {([0, 1, 2, 3, 4] as Priority[]).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityBtn,
                    { borderColor: p === 0 ? colors.bgQuaternary : PRIORITY_COLORS[p] },
                  ]}
                  onPress={() => handleSetPriority(p)}
                >
                  {p > 0 && (
                    <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[p] }]} />
                  )}
                  <Text style={[
                    styles.priorityLabel,
                    { color: p === 0 ? colors.textSecondary : PRIORITY_COLORS[p] },
                  ]}>
                    {PRIORITY_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {panel === 'tags' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to bulk actions">
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>Add tags</Text>
              <TouchableOpacity
                style={[styles.applyBtn, (selectedTags.size === 0 && !newTagText.trim()) && styles.applyBtnDisabled]}
                onPress={handleApplyTags}
              >
                <Text style={[
                  styles.applyBtnText,
                  (selectedTags.size === 0 && !newTagText.trim()) && styles.applyBtnTextDisabled,
                ]}>
                  Apply
                </Text>
              </TouchableOpacity>
            </View>
            {existingTags.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tagScroll}
                contentContainerStyle={styles.tagScrollContent}
              >
                {existingTags.map(tag => (
                  <TouchableOpacity
                    key={tag}
                    style={[
                      styles.tagChip,
                      selectedTags.has(tag) && { backgroundColor: tagColor(tag) + '33', borderColor: tagColor(tag) },
                    ]}
                    onPress={() => { haptics.tap(); handleTagToggle(tag); }}
                  >
                    <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                    <Text style={[
                      styles.tagChipText,
                      selectedTags.has(tag) && { color: tagColor(tag) },
                    ]}>
                      {tag}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View style={styles.tagInputRow}>
              <TextInput
                style={styles.tagInput}
                placeholder="New tag…"
                placeholderTextColor={colors.textTertiary}
                value={newTagText}
                onChangeText={setNewTagText}
                returnKeyType="done"
                onSubmitEditing={handleApplyTags}
                autoCapitalize="none"
              />
            </View>
          </View>
        )}

        {panel === 'group' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to bulk actions">
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>Stack tasks</Text>
              <TouchableOpacity
                style={[styles.applyBtn, !groupTitle.trim() && styles.applyBtnDisabled]}
                onPress={handleApplyGroup}
              >
                <Text style={[styles.applyBtnText, !groupTitle.trim() && styles.applyBtnTextDisabled]}>
                  Create
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.tagInputRow}>
              <TextInput
                style={styles.tagInput}
                placeholder="e.g. Take supplements"
                placeholderTextColor={colors.textTertiary}
                value={groupTitle}
                onChangeText={setGroupTitle}
                returnKeyType="done"
                onSubmitEditing={handleApplyGroup}
                autoFocus
              />
            </View>
          </View>
        )}
      </Animated.View>

      <WhenPicker
        visible={whenVisible}
        value={null}
        onConfirm={handleConfirmWhen}
        onClear={() => handleConfirmWhen(null, [])}
        onCancel={() => setWhenVisible(false)}
      />
      {/* No `value`: the selection can span categories, so there's nothing to
          tick — every row here is a destination. */}
      <CategoryPickerSheet
        visible={categoryVisible}
        title="Move to category"
        onSelect={onSetCategory}
        onClose={() => setCategoryVisible(false)}
      />
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  countText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '600',
  },
  selectAllBtn: {
    paddingVertical: 4,
  },
  selectAllText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: '500',
  },
  cancelBtn: {
    padding: 4,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: spacing.xs,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 56,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  subPanel: {
    gap: spacing.sm,
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: '600',
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
  },
  moreRowText: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: '500',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
    paddingBottom: spacing.xs,
  },
  priorityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.full,
    borderWidth: 1.5,
    backgroundColor: colors.bgTertiary,
  },
  priorityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  priorityLabel: {
    fontSize: font.sm,
    fontWeight: '600',
  },
  applyBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  applyBtnDisabled: {
    backgroundColor: colors.bgTertiary,
  },
  applyBtnText: {
    color: colors.onAccent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  applyBtnTextDisabled: {
    color: colors.textTertiary,
  },
  tagScroll: {
    flexGrow: 0,
  },
  tagScrollContent: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.bgQuaternary,
    backgroundColor: colors.bgTertiary,
  },
  tagDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  tagChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '500',
  },
  tagInputRow: {
    paddingBottom: spacing.xs,
  },
  tagInput: {
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
});
