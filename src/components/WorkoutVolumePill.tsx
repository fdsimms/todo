// The running total of weight lifted, in a pill under the workout screen's header.
// It bounces and shows what the set just ticked added (`+225`) for a moment, so
// logging a set pays off. Nothing happens on the first render, so reopening a
// session in progress doesn't celebrate sets from earlier.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';
import { kgToUnit, type WeightUnit } from '../utils/weightLog';
import { withThousands } from '../utils/workoutRecordText';

/** How long the "+225" badge stays after a set, and how long the number takes to climb. */
const DELTA_MS = 2500;
const COUNT_MS = 350;

interface Props {
  /** `liftVolumeKg` over the session's sets. Null renders nothing. */
  volumeKg: number | null;
  unit: WeightUnit;
}

export function WorkoutVolumePill({ volumeKg, unit }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const target = volumeKg === null ? null : Math.round(kgToUnit(volumeKg, unit));

  const [shown, setShown] = useState<number | null>(target);
  const [delta, setDelta] = useState<number | null>(null);
  const previous = useRef(target);
  const scale = useSharedValue(1);
  const bump = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (target === null || from === null || target <= from) {
      setShown(target);
      setDelta(null);
      return;
    }
    setDelta(target - from);
    const hide = setTimeout(() => setDelta(null), DELTA_MS);
    if (reduceMotion) {
      setShown(target);
      return () => clearTimeout(hide);
    }
    scale.value = withSequence(withTiming(1.06, { duration: 110 }), withSpring(1, animation.spring.smooth));
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / COUNT_MS);
      setShown(Math.round(from + (target - from) * t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { clearTimeout(hide); cancelAnimationFrame(frame); };
  }, [target, reduceMotion, scale]);

  if (target === null || shown === null) return null;
  const total = withThousands(target);
  return (
    <Reanimated.View
      style={[styles.pill, bump]}
      accessible
      accessibilityLabel={`${total} ${unit} lifted so far`}
    >
      <Ionicons name="barbell" size={iconSize.md} color={colors.accentText} />
      <Text style={styles.total}>{`${withThousands(shown)} ${unit}`}</Text>
      <Text style={styles.label}>lifted</Text>
      {delta !== null && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{`+${withThousands(delta)}`}</Text>
        </View>
      )}
    </Reanimated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginBottom: spacing.smd, paddingVertical: spacing.sm, paddingHorizontal: spacing.smd,
    borderRadius: radius.full, backgroundColor: colors.accentSubtle,
  },
  total: { color: colors.accentText, fontSize: font.lg, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  label: { color: colors.textSecondary, fontSize: font.sm },
  badge: { backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  badgeText: { color: colors.onAccent, fontSize: font.xs, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
});
