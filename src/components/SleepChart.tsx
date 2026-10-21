import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyToDate } from '../utils/dateUtils';
import { formatHour } from '../utils/rhythms';
import {
  SLEEP_STAGE_LABEL,
  SLEEP_STAGE_ORDER,
  type SleepStages,
  axisToClockMinutes,
  formatClockMinutes,
  formatSleepDuration,
  sleepPlot,
  timelineTicks,
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
 *
 * **Touch-and-drag reads out a day**, the way `NutrientDayChart` does: a finger
 * over the plot snaps to the nearest day that has a bar and says that night's
 * figures. It adds nothing the chart doesn't already hold (no goal verdict, no
 * "good" or "short"). The scrub is a `PanResponder` on a childless overlay
 * exactly over the plot, so it adds no accessibility element.
 */

const CHART_HEIGHT = 150;
/** Fixed rather than measured, so the tooltip doesn't reflow as it appears. */
const TOOLTIP_WIDTH = 150;
const TOOLTIP_LINE_HEIGHT = 16;

/**
 * Which day a finger is over, snapped to the nearest day that has a bar. The
 * host turns its scroll view off through `onScrubChange`: a native scroll view
 * yields only to a responder that is its ancestor, and this one is a descendant.
 */
function useDayScrub(
  hasBar: readonly boolean[],
  slot: number,
  onScrubChange: ((scrubbing: boolean) => void) | undefined,
) {
  const [index, setIndex] = useState<number | null>(null);
  const indexRef = useRef<number | null>(null);
  const onScrubChangeRef = useRef(onScrubChange);
  onScrubChangeRef.current = onScrubChange;

  const panHandlers = useMemo(() => {
    const scrubTo = (event: GestureResponderEvent) => {
      if (slot === 0) return;
      const x = event.nativeEvent.locationX;
      let nearest: number | null = null;
      let nearestDistance = Infinity;
      for (let i = 0; i < hasBar.length; i++) {
        if (!hasBar[i]) continue;
        const distance = Math.abs((i + 0.5) * slot - x);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = i;
        }
      }
      if (nearest !== indexRef.current) haptics.dragTick();
      indexRef.current = nearest;
      setIndex(nearest);
    };
    const endScrub = () => {
      indexRef.current = null;
      setIndex(null);
      onScrubChangeRef.current?.(false);
    };
    return PanResponder.create({
      // Claimed on touch-down so a plain tap shows a day, the trade
      // `WeightChart` documents: a scroll that starts on the plot becomes a scrub.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event => {
        onScrubChangeRef.current?.(true);
        scrubTo(event);
      },
      onPanResponderMove: scrubTo,
      onPanResponderRelease: endScrub,
      onPanResponderTerminate: endScrub,
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  }, [hasBar, slot]);

  return { index, panHandlers };
}

/** Where the tooltip's left edge goes so it stays over the plot. */
function tooltipLeftFor(index: number, slot: number, plotWidth: number): number {
  return AXIS_WIDTH + Math.min(
    Math.max((index + 0.5) * slot - TOOLTIP_WIDTH / 2, 0),
    Math.max(plotWidth - TOOLTIP_WIDTH, 0),
  );
}
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
  /** Fires true while a finger is on the plot, so the host can turn its scroll off. */
  onScrubChange?: (scrubbing: boolean) => void;
}

export function SleepTimesChart({ dayKeys, nights, use24Hour, onScrubChange }: TimesProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const plot = useMemo(() => sleepPlot(nights), [nights]);
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const slot = dayKeys.length > 0 ? plotWidth / dayKeys.length : 0;
  const hasBar = useMemo(() => {
    const recorded = new Set(nights.map(n => n.dayKey));
    return dayKeys.map(k => recorded.has(k));
  }, [dayKeys, nights]);
  const scrub = useDayScrub(hasBar, slot, onScrubChange);
  if (!plot) return null;

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

  const scrubbedNight = scrub.index !== null
    ? nights.find(n => n.dayKey === dayKeys[scrub.index as number]) ?? null
    : null;
  const scrubbedBar = scrubbedNight ? plot.bars.find(b => b.dayKey === scrubbedNight.dayKey) ?? null : null;
  const napMinutes = scrubbedNight ? scrubbedNight.minutes - scrubbedNight.mainMinutes : 0;
  const hasNap = Math.round(napMinutes) >= 1;

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
            {scrub.index !== null && scrubbedNight && (
              <Line
                x1={(scrub.index + 0.5) * slot}
                x2={(scrub.index + 0.5) * slot}
                y1={0}
                y2={CHART_HEIGHT}
                stroke={colors.textTertiary}
                strokeWidth={1}
              />
            )}
          </Svg>
        )}
        <View style={styles.touch} {...scrub.panHandlers} />
        {scrub.index !== null && scrubbedNight && scrubbedBar && (() => {
          const lines = hasNap ? 3 : 2;
          const height = lines * TOOLTIP_LINE_HEIGHT + spacing.xs * 2;
          const barTop = y(scrubbedBar.from);
          const barBottom = y(scrubbedBar.to);
          // Beside the bar's own ends rather than over it: above it when
          // there's room, otherwise below, otherwise pinned to the top.
          const top = barTop - height - spacing.xs >= 0
            ? barTop - height - spacing.xs
            : barBottom + spacing.xs + height <= CHART_HEIGHT
              ? barBottom + spacing.xs
              : 0;
          return (
            <View
              style={[styles.tooltip, { left: tooltipLeftFor(scrub.index, slot, plotWidth), top, height }]}
              pointerEvents="none"
            >
              <Text style={styles.tooltipText}>
                {format(dayKeyToDate(scrubbedNight.dayKey), 'MMM d')} · {formatSleepDuration(scrubbedNight.mainMinutes)}
              </Text>
              <Text style={styles.tooltipDetail}>
                {formatClockMinutes(clockOf(scrubbedNight.asleepAt), use24Hour)} to {formatClockMinutes(clockOf(scrubbedNight.wokeAt), use24Hour)}
              </Text>
              {hasNap && (
                <Text style={styles.tooltipDetail}>{formatSleepDuration(scrubbedNight.minutes)} with naps</Text>
              )}
            </View>
          );
        })()}
      </View>
      <DayAxis dayKeys={dayKeys} styles={styles} />
    </View>
  );
}

/** A moment's clock time as minutes after midnight, in the device's zone. */
function clockOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

interface HoursProps {
  dayKeys: readonly string[];
  nights: readonly SleepNight[];
  goalMinutes: number | null;
  onScrubChange?: (scrubbing: boolean) => void;
}

/** The hours chart's top never sits below this, so one short night isn't drawn full height. */
const MIN_HOURS_DOMAIN = 8 * 60;

export function SleepHoursChart({ dayKeys, nights, goalMinutes, onScrubChange }: HoursProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const slot = dayKeys.length > 0 ? plotWidth / dayKeys.length : 0;
  const hasBar = useMemo(() => {
    const recorded = new Set(nights.map(n => n.dayKey));
    return dayKeys.map(k => recorded.has(k));
  }, [dayKeys, nights]);
  const scrub = useDayScrub(hasBar, slot, onScrubChange);
  if (nights.length === 0) return null;

  const most = Math.max(...nights.map(n => n.minutes), goalMinutes ?? 0, MIN_HOURS_DOMAIN);
  const top = Math.ceil(most / 120) * 120;
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
            {scrub.index !== null && (
              <Line
                x1={(scrub.index + 0.5) * slot}
                x2={(scrub.index + 0.5) * slot}
                y1={0}
                y2={CHART_HEIGHT}
                stroke={colors.textTertiary}
                strokeWidth={1}
              />
            )}
          </Svg>
        )}
        <View style={styles.touch} {...scrub.panHandlers} />
        {scrub.index !== null && (() => {
          const night = byDay.get(dayKeys[scrub.index]);
          if (!night) return null;
          const height = TOOLTIP_LINE_HEIGHT + spacing.xs * 2;
          const barTop = y(night.minutes);
          return (
            <View
              style={[
                styles.tooltip,
                { left: tooltipLeftFor(scrub.index, slot, plotWidth), top: Math.max(0, barTop - height - spacing.xs), height },
              ]}
              pointerEvents="none"
            >
              <Text style={styles.tooltipText}>
                {format(dayKeyToDate(night.dayKey), 'MMM d')} · {formatSleepDuration(night.minutes)}
              </Text>
            </View>
          );
        })()}
      </View>
      <DayAxis dayKeys={dayKeys} styles={styles} />
    </View>
  );
}

/**
 * A stage's colour. Four hues that read as four things rather than as a
 * scale, so no stage looks like the "good" one: there is deliberately no
 * green and no red, and nothing here says how much of a stage is enough.
 */
export function sleepStageColor(stage: keyof SleepStages, colors: Colors): string {
  switch (stage) {
    case 'awake': return colors.orange;
    case 'rem': return colors.tagPalette[7];
    case 'core': return colors.accent;
    case 'deep': return colors.timeNight;
  }
}

interface StagesProps {
  stages: SleepStages;
  /** Read out ahead of the figures, e.g. "Most recent sleep" or "Average". */
  label: string;
  /** False for the legend alone, under a chart that already draws the proportions. */
  showBar?: boolean;
}

/**
 * One night's (or an average night's) stages as a single stacked bar, with a
 * legend giving each stage's time. The legend carries the figures, so the bar
 * is an aid to reading them, the rule `ContrastBars` states for its own pair.
 */
export function SleepStagesBar({ stages, label, showBar = true }: StagesProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const total = SLEEP_STAGE_ORDER.reduce((sum, k) => sum + stages[k], 0);
  if (total <= 0) return null;
  const spoken = SLEEP_STAGE_ORDER
    .map(k => `${SLEEP_STAGE_LABEL[k]} ${formatSleepDuration(stages[k])}`)
    .join(', ');
  return (
    <View accessible accessibilityLabel={`${label} stages: ${spoken}.`}>
      {showBar && (
        <View style={styles.stageTrack}>
          {SLEEP_STAGE_ORDER.map(k => stages[k] > 0 && (
            <View key={k} style={{ flex: stages[k], backgroundColor: sleepStageColor(k, colors) }} />
          ))}
        </View>
      )}
      <View style={[styles.stageLegend, !showBar && styles.stageLegendAlone]}>
        {SLEEP_STAGE_ORDER.map(k => (
          <View key={k} style={styles.stageItem}>
            <View style={[styles.stageDot, { backgroundColor: sleepStageColor(k, colors) }]} />
            <Text style={styles.stageName}>{SLEEP_STAGE_LABEL[k]}</Text>
            <Text style={styles.stageValue}>{formatSleepDuration(stages[k])}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const TIMELINE_ROW_HEIGHT = 30;
const TIMELINE_HEIGHT = TIMELINE_ROW_HEIGHT * SLEEP_STAGE_ORDER.length;
const TIMELINE_BLOCK_INSET = 5;
const TIMELINE_TICK_WIDTH = 56;

interface TimelineProps {
  /** A night with stages and segments; the screen picks which one. */
  night: SleepNight;
  use24Hour: boolean;
}

/**
 * One night's stages along the clock: a row per stage in the order Health
 * lists them (awake at the top, deep at the bottom), a block wherever the night
 * was in that stage, and a thin line joining each block to the next.
 *
 * The axis runs from falling asleep to waking, the same stretch the times chart
 * draws as one bar, so the two read against each other. Only the stretches the
 * Watch recorded are drawn: nothing is interpolated across a gap, and no stage
 * is coloured as better than another (`sleepStageColor`). The legend and totals
 * beside it are `SleepStagesBar`'s, since the figures are the record and this
 * is an aid to reading them.
 */
export function SleepStageTimeline({ night, use24Hour }: TimelineProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const total = (night.wokeAt.getTime() - night.asleepAt.getTime()) / 60000;
  if (night.segments.length === 0 || total <= 0) return null;

  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const x = (minutes: number) => (minutes / total) * plotWidth;
  const rowOf = (stage: keyof SleepStages) => SLEEP_STAGE_ORDER.indexOf(stage);
  const ticks = timelineTicks(night.asleepAt, night.wokeAt);
  const summary = `Sleep stages through the night, from ${
    formatClockMinutes(clockOf(night.asleepAt), use24Hour)} to ${formatClockMinutes(clockOf(night.wokeAt), use24Hour)}.`;

  return (
    <View accessible accessibilityLabel={summary} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ height: TIMELINE_HEIGHT }}>
        {SLEEP_STAGE_ORDER.map((stage, i) => (
          <Text key={stage} style={[styles.axisLabel, { top: i * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2 - 7 }]}>
            {SLEEP_STAGE_LABEL[stage]}
          </Text>
        ))}
        {width > 0 && (
          <Svg width={plotWidth} height={TIMELINE_HEIGHT} style={styles.svg}>
            {SLEEP_STAGE_ORDER.slice(1).map((stage, i) => (
              <Line
                key={stage}
                x1={0}
                x2={plotWidth}
                y1={(i + 1) * TIMELINE_ROW_HEIGHT}
                y2={(i + 1) * TIMELINE_ROW_HEIGHT}
                stroke={colors.separator}
                strokeWidth={1}
              />
            ))}
            {night.segments.map((seg, i) => {
              const prev = i > 0 ? night.segments[i - 1] : null;
              const mid = (stage: keyof SleepStages) => rowOf(stage) * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2;
              return (
                <React.Fragment key={`${seg.from}-${seg.stage}`}>
                  {prev && prev.stage !== seg.stage && (
                    <Line
                      x1={x(seg.from)}
                      x2={x(seg.from)}
                      y1={mid(prev.stage)}
                      y2={mid(seg.stage)}
                      stroke={colors.separator}
                      strokeWidth={1.5}
                    />
                  )}
                  <Rect
                    x={x(seg.from)}
                    y={rowOf(seg.stage) * TIMELINE_ROW_HEIGHT + TIMELINE_BLOCK_INSET}
                    width={Math.max(MIN_BAR_WIDTH, x(seg.to) - x(seg.from) - 1)}
                    height={TIMELINE_ROW_HEIGHT - TIMELINE_BLOCK_INSET * 2}
                    rx={4}
                    fill={sleepStageColor(seg.stage, colors)}
                  />
                </React.Fragment>
              );
            })}
          </Svg>
        )}
      </View>
      <View style={styles.timelineAxis}>
        {width > 0 && ticks.map(t => (
          <Text
            key={t.at.getTime()}
            style={[styles.timelineTick, { left: AXIS_WIDTH + t.fraction * plotWidth - TIMELINE_TICK_WIDTH / 2 }]}
          >
            {formatHour(t.at.getHours(), use24Hour)}
          </Text>
        ))}
      </View>
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
  touch: { position: 'absolute', left: AXIS_WIDTH, right: 0, top: 0, bottom: 0 },
  tooltip: {
    position: 'absolute',
    width: TOOLTIP_WIDTH,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  tooltipText: {
    fontSize: font.xs,
    lineHeight: TOOLTIP_LINE_HEIGHT,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  tooltipDetail: {
    fontSize: font.xs,
    lineHeight: TOOLTIP_LINE_HEIGHT,
    color: colors.textSecondary,
    textAlign: 'center',
  },
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
  timelineAxis: { height: 16, marginTop: spacing.xs },
  timelineTick: {
    position: 'absolute',
    top: 0,
    width: TIMELINE_TICK_WIDTH,
    textAlign: 'center',
    fontSize: font.xxs,
    color: colors.textSecondary,
  },
  stageTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: colors.bgTertiary,
    gap: 2,
  },
  stageLegend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.smd, rowGap: spacing.sm },
  stageLegendAlone: { marginTop: spacing.md },
  stageItem: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: spacing.xsm },
  stageDot: { width: 8, height: 8, borderRadius: 4 },
  stageName: { fontSize: font.sm, color: colors.textSecondary },
  stageValue: { fontSize: font.sm, color: colors.text, fontWeight: fontWeight.semibold },
});
