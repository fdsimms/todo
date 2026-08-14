import React, { useMemo, useState } from 'react';
import { Platform, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { formatDuration, formatStopwatch } from '../utils/effort';
import { animateLayout } from '../utils/layoutAnimation';
import { haptics } from '../utils/haptics';
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
 * One timer — start/pause, log, reset, and a countdown or stopwatch header,
 * depending on whether a target duration is set. Shared by RecipeDetailScreen's
 * prep and cook timers: they're two independent instances of exactly this UI,
 * targeting Recipe.prepMinutes/prepTimer* vs. estimatedMinutes/timer*.
 *
 * **One row, not a card** (#1612). Each of these used to be a full card with a
 * header, an action row, a permanently-visible "or log a time" field and a
 * summary line — four stacked rows apiece, so two of them put roughly a third
 * of a phone screen of stopwatch chrome above the ingredients on *every*
 * recipe, including the great majority that have never been timed and have no
 * duration set. The caller stacks them in one card now, and everything past
 * "start it / how long is left" is behind the row's own disclosure:
 * progressive disclosure, the same shape every editor here uses.
 *
 * What deliberately stays on the collapsed row is the pair of controls a cook
 * needs with their hands full — the start/pause button, and while a timer is
 * running the tick that logs it. Typing a time in from the stove clock is the
 * one that can afford a tap first.
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
  const [expanded, setExpanded] = useState(false);

  const submitManual = () => {
    const minutes = parseInt(manualMinutes, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    onLogManual(minutes);
    setManualMinutes('');
    setExpanded(false);
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
    <View style={styles.timerRow}>
      <View style={styles.headerLine}>
        <TouchableOpacity
          style={styles.headerTap}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); animateLayout(); setExpanded(v => !v); }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${verb} timer, ${headerText}`}
          accessibilityHint="Double tap for the time it usually takes, and to log one by hand"
        >
          <Ionicons
            name={ready ? 'checkmark-circle' : 'timer-outline'}
            size={16}
            color={ready ? colors.green : colors.accent}
          />
          <Text style={styles.timerHeaderText} numberOfLines={1}>{headerText}</Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
        {inProgress && (
          <TouchableOpacity
            onPress={onLog}
            hitSlop={8}
            style={styles.timerSecondaryBtn}
            accessibilityRole="button"
            accessibilityLabel={`Done, log this ${verb.toLowerCase()} time`}
          >
            <Ionicons name="checkmark" size={iconSize.sm} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        {inProgress && (
          <TouchableOpacity
            onPress={onReset}
            hitSlop={8}
            style={styles.timerSecondaryBtn}
            accessibilityRole="button"
            accessibilityLabel={`Reset ${verb.toLowerCase()} timer`}
          >
            <Ionicons name="refresh" size={iconSize.sm} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
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
      </View>
      {/* Only while something is actually counting: an untouched bar at 0% on
          every recipe is the chrome this row exists to cut. */}
      {hasTarget && inProgress && <ProgressBar progress={progress} height={4} />}
      {expanded && (
        <View style={styles.details}>
          {!!summary && <Text style={styles.timerSummary}>{summary}</Text>}
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
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  timerRow: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // The whole label is the disclosure target, so the tap has a row-width
  // surface rather than a chevron a cook has to aim at.
  headerTap: {
    flex: 1,
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
  details: {
    gap: spacing.xs,
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
