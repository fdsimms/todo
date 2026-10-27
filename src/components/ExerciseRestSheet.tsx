import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { CountStepper } from './CountStepper';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';
import { REST_SECONDS_MAX, formatRestSeconds } from '../utils/workoutData';

/** The rests offered as one tap, in seconds. */
export const REST_PRESETS: readonly number[] = [30, 60, 90, 120, 180];

interface Props {
  visible: boolean;
  exerciseName: string;
  /** The rest in effect now, in seconds. 0 is no rest. */
  seconds: number;
  /** What "Use default" goes back to: the routine's rest for it, else the setting. */
  fallbackSeconds: number;
  /** Whether a rest was set in this workout, which is when "Use default" has something to undo. */
  overridden: boolean;
  /** Every change is applied as it is made. Null goes back to the fallback. */
  onChange: (seconds: number | null) => void;
  onClose: () => void;
}

/**
 * The rest after each set of one exercise, for this workout only: workout
 * mode's Rest chip opens it. A short card rather than a bottom sheet because
 * it is one number. Every tap commits straight through `onChange`, so there is
 * nothing to save and no unsaved-changes guard; Done only closes it.
 */
export function ExerciseRestSheet({ visible, exerciseName, seconds, fallbackSeconds, overridden, onChange, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);

  return (
    <CardSheet name="ExerciseRestSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerSpacer} />
          <Text style={styles.heading}>Rest between sets</Text>
          <SheetHeaderButton label={BUTTON_LABEL.done} onPress={dismiss} minWidth={56} style={styles.headerRight} />
        </View>
        <HelpText style={styles.sub}>{`${exerciseName}, for this workout only. The routine isn’t changed.`}</HelpText>

        <View style={styles.stepper}>
          <CountStepper
            value={seconds}
            onChange={n => onChange(n ?? 0)}
            min={0}
            max={REST_SECONDS_MAX}
            step={15}
            format={n => (n === 0 ? 'None' : formatRestSeconds(n))}
            label="Rest between sets"
          />
        </View>

        <View style={styles.presets}>
          {REST_PRESETS.map(p => {
            const on = p === seconds;
            return (
              <TouchableOpacity
                key={p}
                style={[styles.preset, on && styles.presetOn]}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); onChange(p); }}
                accessibilityRole="button"
                accessibilityLabel={`${formatRestSeconds(p)} of rest`}
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.presetText, on && styles.presetTextOn]}>{formatRestSeconds(p)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.actions}>
          <InlineAction
            label="No rest"
            variant="neutral"
            onPress={() => { haptics.tap(); onChange(0); }}
            accessibilityLabel="No rest after sets of this exercise"
          />
          {overridden && (
            <InlineAction
              label={`Use default (${fallbackSeconds === 0 ? 'none' : formatRestSeconds(fallbackSeconds)})`}
              variant="neutral"
              onPress={() => { haptics.tap(); onChange(null); }}
              accessibilityLabel="Go back to the default rest for this exercise"
            />
          )}
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  headerSpacer: { minWidth: 56 },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  sub: { color: colors.textTertiary, fontSize: font.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, textAlign: 'center' },
  stepper: { alignItems: 'center', paddingTop: spacing.md, paddingHorizontal: spacing.md },
  presets: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  preset: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.smd,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  presetOn: { backgroundColor: colors.accent },
  presetText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  presetTextOn: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
});
