import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, interaction, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { isGuardableHabit } from '../utils/rewardGuard';
import { displayTitleFor } from '../utils/visibilityUtils';
import { PickerSheet, PICKER_SHEET_LIST_MAX_HEIGHT } from './CategoryPicker';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import { TextField } from './TextField';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The habit picked now, ticked in the list; null for none. */
  value: string | null;
  /** Called with the picked habit's id, or null for "No habit". */
  onSelect: (taskId: string | null) => void;
  /** Habits another reward already guards, left out so one habit has one price. */
  excludeIds: ReadonlySet<string>;
}

/**
 * Pick the "Avoid this" habit a reward guards (`Reward.guardsTaskId`). The
 * same shape as `ProjectPickerSheet`: a "none" row, then one row per live
 * avoid habit, on the `PickerSheet` shell. A field under the list makes a new
 * avoid habit and picks it, so a habit that doesn't exist yet needs no trip to
 * the task editor first (the same plain avoid task quick add writes).
 */
export function HabitPickerSheet({ visible, onClose, value, onSelect, excludeIds }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [newTitle, setNewTitle] = useState('');
  const habits = useTaskStore(useShallow(s =>
    s.tasks.filter(t => isGuardableHabit(t) && (!excludeIds.has(t.id) || t.id === value))));

  const canCreate = newTitle.trim().length > 0;

  return (
    <PickerSheet visible={visible} onClose={onClose} title="Linked habit">
      {choose => {
        const create = () => {
          const title = newTitle.trim();
          if (!title) return;
          haptics.success();
          const task = useTaskStore.getState().addTask({ title, polarity: 'negative', showStreak: true });
          setNewTitle('');
          choose(() => onSelect(task.id));
        };
        return (
        <ScrollView style={{ maxHeight: PICKER_SHEET_LIST_MAX_HEIGHT }} keyboardShouldPersistTaps="handled">
          {[{ id: null as string | null, title: 'No habit' }, ...habits.map(t => ({
            id: t.id as string | null, title: displayTitleFor(t),
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
                accessibilityLabel={row.title}
              >
                <Ionicons
                  name={row.id === null ? 'remove-circle-outline' : 'shield-checkmark-outline'}
                  size={iconSize.sm}
                  color={colors.textSecondary}
                />
                <Text style={[styles.rowText, on && styles.rowTextOn]} numberOfLines={1}>{row.title}</Text>
                {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />}
              </TouchableOpacity>
            );
          })}
          {habits.length === 0 && (
            <Text style={styles.empty}>
              No habits to link yet. Name one below to make it.
            </Text>
          )}
          <View style={styles.newRow}>
            <TextField
              style={styles.newInput}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="e.g. No dessert"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={create}
              accessibilityLabel="New habit name"
            />
            <InlineAction label="New habit" icon="add" variant="neutral" onPress={create} disabled={!canCreate} />
          </View>
          <HelpText style={styles.newHint}>Makes a new Avoid this habit and links it.</HelpText>
        </ScrollView>
        );
      }}
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
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingLeft: spacing.smd,
    paddingRight: spacing.xsm,
    marginTop: spacing.sm,
  },
  newInput: { flex: 1, color: colors.text, fontSize: font.md, minHeight: 44 },
  newHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xsm, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: font.sm, paddingVertical: spacing.sm },
});
