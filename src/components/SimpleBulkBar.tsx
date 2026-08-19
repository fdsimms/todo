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
  /**
   * The one verb this list has besides delete — "Incomplete" in the Logbook,
   * "Restore" on Archived. Both screens hold rows that have already left the
   * daily lists, so the useful pair is "put it back" and "get rid of it".
   */
  primary: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    /** Spoken on the icon button, which is otherwise just its label. */
    accessibilityLabel: string;
  };
  onDelete: () => void;
  /** Spoken on the delete button — "entries" in the Logbook, "tasks" elsewhere. */
  deleteAccessibilityLabel?: string;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  /** Clearance to leave below the bar — the floating tab bar's rendered height. */
  bottomInset: number;
  /** Reports the bar's height so the list can reserve matching space at its bottom. */
  onHeightChange?: (height: number) => void;
}

/**
 * Floating bulk-action bar for a list whose rows have two things left they can
 * do — a trimmed sibling of BulkActionBar, which offers the full set (complete,
 * when, pin, stack, priority) that only a *live* task can take.
 *
 * Parameterized over its first verb rather than copied per screen: the Logbook
 * marks entries incomplete and Archived restores them, and those differ by an
 * icon and a word. A second hand-written copy is how the third one would end up
 * with a grey Cancel and a differently-sized icon — the drift SheetHeaderButton
 * was created to undo.
 */
export function SimpleBulkBar({
  selectedCount,
  totalCount,
  primary,
  onDelete,
  deleteAccessibilityLabel = 'Delete selected entries',
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
          onPress={() => { haptics.tap(); primary.onPress(); }}
          accessibilityLabel={primary.accessibilityLabel}
        >
          <Ionicons name={primary.icon} size={24} color={colors.accent} />
          <Text style={[styles.actionLabel, { color: colors.accent }]}>{primary.label}</Text>
        </PressableScale>
        <PressableScale
          style={[styles.actionBtn, none && styles.actionBtnDisabled]}
          disabled={none}
          onPress={() => { haptics.impactMedium(); onDelete(); }}
          accessibilityLabel={deleteAccessibilityLabel}
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
