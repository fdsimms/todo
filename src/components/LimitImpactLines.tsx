import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, radius, spacing, type Colors } from '../theme';
import {
  describeLimitFigures,
  describeLimitImpact,
  limitImpactLabel,
  type LimitImpact,
} from '../utils/nutritionTargets';

/** One headline figure above the limits: "102" over "cal". */
export interface EntryStat {
  value: string;
  label: string;
}

/**
 * What an entry about to be logged would do, as one card: the entry's own
 * figures (`stats`) across the top, then one row per limit it would move
 * ("Saturated fat … 16.8 of 16 g" over a bar of how full the day's limit is).
 * Renders nothing when there is neither, so a sheet can mount it
 * unconditionally. A limit that is taken or kept past is red, the colour the
 * Food log's bar uses for the same state, and says nothing more about how far:
 * the figures beside it already do. The rest are the secondary grey, since
 * they are information rather than a warning.
 */
export function LimitImpactLines({
  impacts,
  stats,
  style,
}: {
  impacts: LimitImpact[];
  stats?: EntryStat[];
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hasStats = !!stats && stats.length > 0;
  if (impacts.length === 0 && !hasStats) return null;
  return (
    <View style={[styles.card, style]}>
      {hasStats && (
        <View style={styles.stats}>
          {stats.map((stat, i) => (
            <View key={stat.label} style={[styles.stat, i > 0 && styles.statDivided]}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      )}
      {impacts.map((impact, i) => {
        const over = impact.status === 'over';
        const fill = Math.min(1, impact.target > 0 ? impact.after / impact.target : 1);
        return (
          <View
            key={impact.key}
            style={[styles.row, (hasStats || i > 0) && styles.rowDivided]}
            accessible
            accessibilityLabel={describeLimitImpact(impact)}
          >
            <View style={styles.rowTop}>
              <Text style={styles.rowName} numberOfLines={1}>{limitImpactLabel(impact)}</Text>
              <Text style={[styles.rowFigures, over && styles.over]}>{describeLimitFigures(impact)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, over && styles.fillOver, { width: `${Math.round(fill * 100)}%` }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
    stats: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
    stat: { flex: 1 },
    statDivided: { borderLeftWidth: border.hairline, borderLeftColor: colors.separator, paddingLeft: spacing.md },
    statValue: { color: colors.text, fontSize: font.xl, fontWeight: fontWeight.semibold },
    statLabel: { color: colors.textSecondary, fontSize: font.xs },
    row: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
    rowDivided: { borderTopWidth: border.hairline, borderTopColor: colors.separator },
    // The name is the part that must win the row, so the figures are the
    // short, fixed side and the name truncates last.
    rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.smd },
    rowName: { flexShrink: 1, color: colors.text, fontSize: font.md },
    rowFigures: { color: colors.textSecondary, fontSize: font.sm },
    over: { color: colors.redText, fontWeight: fontWeight.semibold },
    track: { height: 6, borderRadius: 3, backgroundColor: colors.bgQuaternary, marginTop: spacing.sm, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3, backgroundColor: colors.textTertiary },
    fillOver: { backgroundColor: colors.red },
  });
}
