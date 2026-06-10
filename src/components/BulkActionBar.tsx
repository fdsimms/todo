import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DeferModal } from './DeferModal';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { PRIORITY_LABELS, PRIORITY_COLORS, type Priority } from '../types';
import { tagColor } from '../utils/tagColor';

interface Props {
  selectedCount: number;
  totalCount: number;
  existingTags: string[];
  onComplete: () => void;
  onDelete: () => void;
  onDefer: (date: Date) => void;
  onAddTags: (tags: string[]) => void;
  onSetPriority: (priority: Priority) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  bottomInset: number;
}

type Panel = 'actions' | 'priority' | 'tags';

export function BulkActionBar({
  selectedCount,
  totalCount,
  existingTags,
  onComplete,
  onDelete,
  onDefer,
  onAddTags,
  onSetPriority,
  onSelectAll,
  onDeselectAll,
  onCancel,
  bottomInset,
}: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [panel, setPanel] = useState<Panel>('actions');
  const [deferVisible, setDeferVisible] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [newTagText, setNewTagText] = useState('');

  const allSelected = selectedCount === totalCount;

  const handleDefer = (date: Date) => {
    setDeferVisible(false);
    onDefer(date);
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

  const goBack = () => {
    setPanel('actions');
    setSelectedTags(new Set());
    setNewTagText('');
  };

  return (
    <>
      <View style={[styles.container, shadows.sheet, { paddingBottom: Math.max(bottomInset, spacing.sm) + spacing.sm }]}>
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
              <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.actionRow}>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.success(); onComplete(); }}
              >
                <Ionicons name="checkmark-circle" size={24} color={colors.green} />
                <Text style={[styles.actionLabel, { color: colors.green }]}>Complete</Text>
              </PressableScale>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.tap(); setDeferVisible(true); }}
              >
                <Ionicons name="time" size={24} color={colors.orange} />
                <Text style={[styles.actionLabel, { color: colors.orange }]}>Defer</Text>
              </PressableScale>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.tap(); setPanel('tags'); }}
              >
                <Ionicons name="pricetag" size={24} color={colors.accent} />
                <Text style={[styles.actionLabel, { color: colors.accent }]}>Tag</Text>
              </PressableScale>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.tap(); setPanel('priority'); }}
              >
                <Ionicons name="flag" size={24} color={colors.purple} />
                <Text style={[styles.actionLabel, { color: colors.purple }]}>Priority</Text>
              </PressableScale>
              <PressableScale
                style={styles.actionBtn}
                onPress={() => { haptics.impactMedium(); onDelete(); }}
              >
                <Ionicons name="trash" size={24} color={colors.red} />
                <Text style={[styles.actionLabel, { color: colors.red }]}>Delete</Text>
              </PressableScale>
            </View>
          </>
        )}

        {panel === 'priority' && (
          <View style={styles.subPanel}>
            <View style={styles.subHeader}>
              <TouchableOpacity onPress={goBack} hitSlop={8}>
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>Set Priority</Text>
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
              <TouchableOpacity onPress={goBack} hitSlop={8}>
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.subTitle}>Add Tags</Text>
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
      </View>

      <DeferModal
        visible={deferVisible}
        onConfirm={handleDefer}
        onCancel={() => setDeferVisible(false)}
      />
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 0,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
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
    paddingVertical: 6,
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
