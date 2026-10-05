import React, { useMemo } from 'react';
import { Alert, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { StepTimer } from '../types';
import { ProgressBar } from './ProgressBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import {
  formatStepTimerClock,
  isStepTimerReady,
  isStepTimerRunning,
  stepTimerCancelPrompt,
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
 *
 * **Sized for a knuckle, not a fingertip** (#2920), and `RecipeTimerRow` has
 * since taken the same sizes, so the rows in one card still match. These rows are
 * reached for mid-cook with the hands full, often two or three at once, so:
 * every control is at least 44pt with no `hitSlop` reaching into its
 * neighbour's; Cancel sits a wider gap away from Pause and asks first while
 * there is time left to lose (`stepTimerCancelPrompt`); the countdown is
 * `font.lg`; and a full-width line under the controls names the step by its
 * own words (`stepExcerpt`) ahead of "Step 5 of 12", so two rows say which
 * pan is which.
 * Pause and Resume are glyphs rather than words to make that room, with the
 * state spelled out after the clock ("12:30 paused").
 */
export function StepTimerRow({ timer, now, hideRecipeName, onToggle, onAddTime, onRestart, onRemove }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const running = isStepTimerRunning(timer);
  const ready = isStepTimerReady(timer, now);
  const remaining = stepTimerRemaining(timer, now);

  // The number big, the state small after it: "12:30 left", "12:30 paused",
  // "0:45 over" (the last in orange, with "Time's up" leading the line below).
  const clock = formatStepTimerClock(ready ? -remaining : remaining);
  const state = ready ? 'over' : running ? 'left' : 'paused';

  const context = [hideRecipeName ? '' : timer.recipeName, timer.stepExcerpt, timer.stepLabel]
    .filter(Boolean)
    .join(' · ');
  const name = timer.stepLabel || 'step';

  // Asks while there's time left to lose; a rung timer is only being dismissed.
  const handleRemove = () => {
    const prompt = stepTimerCancelPrompt(timer, Date.now());
    if (!prompt) { onRemove(); return; }
    Alert.alert(prompt.title, prompt.message, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel timer', style: 'destructive', onPress: onRemove },
    ]);
  };

  return (
    <View style={styles.row}>
      <View style={styles.headerLine}>
        <Ionicons
          name={ready ? 'alarm' : 'timer-outline'}
          size={18}
          color={ready ? colors.orangeText : colors.accent}
        />
        <Text
          style={styles.labels}
          numberOfLines={1}
          accessibilityLabel={ready ? `Time's up, ${clock} over` : `${clock} ${state}`}
        >
          <Text style={[styles.clock, ready && styles.clockReady]}>{clock}</Text>
          <Text style={[styles.clockState, ready && styles.clockStateReady]}> {state}</Text>
        </Text>

        <TouchableOpacity
          onPress={onAddTime}
          style={styles.secondaryBtn}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Add a minute to the ${name} timer`}
        >
          <Text style={styles.secondaryBtnText}>+1m</Text>
        </TouchableOpacity>

        {ready ? (
          <TouchableOpacity
            style={[styles.primaryBtn, styles.primaryBtnWide]}
            activeOpacity={interaction.activeOpacity}
            onPress={onRestart}
            accessibilityRole="button"
            accessibilityLabel={`Start the ${name} timer again`}
          >
            <Ionicons name="refresh" size={14} color={colors.onAccent} />
            <Text style={styles.primaryBtnText}>Again</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, running && styles.primaryBtnRunning]}
            activeOpacity={interaction.activeOpacity}
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityLabel={`${running ? 'Pause' : 'Resume'} the ${name} timer`}
          >
            <Ionicons name={running ? 'pause' : 'play'} size={iconSize.sm} color={colors.onAccent} />
          </TouchableOpacity>
        )}

        {/* Set a wider gap apart from the button beside it (`removeBtn`),
            and no hitSlop on either: the two used to sit 8pt apart with
            overlapping hit areas, so a knuckle meant for Pause could land on
            Cancel. */}
        <TouchableOpacity
          onPress={ready ? onRemove : handleRemove}
          style={[styles.secondaryBtn, styles.removeBtn]}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={ready ? `Dismiss the ${name} timer` : `Cancel the ${name} timer`}
        >
          <Ionicons
            name={ready ? 'checkmark' : 'close'}
            size={iconSize.sm}
            color={ready ? colors.textSecondary : colors.textTertiary}
          />
        </TouchableOpacity>
      </View>
      {/* Its own full-width line rather than squeezed under the clock beside
          three 44pt controls, where the excerpt came out as "Simmer the r…":
          the words are what say which pan this is, so they get the row. */}
      {(ready || !!context) && (
        <Text style={styles.context} numberOfLines={1}>
          {ready && <Text style={styles.contextReady}>Time's up{context ? ' · ' : ''}</Text>}
          {context}
        </Text>
      )}
      <ProgressBar progress={stepTimerProgress(timer, now)} height={4} />
    </View>
  );
}

/** Every control on the row is at least this tall and wide: the 44pt touch target. */
const TOUCH = 44;

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
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  clockReady: {
    color: colors.orangeText,
  },
  clockState: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  clockStateReady: {
    color: colors.orangeText,
  },
  context: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  contextReady: {
    color: colors.orangeText,
    fontWeight: fontWeight.semibold,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xsm,
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
    minWidth: TOUCH,
    height: TOUCH,
  },
  primaryBtnWide: {
    paddingHorizontal: spacing.smd,
  },
  primaryBtnRunning: {
    backgroundColor: colors.orangeFill,
  },
  primaryBtnText: {
    color: colors.onAccent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  secondaryBtn: {
    minWidth: TOUCH,
    height: TOUCH,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // With the row's own gap, 16pt clear of the button beside it.
  removeBtn: {
    marginLeft: spacing.sm,
  },
  secondaryBtnText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
});
