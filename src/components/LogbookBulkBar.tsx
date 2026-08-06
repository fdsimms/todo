import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  selectedCount: number;
  totalCount: number;
  onMarkIncomplete: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  /** Clearance to leave below the bar — the floating tab bar's rendered height. */
  bottomInset: number;
  /** Reports the bar's height so the list can reserve matching space at its bottom. */
  onHeightChange?: (height: number) => void;
}

/**
 * Floating bulk-action bar for selected Logbook entries — a trimmed sibling of
 * BulkActionBar with just the two things a *completed* task can still do: go
 * back to being incomplete, or be deleted from the history. Everything else
 * that bar offers (complete, when, pin, stack, priority) either already
 * happened or would mean scheduling a task that is done.
 */
export function LogbookBulkBar({
  selectedCount,
  totalCount,
  onMarkIncomplete,
  onDelete,
  onSelectAll,
  onDeselectAll,
  onCancel,
  bottomInset,
  onHeightChange,
}: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allSelected = selectedCount === totalCount;
  const none = selectedCount === 0;

  return (
    <View
      style={[styles.container, shadows.sheet, { bottom: bottomInset + spacing.sm }]}
      onLayout={onHeightChange ? e => onHeightChange(e.nativeEvent.layout.height) : undefined}
    >
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.selectAllBtn}
          onPress={() => { haptics.tap(); allSelected ? onDeselectAll() : onSelectAll(); }}
        >
          <Text style={styles.selectAllText}>{allSelected ? 'Deselect All' : 'Select All'}</Text>
        </TouchableOpacity>
        <Text style={styles.countText}>{selectedCount} selected</Text>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel selection">
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <View style={styles.actionRow}>
        <PressableScale
          style={[styles.actionBtn, none && styles.actionBtnDisabled]}
          disabled={none}
          onPress={() => { haptics.tap(); onMarkIncomplete(); }}
          accessibilityLabel="Mark selected tasks incomplete"
        >
          <Ionicons name="arrow-undo" size={24} color={colors.accent} />
          <Text style={[styles.actionLabel, { color: colors.accent }]}>Incomplete</Text>
        </PressableScale>
        <PressableScale
          style={[styles.actionBtn, none && styles.actionBtnDisabled]}
          disabled={none}
          onPress={() => { haptics.impactMedium(); onDelete(); }}
          accessibilityLabel="Delete selected entries"
        >
          <Ionicons name="trash" size={24} color={colors.red} />
          <Text style={[styles.actionLabel, { color: colors.red }]}>Delete</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
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
  countText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.semibold },
  selectAllBtn: { paddingVertical: 4 },
  selectAllText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  cancelBtn: { padding: 4 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-around', paddingBottom: spacing.xs },
  actionBtn: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
    minWidth: 72,
  },
  actionBtnDisabled: { opacity: 0.4 },
  actionLabel: { fontSize: font.xs, fontWeight: fontWeight.medium },
});
