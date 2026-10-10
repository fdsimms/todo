import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyToDate } from '../utils/dateUtils';
import { niceAxis, type NutrientDay } from '../utils/nutritionStats';

/**
 * One nutrient's total for each day, as bars: the Stats screen's view of how a
 * nutrient moves, beside the averages that flatten it.
 *
 * **Every day gets a slot, and a day that can't speak is a gap.** A null
 * `amount` (not logged past one meal, or a food that didn't state the
 * nutrient) draws nothing, never a zero bar, so a week with three usable days
 * reads as three bars and four gaps. The same rule `SleepChart` follows, and
 * the one `nutritionStats.ts` states: an unlogged day is not a day of nothing.
 *
 * **Bars from zero, in one colour, with no target line.** Calories or protein
 * is a quantity whose bar length is the number, so the baseline is zero (the
 * line/bar split `WeightChart`'s header explains). The bars are neutral
 * accent and the daily target is deliberately not drawn: a month of days laid
 * against a target is the report card `nutritionStats.ts` refuses to produce.
 *
 * One accessibility element with a spoken summary rather than a bar each, for
 * the reason `WeightChart` gives.
 *
 * **Touch-and-drag reads out a day.** A finger over the plot snaps to the
 * nearest day that has a bar and shows its date and total: the number already
 * drawn, said for one day. Nothing more (no target, no verdict). The scrub is
 * a `PanResponder` on a childless overlay exactly over the plot, so
 * `locationX` is relative to the plot rather than to whichever child was hit;
 * it adds no accessibility element, so the spoken summary stays the only one.
 */

const CHART_HEIGHT = 150;
/** Room on the left for the axis labels. */
const AXIS_WIDTH = 44;
const BAR_FILL = 0.6;
const MIN_BAR_WIDTH = 2;
/** Fixed rather than measured, so the tooltip doesn't reflow as it appears. */
const TOOLTIP_WIDTH = 120;
const TOOLTIP_HEIGHT = 24;

interface Props {
  /** One entry per day, oldest first (`nutrientDailySeries`). */
  days: readonly NutrientDay[];
  /** "Calories", as the heading and summary name it. */
  label: string;
  /** "cal", "g" or "mg", as the axis and summary write it. */
  unit: string;
}

export function NutrientDayChart({ days, label, unit }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);

  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const scrubIndexRef = useRef<number | null>(null);
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const slot = days.length > 0 ? plotWidth / days.length : 0;

  const scrubTo = (event: GestureResponderEvent) => {
    if (slot === 0) return;
    const x = event.nativeEvent.locationX;
    let nearest: number | null = null;
    let nearestDistance = Infinity;
    for (let i = 0; i < days.length; i++) {
      if (days[i].amount === null) continue;
      const distance = Math.abs((i + 0.5) * slot - x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    if (nearest !== scrubIndexRef.current) haptics.dragTick();
    scrubIndexRef.current = nearest;
    setScrubIndex(nearest);
  };

  const endScrub = () => {
    scrubIndexRef.current = null;
    setScrubIndex(null);
  };

  const panResponder = useMemo(() => PanResponder.create({
    // Claimed on touch-down so a plain tap shows a day, the trade
    // `WeightChart` documents: a scroll that starts on the plot becomes a scrub.
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: scrubTo,
    onPanResponderMove: scrubTo,
    onPanResponderRelease: endScrub,
    onPanResponderTerminate: endScrub,
    onPanResponderTerminationRequest: () => false,
  }), [days, slot]);

  const stated = days.filter(d => d.amount !== null);
  if (stated.length === 0) return null;

  const most = Math.max(...stated.map(d => d.amount as number));
  const { top, step } = niceAxis(most);
  const barWidth = Math.max(MIN_BAR_WIDTH, slot * BAR_FILL);
  const y = (amount: number) => CHART_HEIGHT - (amount / top) * CHART_HEIGHT;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);

  const scrubbed = scrubIndex !== null ? days[scrubIndex] : null;
  const tooltipLeft = scrubIndex !== null
    ? AXIS_WIDTH + Math.min(Math.max((scrubIndex + 0.5) * slot - TOOLTIP_WIDTH / 2, 0), Math.max(plotWidth - TOOLTIP_WIDTH, 0))
    : 0;
  const suffix = unit === 'cal' ? ' cal' : unit;
  const summary = `${label} for ${stated.length} of the last ${days.length} days, `
    + `from ${Math.round(Math.min(...stated.map(d => d.amount as number))).toLocaleString()}${suffix} `
    + `to ${Math.round(most).toLocaleString()}${suffix}.`;

  return (
    <View style={styles.wrap} accessible accessibilityLabel={summary} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ height: CHART_HEIGHT }}>
        {ticks.map(t => (
          <Text key={t} style={[styles.axisLabel, { top: y(t) - 7 }]}>{t.toLocaleString()}</Text>
        ))}
        {width > 0 && (
          <Svg width={plotWidth} height={CHART_HEIGHT} style={styles.svg}>
            {ticks.map(t => (
              <Line key={t} x1={0} x2={plotWidth} y1={y(t)} y2={y(t)} stroke={colors.separator} strokeWidth={1} />
            ))}
            {days.map((day, i) => {
              if (day.amount === null) return null;
              const barTop = y(day.amount);
              return (
                <Rect
                  key={day.dayKey}
                  x={i * slot + (slot - barWidth) / 2}
                  y={barTop}
                  width={barWidth}
                  height={Math.max(1, CHART_HEIGHT - barTop)}
                  rx={Math.min(3, barWidth / 2)}
                  fill={colors.accent}
                />
              );
            })}
            {scrubbed && (
              <Line
                x1={(scrubIndex as number + 0.5) * slot}
                x2={(scrubIndex as number + 0.5) * slot}
                y1={0}
                y2={CHART_HEIGHT}
                stroke={colors.textTertiary}
                strokeWidth={1}
              />
            )}
          </Svg>
        )}
        <View style={styles.touch} {...panResponder.panHandlers} />
        {scrubbed && (
          <View
            style={[styles.tooltip, { left: tooltipLeft, top: Math.max(0, y(scrubbed.amount as number) - TOOLTIP_HEIGHT - spacing.xs) }]}
            pointerEvents="none"
          >
            <Text style={styles.tooltipText}>
              {format(dayKeyToDate(scrubbed.dayKey), 'MMM d')} · {Math.round(scrubbed.amount as number).toLocaleString()}{suffix}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.dayAxis}>
        <Text style={styles.dayLabel}>{format(dayKeyToDate(days[0].dayKey), 'MMM d')}</Text>
        <Text style={styles.dayLabel}>{format(dayKeyToDate(days[days.length - 1].dayKey), 'MMM d')}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Room for the top axis label, which is centered on the top gridline.
  wrap: { paddingTop: spacing.sm },
  touch: { position: 'absolute', left: AXIS_WIDTH, right: 0, top: 0, bottom: 0 },
  tooltip: {
    position: 'absolute',
    width: TOOLTIP_WIDTH,
    height: TOOLTIP_HEIGHT,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  tooltipText: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  svg: { position: 'absolute', left: AXIS_WIDTH, top: 0 },
  axisLabel: {
    position: 'absolute',
    left: 0,
    width: AXIS_WIDTH - spacing.xs,
    fontSize: font.xxs,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  dayAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: AXIS_WIDTH,
    marginTop: spacing.xs,
  },
  dayLabel: { fontSize: font.xxs, color: colors.textSecondary },
});
