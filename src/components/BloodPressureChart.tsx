import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useColors } from '../theme/ThemeContext';
import { useGuideGutter } from './ChartGuides';
import { spacing, font, type Colors } from '../theme';
import {
  bloodPressureDomain,
  bloodPressureTicks,
  readingSegments,
  type BloodPressureReading,
} from '../utils/bloodPressureLog';

/**
 * Blood pressure over a range: the top and bottom numbers as two lines on one
 * axis, with a dot for every reading.
 *
 * `WeightChart`'s honesty rules carry over: the axis is windowed to the data and
 * never starts at zero, the line breaks across a gap over two weeks
 * (`readingSegments`), and every reading is a dot so the chart shows how much of
 * itself is data. Readings sit at their real time, since several a day is
 * ordinary. **There are no bands, zones or colours that rate a value.** The two
 * lines differ by colour and by weight only (the top number is the stronger
 * one), and a legend under the plot names them.
 *
 * One accessibility element with a spoken summary rather than one per reading,
 * and no scrub: the readings list under it carries each exact value.
 */

const CHART_HEIGHT = 160;
const VERTICAL_INSET = 12;
const DOT_RADIUS = 3;
const LABEL_WIDTH = 30;

interface Props {
  readings: BloodPressureReading[];
  /** The range's first and last instant, which put the dots on a time axis. */
  startMs: number;
  endMs: number;
  /** The spoken summary, written by the screen, which knows the range's name. */
  summary: string;
}

export function BloodPressureChart({ readings, startMs, endMs, summary }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const gutter = useGuideGutter(LABEL_WIDTH);
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const domain = useMemo(() => bloodPressureDomain(readings), [readings]);
  const segments = useMemo(() => readingSegments(readings), [readings]);
  if (!domain) return null;

  const plotHeight = CHART_HEIGHT - VERTICAL_INSET * 2;
  const yFor = (mmHg: number) =>
    VERTICAL_INSET + (1 - (mmHg - domain.min) / (domain.max - domain.min)) * plotHeight;
  const span = Math.max(endMs - startMs, 1);
  const plotWidth = Math.max(width - gutter - DOT_RADIUS * 2, 0);
  const xFor = (at: Date) =>
    gutter + DOT_RADIUS + Math.min(Math.max((at.getTime() - startMs) / span, 0), 1) * plotWidth;

  const line = (pick: (r: BloodPressureReading) => number) => (segment: BloodPressureReading[]) =>
    segment.map(r => `${xFor(r.at)},${yFor(pick(r))}`).join(' ');
  const systolicPoints = line(r => r.systolic);
  const diastolicPoints = line(r => r.diastolic);

  return (
    <View accessible accessibilityLabel={summary}>
      <View style={styles.plot} onLayout={onLayout}>
        {width > 0 && (
          <Svg width={width} height={CHART_HEIGHT}>
            {bloodPressureTicks(domain).map(tick => (
              <Line
                key={`tick-${tick}`}
                x1={gutter}
                y1={yFor(tick)}
                x2={width}
                y2={yFor(tick)}
                stroke={colors.separator}
                strokeOpacity={0.6}
                strokeWidth={1}
              />
            ))}
            {segments.map((segment, i) => (
              <React.Fragment key={`segment-${i}`}>
                {segment.length > 1 && (
                  <>
                    <Polyline
                      points={diastolicPoints(segment)}
                      fill="none"
                      stroke={colors.textSecondary}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <Polyline
                      points={systolicPoints(segment)}
                      fill="none"
                      stroke={colors.accent}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </>
                )}
                {segment.map(r => (
                  <React.Fragment key={r.at.toISOString()}>
                    <Circle cx={xFor(r.at)} cy={yFor(r.diastolic)} r={DOT_RADIUS} fill={colors.textSecondary} />
                    <Circle cx={xFor(r.at)} cy={yFor(r.systolic)} r={DOT_RADIUS} fill={colors.accent} />
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </Svg>
        )}
        {width > 0 && bloodPressureTicks(domain).map(tick => (
          <Text
            key={`label-${tick}`}
            style={[styles.tickLabel, { top: yFor(tick) - 8, width: gutter - spacing.xs }]}
            allowFontScaling={false}
          >
            {tick}
          </Text>
        ))}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.accent }]} />
          <Text style={styles.legendText}>Top number</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.textSecondary }]} />
          <Text style={styles.legendText}>Bottom number</Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  plot: { height: CHART_HEIGHT, width: '100%' },
  tickLabel: {
    position: 'absolute',
    left: 0,
    textAlign: 'right',
    fontSize: font.xxs,
    color: colors.textSecondary,
  },
  legend: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm },
  swatch: { width: 12, height: 3, borderRadius: 2 },
  legendText: { fontSize: font.xs, color: colors.textSecondary },
});
