import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { CardSheet, useCardSheet } from './CardSheet';
import { useLookAwayStore } from '../store/useLookAwayStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { playBeatSound } from '../utils/beatSound';
import { BUTTON_LABEL } from '../copy/shared';
import { lookAwayProgress, lookAwaySecondsLeft } from '../utils/lookAway';

const RING_SIZE = 150;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The countdown a tapped nudge opens (`Task.quotaCountdownSeconds`, 20 for a
 * 20/20/20 eye break), mounted once
 * at the app's root so it appears over whatever screen is up (the way
 * `AskClaudeHost` does). At zero it buzzes and chimes once, then waits for Done:
 * like a focus step, a countdown that runs out does not close itself.
 */
export function LookAwayHost() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const endsAt = useLookAwayStore(s => s.endsAt);
  const seconds = useLookAwayStore(s => s.seconds);
  const dismiss = useLookAwayStore(s => s.dismiss);

  // The run being shown, kept past `endsAt` going null so the card can fade out
  // still reading what it said rather than snapping to 20.
  const [shown, setShown] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const chimedFor = useRef<number | null>(null);

  useEffect(() => {
    if (endsAt !== null) setShown(endsAt);
  }, [endsAt]);

  useEffect(() => {
    if (endsAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const active = shown ?? Date.now();
  const left = lookAwaySecondsLeft(active, now);
  const done = shown !== null && left === 0;

  useEffect(() => {
    if (!done || shown === null || chimedFor.current === shown) return;
    chimedFor.current = shown;
    haptics.success();
    playBeatSound();
  }, [done, shown]);

  const finish = () => {
    haptics.tap();
    card.close(() => dismiss());
  };

  const progress = shown === null ? 0 : lookAwayProgress(shown, now, seconds);

  return (
    <CardSheet
      name="LookAwayHost"
      visible={endsAt !== null}
      controller={card}
      onRequestClose={() => finish()}
    >
      <View style={styles.card}>
        <Text style={styles.heading}>{done ? 'Break over' : 'Look away'}</Text>
        <View
          style={styles.ringWrap}
          accessible
          accessibilityRole="timer"
          accessibilityLabel={done ? 'Break over' : `${left} seconds left`}
        >
          <Svg width={RING_SIZE} height={RING_SIZE} style={styles.ring}>
            <Circle
              cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
              stroke={colors.accentSubtle} strokeWidth={RING_STROKE} fill="none"
            />
            <Circle
              cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
              stroke={colors.accent} strokeWidth={RING_STROKE} fill="none" strokeLinecap="round"
              strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
              strokeDashoffset={RING_LENGTH * progress}
              rotation={-90} origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
            />
          </Svg>
          <Text style={styles.count}>{done ? '✓' : left}</Text>
        </View>
        <Text style={styles.sub}>
          {done ? 'You can look back at the screen.' : `Look at something far away for ${seconds} seconds.`}
        </Text>
        <TouchableOpacity
          style={styles.button}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={done ? BUTTON_LABEL.done : 'Skip this break'}
          onPress={finish}
        >
          <Text style={styles.buttonText}>{done ? BUTTON_LABEL.done : 'Skip'}</Text>
        </TouchableOpacity>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { padding: spacing.md, alignItems: 'center' },
  heading: { color: colors.textSecondary, fontSize: font.md, marginBottom: spacing.sm },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center', marginVertical: spacing.smd },
  ring: { position: 'absolute' },
  // A hero number, which the font scale is not for (ui-design.md, "The font scale").
  count: { color: colors.text, fontSize: 44, fontWeight: fontWeight.semibold },
  sub: { color: colors.textSecondary, fontSize: font.sm, textAlign: 'center', marginBottom: spacing.md },
  button: {
    alignSelf: 'stretch',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
  },
  buttonText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
