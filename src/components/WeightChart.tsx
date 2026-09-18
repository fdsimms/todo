import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyToDate } from '../utils/dateUtils';
import {
  formatWeight,
  weightDomain,
  weightFraction,
  weightPlotPoints,
  weightSegments,
  weightTrendPoints,
  weightTrendSegments,
  type WeightPoint,
  type WeightUnit,
} from '../utils/weightLog';
import type { PacePlotPoint } from '../utils/weightGoal';

/**
 * Body weight over a window of days: the app's first line chart.
 *
 * **Why a line rather than the bars every other chart here draws.** The four
 * existing charts (three on Stats, one on Mood) plot counts, where zero is a
 * real value and a bar's length *is* the quantity — a zero baseline is the
 * honest drawing of "you completed nothing". A body sits in a narrow band a
 * long way from zero, so bars from a zero baseline are 180 identical
 * full-height columns, and bars scaled to the data are a row of stalagmites
 * whose lengths mean nothing. The quantity worth drawing here is the
 * *movement*, which is what a line drawn over a windowed domain shows and what
 * neither bar treatment can.
 *
 * Drawn with `react-native-svg`, already in the tree for `PinIcon` and
 * `ScrollEdgeFade` — the same precedent that file cites for reaching for it.
 *
 * **Three things keep it honest, and all three were deliberate choices against
 * an easier drawing:**
 *
 * - The y-domain never starts at zero and never scales to the data alone
 *   (`weightDomain`), so a week in which somebody's weight moved 200g is drawn
 *   as a nearly flat line rather than as a mountain range.
 * - The line breaks across gaps longer than a fortnight (`weightSegments`),
 *   because a straight line across a three-month gap draws every day nobody
 *   measured.
 * - Every reading gets a dot. The line between two dots is interpolation and
 *   the dots are the measurements, so the chart shows how much of itself is
 *   actually data — the same duty `MoodScreen`'s "a flat line is a day with
 *   nothing logged" caption discharges for its own gaps.
 *
 * A second, fainter line underneath is `weightTrendPoints`' 7-day trailing
 * average — dotless, so it reads as background shape rather than as a second
 * set of measurements, and broken at the same gaps the raw line is (see that
 * function's own note on why the two must agree). It is arithmetic over the
 * same dots already on screen, not a new claim: no slope is fitted and no
 * direction is named, which keeps it on the right side of the "nothing here
 * interprets a body" rule `weightLog.ts` states at its top.
 *
 * It is one accessibility element with a spoken summary rather than one per
 * reading, unlike the mood chart's fourteen columns: a year's window is up to
 * 365 of them, which is a wall to swipe through rather than a chart to read.
 * The summary names the count and the range, which is what the drawing says,
 * and says nothing about the trend line — it is a smoothing of the same
 * numbers the summary already covers, not a second reading.
 *
 * **Touch-and-drag scrubs the line.** A finger anywhere over the plot snaps to
 * the nearest actual reading and shows its date, its weight, and (when there
 * are enough readings nearby to have one) its 7-day average — the same three
 * numbers already drawn, read out for one point instead of inferred from the
 * shape. It never states more than that: no distance from the target, no
 * verdict on the trend, same "nothing here interprets a body" line the rest of
 * the file holds. The scrub is a `PanResponder` (the pattern `ReorderableList`
 * already uses in this app) rather than `react-native-gesture-handler`, since
 * a single free-floating touch region needs none of the simultaneous-gesture
 * arbitration that library is for. It changes nothing about the single
 * accessibility element above: the touch layer has no accessible children of
 * its own, so a screen-reader user still gets just the spoken summary.
 */

const CHART_HEIGHT = 160;
const DOT_RADIUS = 2.5;
/** Keeps a dot at the very top or bottom of the domain from being clipped. */
const VERTICAL_INSET = DOT_RADIUS + 1;
/**
 * How faint the trend line is drawn, as an SVG `opacity` on the same accent
 * stroke the raw line uses — not a second color, so there is no new hex value
 * to keep in step with the theme. Faint enough to read as background shape
 * under the raw line's dots, not faint enough to disappear against `bg`.
 */
const TREND_LINE_OPACITY = 0.35;

/**
 * The dash pattern both plan lines use, in SVG user units.
 *
 * One pattern rather than two, because the target and the pace are one claim
 * drawn as two strokes: a horizontal line at the number and a diagonal
 * arriving at it. Giving them separate treatments would read as two unrelated
 * things on the chart rather than as the plan against the readings.
 */
const PLAN_DASH = '4 4';

/** Fixed rather than measured — a tooltip that reflows as it appears reads as a glitch. */
const TOOLTIP_WIDTH = 148;

interface Props {
  /** One entry per day in the window, oldest first, null where nothing was logged. */
  points: WeightPoint[];
  unit: WeightUnit;
  /**
   * The goal's target, drawn as a horizontal line and given room in the
   * y-domain. Omitted when there is no goal, which leaves the chart exactly as
   * it was.
   */
  targetKg?: number | null;
  /** The pace line's vertices, indexed into `points`. Empty or omitted draws none. */
  pacePoints?: PacePlotPoint[];
}

/**
 * **The two plan lines are grey and dashed, and that is load-bearing rather
 * than decorative.** Everything in the accent colour on this chart is something
 * that happened: the readings, and an average of the readings. The target and
 * the pace are neither, and a solid accent line for them would put a plan and a
 * measurement in the same visual language on a chart whose whole design is
 * about not doing that (see the three rules above). They share one colour and
 * one dash pattern because together they are one statement.
 */
export function WeightChart({ points, unit, targetKg, pacePoints }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);

  const domain = useMemo(() => weightDomain(points, targetKg), [points, targetKg]);
  const segments = useMemo(() => weightSegments(points), [points]);
  const trendSegments = useMemo(() => weightTrendSegments(points), [points]);
  // One entry per actual reading, in step with each other (both built from the
  // same reading list) — so `trendPoints[i]` is the trailing average as of
  // `plotPoints[i]`, which is what makes the scrub below a plain index lookup.
  const plotPoints = useMemo(() => weightPlotPoints(points), [points]);
  const trendPoints = useMemo(() => weightTrendPoints(points), [points]);

  const summary = useMemo(() => {
    const all = segments.flat();
    if (all.length === 0) return 'Weight chart, nothing logged';
    let low = all[0].kilograms;
    let high = all[0].kilograms;
    for (const point of all) {
      if (point.kilograms < low) low = point.kilograms;
      if (point.kilograms > high) high = point.kilograms;
    }
    const count = `${all.length} ${all.length === 1 ? 'reading' : 'readings'}`;
    const range = low === high
      ? `Weight chart, ${count}, ${formatWeight(low, unit)}`
      : `Weight chart, ${count}, between ${formatWeight(low, unit)} and ${formatWeight(high, unit)}`;
    // The target is named because it changes what the drawing shows; the pace
    // line is not, for the reason the trend line isn't — it is the target and
    // the rate restated as a line, and the goal card says both in words.
    return targetKg === undefined || targetKg === null
      ? range
      : `${range}. Target ${formatWeight(targetKg, unit)}`;
  }, [segments, unit, targetKg]);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  // A single-day window has no span to divide by, so its one reading is drawn
  // in the middle rather than at x=0 with a NaN beside it.
  const lastIndex = Math.max(1, points.length - 1);
  const xFor = (index: number) => (index / lastIndex) * width;

  // The scrubbed reading, by its position in `plotPoints`/`trendPoints` — not a
  // dayKey, so a touch between two readings resolves to whichever is nearer in
  // one comparison rather than a lookup.
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const scrubIndexRef = useRef<number | null>(null);

  const scrubTo = (event: GestureResponderEvent) => {
    if (plotPoints.length === 0 || width === 0) return;
    const x = event.nativeEvent.locationX;
    let nearest = 0;
    let nearestDistance = Infinity;
    for (let i = 0; i < plotPoints.length; i++) {
      const distance = Math.abs(xFor(plotPoints[i].index) - x);
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
    // Claimed on touch-down rather than after some horizontal movement, so a
    // plain tap (no drag at all) still shows the tooltip for that point. The
    // cost — the same trade `PaintSelection` documents for its own gutter — is
    // that a scroll gesture starting with a finger already on the plot begins
    // a scrub instead: the screen still scrolls from anywhere else on it.
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: scrubTo,
    onPanResponderMove: scrubTo,
    onPanResponderRelease: endScrub,
    onPanResponderTerminate: endScrub,
    onPanResponderTerminationRequest: () => false,
  }), [plotPoints, width]);

  // The caller draws an empty state instead; a chart of nothing is a box.
  if (!domain) return null;

  const plotHeight = CHART_HEIGHT - VERTICAL_INSET * 2;
  const yFor = (kilograms: number) =>
    VERTICAL_INSET + (1 - weightFraction(kilograms, domain)) * plotHeight;

  const scrubbed = scrubIndex !== null ? plotPoints[scrubIndex] : null;
  const scrubbedTrend = scrubIndex !== null ? trendPoints[scrubIndex] : null;
  const tooltipLeft = scrubbed
    ? Math.min(Math.max(xFor(scrubbed.index) - TOOLTIP_WIDTH / 2, 0), Math.max(width - TOOLTIP_WIDTH, 0))
    : 0;
  const tooltipHeight = scrubbedTrend ? 44 : 24;
  const tooltipTop = scrubbed
    ? Math.max(0, Math.min(yFor(scrubbed.kilograms) - tooltipHeight - 10, CHART_HEIGHT - tooltipHeight))
    : 0;

  return (
    <View accessible accessibilityLabel={summary}>
      <View style={styles.plot} onLayout={onLayout} {...panResponder.panHandlers}>
        {width > 0 && (
          <Svg width={width} height={CHART_HEIGHT}>
            {/* Drawn first so the readings sit on top of the plan, never under it. */}
            {targetKg !== undefined && targetKg !== null && (
              <Line
                x1={0}
                y1={yFor(targetKg)}
                x2={width}
                y2={yFor(targetKg)}
                stroke={colors.textTertiary}
                strokeWidth={1}
                strokeDasharray={PLAN_DASH}
              />
            )}
            {pacePoints !== undefined && pacePoints.length > 1 && (
              <Polyline
                points={pacePoints.map(p => `${xFor(p.index)},${yFor(p.kilograms)}`).join(' ')}
                fill="none"
                stroke={colors.textTertiary}
                strokeWidth={1}
                strokeDasharray={PLAN_DASH}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {trendSegments.map((segment, i) => segment.length > 1 && (
              <Polyline
                key={`trend-${i}`}
                points={segment.map(p => `${xFor(p.index)},${yFor(p.kilograms)}`).join(' ')}
                fill="none"
                stroke={colors.accent}
                strokeOpacity={TREND_LINE_OPACITY}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {segments.map((segment, i) => (
              <React.Fragment key={`segment-${i}`}>
                {segment.length > 1 && (
                  <Polyline
                    points={segment.map(p => `${xFor(p.index)},${yFor(p.kilograms)}`).join(' ')}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {segment.map(p => (
                  <Circle
                    key={p.dayKey}
                    cx={xFor(p.index)}
                    cy={yFor(p.kilograms)}
                    r={DOT_RADIUS}
                    fill={colors.accent}
                  />
                ))}
              </React.Fragment>
            ))}
            {scrubbed && (
              <>
                <Line
                  x1={xFor(scrubbed.index)}
                  y1={0}
                  x2={xFor(scrubbed.index)}
                  y2={CHART_HEIGHT}
                  stroke={colors.textTertiary}
                  strokeWidth={1}
                />
                <Circle
                  cx={xFor(scrubbed.index)}
                  cy={yFor(scrubbed.kilograms)}
                  r={DOT_RADIUS + 3}
                  fill="none"
                  stroke={colors.accent}
                  strokeWidth={2}
                />
              </>
            )}
          </Svg>
        )}
        <Text style={[styles.axis, styles.axisTop]}>{formatWeight(domain.max, unit)}</Text>
        <Text style={[styles.axis, styles.axisBottom]}>{formatWeight(domain.min, unit)}</Text>
        {scrubbed && (
          <View
            style={[styles.tooltip, { left: tooltipLeft, top: tooltipTop, height: tooltipHeight }]}
            pointerEvents="none"
          >
            <Text style={styles.tooltipText}>
              {format(dayKeyToDate(scrubbed.dayKey), 'MMM d')} · {formatWeight(scrubbed.kilograms, unit)}
            </Text>
            {scrubbedTrend && (
              <Text style={styles.tooltipSubtext}>7-day avg {formatWeight(scrubbedTrend.kilograms, unit)}</Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  plot: { height: CHART_HEIGHT, justifyContent: 'center' },
  axis: {
    position: 'absolute',
    right: 0,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
    color: colors.textTertiary,
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.xs,
  },
  axisTop: { top: 0 },
  axisBottom: { bottom: 0 },
  tooltip: {
    position: 'absolute',
    width: TOOLTIP_WIDTH,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  tooltipText: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  tooltipSubtext: {
    fontSize: font.xxs,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: 1,
  },
});
