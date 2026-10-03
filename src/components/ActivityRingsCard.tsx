import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';
import {
  RING_META,
  RING_ORDER,
  describeRing,
  isRingClosed,
  ringFraction,
  ringsAccessibilityLabel,
  type ActivityRings,
  type RingId,
} from '../utils/activityRings';

/**
 * Today's Move, Exercise and Stand rings, drawn the way Fitness draws them:
 * three concentric arcs, outermost first, with each ring's figure and goal
 * written beside it.
 *
 * **A ring with nothing to measure is not drawn at all**, rather than as an
 * empty track. A track with no arc on it reads as "none of this done", which
 * is a claim, and a missing figure is no claim either way (`activityRings.ts`).
 * A ring that has a goal and a real zero does get its track, because that one
 * is true.
 *
 * Fill is clamped at one lap. Fitness draws a second lap past a closed ring,
 * and that is decoration this does not repeat; the text still says the real
 * figure, which is the record.
 *
 * It is one accessibility element carrying a spoken summary, not three arcs
 * and three rows to swipe through.
 */

const SIZE = 104;
const STROKE = 11;
const GAP = 3;

// Fitness's own colors for the three rings, fixed: a ring is recognized by its
// color before its label, and this is one place where matching another app's
// meaning is the point rather than a drift from the theme.
function ringColor(id: RingId, colors: Colors): string {
  return id === 'move' ? colors.red : id === 'exercise' ? colors.green : colors.accent;
}

export function ActivityRingsCard({ rings }: { rings: ActivityRings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const drawn = RING_ORDER.filter(id => {
    const ring = rings[id];
    return ring.value !== null && ring.goal !== null;
  });
  const lines = RING_ORDER.filter(id => rings[id].value !== null);
  const label = ringsAccessibilityLabel(rings);

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={label ? `Activity rings today. ${label}` : 'Activity rings today'}
    >
      <View style={styles.row}>
        <Svg width={SIZE} height={SIZE} importantForAccessibility="no-hide-descendants">
          {drawn.map((id, index) => {
            const radius = SIZE / 2 - STROKE / 2 - index * (STROKE + GAP);
            const circumference = 2 * Math.PI * radius;
            const fraction = Math.min(1, ringFraction(rings[id]) ?? 0);
            const color = ringColor(id, colors);
            return (
              <React.Fragment key={id}>
                <Circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={radius}
                  stroke={color}
                  strokeOpacity={0.2}
                  strokeWidth={STROKE}
                  fill="none"
                />
                {fraction > 0 && (
                  <Circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={radius}
                    stroke={color}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${circumference * fraction} ${circumference}`}
                    // SVG circles start at three o'clock; Fitness starts at the top.
                    rotation={-90}
                    origin={`${SIZE / 2}, ${SIZE / 2}`}
                    fill="none"
                  />
                )}
              </React.Fragment>
            );
          })}
        </Svg>
        <View style={styles.legend}>
          {lines.map(id => (
            <View key={id} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: ringColor(id, colors) }]} />
              <View style={styles.legendText}>
                <Text style={styles.ringLabel}>
                  {RING_META[id].label}{isRingClosed(rings[id]) ? ' · closed' : ''}
                </Text>
                <Text style={styles.ringFigure}>{describeRing(id, rings[id])}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
      {rings.moveByTime && (
        <Text style={styles.note}>
          Your Move ring counts Move Time rather than calories, so it isn't shown here.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  legend: {
    flex: 1,
    gap: spacing.smd,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    flex: 1,
  },
  ringLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  ringFigure: {
    fontSize: font.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  note: {
    marginTop: spacing.smd,
    fontSize: font.xs,
    color: colors.textSecondary,
  },
});
