import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { StepTimer } from '../types';
import { ProgressBar } from './ProgressBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import {
  formatStepTimerClock,
  isStepTimerReady,
  isStepTimerRunning,
  stepTimerProgress,
  stepTimerRemaining,
} from '../utils/stepTimers';

interface Props {
  timer: StepTimer;
  /** The clock the row is drawn against, from `useStepTimers`. */
  now: number;
  /** True on the screen that owns the recipe, where the dish's name is already in the header. */
  hideRecipeName?: boolean;
  onToggle: () => void;
  onAddTime: () => void;
  onRestart: () => void;
  onRemove: () => void;
}

/**
 * One cooking step timer — the countdown, and the four things a cook does to it
 *.
 *
 * Built to `RecipeTimerRow`'s shape on purpose: these stack directly beneath a
 * recipe's cook timer in cook mode's footer, and a countdown drawn in a
 * different idiom two rows below one that isn't would read as a different
 * feature rather than a second clock. Same row height, same clock face
 * (`formatStopwatch`), same pill for the primary control.
 *
 * What differs is which controls are on it, and that follows from what a step
 * timer is for. There is no disclosure and no log: nothing here is measuring
 * how long anything took, so there's nothing to keep and nothing to type in by
 * hand. What a cook wants instead, with their hands full, is on the row:
 *
 * - **Pause**, because a pan comes off the heat.
 * - **+1 min**, the single most-used button on any kitchen timer, and the one
 *   that also un-rings a timer that just went off (see `addTime`).
 * - **Again**, once it has rung, for the second side and the second batch —
 *   which is also why a length a step names twice is only offered once.
 * - **Dismiss**, which is the only way one leaves before it goes stale.
 *
 * A rung timer turns orange and says so rather than jumping to the top of the
 * stack: see `sortStepTimers` for why moving it would be the wrong kindness.
 */
export function StepTimerRow({ timer, now, hideRecipeName, onToggle, onAddTime, onRestart, onRemove }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const running = isStepTimerRunning(timer);
  const ready = isStepTimerReady(timer, now);
  const remaining = stepTimerRemaining(timer, now);

  const clock = ready
    ? `Time's up · ${formatStepTimerClock(-remaining)} over`
    : running
      ? `${formatStepTimerClock(remaining)} left`
      : `Paused · ${formatStepTimerClock(remaining)} left`;

  const context = [hideRecipeName ? '' : timer.recipeName, timer.stepLabel].filter(Boolean).join(' · ');

  return (
    <View style={styles.row}>
      <View style={styles.headerLine}>
        <Ionicons
          name={ready ? 'alarm' : 'timer-outline'}
          size={16}
          color={ready ? colors.orange : colors.accent}
        />
        <View style={styles.labels}>
          <Text style={[styles.clock, ready && styles.clockReady]} numberOfLines={1}>{clock}</Text>
          {!!context && <Text style={styles.context} numberOfLines={1}>{context}</Text>}
        </View>

        <TouchableOpacity
          onPress={onAddTime}
          hitSlop={8}
          style={styles.secondaryBtn}
          accessibilityRole="button"
          accessibilityLabel={`Add a minute to the ${timer.stepLabel || 'step'} timer`}
        >
          <Text style={styles.secondaryBtnText}>+1m</Text>
        </TouchableOpacity>

        {ready ? (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={interaction.activeOpacity}
              onPress={onRestart}
              accessibilityRole="button"
              accessibilityLabel={`Start the ${timer.stepLabel || 'step'} timer again`}
            >
              <Ionicons name="refresh" size={12} color={colors.onAccent} />
              <Text style={styles.primaryBtnText}>Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onRemove}
              hitSlop={8}
              style={styles.secondaryBtn}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss the ${timer.stepLabel || 'step'} timer`}
            >
              <Ionicons name="checkmark" size={iconSize.sm} color={colors.textSecondary} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.primaryBtn, running && styles.primaryBtnRunning]}
              activeOpacity={interaction.activeOpacity}
              onPress={onToggle}
              accessibilityRole="button"
              accessibilityLabel={`${running ? 'Pause' : 'Resume'} the ${timer.stepLabel || 'step'} timer`}
            >
              <Ionicons name={running ? 'pause' : 'play'} size={12} color={colors.onAccent} />
              <Text style={styles.primaryBtnText}>{running ? 'Pause' : 'Resume'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onRemove}
              hitSlop={8}
              style={styles.secondaryBtn}
              accessibilityRole="button"
              accessibilityLabel={`Cancel the ${timer.stepLabel || 'step'} timer`}
            >
              <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          </>
        )}
      </View>
      <ProgressBar progress={stepTimerProgress(timer, now)} height={4} />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labels: {
    flex: 1,
  },
  clock: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    fontVariant: ['tabular-nums'],
  },
  clockReady: {
    color: colors.orange,
    fontWeight: fontWeight.semibold,
  },
  context: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accentFill,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  primaryBtnRunning: {
    backgroundColor: colors.orange,
  },
  primaryBtnText: {
    color: colors.onAccent,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  secondaryBtn: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
});
