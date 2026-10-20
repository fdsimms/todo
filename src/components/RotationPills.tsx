import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { getCurrentDayStart } from '../utils/dateUtils';
import { rotationPills } from '../utils/rotation';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import type { Task } from '../types';

interface Props {
  task: Task;
  /** A member was tapped. Logs it straight away, the way picking it in the sheet does. */
  onPick: (itemId: string) => void;
  /** A member that names a workout was tapped: start it. Finishing it logs the member. */
  onStartWorkout?: (itemId: string) => void;
  /** While the row is selecting or finishing, a tap on a pill must do nothing. */
  disabled?: boolean;
  /** The row sits on `bgTertiary` (a stack's tray), so a done pill needs the next step up to show. */
  onRaised?: boolean;
}

/**
 * A rotation's members on the task row, each one a button that logs it.
 *
 * It is the picker's shortcut, not a replacement: the checkbox still opens
 * `RotationPickSheet`, which says when each member was last done. A pill says
 * only its name and count, for the person who already knows what they did.
 *
 * **A member that is already done stays tappable**, for the reason the picker
 * gives: doing it twice is a real thing to record, and logging it again does
 * not re-count the week. It reads as done (a check, a quiet fill) rather than
 * as disabled.
 *
 * **A member that names a workout starts it instead of logging**, and says so
 * with a play mark. Finishing the session logs the member (`workoutTaskEffect`),
 * and the checkbox's picker is still the way to log one done some other way.
 * The link only counts while it leads somewhere: a deleted routine, or a
 * program with nothing in its rotation, leaves a plain pill.
 *
 * The set is shown whole, in the user's own order, and it wraps rather than
 * caps. A set big enough for that to matter is one this feature is the wrong
 * shape for (see `RotationPickSheet`).
 */
export function RotationPills({ task, onPick, onStartWorkout, disabled = false, onRaised = false }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const pills = rotationPills(task, getCurrentDayStart(), weekStartsOn);
  const workoutsEnabled = useSettingsStore(s => s.workoutsEnabled);
  // Ids only, so the row re-renders when a link starts or stops leading
  // somewhere and not on every workout store write.
  const liveWorkoutIds = useWorkoutStore(s => (!workoutsEnabled || !onStartWorkout ? '' : task.rotationItems
    .filter(i => (i.workoutProgramId
      ? s.programs.some(p => p.id === i.workoutProgramId && p.rotation.some(id => s.routines.some(r => r.id === id)))
      : !!i.workoutRoutineId && s.routines.some(r => r.id === i.workoutRoutineId)))
    .map(i => i.id)
    .join(',')));

  return (
    <View style={styles.wrap}>
      {pills.map(pill => {
        const starts = pill.hasWorkout && liveWorkoutIds.split(',').includes(pill.id);
        return (
        <TouchableOpacity
          key={pill.id}
          style={[
            styles.pill,
            pill.done && (onRaised ? styles.pillDoneRaised : styles.pillDone),
            disabled && styles.pillDisabled,
          ]}
          activeOpacity={interaction.activeOpacity}
          disabled={disabled}
          hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
          onPress={() => (starts ? onStartWorkout!(pill.id) : onPick(pill.id))}
          accessibilityRole="button"
          accessibilityLabel={
            starts
              ? `Start the ${pill.title} workout${pill.done ? ', already done this week' : pill.progress ? `, ${pill.progress} this week` : ''}`
              : pill.done
                ? `${pill.title}, already done this week. Log it again.`
                : `Log ${pill.title}${pill.progress ? `, ${pill.progress} this week` : ''}`
          }
        >
          {pill.done && <Ionicons name="checkmark" size={10} color={colors.done} />}
          {starts && <Ionicons name="play" size={9} color={pill.done ? colors.textSecondary : colors.accent} />}
          <Text style={[styles.label, pill.done && styles.labelDone]} numberOfLines={1}>
            {pill.title}
            {!pill.done && pill.progress ? ` ${pill.progress}` : ''}
          </Text>
        </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  // Tinted rather than bare accent text: this is a button, and accent text on a
  // card reads as a link (the `InlineAction` note in CLAUDE.md).
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    backgroundColor: colors.accentSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  pillDone: { backgroundColor: colors.bgTertiary },
  pillDoneRaised: { backgroundColor: colors.bgQuaternary },
  pillDisabled: { opacity: 0.5 },
  label: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  labelDone: { color: colors.textSecondary },
});
