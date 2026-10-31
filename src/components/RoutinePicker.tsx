// The routine picker: a find field and one row per routine, with what the
// routine is for under its name. Three places pick a routine (a program's
// rotation, a rotation member's workout, a task's workout link) and each used
// a `PillGroup`, where a name like "Pull / Push / Legs (Bodyweight + Dumbbell)"
// takes a whole line and anything past eight sits behind "N more". The filter
// rules are in src/utils/routinePicker.ts.
import React, { useMemo } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { WorkoutRoutine } from '../types';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { useFilterField } from '../hooks/useFilterField';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { catalogExercise } from '../utils/exerciseCatalog';
import { describeRoutine } from '../utils/workoutRoutine';
import { filterRoutines, resolveRoutineSubmit } from '../utils/routinePicker';
import { TextField } from './TextField';

interface Props {
  /** The routines on offer. The host decides what is left out (archived ones). */
  routines: readonly WorkoutRoutine[];
  /**
   * The chosen routine's id, ticked on its row. Omit where a pick adds to a
   * list rather than choosing a value: the rows then end in a plus instead.
   */
  selectedId?: string | null;
  /** Fires no haptic of its own; the host's handler does, as the three of them already had. */
  onSelect: (routineId: string) => void;
  /** A "None" row above the routines that clears the field. Hidden while filtering, since typing "no" isn't a request to clear it. */
  none?: { selected: boolean; onPress: () => void };
}

/**
 * Every routine, one per row. The field is always on show for the reason
 * `CategoryPickerList` gives: it is one control, not a threshold to explain.
 * No cap and no "N more": the hosts all sit in something that already scrolls.
 */
export function RoutinePickerList({ routines, selectedId, onSelect, none }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const exercises = useWorkoutStore(s => s.exercises);
  const { query, clear, props: filterField } = useFilterField();

  const result = useMemo(() => filterRoutines(routines, query), [routines, query]);
  const trimmed = query.trim();

  const musclesOf = (id: string) => catalogExercise(exercises, id)?.primaryMuscles ?? [];

  return (
    <View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
        <TextField
          style={styles.searchInput}
          {...filterField}
          placeholder="Find a routine…"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          onSubmitEditing={() => {
            const only = resolveRoutineSubmit(result, query);
            if (only) onSelect(only.id);
          }}
          autoCorrect={false}
          accessibilityLabel="Find a routine"
        />
        {!!trimmed && (
          <TouchableOpacity onPress={() => clear()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {!trimmed && none && (
        <TouchableOpacity
          style={styles.row}
          onPress={none.onPress}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ selected: none.selected }}
          accessibilityLabel="No workout"
        >
          <Text style={[styles.name, styles.nameMuted]}>None</Text>
          {none.selected && <Ionicons name="checkmark" size={17} color={colors.accent} />}
        </TouchableOpacity>
      )}

      {result.matches.map(routine => {
        const selected = routine.id === selectedId;
        return (
          <TouchableOpacity
            key={routine.id}
            style={styles.row}
            onPress={() => onSelect(routine.id)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={routine.name}
          >
            <View style={styles.rowText}>
              <Text style={[styles.name, selected && styles.nameSelected]}>{routine.name}</Text>
              <Text style={styles.meta}>{describeRoutine(routine.items, musclesOf)}</Text>
            </View>
            {selectedId === undefined
              ? <Ionicons name="add" size={iconSize.md} color={colors.accent} />
              : selected && <Ionicons name="checkmark" size={17} color={colors.accent} />}
          </TouchableOpacity>
        );
      })}

      {result.noMatches && <Text style={styles.empty}>No routine matches “{trimmed}”.</Text>}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  // A height rather than a lineHeight, which a TextInput must never carry.
  searchInput: { flex: 1, color: colors.text, fontSize: font.md, minHeight: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.smd,
    minHeight: 52,
  },
  rowText: { flex: 1 },
  name: { color: colors.text, fontSize: font.md },
  nameMuted: { flex: 1, color: colors.textSecondary },
  nameSelected: { fontWeight: fontWeight.semibold },
  meta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  empty: { fontSize: font.sm, color: colors.textTertiary, paddingVertical: spacing.sm },
});
