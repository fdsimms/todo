import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, type Colors } from '../theme';
import { dayKeyToDate } from '../utils/dateUtils';
import { formatHour } from '../utils/rhythms';
import {
  axisToClockMinutes,
  formatClockMinutes,
  formatSleepDuration,
  sleepPlot,
  type SleepNight,
} from '../utils/sleepLog';

/**
 * The Sleep screen's two charts: when each day's main sleep happened, and how
 * long the day's sleep added up to.
 *
 * **Every day in the window gets a slot, recorded or not.** A day with nothing
 * from Health is an empty slot rather than a squeezed-out one, so a week with
 * two nights recorded reads as two nights and five gaps, not as two fat bars.
 * That is the same duty `WeightChart`'s dots discharge: the chart shows how
 * much of itself is data.
 *
 * The hours chart starts at zero, unlike `WeightChart`, because time asleep is
 * a quantity whose bar length *is* the number (`WeightChart`'s header draws the
 * same line between counts and a body's narrow band). The times chart has no
 * zero at all: its axis is the clock, from the earliest fall-asleep in the
 * window to the latest wake, read top to bottom the way the night went.
 *
 * Each chart is one accessibility element with a spoken summary, for the
 * reason `WeightChart` gives: ninety bars are a wall to swipe through.
 */

const CHART_HEIGHT = 150;
/** Room on the left for the axis labels. */
const AXIS_WIDTH = 44;
/** How much of each day's slot a bar fills. */
const BAR_FILL = 0.6;
const MIN_BAR_WIDTH = 2;
const GOAL_DASH = '4 4';

interface TimesProps {
  /** The window's day keys, oldest first, one per slot. */
  dayKeys: readonly string[];
  nights: readonly SleepNight[];
  use24Hour: boolean;
}

export function SleepTimesChart({ dayKeys, nights, use24Hour }: TimesProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const plot = useMemo(() => sleepPlot(nights), [nights]);
  if (!plot) return null;

  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const slot = dayKeys.length > 0 ? plotWidth / dayKeys.length : 0;
  const barWidth = Math.max(MIN_BAR_WIDTH, slot * BAR_FILL);
  const span = plot.domainEnd - plot.domainStart;
  const y = (axis: number) => ((axis - plot.domainStart) / span) * CHART_HEIGHT;
  const index = new Map(dayKeys.map((k, i) => [k, i]));

  // An hour line every 2 hours, or every 3 once the axis is long enough that
  // 2 would crowd the labels.
  const tickEvery = span > 14 * 60 ? 180 : 120;
  const ticks: number[] = [];
  for (let t = Math.ceil(plot.domainStart / tickEvery) * tickEvery; t <= plot.domainEnd; t += tickEvery) {
    ticks.push(t);
  }

  const summary = `Sleep times for ${nights.length} of the last ${dayKeys.length} days, falling asleep between ${
    formatClockMinutes(axisToClockMinutes(plot.domainStart), use24Hour)} and waking by ${
    formatClockMinutes(axisToClockMinutes(plot.domainEnd), use24Hour)}.`;

  return (
    <View accessible accessibilityLabel={summary} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ height: CHART_HEIGHT }}>
        {ticks.map(t => (
          <Text key={t} style={[styles.axisLabel, { top: y(t) - 7 }]}>
            {formatHour(Math.round(axisToClockMinutes(t) / 60), use24Hour)}
          </Text>
        ))}
        {width > 0 && (
          <Svg width={plotWidth} height={CHART_HEIGHT} style={styles.svg}>
            {ticks.map(t => (
              <Line key={t} x1={0} x2={plotWidth} y1={y(t)} y2={y(t)} stroke={colors.separator} strokeWidth={1} />
            ))}
            {plot.bars.map(bar => {
              const i = index.get(bar.dayKey);
              if (i === undefined) return null;
              const top = y(bar.from);
              return (
                <Rect
                  key={bar.dayKey}
                  x={i * slot + (slot - barWidth) / 2}
                  y={top}
                  width={barWidth}
                  height={Math.max(1, y(bar.to) - top)}
                  rx={Math.min(3, barWidth / 2)}
                  fill={colors.accent}
                />
              );
            })}
          </Svg>
        )}
      </View>
      <DayAxis dayKeys={dayKeys} styles={styles} />
    </View>
  );
}

interface HoursProps {
  dayKeys: readonly string[];
  nights: readonly SleepNight[];
  goalMinutes: number | null;
}

/** The hours chart's top never sits below this, so one short night isn't drawn full height. */
const MIN_HOURS_DOMAIN = 8 * 60;

export function SleepHoursChart({ dayKeys, nights, goalMinutes }: HoursProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  if (nights.length === 0) return null;

  const most = Math.max(...nights.map(n => n.minutes), goalMinutes ?? 0, MIN_HOURS_DOMAIN);
  const top = Math.ceil(most / 120) * 120;
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const slot = dayKeys.length > 0 ? plotWidth / dayKeys.length : 0;
  const barWidth = Math.max(MIN_BAR_WIDTH, slot * BAR_FILL);
  const y = (minutes: number) => CHART_HEIGHT - (minutes / top) * CHART_HEIGHT;
  const byDay = new Map(nights.map(n => [n.dayKey, n]));
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += 120) ticks.push(t);

  const summary = `Hours asleep for ${nights.length} of the last ${dayKeys.length} days${
    goalMinutes !== null ? `, against a goal of ${formatSleepDuration(goalMinutes)}` : ''}.`;

  return (
    <View accessible accessibilityLabel={summary} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ height: CHART_HEIGHT }}>
        {ticks.map(t => (
          <Text key={t} style={[styles.axisLabel, { top: y(t) - 7 }]}>{`${t / 60}h`}</Text>
        ))}
        {width > 0 && (
          <Svg width={plotWidth} height={CHART_HEIGHT} style={styles.svg}>
            {ticks.map(t => (
              <Line key={t} x1={0} x2={plotWidth} y1={y(t)} y2={y(t)} stroke={colors.separator} strokeWidth={1} />
            ))}
            {dayKeys.map((key, i) => {
              const night = byDay.get(key);
              if (!night) return null;
              const barTop = y(night.minutes);
              return (
                <Rect
                  key={key}
                  x={i * slot + (slot - barWidth) / 2}
                  y={barTop}
                  width={barWidth}
                  height={Math.max(1, CHART_HEIGHT - barTop)}
                  rx={Math.min(3, barWidth / 2)}
                  fill={colors.accent}
                />
              );
            })}
            {goalMinutes !== null && (
              <Line
                x1={0}
                x2={plotWidth}
                y1={y(goalMinutes)}
                y2={y(goalMinutes)}
                stroke={colors.text}
                strokeWidth={1.5}
                strokeDasharray={GOAL_DASH}
              />
            )}
          </Svg>
        )}
      </View>
      <DayAxis dayKeys={dayKeys} styles={styles} />
    </View>
  );
}

/** The window's first and last day under the plot. */
function DayAxis({ dayKeys, styles }: { dayKeys: readonly string[]; styles: ReturnType<typeof makeStyles> }) {
  if (dayKeys.length === 0) return null;
  return (
    <View style={styles.dayAxis}>
      <Text style={styles.dayLabel}>{format(dayKeyToDate(dayKeys[0]), 'MMM d')}</Text>
      <Text style={styles.dayLabel}>{format(dayKeyToDate(dayKeys[dayKeys.length - 1]), 'MMM d')}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
