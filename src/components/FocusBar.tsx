import React, { useMemo } from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';
import { formatStopwatch } from '../utils/effort';
import { displayTitleFor } from '../utils/visibilityUtils';
import {
  currentFocusStep,
  isFocusRunning,
  isFocusSessionFinished,
  isFocusStepDone,
  focusStepRemaining,
} from '../utils/focusPlan';
import { useFocusSession } from '../hooks/useFocusSession';
import { useFocusStore } from '../store/useFocusStore';
import { useTaskStore } from '../store/useTaskStore';

interface Props {
  /** Reopens the session sheet. */
  onOpen: () => void;
}

/**
 * The strip on Today saying a focus session is running, and how far into the
 * current stretch it is.
 *
 * Same job `ActiveTripBanner` and `CategoryFocusBanner` do for their modes: a
 * session that's been closed back to the task list has no other affordance on
 * screen, and without this the only evidence it exists is a chime some minutes
 * later. Tapping anywhere along it reopens the session.
 *
 * Renders nothing when there's no session, so Today pays no height for it the
 * rest of the time. The pause control is here as well as inside the sheet
 * because pausing is the one thing you want without going back in: the phone
 * rang, and reopening a full-screen countdown to stop the clock is two taps
 * where one will do.
 */
export function FocusBar({ onOpen }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { session, now } = useFocusSession();
  const tasks = useTaskStore(s => s.tasks);
  const pause = useFocusStore(s => s.pause);
  const resume = useFocusStore(s => s.resume);

  if (!session) return null;

  const finished = isFocusSessionFinished(session);
  const step = currentFocusStep(session);
  const running = isFocusRunning(session);
  const stepDone = isFocusStepDone(session, now);
  const remaining = focusStepRemaining(session, now);

  const task = step?.taskId ? tasks.find(t => t.id === step.taskId) : undefined;
  const label = finished
    ? 'Session done'
    : step?.kind === 'rest'
      ? (step.long ? 'Long break' : 'Break')
      : task
        ? displayTitleFor(task)
        : 'Focusing';

  // An over-run step counts up rather than sitting at 0:00, so the strip says
  // how long it's been waiting on you rather than just that it is.
  const clock = finished
    ? null
    : stepDone
      ? `+${formatStopwatch(-remaining)}`
      : formatStopwatch(remaining);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.summary}
        onPress={() => {
          haptics.tap();
          onOpen();
        }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={
          finished
            ? 'Focus session finished. Open it'
            : `Focusing on ${label}, ${clock} ${stepDone ? 'over' : 'left'}. Open the session`
        }
      >
        <Ionicons
          name={finished ? 'checkmark-done' : step?.kind === 'rest' ? 'cafe' : 'hourglass'}
          size={iconSize.sm}
          color={stepDone && !finished ? colors.orange : colors.accent}
        />
        <Text style={styles.text} numberOfLines={1}>{label}</Text>
        {clock !== null && (
          <Text style={[styles.clock, stepDone && styles.clockDone]}>{clock}</Text>
        )}
      </TouchableOpacity>

      {!finished && (
        <PressableScale
          style={styles.button}
          onPress={() => {
            haptics.tap();
            if (running) pause();
            else resume();
          }}
          accessibilityLabel={running ? 'Pause focus session' : 'Resume focus session'}
        >
          <Ionicons name={running ? 'pause' : 'play'} size={iconSize.sm} color={colors.onAccent} />
        </PressableScale>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bgSunken,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  clock: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  clockDone: { color: colors.orange },
  button: {
    backgroundColor: colors.accent,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
});
