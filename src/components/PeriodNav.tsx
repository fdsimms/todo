import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, type Colors } from '../theme';
import { PressableScale } from './PressableScale';

interface Props {
  /** The period currently on screen — "August 2026", "Aug 23 – 29". */
  label: string;
  onPrev: () => void;
  onNext: () => void;
  /** Spoken labels for the two icon-only buttons ("Previous week"/"Next week"). */
  prevAccessibilityLabel: string;
  nextAccessibilityLabel: string;
}

/**
 * The `‹ label ›` stepper that sits directly under a screen's header and
 * moves it one period at a time: the calendar's month, the meal plan's week.
 *
 * It belongs below the header rather than in its action row. `ScreenHeader`'s
 * actions are 34pt icon buttons in a horizontal run, so a pair of chevrons
 * there reads as two more of whatever the rest of that run is (copy, share,
 * jump to today) instead of as one control with a direction, and the period
 * they move has to be named separately in the overline. Here the two arrows
 * flank the thing they change, which is also what makes the label the row's
 * subject rather than a caption above the title.
 *
 * Neither button fires a haptic — both call sites do it in their own handler,
 * alongside the state they clear when the period changes.
 */
export function PeriodNav({ label, onPrev, onNext, prevAccessibilityLabel, nextAccessibilityLabel }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.nav}>
      <PressableScale style={styles.btn} onPress={onPrev} accessibilityLabel={prevAccessibilityLabel}>
        <Ionicons name="chevron-back" size={iconSize.md} color={colors.accent} />
      </PressableScale>
      <Text style={styles.label}>{label}</Text>
      <PressableScale style={styles.btn} onPress={onNext} accessibilityLabel={nextAccessibilityLabel}>
        <Ionicons name="chevron-forward" size={iconSize.md} color={colors.accent} />
      </PressableScale>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    nav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      // Padded on both sides rather than only below, so this row never reads
      // as flush with whatever precedes it — the calendar's header, the meal
      // plan's fridge card.
      paddingTop: spacing.xs,
      paddingBottom: spacing.xs,
    },
    btn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
  });
