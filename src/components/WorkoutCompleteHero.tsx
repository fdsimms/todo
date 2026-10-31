import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, radius, spacing, type Colors } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

interface Props {
  /** The line under the title, e.g. "Started 9:28 AM". */
  subtitle: string;
  /** Records this workout set; 0 draws no pill. */
  records: number;
}

const BADGE = 88;
const CHECK = 52;

/**
 * The top of the finish summary: a gold check that springs in, "Workout
 * complete", and a pill when the workout set a personal record. Gold is
 * `colors.done`, the colour of finishing, so this reads as the same thing the
 * task checkbox does. With Reduce Motion on it appears settled.
 */
export function WorkoutCompleteHero({ subtitle, records }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const pop = useSharedValue(reduceMotion ? 1 : 0);
  const text = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      pop.value = 1;
      text.value = 1;
      return;
    }
    pop.value = withSpring(1, animation.spring.bouncy);
    text.value = withDelay(180, withTiming(1, { duration: 280 }));
  }, [reduceMotion, pop, text]);

  const badgeStyle = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ scale: 0.4 + 0.6 * pop.value }] }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: 0.22 * pop.value, transform: [{ scale: 0.6 + 0.4 * pop.value }] }));
  const textStyle = useAnimatedStyle(() => ({ opacity: text.value, transform: [{ translateY: (1 - text.value) * 8 }] }));

  return (
    <View style={styles.wrap} accessible accessibilityRole="header" accessibilityLabel={`Workout complete. ${subtitle}${records > 0 ? `. ${records} personal ${records === 1 ? 'record' : 'records'}` : ''}`}>
      <View style={styles.badgeBox}>
        <Reanimated.View style={[styles.halo, haloStyle]} />
        <Reanimated.View style={[styles.badge, badgeStyle]}>
          <Ionicons name="checkmark" size={CHECK} color={colors.onDone} />
        </Reanimated.View>
      </View>
      <Reanimated.View style={[styles.textBlock, textStyle]}>
        <Text style={styles.title}>Workout complete</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {records > 0 && (
          <View style={styles.pill}>
            <Text style={styles.pillText}>{`${records} personal ${records === 1 ? 'record' : 'records'}`}</Text>
          </View>
        )}
      </Reanimated.View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: spacing.lg, paddingBottom: spacing.md },
  badgeBox: { width: BADGE + 24, height: BADGE + 24, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: BADGE + 24, height: BADGE + 24, borderRadius: (BADGE + 24) / 2, backgroundColor: colors.done },
  badge: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, backgroundColor: colors.done, alignItems: 'center', justifyContent: 'center' },
  textBlock: { alignItems: 'center', marginTop: spacing.smd },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold },
  subtitle: { color: colors.textSecondary, fontSize: font.md, marginTop: spacing.xs },
  pill: { marginTop: spacing.smd, paddingHorizontal: spacing.smd, paddingVertical: spacing.xsm, borderRadius: radius.full, backgroundColor: colors.accentSubtle },
  pillText: { color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold },
});
