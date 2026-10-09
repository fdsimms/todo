import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, type Colors } from '../theme';
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
 */

const CHART_HEIGHT = 150;
/** Room on the left for the axis labels. */
const AXIS_WIDTH = 44;
const BAR_FILL = 0.6;
const MIN_BAR_WIDTH = 2;

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

  const stated = days.filter(d => d.amount !== null);
  if (stated.length === 0) return null;

  const most = Math.max(...stated.map(d => d.amount as number));
  const { top, step } = niceAxis(most);
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const slot = plotWidth / days.length;
  const barWidth = Math.max(MIN_BAR_WIDTH, slot * BAR_FILL);
  const y = (amount: number) => CHART_HEIGHT - (amount / top) * CHART_HEIGHT;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);

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
          </Svg>
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
