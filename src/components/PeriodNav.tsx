import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, radius, type Colors } from '../theme';
import { PressableScale } from './PressableScale';

interface Props {
  /** The period currently on screen — "August 2026", "Aug 23 – 29". */
  label: string;
  onPrev: () => void;
  onNext: () => void;
  /** Spoken labels for the two icon-only buttons ("Previous week"/"Next week"). */
  prevAccessibilityLabel: string;
  nextAccessibilityLabel: string;
  /**
   * A small caption under the label — "This week" — for the one case the
   * label alone can't say: that the period on screen is the current one.
   * Pass it only while that's true; omitting it (the default) leaves this
   * row exactly as it was for every period that isn't.
   */
  sublabel?: string;
  /**
   * Draws the arrows and label as one `bgSecondary` capsule instead of
   * spreading the arrows to the row's full width. The plain layout reads fine
   * under a header, where the title above already gives the row something to
   * sit against; with nothing above it but another card (the meal plan's
   * fridge), two arrows anchored to the edges left a wide stretch of bare
   * background between them and the label, and looked like empty space
   * rather than a control. Default false so Calendar's layout is unchanged.
   */
  grouped?: boolean;
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
export function PeriodNav({
  label,
  onPrev,
  onNext,
  prevAccessibilityLabel,
  nextAccessibilityLabel,
  sublabel,
  grouped = false,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const labelBlock = sublabel ? (
    <View style={styles.labelBlock}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.sublabel}>{sublabel}</Text>
    </View>
  ) : (
    <Text style={styles.label}>{label}</Text>
  );

  const arrows = (
    <>
      <PressableScale hitSlop={8} style={styles.btn} onPress={onPrev} accessibilityLabel={prevAccessibilityLabel}>
        <Ionicons name="chevron-back" size={iconSize.md} color={colors.accent} />
      </PressableScale>
      {labelBlock}
      <PressableScale hitSlop={8} style={styles.btn} onPress={onNext} accessibilityLabel={nextAccessibilityLabel}>
        <Ionicons name="chevron-forward" size={iconSize.md} color={colors.accent} />
      </PressableScale>
    </>
  );

  if (grouped) {
    return (
      <View style={styles.navGrouped}>
        <View style={styles.pill}>{arrows}</View>
      </View>
    );
  }

  return <View style={styles.nav}>{arrows}</View>;
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
      textAlign: 'center',
    },
    labelBlock: {
      alignItems: 'center',
    },
    sublabel: {
      color: colors.textSecondary,
      fontSize: font.xxs,
      fontWeight: fontWeight.medium,
    },
    navGrouped: {
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.xs,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
    },
  });
