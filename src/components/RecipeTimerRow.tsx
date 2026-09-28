import React, { useMemo, useState } from 'react';
import { Alert, Platform, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { formatDuration } from '../utils/effort';
import { recipeTimerClock, recipeTimerResetPrompt } from '../utils/recipeTimer';
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
 *
 * **Sized for a knuckle, the same as `StepTimerRow`** (#2920's treatment,
 * carried over): these sit in the same card and the same cook mode footer as
 * the step timers, reached for the same way. Every control is 44pt with no
 * `hitSlop` reaching into a neighbour's; the countdown is `font.lg` with its
 * state after it ("12:30 left", `recipeTimerClock`); Pause and Resume are
 * glyphs, as there. Reset is the one that loses something, a time about to be
 * logged, so it sits furthest from the primary button behind a wider gap and
 * asks first (`recipeTimerResetPrompt`). The primary stays at the trailing
 * edge in every state, so Start becomes Pause under the same finger; the step
 * row's own order would put it a slot in once a cook is running, moving it out
 * from under the tap that started it.
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

  // The number big, the state small after it, once there's a clock to show;
  // before that, what starting it would do.
  const reading = recipeTimerClock({ hasTarget, running, paused, ready, elapsedSeconds, remainingSeconds });
  const idleLabel = hasTarget ? `${verb} for ${formatDuration(targetMinutes!)}` : idleText;
  const spoken = !reading
    ? idleLabel
    : ready ? `Time's up, ${reading.clock} over` : `${reading.clock} ${reading.state}`;
  const noun = verb.toLowerCase();

  // Asks while there's time on it to lose, which is always once it's shown.
  const handleReset = () => {
    const prompt = recipeTimerResetPrompt(verb, { running, elapsedSeconds });
    if (!prompt) { onReset(); return; }
    Alert.alert(prompt.title, prompt.message, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Reset timer', style: 'destructive', onPress: onReset },
    ]);
  };

  return (
    <View style={styles.timerRow}>
      <View style={styles.headerLine}>
        <TouchableOpacity
          style={styles.headerTap}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); animateLayout(); setExpanded(v => !v); }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${verb} timer, ${spoken}`}
          accessibilityHint="Double tap for the time it usually takes, and to log one by hand"
        >
          <Ionicons
            name={ready ? 'alarm' : 'timer-outline'}
            size={18}
            color={ready ? colors.orange : colors.accent}
          />
          {reading ? (
            <Text style={styles.labels} numberOfLines={1}>
              <Text style={[styles.clock, ready && styles.clockReady]}>{reading.clock}</Text>
              <Text style={[styles.clockState, ready && styles.clockStateReady]}> {reading.state}</Text>
            </Text>
          ) : (
            <Text style={[styles.labels, styles.idleLabel]} numberOfLines={1}>{idleLabel}</Text>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={iconSize.xs}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
        {/* Furthest from the primary button and a wider gap from its
            neighbour (`resetBtn`), with no hitSlop anywhere on the row: the
            three used to sit 8pt apart with overlapping hit areas, Reset right
            beside Pause. */}
        {inProgress && (
          <TouchableOpacity
            onPress={handleReset}
            style={[styles.secondaryBtn, styles.resetBtn]}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Reset ${noun} timer`}
          >
            <Ionicons name="refresh" size={iconSize.sm} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
        {inProgress && (
          <TouchableOpacity
            onPress={onLog}
            style={styles.secondaryBtn}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Done, log this ${noun} time`}
          >
            <Ionicons name="checkmark" size={iconSize.sm} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.primaryBtn, running && styles.primaryBtnRunning]}
          activeOpacity={interaction.activeOpacity}
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={
            running ? `Pause ${noun} timer` : paused ? `Resume ${noun} timer` : `Start ${noun} timer`
          }
        >
          <Ionicons name={running ? 'pause' : 'play'} size={iconSize.sm} color={colors.onAccent} />
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
                style={[styles.secondaryBtn, !manualMinutes && styles.manualLogBtnDisabled]}
                activeOpacity={interaction.activeOpacity}
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

/** Every control on the row is at least this tall and wide: the 44pt touch target. */
const TOUCH = 44;

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
  // surface rather than a chevron a cook has to aim at. As tall as the
  // controls beside it, so it's a 44pt target too.
  headerTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: TOUCH,
  },
  labels: {
    flex: 1,
  },
  // StepTimerRow's clock face, so the rows in one card read as one set.
  clock: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  clockReady: {
    color: colors.orange,
  },
  clockState: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  clockStateReady: {
    color: colors.orange,
  },
  // "Cook for 45m", "Time prep": a line of words rather than a clock, so a
  // step under the clock's size. Most recipes are never timed, and two idle
  // rows at clock size would shout on every one of them.
  idleLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  primaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
    width: TOUCH,
    height: TOUCH,
  },
  primaryBtnRunning: {
    backgroundColor: colors.orange,
  },
  secondaryBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // With the row's own gap, 16pt clear of the button beside it.
  resetBtn: {
    marginRight: spacing.sm,
  },
  details: {
    gap: spacing.xs,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  manualLabel: {
    color: colors.textSecondary,
    fontSize: font.sm,
    flex: 1,
  },
  manualInput: {
    minWidth: 64,
    height: TOUCH,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    color: colors.text,
    fontSize: font.md,
    textAlign: 'right',
  },
  manualLogBtnDisabled: {
    opacity: 0.5,
  },
  timerSummary: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
});
