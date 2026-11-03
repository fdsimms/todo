import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { CountStepper } from './CountStepper';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { REST_PRESETS } from './ExerciseRestSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';
import { REST_SECONDS_MAX, REST_SECONDS_MIN, formatRestSeconds } from '../utils/workoutData';

interface Props {
  visible: boolean;
  /** Where the length starts each time the card opens: the default rest setting. */
  initialSeconds: number;
  /** Starts the timer. The card closes after it. */
  onStart: (seconds: number) => void;
  onClose: () => void;
}

/**
 * A timer started by hand, from workout mode's header: for a rest the sets
 * didn't start (a warm-up, a superset swap, a break between exercises). It
 * runs as the workout's rest, so it shows in the same strip, replaces the rest
 * going and rings the same way. A short card because it is one number.
 */
export function ManualRestSheet({ visible, initialSeconds, onStart, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [seconds, setSeconds] = useState(initialSeconds);
  // Reseed on each opening, so a length typed last time doesn't linger.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setSeconds(Math.max(REST_SECONDS_MIN, initialSeconds));
  }

  return (
    <CardSheet name="ManualRestSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} minWidth={56} />
          <Text style={styles.heading}>Timer</Text>
          <View style={styles.headerSpacer} />
        </View>
        <HelpText style={styles.sub}>Counts down like a rest between sets and replaces the one that’s running.</HelpText>

        <View style={styles.stepper}>
          <CountStepper
            value={seconds}
            onChange={n => setSeconds(n ?? REST_SECONDS_MIN)}
            min={REST_SECONDS_MIN}
            max={REST_SECONDS_MAX}
            step={15}
            format={formatRestSeconds}
            label="Timer length"
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
                onPress={() => { haptics.tap(); setSeconds(p); }}
                accessibilityRole="button"
                accessibilityLabel={`${formatRestSeconds(p)} timer`}
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.presetText, on && styles.presetTextOn]}>{formatRestSeconds(p)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.actions}>
          <InlineAction
            label={`Start ${formatRestSeconds(seconds)}`}
            onPress={() => { haptics.tap(); card.close(() => { onStart(seconds); onClose(); }); }}
            accessibilityLabel={`Start a ${formatRestSeconds(seconds)} timer`}
          />
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
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
});
