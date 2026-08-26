import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Animated } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, radius, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useBulkBarEntrance } from '../hooks/useBulkBarEntrance';

interface Props {
  selectedCount: number;
  onDelete: () => void;
  onGroup: (title: string) => void;
  onCancel: () => void;
  /** Clearance to leave below the bar. */
  bottomInset: number;
}

type Panel = 'actions' | 'group';

/**
 * Floating bulk-action bar for selected template items — a trimmed sibling of
 * BulkActionBar with just Delete and Group, since template items have no
 * tags/priority/category panels worth bulk-editing before they become tasks.
 */
export function TemplateItemBulkBar({ selectedCount, onDelete, onGroup, onCancel, bottomInset }: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const entranceStyle = useBulkBarEntrance();
  const [panel, setPanel] = useState<Panel>('actions');
  const [groupTitle, setGroupTitle] = useState('');

  const handleApplyGroup = () => {
    const trimmed = groupTitle.trim();
    if (!trimmed) return;
    haptics.success();
    onGroup(trimmed);
    setGroupTitle('');
    setPanel('actions');
  };

  return (
    <Animated.View style={[styles.container, shadows.sheet, { bottom: bottomInset + spacing.md }, entranceStyle]}>
      {panel === 'actions' && (
        <>
          <View style={styles.topRow}>
            <Text style={styles.countText}>{selectedCount} selected</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel selection">
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <PressableScale style={styles.actionBtn} onPress={() => { haptics.tap(); setPanel('group'); }}>
              <Ionicons name="layers" size={24} color={colors.accent} />
              <Text style={[styles.actionLabel, { color: colors.accent }]}>Stack</Text>
            </PressableScale>
            <PressableScale style={styles.actionBtn} onPress={() => { haptics.impactMedium(); onDelete(); }}>
              <Ionicons name="trash" size={24} color={colors.red} />
              <Text style={[styles.actionLabel, { color: colors.red }]}>Delete</Text>
            </PressableScale>
          </View>
        </>
      )}

      {panel === 'group' && (
        <View style={styles.subPanel}>
          <View style={styles.subHeader}>
            <TouchableOpacity onPress={() => setPanel('actions')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to bulk actions">
              <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.subTitle}>Stack items</Text>
            <TouchableOpacity
              style={[styles.applyBtn, !groupTitle.trim() && styles.applyBtnDisabled]}
              onPress={handleApplyGroup}
            >
              <Text style={[styles.applyBtnText, !groupTitle.trim() && styles.applyBtnTextDisabled]}>Apply</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.groupInput}
            value={groupTitle}
            onChangeText={setGroupTitle}
            placeholder="e.g. Take supplements"
            placeholderTextColor={colors.textTertiary}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleApplyGroup}
          />
        </View>
      )}
    </Animated.View>
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  countText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '600' },
  cancelBtn: { padding: 4 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-around', paddingBottom: spacing.xs },
  actionBtn: { alignItems: 'center', gap: 4, paddingVertical: spacing.xs, paddingHorizontal: spacing.lg, minWidth: 72 },
  actionLabel: { fontSize: font.xs, fontWeight: '500' },
  subPanel: { gap: spacing.sm },
  subHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  applyBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  applyBtnDisabled: { opacity: 0.4 },
  applyBtnText: { color: colors.accent, fontSize: font.sm, fontWeight: '600' },
  applyBtnTextDisabled: { color: colors.textTertiary },
  groupInput: {
    color: colors.text, fontSize: font.md,
    backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
});
