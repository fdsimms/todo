import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../store/useProjectStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import type { ProjectKind } from '../types';
import { PickerSheet, PICKER_SHEET_LIST_MAX_HEIGHT } from './CategoryPicker';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The project picked now, ticked in the list; null for none. */
  value: string | null;
  /** Called with the picked project's id, or null for "No project". */
  onSelect: (projectId: string | null) => void;
  /**
   * Offer only projects of this kind. The Rewards screen passes 'list', since
   * only a list's items can be priced as rewards. Omitted, every kind shows.
   */
  kind?: ProjectKind;
  /** The sheet's title and the label of the "none" row. Default "Project" / "No project". */
  title?: string;
  noneLabel?: string;
}

/**
 * Pick the project a new task goes into, from quick add: one row per active
 * project, lists marked with the list icon, in the user's own project order.
 * Built on `PickerSheet`, the shell the category picker uses, so it arrives,
 * dismisses and sits over the keyboard the same way.
 */
export function ProjectPickerSheet({
  visible, onClose, value, onSelect, kind, title = 'Project', noneLabel = 'No project',
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const projects = useProjectStore(useShallow(s =>
    s.projects
      .filter(p => !p.archived && !p.completed && (kind === undefined || p.kind === kind))
      .sort((a, b) => a.sortOrder - b.sortOrder)));

  return (
    <PickerSheet visible={visible} onClose={onClose} title={title}>
      {choose => (
        <ScrollView style={{ maxHeight: PICKER_SHEET_LIST_MAX_HEIGHT }} keyboardShouldPersistTaps="handled">
          {[{ id: null, title: noneLabel, isList: false }, ...projects.map(p => ({
            id: p.id as string | null, title: p.title, isList: p.kind === 'list',
          }))].map(row => {
            const on = row.id === value;
            return (
              <TouchableOpacity
                key={row.id ?? '__none__'}
                style={styles.row}
                onPress={() => { haptics.tap(); choose(() => onSelect(row.id)); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={row.id === null ? noneLabel : `${row.title}${row.isList ? ', list' : ''}`}
              >
                <Ionicons
                  name={row.id === null ? 'remove-circle-outline' : row.isList ? 'list-outline' : 'briefcase-outline'}
                  size={iconSize.sm}
                  color={colors.textSecondary}
                />
                <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={1}>{row.title}</Text>
                {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />}
              </TouchableOpacity>
            );
          })}
          {projects.length === 0 && (
            <Text style={styles.empty}>
              {kind === 'list'
                ? 'No lists yet. Make one on the Projects page.'
                : 'No active projects yet. Make one on the Projects page.'}
            </Text>
          )}
        </ScrollView>
      )}
    </PickerSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    minHeight: 44,
  },
  rowText: { flex: 1, color: colors.text, fontSize: font.md },
  rowTextOn: { fontWeight: fontWeight.semibold },
  empty: { color: colors.textSecondary, fontSize: font.sm, paddingVertical: spacing.sm },
});
