import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  chartDomain,
  chartPoints,
  chartSegments,
  domainFraction,
  minTickGapDays,
  monthTicks,
  recordIndexes,
  type ChartPoint,
} from '../utils/exerciseChart';

/**
 * One exercise over time: a line through each session's figure, a dot per
 * session, the line broken across a long layoff, and a finger that scrubs. The
 * `WeightChart` shape (see its note for the three rules it keeps, which this
 * keeps too): the y axis is never anchored at zero and never scaled to the data
 * alone, a break is a stretch with no sessions, and every dot is a measurement.
 *
 * The dot for the latest record is `colors.done`, the gold of finishing. Only
 * the latest: a line of eleven gold dots says nothing, and "when did I last
 * beat it" is the question. A series that only ever fell has none.
 *
 * It is one accessibility element with a spoken summary, for `WeightChart`'s
 * reason (a year of sessions is a wall to swipe through). The summary says what
 * is drawn, and the caller supplies the words for a value so the chart knows
 * nothing about kilograms or reps.
 *
 * The scrub is a `PanResponder`, claimed on touch-down so a tap alone shows its
 * point: the trade `WeightChart` documents.
 */

const CHART_HEIGHT = 150;
const AXIS_GUTTER = 34;
const DOT_RADIUS = 3.5;
const LATEST_RADIUS = 5;
const VERTICAL_INSET = LATEST_RADIUS + 2;
/** Keeps the first and last dots from being cut by the edge of the drawing. */
const X_INSET = LATEST_RADIUS + 2;
const TOOLTIP_WIDTH = 150;
const LABEL_ROW_HEIGHT = 18;

export interface ExerciseChartPoint {
  dayKey: string;
  value: number;
  /** The reading as text, for the scrub tooltip. */
  text: string;
}

interface Props {
  points: readonly ExerciseChartPoint[];
  /** An axis label for a value. */
  formatAxis: (value: number) => string;
  /** The spoken summary of the whole chart, without the points. */
  summary: string;
}

const dayLabel = (dayKey: string) => format(new Date(`${dayKey}T12:00:00`), 'MMM d');

export function ExerciseProgressChart({ points, formatAxis, summary }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);

  const series = useMemo(() => chartPoints(points), [points]);
  const textByDay = useMemo(() => new Map(points.map(p => [`${p.dayKey}|${p.value}`, p.text])), [points]);
  const segments = useMemo(() => chartSegments(series), [series]);
  const domain = useMemo(() => chartDomain(series.map(p => p.value)), [series]);
  const latestRecord = useMemo(() => {
    const idx = recordIndexes(series);
    return idx.length > 0 ? series[idx[idx.length - 1]] : null;
  }, [series]);

  const plotWidth = Math.max(0, width - AXIS_GUTTER);
  const span = series.length > 0 ? series[series.length - 1].dayIndex : 0;
  // One session, or sessions all on one day, have no span to divide by: draw
  // them in the middle rather than at x=0 with a NaN beside it.
  const xAtDay = (dayIndex: number) =>
    span === 0 ? plotWidth / 2 : X_INSET + (dayIndex / span) * Math.max(0, plotWidth - X_INSET * 2);
  const xFor = (p: ChartPoint) => xAtDay(p.dayIndex);

  const ticks = useMemo(
    () => (series.length > 0
      ? monthTicks(series[0].dayKey, series[series.length - 1].dayKey, minTickGapDays(span, plotWidth))
      : []),
    [series, span, plotWidth],
  );

  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const scrubTo = (event: GestureResponderEvent) => {
    if (series.length === 0 || plotWidth === 0) return;
    const x = event.nativeEvent.locationX;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < series.length; i++) {
      const d = Math.abs(xFor(series[i]) - x);
      if (d < best) { best = d; nearest = i; }
    }
    if (nearest !== scrubRef.current) haptics.dragTick();
    scrubRef.current = nearest;
    setScrubIndex(nearest);
  };
  const endScrub = () => {
    scrubRef.current = null;
    setScrubIndex(null);
  };
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: scrubTo,
    onPanResponderMove: scrubTo,
    onPanResponderRelease: endScrub,
    onPanResponderTerminate: endScrub,
    onPanResponderTerminationRequest: () => false,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [series, plotWidth]);

  if (!domain || series.length === 0) return null;

  const plotHeight = CHART_HEIGHT - VERTICAL_INSET * 2;
  const yFor = (value: number) => VERTICAL_INSET + (1 - domainFraction(value, domain)) * plotHeight;
  const mid = (domain.min + domain.max) / 2;
  const gridValues = [domain.max, mid, domain.min];

  const scrubbed = scrubIndex !== null ? series[scrubIndex] : null;
  const tooltipLeft = scrubbed
    ? Math.min(Math.max(xFor(scrubbed) - TOOLTIP_WIDTH / 2, 0), Math.max(plotWidth - TOOLTIP_WIDTH, 0))
    : 0;
  const tooltipTop = scrubbed ? Math.max(0, Math.min(yFor(scrubbed.value) - 52, CHART_HEIGHT - 44)) : 0;

  return (
    <View accessible accessibilityLabel={summary}>
      <View style={styles.plot} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} {...panResponder.panHandlers}>
        {width > 0 && (
          <Svg width={width} height={CHART_HEIGHT}>
            {gridValues.map(v => (
              <Line
                key={v}
                x1={0}
                x2={plotWidth}
                y1={yFor(v)}
                y2={yFor(v)}
                stroke={colors.separator}
                strokeOpacity={0.5}
                strokeWidth={1}
              />
            ))}
            {segments.map((segment, i) => (
              <React.Fragment key={`segment-${i}`}>
                {segment.length > 1 && (
                  <Polyline
                    points={segment.map(p => `${xFor(p)},${yFor(p.value)}`).join(' ')}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {segment.map((p, j) => (
                  <Circle
                    key={`${p.dayKey}-${j}`}
                    cx={xFor(p)}
                    cy={yFor(p.value)}
                    r={DOT_RADIUS}
                    fill={colors.accent}
                  />
                ))}
              </React.Fragment>
            ))}
            {latestRecord && (
              <Circle
                cx={xFor(latestRecord)}
                cy={yFor(latestRecord.value)}
                r={LATEST_RADIUS}
                fill={colors.done}
                stroke={colors.bgSecondary}
                strokeWidth={2}
              />
            )}
            {scrubbed && (
              <>
                <Line x1={xFor(scrubbed)} x2={xFor(scrubbed)} y1={0} y2={CHART_HEIGHT} stroke={colors.textTertiary} strokeWidth={1} />
                <Circle cx={xFor(scrubbed)} cy={yFor(scrubbed.value)} r={DOT_RADIUS + 3} fill="none" stroke={colors.accent} strokeWidth={2} />
              </>
            )}
          </Svg>
        )}
        {width > 0 && gridValues.map(v => (
          <Text key={`axis-${v}`} style={[styles.axis, { top: yFor(v) - 8, right: 0 }]}>{formatAxis(v)}</Text>
        ))}
        {scrubbed && (
          <View style={[styles.tooltip, { left: tooltipLeft, top: tooltipTop }]} pointerEvents="none">
            <Text style={styles.tooltipText}>{`${dayLabel(scrubbed.dayKey)} · ${textByDay.get(`${scrubbed.dayKey}|${scrubbed.value}`) ?? ''}`}</Text>
          </View>
        )}
      </View>
      {width > 0 && (
        <View style={styles.months} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {ticks.map(t => (
            <Text key={t.dayKey} style={[styles.month, { left: Math.max(0, Math.min(xAtDay(t.dayIndex) - X_INSET, plotWidth - 24)) }]}>
              {t.label}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  plot: { height: CHART_HEIGHT },
  axis: {
    position: 'absolute', width: AXIS_GUTTER, paddingLeft: spacing.xs,
    fontSize: font.xxs, fontWeight: fontWeight.medium, color: colors.textTertiary, fontVariant: ['tabular-nums'],
  },
  months: { height: LABEL_ROW_HEIGHT, marginTop: spacing.xs },
  month: { position: 'absolute', top: 0, fontSize: font.xxs, fontWeight: fontWeight.medium, color: colors.textTertiary },
  tooltip: {
    position: 'absolute', width: TOOLTIP_WIDTH, backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, justifyContent: 'center',
  },
  tooltipText: { fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.text, textAlign: 'center' },
});
