import React, { useMemo, useState } from 'react';
import { Platform, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { formatDuration, formatStopwatch } from '../utils/effort';
import { ProgressBar } from './ProgressBar';
import { NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';

interface Props {
  /** "Prep" or "Cook" — drives the idle/counting-down copy ("Prep for 15m", "Time this cook"). */
  verb: 'Prep' | 'Cook';
  targetMinutes: number | null;
  running: boolean;
  paused: boolean;
  inProgress: boolean;
  ready: boolean;
  elapsedSeconds: number;
  remainingSeconds: number;
  progress: number;
  /** describePrepTime/describeCookTime's output — "Est. 15m · took 18m last time". Empty renders nothing. */
  summary: string;
  onToggle: () => void;
  onLog: () => void;
  onReset: () => void;
  /** Logs a time typed in directly, for whoever timed it on a stove clock instead of this one. */
  onLogManual: (minutes: number) => void;
}

/**
 * One timer card — start/pause, log, reset, and a countdown or stopwatch
 * header, depending on whether a target duration is set. Shared by
 * RecipeDetailScreen's prep and cook timers (#recipe-metadata-improvements):
 * they're two independent instances of exactly this UI, targeting
 * Recipe.prepMinutes/prepTimer* vs. estimatedMinutes/timer* respectively, and
 * duplicating this much JSX+styling per timer is the thing worth avoiding,
 * not the two call sites themselves.
 */
export function RecipeTimerRow({
  verb, targetMinutes, running, paused, inProgress, ready,
  elapsedSeconds, remainingSeconds, progress, summary, onToggle, onLog, onReset, onLogManual,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hasTarget = targetMinutes !== null;
  const idleText = verb === 'Cook' ? 'Time this cook' : 'Time prep';
  const [manualMinutes, setManualMinutes] = useState('');

  const submitManual = () => {
    const minutes = parseInt(manualMinutes, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    onLogManual(minutes);
    setManualMinutes('');
  };

  const headerText = hasTarget
    ? ready
      ? `Ready · ${formatDuration(targetMinutes!)} done`
      : running
        ? `${formatStopwatch(Math.max(0, remainingSeconds))} left`
        : paused
          ? `Paused · ${formatStopwatch(Math.max(0, remainingSeconds))} left`
          : `${verb} for ${formatDuration(targetMinutes!)}`
    : running
      ? `${formatStopwatch(elapsedSeconds)} elapsed`
      : paused
        ? `Paused · ${formatStopwatch(elapsedSeconds)}`
        : idleText;

  return (
    <View style={styles.timerCard}>
      <View style={styles.timerHeader}>
        <Ionicons
          name={ready ? 'checkmark-circle' : 'timer-outline'}
          size={16}
          color={ready ? colors.green : colors.accent}
        />
        <Text style={styles.timerHeaderText} numberOfLines={1}>{headerText}</Text>
      </View>
      {hasTarget && <ProgressBar progress={progress} height={4} />}
      <View style={styles.timerActions}>
        <TouchableOpacity
          style={[styles.timerBtn, running && styles.timerBtnRunning]}
          activeOpacity={interaction.activeOpacity}
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={
            running ? `Pause ${verb.toLowerCase()} timer` : paused ? `Resume ${verb.toLowerCase()} timer` : `Start ${verb.toLowerCase()} timer`
          }
        >
          <Ionicons name={running ? 'pause' : 'play'} size={12} color={colors.onAccent} />
          <Text style={styles.timerBtnText}>{running ? 'Pause' : paused ? 'Resume' : 'Start'}</Text>
        </TouchableOpacity>
        {inProgress && (
          <>
            <TouchableOpacity
              onPress={onLog}
              hitSlop={8}
              style={styles.timerSecondaryBtn}
              accessibilityRole="button"
              accessibilityLabel={`Done — log this ${verb.toLowerCase()} time`}
            >
              <Ionicons name="checkmark" size={iconSize.sm} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onReset}
              hitSlop={8}
              style={styles.timerSecondaryBtn}
              accessibilityRole="button"
              accessibilityLabel={`Reset ${verb.toLowerCase()} timer`}
            >
              <Ionicons name="refresh" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          </>
        )}
      </View>
      {!inProgress && (
        <View style={styles.manualRow}>
          <Text style={styles.manualLabel}>or log a time</Text>
          <TextInput
            style={styles.manualInput}
            value={manualMinutes}
            onChangeText={text => setManualMinutes(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="min"
            placeholderTextColor={colors.textTertiary}
            maxLength={4}
            returnKeyType="done"
            onSubmitEditing={submitManual}
            inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
            accessibilityLabel={`${verb} time in minutes`}
          />
          <TouchableOpacity
            onPress={submitManual}
            disabled={!manualMinutes}
            hitSlop={8}
            style={[styles.timerSecondaryBtn, !manualMinutes && styles.manualLogBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={`Log this ${verb.toLowerCase()} time`}
          >
            <Ionicons name="checkmark" size={iconSize.sm} color={manualMinutes ? colors.accent : colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}
      {!!summary && <Text style={styles.timerSummary}>{summary}</Text>}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  timerCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  timerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  timerHeaderText: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    fontVariant: ['tabular-nums'],
  },
  timerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  timerBtnRunning: {
    backgroundColor: colors.orange,
  },
  timerBtnText: {
    color: colors.onAccent,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  timerSecondaryBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  manualLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    flex: 1,
  },
  manualInput: {
    minWidth: 44,
    height: 28,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    color: colors.text,
    fontSize: font.sm,
    textAlign: 'right',
  },
  manualLogBtnDisabled: {
    opacity: 0.5,
  },
  timerSummary: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
});
